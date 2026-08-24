/**
 * Memory — what processing produced, and the verbs that change it: the grounded
 * answer, facts and their history, the entity graph, folders, aliases, and the
 * four direct write verbs.
 */

import type { ClientContext } from "./internal.js";
import { compact, required, withExtra } from "./internal.js";
import { SmartDiskUsageError } from "./errors.js";
import type {
  AliasesResponse,
  AliasesWriteResponse,
  AskOptions,
  AskResponse,
  DeletedResponse,
  DiskRef,
  EcosystemResponse,
  Folder,
  FoldersResponse,
  ForgetResponse,
  FactGroup,
  GraphQueryResponse,
  GroupsResponse,
  Content,
  ContentsResponse,
  MemoryResponse,
  MovedResponse,
  ProfileResponse,
  RememberParams,
  RememberResponse,
  SubjectsResponse,
  Tag,
  TagsResponse,
  UpdatedResponse,
} from "./types.js";

/** One grounded answer costs a model call server-side; allow for it. */
const ASK_TIMEOUT_MS = 180_000;

export class Memory {
  constructor(private readonly ctx: ClientContext) {}

  /**
   * Ask the disk a question and get one grounded answer with citations — the
   * one-call alternative to retrieve-then-prompt. Accepts every retrieval
   * filter, plus an answer `model` tier, a `language`, and prior `history`.
   */
  async ask(disk: DiskRef, query: string, options: AskOptions = {}): Promise<AskResponse> {
    const question = required(query, "query");
    const uuid = await this.ctx.diskUuid(disk);
    const body = compact({
      query: question,
      path: options.path,
      model: options.model,
      language: options.language,
      history: options.history,
      categories: options.categories,
      tags: options.tags,
      since: options.since,
      until: options.until,
      graph_expand: options.graph_expand,
      graph_hops: options.graph_hops,
      expand: options.expand,
      expand_max: options.expand_max,
    });
    return this.ctx.transport.request<AskResponse>({
      method: "POST",
      path: `sd/disks/${uuid}/chat`,
      body: withExtra(body, options.extra),
      timeoutMs: ASK_TIMEOUT_MS,
    });
  }

  // --- reading what was derived ---------------------------------------- //

  /**
   * The disk's enduring facts (deduplicated disk-wide, central-first), its
   * latest summary, and its tag catalogue.
   */
  async facts(disk: DiskRef): Promise<MemoryResponse> {
    const uuid = await this.ctx.diskUuid(disk);
    return this.ctx.transport.request<MemoryResponse>({
      method: "GET",
      path: `sd/disks/${uuid}/memory`,
    });
  }

  /**
   * Facts grouped by `(subject, predicate)`: what is true now, and the chain of
   * what it replaced. Nothing is ever deleted, so a group is a small history.
   */
  async groups(disk: DiskRef): Promise<GroupsResponse> {
    const uuid = await this.ctx.diskUuid(disk);
    return this.ctx.transport.request<GroupsResponse>({
      method: "GET",
      path: `sd/disks/${uuid}/groups`,
    });
  }

  /** Just the groups array, for callers that do not need the envelope counts. */
  async groupList(disk: DiskRef): Promise<FactGroup[]> {
    return (await this.groups(disk)).groups ?? [];
  }

  /**
   * The knowledge graph as nodes and edges — who and what the facts are about,
   * and how they connect. `limit: 0` returns every subject.
   */
  async subjects(disk: DiskRef, options: { limit?: number } = {}): Promise<SubjectsResponse> {
    const uuid = await this.ctx.diskUuid(disk);
    return this.ctx.transport.request<SubjectsResponse>({
      method: "GET",
      path: `sd/disks/${uuid}/subjects`,
      query: { limit: options.limit },
    });
  }

  /**
   * The disk's standing profile and its memory index. Both are `null` until
   * there is enough processed memory; both also ride on every retrieve response
   * as `stable`, so this call is for when you want them on their own.
   */
  async profile(disk: DiskRef): Promise<ProfileResponse> {
    const uuid = await this.ctx.diskUuid(disk);
    return this.ctx.transport.request<ProfileResponse>({
      method: "GET",
      path: `sd/disks/${uuid}/profile`,
    });
  }

  /** Force a fresh profile synthesis now — one model call, a few seconds. */
  async regenerateProfile(disk: DiskRef): Promise<ProfileResponse> {
    const uuid = await this.ctx.diskUuid(disk);
    return this.ctx.transport.request<ProfileResponse>({
      method: "POST",
      path: `sd/disks/${uuid}/profile/regen`,
      timeoutMs: ASK_TIMEOUT_MS,
    });
  }

