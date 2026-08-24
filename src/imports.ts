/**
 * Import — the two kinds of content that go into a disk. A **conversation** is
 * an append-only thread keyed by its name; a **document** is a static unit
 * identified by its `(folder_path, name)` path, so re-importing upserts.
 */

import type { ClientContext } from "./internal.js";
import { compact, required, slugOf } from "./internal.js";
import type {
  ContentsResponse,
  DiskRef,
  ImportChatParams,
  ImportChatResponse,
  ImportCursor,
  ImportDocumentParams,
  ImportDocumentResult,
  ImportUrlParams,
  ImportUrlResponse,
  RetryResponse,
  WaitUntilProcessedOptions,
} from "./types.js";
import { SmartDiskError, SmartDiskUsageError, SmartDiskWaitTimeoutError } from "./errors.js";

/** Imports and URL fetches can take a while; give them room over the default. */
const IMPORT_TIMEOUT_MS = 180_000;
const URL_TIMEOUT_MS = 240_000;

/** Defaults for {@link Imports.waitUntilProcessed}. */
const WAIT_POLL_INTERVAL_MS = 5_000;
const WAIT_TIMEOUT_MS = 600_000;
/**
 * How many consecutive clear polls end a wait. Consolidation runs in sub-passes
 * and its flag reads false *between* them, so one clear poll is not quiescence —
 * two consecutive ones are.
 */
const WAIT_CLEAR_POLLS = 2;

export class Imports {
  constructor(private readonly ctx: ClientContext) {}

  /**
   * Import a conversation. Passing a **slug** uses the by-slug route, which
   * resolves or creates the disk in the same call — a script then needs only a
   * key and a slug. Passing a uuid or a `Disk` imports into that known disk.
   *
   * Re-importing under the same `name` appends to the same thread; messages
   * carrying a `uuid` are deduplicated individually, so an overlapping batch
   * adds only what is new.
   */
  async chat(disk: DiskRef, params: ImportChatParams): Promise<ImportChatResponse> {
    if (!params?.messages?.length) throw new SmartDiskUsageError("messages is required");

    const slug = slugOf(disk);
    const shared = compact({
      name: params.name,
      folder_path: params.folder_path,
      persona: params.persona,
      source: params.source,
      aliases: params.aliases,
      messages: params.messages,
    });

    if (slug) {
      return this.ctx.transport.request<ImportChatResponse>({
        method: "POST",
        path: "sd/import/chatml",
        body: { disk_slug: slug, ...compact({ disk_name: params.disk_name }), ...shared },
        timeoutMs: IMPORT_TIMEOUT_MS,
      });
    }

    const uuid = await this.ctx.diskUuid(disk);
    return this.ctx.transport.request<ImportChatResponse>({
      method: "POST",
      path: `sd/disks/${uuid}/import/chatml`,
      body: shared,
      timeoutMs: IMPORT_TIMEOUT_MS,
    });
  }

  /**
   * Import a document. Text and markup formats go in `body`; binary formats
   * (`pdf`, `pptx`, `xlsx`, `xls`) and image formats go in `body_b64`.
   *
   * The `(folder_path, name)` pair is the document's identity: an unchanged body
   * at the same path is skipped, a changed one replaces the previous version. A
   * recognised AI chat-history export comes back as a `ChatExportResponse`
   * instead — it is imported as conversations, not as one giant text file.
   */
  async document(disk: DiskRef, params: ImportDocumentParams): Promise<ImportDocumentResult> {
    if (!params?.body && !params?.body_b64) {
      throw new SmartDiskUsageError("either body or body_b64 is required");
    }
    const uuid = await this.ctx.diskUuid(disk);
    return this.ctx.transport.request<ImportDocumentResult>({
      method: "POST",
      path: `sd/disks/${uuid}/import/doc`,
      body: compact({
        body: params.body,
        body_b64: params.body_b64,
        title: params.title,
        name: params.name,
        folder_path: params.folder_path,
        source: params.source,
        format: params.format,
      }),
      timeoutMs: IMPORT_TIMEOUT_MS,
    });
  }

