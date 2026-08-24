/**
 * A recording fetch stub. Every test runs fully offline: nothing here opens a
 * socket, and each call is captured so the request that *would* have gone out
 * can be asserted field by field.
 */

import { SmartDisk, type SmartDiskOptions } from "../src/index.js";

export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;
  rawBody: string | undefined;
  /** The query string parsed out of the URL. */
  query: Record<string, string>;
  /** The path under the API base, e.g. `sd/disks/…`. */
  path: string;
}

export interface StubResponse {
  status?: number;
  /** Sent as the `data` half of the REST envelope unless `raw` is set. */
  body?: unknown;
  /** Sent verbatim; use for envelope-free bodies and non-JSON payloads. */
  raw?: string;
  headers?: Record<string, string>;
}

export const BASE = "https://smartdisk.pixilab.ai/_special/rest/Pixi/api";
export const DISK_UUID = "00000000-0000-4000-8000-000000000001";

export class FetchRecorder {
  readonly calls: RecordedCall[] = [];
  private queue: StubResponse[] = [];
  private fallback: StubResponse = { body: {} };

  /** Queue one response per upcoming call, in order. */
  push(...responses: StubResponse[]): this {
    this.queue.push(...responses);
    return this;
  }

  /** The response used once the queue runs dry. */
  always(response: StubResponse): this {
    this.fallback = response;
    return this;
  }

  get last(): RecordedCall {
    const call = this.calls[this.calls.length - 1];
    if (!call) throw new Error("no call was recorded");
    return call;
  }

  get fetch() {
    return async (url: string, init: RequestInit = {}): Promise<Response> => {
      const parsed = new URL(url);
      const rawBody = typeof init.body === "string" ? init.body : undefined;
      this.calls.push({
        url,
        method: String(init.method ?? "GET"),
        headers: { ...((init.headers ?? {}) as Record<string, string>) },
        body: rawBody ? JSON.parse(rawBody) : undefined,
        rawBody,
        query: Object.fromEntries(parsed.searchParams.entries()),
        path: parsed.pathname.replace("/_special/rest/Pixi/api/", ""),
      });

      const stub = this.queue.shift() ?? this.fallback;
      const status = stub.status ?? 200;
      const text =
        stub.raw !== undefined
          ? stub.raw
          : JSON.stringify(
              status >= 400 ? (stub.body ?? {}) : { data: stub.body ?? {}, result: "success" },
            );
      return new Response(text, {
        status,
        headers: { "content-type": "application/json", ...(stub.headers ?? {}) },
      });
    };
  }
}

/** A client wired to a fresh recorder, with retries off unless a test wants them. */
export function makeClient(options: Partial<SmartDiskOptions> = {}): {
  client: SmartDisk;
  http: FetchRecorder;
} {
  const http = new FetchRecorder();
  const client = new SmartDisk({
    apiKey: "sd_test_key",
    fetch: http.fetch,
    retry: { maxRetries: 0 },
    ...options,
  });
  return { client, http };
}
