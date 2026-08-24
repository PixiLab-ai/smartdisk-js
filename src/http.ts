/**
 * The transport: one small fetch wrapper that adds the bearer key, a timeout,
 * bounded retries, and the two conventions the API asks every client to carry —
 * peel the `{"data": …, "result": "success"}` envelope, and treat 64-bit fields
 * as strings.
 */

import {
  SmartDiskConnectionError,
  SmartDiskTimeoutError,
  errorFromResponse,
  type SmartDiskError,
  type SmartDiskErrorBody,
} from "./errors.js";

/** The hosted API — the only production endpoint. `baseUrl` overrides exist for staging/tests. */
export const DEFAULT_BASE_URL = "https://smartdisk.pixilab.ai/_special/rest/Pixi/api";

/** Anything `globalThis.fetch` accepts. Injectable so tests never touch a socket. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface RetryOptions {
  /** Retries after the first attempt. Default 2 (so at most 3 requests). */
  maxRetries?: number;
  /** First backoff step in ms; doubles each retry. Default 500. */
  initialDelayMs?: number;
  /** Backoff ceiling in ms. Default 8000. */
  maxDelayMs?: number;
}

export interface TransportOptions {
  apiKey: string;
  baseUrl?: string;
  /** Per-request timeout in ms. Default 60000. */
  timeoutMs?: number;
  retry?: RetryOptions;
  /** Extra headers sent on every request. */
  headers?: Record<string, string>;
  fetch?: FetchLike;
}

export type QueryValue = string | number | boolean | undefined | null;

export interface RequestOptions {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Path under the base URL, e.g. `sd/disks/…`. */
  path: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
  /** Return the response text verbatim instead of parsing JSON (used by export). */
  raw?: boolean;
  /** Override the client timeout for one slow call (imports, answers). */
  timeoutMs?: number;
}

/**
 * Retried automatically: rate limiting, an unnamed server fault, and a failed
 * dependency. 503 is not here on purpose — the API uses it for "this feature
 * isn't deployed", which no amount of retrying fixes.
 */
const RETRY_STATUSES = new Set([429, 500, 502]);

export class Transport {
  readonly baseUrl: string;
  readonly timeoutMs: number;

  private readonly apiKey: string;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: FetchLike;
  private readonly maxRetries: number;
  private readonly initialDelayMs: number;
  private readonly maxDelayMs: number;

  constructor(options: TransportOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.headers = options.headers ?? {};
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== "function") {
      throw new SmartDiskConnectionError(
        "no fetch implementation is available — SmartDisk needs Node 18+ or an explicit `fetch` option",
      );
    }
    this.fetchImpl = fetchImpl.bind(globalThis) as FetchLike;
    this.maxRetries = options.retry?.maxRetries ?? 2;
    this.initialDelayMs = options.retry?.initialDelayMs ?? 500;
    this.maxDelayMs = options.retry?.maxDelayMs ?? 8_000;
  }

  url(path: string, query?: Record<string, QueryValue>): string {
    const suffix = path.replace(/^\/+/, "");
    const search = buildQuery(query);
    return `${this.baseUrl}/${suffix}${search}`;
  }

  async request<T>(options: RequestOptions): Promise<T> {
    const url = this.url(options.path, options.query);
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    let attempt = 0;

    for (;;) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new TimeoutMarker()), timeoutMs);

      let response: Response | undefined;
      let networkFailure: SmartDiskError | undefined;
      try {
        response = await this.fetchImpl(url, {
          method: options.method,
          headers: this.buildHeaders(options.body !== undefined),
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          signal: controller.signal,
        });
      } catch (cause) {
        networkFailure = this.wrapNetworkFailure(cause, options, url, timeoutMs);
      } finally {
        clearTimeout(timer);
      }

      if (networkFailure || !response) {
        const failure = networkFailure ?? new SmartDiskConnectionError(`${options.method} ${url} — no response`);
        if (attempt >= this.maxRetries) throw failure;
        attempt += 1;
        await sleep(this.backoff(attempt));
        continue;
      }

      if (response.ok) {
        if (options.raw) return (await response.text()) as T;
        return unwrap(await readJson(response)) as T;
      }

      const body = await readErrorBody(response);
      const retryAfter = parseRetryAfter(response.headers?.get?.("retry-after"));
      const failure = errorFromResponse({
        status: response.status,
        body,
        method: options.method,
        url,
        retryAfter,
      });
      if (!RETRY_STATUSES.has(response.status) || attempt >= this.maxRetries) throw failure;
      attempt += 1;
      await sleep(retryAfter !== undefined ? retryAfter * 1000 : this.backoff(attempt));
    }
  }

  private buildHeaders(hasBody: boolean): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
      ...this.headers,
    };
    if (hasBody) headers["Content-Type"] = "application/json";
    return headers;
  }

  private wrapNetworkFailure(cause: unknown, options: RequestOptions, url: string, timeoutMs: number) {
    if (isTimeout(cause)) {
      return new SmartDiskTimeoutError(
        `${options.method} ${url} — the request timed out after ${timeoutMs}ms`,
        { method: options.method, url, cause },
      );
    }
    const reason = cause instanceof Error ? cause.message : String(cause);
    return new SmartDiskConnectionError(`${options.method} ${url} — could not reach the server: ${reason}`, {
      method: options.method,
      url,
      cause,
    });
  }

  private backoff(attempt: number): number {
    const step = Math.min(this.initialDelayMs * 2 ** (attempt - 1), this.maxDelayMs);
    return Math.round(step * (0.5 + Math.random() / 2));
  }
}

/** Marker used to tell "our timeout fired" apart from "the caller aborted". */
class TimeoutMarker extends Error {
  constructor() {
    super("smartdisk-timeout");
    this.name = "SmartDiskTimeoutMarker";
  }
}

function isTimeout(cause: unknown): boolean {
  if (cause instanceof TimeoutMarker) return true;
  if (typeof cause !== "object" || cause === null) return false;
  const named = cause as { name?: string; cause?: unknown; message?: string };
  if (named.cause instanceof TimeoutMarker) return true;
  return named.name === "TimeoutError";
}

/**
 * Peel the REST envelope. Responses are wrapped as
 * `{"data": …, "result": "success"}`; a body without both keys is already bare.
 */
export function unwrap(body: unknown): unknown {
  if (body !== null && typeof body === "object" && !Array.isArray(body)) {
    const record = body as Record<string, unknown>;
    if ("data" in record && "result" in record) return record.data;
  }
  return body;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function readErrorBody(response: Response): Promise<SmartDiskErrorBody> {
  const parsed = await readJson(response);
  if (typeof parsed !== "object" || parsed === null) {
    return typeof parsed === "string" && parsed ? { detail: parsed.slice(0, 300) } : {};
  }
  const record = parsed as Record<string, unknown>;
  const inner = record.data;
  if (inner !== null && typeof inner === "object" && ("error" in inner || "detail" in inner)) {
    return inner as SmartDiskErrorBody;
  }
  return record as SmartDiskErrorBody;
}

function parseRetryAfter(header: string | null | undefined): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds, 60);
  const when = Date.parse(header);
  if (Number.isNaN(when)) return undefined;
  return Math.min(Math.max(0, (when - Date.now()) / 1000), 60);
}

function buildQuery(query?: Record<string, QueryValue>): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.append(key, String(value));
  }
  const rendered = params.toString();
  return rendered ? `?${rendered}` : "";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