  /**
   * Fetch a web page and import it as a document; a YouTube link imports the
   * video's transcript. The fetch happens before the response, so a failure is
   * reported immediately and no content is created.
   */
  async url(disk: DiskRef, params: ImportUrlParams): Promise<ImportUrlResponse> {
    required(params?.url, "url");
    const uuid = await this.ctx.diskUuid(disk);
    return this.ctx.transport.request<ImportUrlResponse>({
      method: "POST",
      path: `sd/disks/${uuid}/import/url`,
      body: compact({ url: params.url, name: params.name, folder_path: params.folder_path }),
      timeoutMs: URL_TIMEOUT_MS,
    });
  }

  /**
   * Where an incremental sync left off. Send only the messages strictly newer
   * than `(original_timestamp, original_uuid)`. The cursor lives with the disk,
   * so it stays correct even if the disk is rebuilt.
   */
  async cursor(disk: DiskRef): Promise<ImportCursor> {
    const uuid = await this.ctx.diskUuid(disk);
    return this.ctx.transport.request<ImportCursor>({
      method: "GET",
      path: `sd/disks/${uuid}/import/last`,
    });
  }

  /** Re-queue one source whose processing failed. */
  async retry(disk: DiskRef, contentUuid: string): Promise<RetryResponse> {
    const cuuid = required(contentUuid, "contentUuid");
    const uuid = await this.ctx.diskUuid(disk);
    return this.ctx.transport.request<RetryResponse>({
      method: "POST",
      path: `sd/disks/${uuid}/contents/${cuuid}/retry`,
    });
  }

  /**
   * Wait until the disk has settled: every source processed, and the
   * disk-level consolidation pass finished.
   *
   * Import is asynchronous in two stages. Per-source processing moves each
   * content `queued → processing → processed`; then a disk-level pass
   * consolidates the facts and supersedes whatever a newer source replaced.
   * Anything that reads memory before both are done reads a half-built disk.
   *
   * The second stage is why this needs a quiescence window rather than a single
   * check: consolidation runs in sub-passes and `consolidating` reads false
   * *between* them, so the disk has to look clear on two consecutive polls
   * before this resolves.
   *
   * Throws a `SmartDiskWaitTimeoutError` — naming how many sources were still
   * pending — when the deadline passes, and a `SmartDiskError` when a source
   * ends `failed`.
   */
  async waitUntilProcessed(
    disk: DiskRef,
    options: WaitUntilProcessedOptions = {},
  ): Promise<ContentsResponse> {
    const pollIntervalMs = options.pollIntervalMs ?? WAIT_POLL_INTERVAL_MS;
    const timeoutMs = options.timeoutMs ?? WAIT_TIMEOUT_MS;
    const uuid = await this.ctx.diskUuid(disk);
    const deadline = Date.now() + timeoutMs;

    let previous = "";
    let clear = 0;

    for (;;) {
      const listing = await this.ctx.transport.request<ContentsResponse>({
        method: "GET",
        path: `sd/disks/${uuid}/contents`,
      });
      const contents = listing?.contents ?? [];
      const consolidating = listing?.consolidating === true;

      const failed = contents.filter((row) => row.status === "failed");
      if (failed.length > 0) {
        const names = failed
          .slice(0, 5)
          .map((row) => row.name || row.uuid)
          .join(", ");
        throw new SmartDiskError(`${failed.length} source(s) failed to process: ${names}`);
      }

      const done = contents.filter((row) => row.status === "processed").length;
      const status = `${done}/${contents.length} processed${consolidating ? ", consolidating" : ""}`;
      if (options.onProgress && status !== previous) {
        options.onProgress(status);
        previous = status;
      }

      const settled =
        contents.length > 0 && done === contents.length && (options.skipConsolidation === true || !consolidating);
      clear = settled ? clear + 1 : 0;
      if (clear >= WAIT_CLEAR_POLLS) return listing;

      if (Date.now() >= deadline) {
        const pending = contents.length - done;
        throw new SmartDiskWaitTimeoutError(
          `the disk had not settled after ${timeoutMs}ms: ${pending} of ${contents.length} source(s) still pending` +
            (consolidating ? ", disk still consolidating" : ""),
          { pending, total: contents.length, consolidating },
        );
      }
      await sleep(pollIntervalMs);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
