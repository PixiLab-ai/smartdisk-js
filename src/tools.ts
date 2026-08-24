/**
 * Agent tools — the read-only endpoints for when you already know what you want:
 * read this source, find this exact string, rank these entities, hand me the
 * whole graph. Nothing here writes a row, and the extraction preview does not
 * even store what it extracts.
 */

import type { ClientContext } from "./internal.js";
import { compact, required } from "./internal.js";
import type {
  ConsolidationRunResponse,
  ConsolidationRunsResponse,
  DiskRef,
  ExportFormat,
  ExportOptions,
  ExportResponse,
  ExtractPreviewParams,
  ExtractPreviewResponse,
  GrepOptions,
  GrepResponse,
  HubsResponse,
  LintResponse,
  ReadSourceResponse,
} from "./types.js";

/** One model call server-side; give the preview room. */
const PREVIEW_TIMEOUT_MS = 120_000;
const EXPORT_TIMEOUT_MS = 120_000;

export class Tools {
  constructor(private readonly ctx: ClientContext) {}

  /**
   * One source's actual body — the endpoint behind "open this source" and behind
   * following a citation back to where it came from. A document returns `body`
   * paged by **byte** offset (200,000 bytes per call); a conversation returns
   * `messages` paged by position (default 200, max 1000).
   */
  async read(
    disk: DiskRef,
    contentUuid: string,
    options: { offset?: number; limit?: number } = {},
  ): Promise<ReadSourceResponse> {
    const cuuid = required(contentUuid, "contentUuid");
    const uuid = await this.ctx.diskUuid(disk);
    return this.ctx.transport.request<ReadSourceResponse>({
      method: "GET",
      path: `sd/disks/${uuid}/contents/${cuuid}`,
      query: { offset: options.offset, limit: options.limit },
    });
  }

  /**
   * A regex over the stored text — every chat message and every document body.
   * The escape hatch for what semantic search is structurally bad at: an error
   * code, a version string, a rare literal. Patterns are RE2: no backreferences,
   * no lookaround, 200 bytes max.
   */
  async grep(disk: DiskRef, pattern: string, options: GrepOptions = {}): Promise<GrepResponse> {
    const expression = required(pattern, "pattern");
    const uuid = await this.ctx.diskUuid(disk);
    return this.ctx.transport.request<GrepResponse>({
      method: "GET",
      path: `sd/disks/${uuid}/grep`,
      query: {
        pattern: expression,
        path: options.path,
        limit: options.limit,
        case_insensitive: options.case_insensitive === undefined ? undefined : String(options.case_insensitive),
      },
    });
  }

  /**
   * The disk's current facts and relationships as `json`. Above 20,000 facts in
   * scope the call is refused with `too_large` — narrow it with `path`.
   */
  async export(disk: DiskRef, options: Omit<ExportOptions, "format"> = {}): Promise<ExportResponse> {
    const uuid = await this.ctx.diskUuid(disk);
    return this.ctx.transport.request<ExportResponse>({
      method: "GET",
      path: `sd/disks/${uuid}/export`,
      query: { format: "json", include: options.include, path: options.path },
      timeoutMs: EXPORT_TIMEOUT_MS,
    });
  }

  /**
   * The same export rendered as a file, verbatim. This is the one endpoint that
   * does not return the usual JSON envelope — you get the bytes as they are, so
   * `jsonld`, `turtle` and `csv` come back as text.
   */
  async exportRaw(disk: DiskRef, options: ExportOptions = {}): Promise<string> {
    const uuid = await this.ctx.diskUuid(disk);
    const format: ExportFormat = options.format ?? "json";
    return this.ctx.transport.request<string>({
      method: "GET",
      path: `sd/disks/${uuid}/export`,
      query: { format, include: options.include, path: options.path },
      raw: true,
      timeoutMs: EXPORT_TIMEOUT_MS,
    });
  }

  /**
   * Entity centrality — weighted degree and PageRank over the current graph.
   * Deterministic, and it refuses rather than truncates: above 50,000
   * relationships the call is `too_large`, because centrality over a clipped
   * graph is a wrong number, not a partial one.
   */
  async hubs(disk: DiskRef, options: { top?: number; path?: string } = {}): Promise<HubsResponse> {
    const uuid = await this.ctx.diskUuid(disk);
    return this.ctx.transport.request<HubsResponse>({
      method: "GET",
      path: `sd/disks/${uuid}/hubs`,
      query: { top: options.top, path: options.path },
    });
  }

  /**
   * A read-only audit of the derived memory. Every section is fenced
   * independently: one that fails carries its own `error` while the report still
   * answers 200 — so check each section before trusting it. A 200 does not mean
   * all seven succeeded.
   */
  async lint(disk: DiskRef, options: { path?: string; limit?: number } = {}): Promise<LintResponse> {
    const uuid = await this.ctx.diskUuid(disk);
    return this.ctx.transport.request<LintResponse>({
      method: "GET",
      path: `sd/disks/${uuid}/lint`,
      query: { path: options.path, limit: options.limit },
    });
  }

  /**
   * A dry run of fact extraction: the exact prompt, canonicalisation, drop
   * filters and time gate a real import runs — and it stores nothing.
   */
  async extractPreview(disk: DiskRef, params: ExtractPreviewParams): Promise<ExtractPreviewResponse> {
    const text = required(params?.text, "text");
    const uuid = await this.ctx.diskUuid(disk);
    return this.ctx.transport.request<ExtractPreviewResponse>({
      method: "POST",
      path: `sd/disks/${uuid}/extract-preview`,
      body: compact({ text, aliases: params.aliases }),
      timeoutMs: PREVIEW_TIMEOUT_MS,
    });
  }

  /** Consolidation runs, newest first. Counts only — a fold's diff is per-run. */
  async consolidationRuns(
    disk: DiskRef,
    options: { limit?: number } = {},
  ): Promise<ConsolidationRunsResponse> {
    const uuid = await this.ctx.diskUuid(disk);
    return this.ctx.transport.request<ConsolidationRunsResponse>({
      method: "GET",
      path: `sd/disks/${uuid}/consolidation/runs`,
      query: { limit: options.limit },
    });
  }

  /**
   * One run's full memory diff — exactly what the fold merged, closed and
   * reworded. `plan: true` also returns what undoing it would do; the plan is
   * computed, never executed.
   */
  async consolidationRun(
    disk: DiskRef,
    runUuid: string,
    options: { plan?: boolean } = {},
  ): Promise<ConsolidationRunResponse> {
    const run = required(runUuid, "runUuid");
    const uuid = await this.ctx.diskUuid(disk);
    return this.ctx.transport.request<ConsolidationRunResponse>({
      method: "GET",
      path: `sd/disks/${uuid}/consolidation/runs/${run}`,
      query: { plan: options.plan ? 1 : undefined },
    });
  }
}
