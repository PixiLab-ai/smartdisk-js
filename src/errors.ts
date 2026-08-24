/**
 * Typed errors, one class per HTTP failure family described in the API's
 * error reference. Every one carries the machine-readable `code` the server
 * sent (`disk_not_found`, `bad_pattern`, …) so callers can branch on the code
 * without parsing prose.
 */

/** The JSON body of a failed call: `{ "error": "…", "detail": "…" }`. */
export interface SmartDiskErrorBody {
  error?: string;
  detail?: string;
  [key: string]: unknown;
}

export interface SmartDiskErrorInit {
  status?: number;
  code?: string;
  detail?: string;
  body?: SmartDiskErrorBody;
  method?: string;
  url?: string;
  cause?: unknown;
}

/** Base class for everything this SDK throws. */
export class SmartDiskError extends Error {
  /** HTTP status, or 0 when the request never got an answer. */
  readonly status: number;
  /** The server's `error` code, `""` when it sent none. */
  readonly code: string;
  /** The server's `detail` string, `""` when it sent none. */
  readonly detail: string;
  /** The parsed error body, as received. */
  readonly body: SmartDiskErrorBody;
  readonly method: string;
  readonly url: string;

  constructor(message: string, init: SmartDiskErrorInit = {}) {
    super(message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = new.target.name;
    this.status = init.status ?? 0;
    this.code = init.code ?? "";
    this.detail = init.detail ?? "";
    this.body = init.body ?? {};
    this.method = init.method ?? "";
    this.url = init.url ?? "";
  }
}

/** The SDK was called wrong — a missing argument, an unusable disk reference. */
export class SmartDiskUsageError extends SmartDiskError {}

/** The request never reached the server (DNS, TLS, socket, offline). */
export class SmartDiskConnectionError extends SmartDiskError {}

/** The request was still running when the timeout expired. */
export class SmartDiskTimeoutError extends SmartDiskError {}

/** 400 — malformed request: `invalid_json`, `empty_text`, `bad_pattern`, … */
export class SmartDiskBadRequestError extends SmartDiskError {}

/** 401 — `invalid_api_key` or `unauthorized`. Re-check the key; it may be revoked. */
export class SmartDiskAuthenticationError extends SmartDiskError {}

/**
 * 403 — authenticated but not allowed: `smartdisk_access_required` (the account
 * needs enabling by an administrator), `session_required`, `forbidden`.
 * Retrying will not resolve any of them.
 */
export class SmartDiskPermissionError extends SmartDiskError {}

/** 404 — `disk_not_found`, `content_not_found`, `run_not_found`. */
export class SmartDiskNotFoundError extends SmartDiskError {}

/**
 * 413 `too_large` — the request covers more memory than the endpoint will answer
 * for. Narrow it with a folder `path`.
 */
export class SmartDiskTooLargeError extends SmartDiskError {
  /** Current facts in scope, on an export refusal. */
  readonly factsTotal?: number;
  /** The export ceiling that was exceeded. */
  readonly maxFacts?: number;
  /** Relationships in scope, on a centrality refusal. */
  readonly edgesTotal?: number;
  /** The centrality ceiling that was exceeded. */
  readonly maxEdges?: number;

  constructor(message: string, init: SmartDiskErrorInit = {}) {
    super(message, init);
    const body = init.body ?? {};
    this.factsTotal = numeric(body.facts_total);
    this.maxFacts = numeric(body.max_facts);
    this.edgesTotal = numeric(body.edges_total);
    this.maxEdges = numeric(body.max_edges);
  }
}

/**
 * 422 — the request was valid but could not be fulfilled: `blocked`,
 * `no_content`, `no_transcript`, `unavailable` on a URL import.
 */
export class SmartDiskUnprocessableError extends SmartDiskError {}

/** 429 — too many requests. Retried automatically, honouring `Retry-After`. */
export class SmartDiskRateLimitError extends SmartDiskError {
  /** Seconds the server asked us to wait, when it said. */
  readonly retryAfter?: number;

  constructor(message: string, init: SmartDiskErrorInit & { retryAfter?: number } = {}) {
    super(message, init);
    this.retryAfter = init.retryAfter;
  }
}

/** 500 — `ingest_failed`, `chat_failed`, or an unnamed server fault. */
export class SmartDiskServerError extends SmartDiskError {}

/**
 * 502 — a service the request depends on failed: `ocr_failed`, `extract_failed`,
 * `remember_failed`. Retryable, and retried automatically.
 */
export class SmartDiskUpstreamError extends SmartDiskError {}

/**
 * 503 `not_migrated` — the feature is not deployed on this server yet. This is
 * not an outage, so it is deliberately **not** retried.
 */
export class SmartDiskUnavailableError extends SmartDiskError {}

const MESSAGES: Record<string, string> = {
  invalid_api_key: "the API key was rejected (missing, malformed or revoked)",
  unauthorized: "no credentials reached the server",
  smartdisk_access_required:
    "this account has not been granted SmartDisk access yet — an administrator has to enable it",
  session_required: "that route needs a signed-in browser session; an API key cannot be used for it",
  forbidden: "that disk does not belong to the account this API key acts as",
  disk_not_found: "no disk exists with that id",
  content_not_found: "no such source on this disk",
  run_not_found: "no such consolidation run on this disk",
  not_migrated: "the server has the route but not its table yet — this feature is not deployed there",
  too_large: "the request covers more memory than this route will answer for — narrow it with a folder path",
};

/** Build the right error subclass for one failed response. */
export function errorFromResponse(args: {
  status: number;
  body: SmartDiskErrorBody;
  method: string;
  url: string;
  retryAfter?: number;
}): SmartDiskError {
  const { status, body, method, url } = args;
  const code = typeof body.error === "string" ? body.error : "";
  const detail = typeof body.detail === "string" ? body.detail : "";
  const explained = MESSAGES[code];
  const head = explained ?? (code ? `the server refused the call: ${code}` : `HTTP ${status}`);
  const message = `${method} ${url} — ${head}${detail ? ` (${detail})` : ""}`;
  const init: SmartDiskErrorInit = { status, code, detail, body, method, url };

  switch (status) {
    case 400:
      return new SmartDiskBadRequestError(message, init);
    case 401:
      return new SmartDiskAuthenticationError(message, init);
    case 403:
      return new SmartDiskPermissionError(message, init);
    case 404:
      return new SmartDiskNotFoundError(message, init);
    case 413:
      return new SmartDiskTooLargeError(message, init);
    case 422:
      return new SmartDiskUnprocessableError(message, init);
    case 429:
      return new SmartDiskRateLimitError(message, { ...init, retryAfter: args.retryAfter });
    case 502:
      return new SmartDiskUpstreamError(message, init);
    case 503:
      return new SmartDiskUnavailableError(message, init);
    default:
      if (status >= 500) return new SmartDiskServerError(message, init);
      return new SmartDiskError(message, init);
  }
}

function numeric(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
