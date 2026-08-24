/**
 * The client. One object, one API key, four namespaces — `disks`, `imports`,
 * `memory`, `tools` — plus the two calls that carry the whole product:
 * `retrieve` (context, no model in the loop) and `memory.ask` (a grounded,
 * cited answer).
 */

import { Transport, type FetchLike, type RetryOptions } from "./http.js";
import { SmartDiskUsageError } from "./errors.js";
import { Disks } from "./disks.js";
import { Imports } from "./imports.js";
import { Memory } from "./memory.js";
import { Tools } from "./tools.js";
import { compact, required, slugOf, uuidOf, withExtra, type ClientContext } from "./internal.js";
import type {
  DiskRef,
  OcrParams,
  OcrResponse,
  RetrieveOptions,
  RetrieveResponse,
} from "./types.js";

export interface SmartDiskOptions {
  /**
   * Your API key, `sd_…`, minted on the API keys page of the web app. Falls back
   * to `process.env.SMARTDISK_API_KEY`.
   */
  apiKey?: string;
  /** Override for a self-hosted server. Falls back to `process.env.SMARTDISK_BASE`. */
  baseUrl?: string;
  /** Per-request timeout in ms. Default 60000. Imports and answers raise it themselves. */
  timeoutMs?: number;
  /** Retries after the first attempt, and the backoff shape. Default 2 retries. */
  retry?: RetryOptions;
  /** Extra headers on every request. */
  headers?: Record<string, string>;
  /** Injectable fetch, for tests or a custom agent. Defaults to the global one. */
  fetch?: FetchLike;
}

/** Retrieval takes real work server-side; give it more than the default. */
const RETRIEVE_TIMEOUT_MS = 120_000;

export class SmartDisk {
  /** Create, list and delete disks. */
  readonly disks: Disks;
  /** Put conversations, documents and web pages into a disk. */
  readonly imports: Imports;
  /** Read and write what processing produced — including the grounded answer. */
  readonly memory: Memory;
  /** The read-only agent tools: read, grep, export, hubs, lint, preview, audit. */
  readonly tools: Tools;

  private readonly transport: Transport;
  private readonly slugCache = new Map<string, string>();

  constructor(options: SmartDiskOptions = {}) {
    const apiKey = (options.apiKey ?? process?.env?.SMARTDISK_API_KEY ?? "").trim();
    if (!apiKey) {
      throw new SmartDiskUsageError(
        "an API key is required — pass `apiKey`, or set SMARTDISK_API_KEY in the environment",
      );
    }
    this.transport = new Transport({
      apiKey,
      baseUrl: options.baseUrl ?? process?.env?.SMARTDISK_BASE,
      timeoutMs: options.timeoutMs,
      retry: options.retry,
      headers: options.headers,
      fetch: options.fetch,
    });

    const ctx: ClientContext = {
      transport: this.transport,
      diskUuid: (ref) => this.resolveDisk(ref),
    };
    this.disks = new Disks(ctx);
    this.imports = new Imports(ctx);
    this.memory = new Memory(ctx);
    this.tools = new Tools(ctx);
  }

  /** The base URL this client talks to. */
  get baseUrl(): string {
    return this.transport.baseUrl;
  }

  /**
   * Retrieve memory: a packed, token-budgeted block of numbered passages plus
   * the citations behind each number. **No model is in the loop** — you get
   * ready-to-prompt context and feed it into your own model however you like.
   *
   * Retrieval refuses to pad: if nothing clears the relevance floor you get an
   * empty block rather than the best few pieces of noise.
   */
  async retrieve(disk: DiskRef, query: string, options: RetrieveOptions = {}): Promise<RetrieveResponse> {
    const question = required(query, "query");
    const uuid = await this.resolveDisk(disk);
    const body = compact({
      query: question,
      path: options.path,
      context_tokens: options.context_tokens,
      categories: options.categories,
      tags: options.tags,
      since: options.since,
      until: options.until,
      graph_expand: options.graph_expand,
      graph_hops: options.graph_hops,
      expand: options.expand,
      expand_max: options.expand_max,
      min_score: options.min_score,
      exclude: options.exclude,
      session_id: options.session_id,
      dedup_turns: options.dedup_turns,
      recency: options.recency,
      explain: options.explain,
    });
    return this.transport.request<RetrieveResponse>({
      method: "POST",
      path: `sd/disks/${uuid}/retrieve`,
      body: withExtra(body, options.extra),
      timeoutMs: RETRIEVE_TIMEOUT_MS,
    });
  }

  /**
   * OCR one image and get its text back **without** ingesting it. Disk-
   * independent — it touches no disk and stores nothing. To actually store a
   * scan, import it as a document with `body_b64`.
   */
  async ocr(params: OcrParams): Promise<OcrResponse> {
    required(params?.image_b64, "image_b64");
    return this.transport.request<OcrResponse>({
      method: "POST",
      path: "sd/ocr",
      body: compact({ image_b64: params.image_b64, format: params.format }),
      timeoutMs: 120_000,
    });
  }

  /**
   * Resolve any disk reference to a uuid. A uuid or a `Disk` is used directly;
   * a slug is looked up once through the disk listing and cached for the life of
   * this client.
   */
  async resolveDisk(disk: DiskRef): Promise<string> {
    const slug = slugOf(disk);
    if (!slug) return uuidOf(disk) as string;

    const cached = this.slugCache.get(slug);
    if (cached) return cached;

    const found = await this.disks.find(slug);
    if (!found?.uuid) {
      throw new SmartDiskUsageError(
        `no disk with slug "${slug}" belongs to this API key — create it with disks.create({ name, slug }), ` +
          "or pass the disk's uuid",
      );
    }
    this.slugCache.set(slug, found.uuid);
    return found.uuid;
  }

  /** Forget cached slug→uuid resolutions (after deleting and recreating a disk). */
  clearDiskCache(): void {
    this.slugCache.clear();
  }
}