  /**
   * The tag vocabulary with usage counts, most-used first — what the retrieval
   * `tags` filter can match. `path` scopes the list to a subtree.
   */
  async tags(disk: DiskRef, options: { path?: string } = {}): Promise<Tag[]> {
    const uuid = await this.ctx.diskUuid(disk);
    const data = await this.ctx.transport.request<TagsResponse>({
      method: "GET",
      path: `sd/disks/${uuid}/tags`,
      query: { path: options.path },
    });
    return data?.tags ?? [];
  }

  /**
   * The association graph behind the mind-map view: sources, tags and facts,
   * plus the edges connecting them. Pruned server-side; `limit: 0` for all facts.
   */
  async ecosystem(disk: DiskRef, options: { limit?: number } = {}): Promise<EcosystemResponse> {
    const uuid = await this.ctx.diskUuid(disk);
    return this.ctx.transport.request<EcosystemResponse>({
      method: "GET",
      path: `sd/disks/${uuid}/ecosystem`,
      query: { limit: options.limit },
    });
  }

  /**
   * A targeted structural question about the graph — no embeddings, no fuzziness.
   * Three shapes, auto-detected: `alex..northwind` (shortest path), `alex`
   * (neighbours), `alex:works_at:` (edge filter, empty parts are wildcards).
   */
  async graphQuery(
    disk: DiskRef,
    query: string,
    options: { depth?: number } = {},
  ): Promise<GraphQueryResponse> {
    const expression = required(query, "query");
    const uuid = await this.ctx.diskUuid(disk);
    return this.ctx.transport.request<GraphQueryResponse>({
      method: "GET",
      path: `sd/disks/${uuid}/graph-query`,
      query: { q: expression, depth: options.depth },
    });
  }

  // --- sources and folders --------------------------------------------- //

  /** One row per imported source, with its pipeline status and freshness. */
  async contents(disk: DiskRef): Promise<Content[]> {
    const uuid = await this.ctx.diskUuid(disk);
    const data = await this.ctx.transport.request<ContentsResponse>({
      method: "GET",
      path: `sd/disks/${uuid}/contents`,
    });
    return data?.contents ?? [];
  }

  /** The contents listing with its envelope (including `consolidating`). */
  async contentsEnvelope(disk: DiskRef): Promise<ContentsResponse> {
    const uuid = await this.ctx.diskUuid(disk);
    return this.ctx.transport.request<ContentsResponse>({
      method: "GET",
      path: `sd/disks/${uuid}/contents`,
    });
  }

  /**
   * Remove one source. Disk-wide facts and summaries are kept by design — they
   * are derived across the whole disk, not tied to one source.
   */
  async deleteContent(disk: DiskRef, contentUuid: string): Promise<DeletedResponse> {
    const cuuid = required(contentUuid, "contentUuid");
    const uuid = await this.ctx.diskUuid(disk);
    return this.ctx.transport.request<DeletedResponse>({
      method: "DELETE",
      path: `sd/disks/${uuid}/contents/${cuuid}`,
    });
  }

  /** Move one source into another folder. */
  async moveContent(disk: DiskRef, contentUuid: string, folderPath: string): Promise<MovedResponse> {
    const cuuid = required(contentUuid, "contentUuid");
    const destination = required(folderPath, "folderPath");
    const uuid = await this.ctx.diskUuid(disk);
    return this.ctx.transport.request<MovedResponse>({
      method: "POST",
      path: `sd/disks/${uuid}/contents/${cuuid}/move`,
      body: { folder_path: destination },
    });
  }

  /** The disk's folders, with per-folder content counts. */
  async folders(disk: DiskRef): Promise<Folder[]> {
    const uuid = await this.ctx.diskUuid(disk);
    const data = await this.ctx.transport.request<FoldersResponse>({
      method: "GET",
      path: `sd/disks/${uuid}/folders`,
    });
    return data?.folders ?? [];
  }

  /** Create a folder. Ancestors are created with it. */
  async createFolder(disk: DiskRef, path: string): Promise<unknown> {
    const target = required(path, "path");
    const uuid = await this.ctx.diskUuid(disk);
    return this.ctx.transport.request<unknown>({
      method: "POST",
      path: `sd/disks/${uuid}/folders`,
      body: { path: target },
    });
  }

  /** Delete an empty folder. Refused while it still holds content. */
  async deleteFolder(disk: DiskRef, path: string): Promise<DeletedResponse> {
    const target = required(path, "path");
    const uuid = await this.ctx.diskUuid(disk);
    return this.ctx.transport.request<DeletedResponse>({
      method: "DELETE",
      path: `sd/disks/${uuid}/folders`,
      query: { path: target },
    });
  }

  // --- identity aliases ------------------------------------------------- //

  /** The disk-level `{ variant: canonical }` alias map. */
  async aliases(disk: DiskRef): Promise<Record<string, string>> {
    const uuid = await this.ctx.diskUuid(disk);
    const data = await this.ctx.transport.request<AliasesResponse>({
      method: "GET",
      path: `sd/disks/${uuid}/aliases`,
    });
    return data?.aliases ?? {};
  }

  /**
   * Replace the disk-level alias map. An empty object clears it. Changes take
   * effect on the next derive of a source; reprocess to apply them to memory
   * already extracted.
   */
  async setAliases(disk: DiskRef, aliases: Record<string, string>): Promise<AliasesWriteResponse> {
    const uuid = await this.ctx.diskUuid(disk);
    return this.ctx.transport.request<AliasesWriteResponse>({
      method: "PUT",
      path: `sd/disks/${uuid}/aliases`,
      body: { aliases: aliases ?? {} },
    });
  }

  /** One conversation's alias map — merged over the disk-level one. */
  async contentAliases(disk: DiskRef, contentUuid: string): Promise<Record<string, string>> {
    const cuuid = required(contentUuid, "contentUuid");
    const uuid = await this.ctx.diskUuid(disk);
    const data = await this.ctx.transport.request<AliasesResponse>({
      method: "GET",
      path: `sd/disks/${uuid}/contents/${cuuid}/aliases`,
    });
    return data?.aliases ?? {};
  }

  /** Replace one conversation's alias map. */
  async setContentAliases(
    disk: DiskRef,
    contentUuid: string,
    aliases: Record<string, string>,
  ): Promise<AliasesWriteResponse> {
    const cuuid = required(contentUuid, "contentUuid");
    const uuid = await this.ctx.diskUuid(disk);
    return this.ctx.transport.request<AliasesWriteResponse>({
      method: "PUT",
      path: `sd/disks/${uuid}/contents/${cuuid}/aliases`,
      body: { aliases: aliases ?? {} },
    });
  }

  // --- write verbs ------------------------------------------------------ //

  /**
   * Assert one fact directly, bypassing extraction. The triple is optional but
   * strongly recommended — it is what groups the fact with the other statements
   * about the same relation.
   */
  async remember(disk: DiskRef, params: RememberParams): Promise<RememberResponse> {
    const text = required(params?.text, "text");
    const uuid = await this.ctx.diskUuid(disk);
    return this.ctx.transport.request<RememberResponse>({
      method: "POST",
      path: `sd/disks/${uuid}/remember`,
      body: compact({
        text,
        subject: params.subject,
        predicate: params.predicate,
        object: params.object,
        category: params.category ?? "personal",
        priority: params.priority ?? 50,
      }),
    });
  }

  /**
   * Retire a fact so it stops being recalled. A bitemporal close, not a hard
   * delete: it leaves the current layer and stays readable as history.
   */
  async forget(disk: DiskRef, factUuid: string): Promise<ForgetResponse> {
    const fact = required(factUuid, "factUuid");
    const uuid = await this.ctx.diskUuid(disk);
    return this.ctx.transport.request<ForgetResponse>({
      method: "POST",
      path: `sd/disks/${uuid}/forget`,
      body: { fact_uuid: fact },
    });
  }

  /**
   * Record whether retrieved facts actually helped. A positive score makes them
   * easier to recall in future, a negative one harder. Nothing is deleted.
   */
  async feedback(disk: DiskRef, factUuids: string[], score: number): Promise<UpdatedResponse> {
    const clean = (factUuids ?? []).map((value) => String(value).trim()).filter(Boolean);
    if (!clean.length) throw new SmartDiskUsageError("at least one fact uuid is required");
    const uuid = await this.ctx.diskUuid(disk);
    return this.ctx.transport.request<UpdatedResponse>({
      method: "POST",
      path: `sd/disks/${uuid}/feedback`,
      body: { fact_uuids: clean, score },
    });
  }

  /** Raise or lower one fact's standing, from 1 (background) to 100 (always relevant). */
  async reprioritize(disk: DiskRef, factUuid: string, priority: number): Promise<UpdatedResponse> {
    const fact = required(factUuid, "factUuid");
    if (!Number.isInteger(priority) || priority < 1 || priority > 100) {
      throw new SmartDiskUsageError("priority must be an integer between 1 and 100");
    }
    const uuid = await this.ctx.diskUuid(disk);
    return this.ctx.transport.request<UpdatedResponse>({
      method: "POST",
      path: `sd/disks/${uuid}/reprioritize`,
      body: { fact_uuid: fact, priority },
    });
  }
}
