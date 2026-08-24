import { describe, expect, it, vi } from "vitest";
import { SmartDisk, SmartDiskUsageError, DEFAULT_BASE_URL } from "../src/index.js";
import { BASE, DISK_UUID, FetchRecorder, makeClient } from "./helpers.js";

describe("construction", () => {
  it("refuses to build without an API key", () => {
    expect(() => new SmartDisk({ apiKey: "", fetch: new FetchRecorder().fetch })).toThrow(
      SmartDiskUsageError,
    );
  });

  it("defaults to the hosted base URL", () => {
    const { client } = makeClient();
    expect(client.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(DEFAULT_BASE_URL).toBe(BASE);
  });

  it("accepts a self-hosted base URL and trims its trailing slash", async () => {
    const { client, http } = makeClient({ baseUrl: "https://memory.example.test/api/" });
    http.push({ body: { disks: [] } });
    await client.disks.list();
    expect(http.last.url).toBe("https://memory.example.test/api/sd/disks");
  });
});

describe("request construction", () => {
  it("sends the bearer key and JSON content type on a body call", async () => {
    const { client, http } = makeClient();
    http.push({ body: { uuid: DISK_UUID, name: "n", slug: "s" } });
    await client.disks.create({ name: "n" });
    expect(http.last.headers.Authorization).toBe("Bearer sd_test_key");
    expect(http.last.headers["Content-Type"]).toBe("application/json");
  });

  it("omits the content type when there is no body", async () => {
    const { client, http } = makeClient();
    http.push({ body: { disks: [] } });
    await client.disks.list();
    expect(http.last.headers["Content-Type"]).toBeUndefined();
    expect(http.last.rawBody).toBeUndefined();
  });

  it("merges caller headers", async () => {
    const { client, http } = makeClient({ headers: { "X-Trace": "abc" } });
    http.push({ body: { disks: [] } });
    await client.disks.list();
    expect(http.last.headers["X-Trace"]).toBe("abc");
  });

  it("drops undefined and empty query parameters", async () => {
    const { client, http } = makeClient();
    http.push({ body: { hubs: [] } });
    await client.tools.hubs(DISK_UUID, { top: 5 });
    expect(http.last.query).toEqual({ top: "5" });
  });
});

describe("response envelope", () => {
  it("peels {data, result}", async () => {
    const { client, http } = makeClient();
    http.push({ body: { uuid: DISK_UUID, name: "Research", slug: "research" } });
    const disk = await client.disks.create({ name: "Research" });
    expect(disk).toEqual({ uuid: DISK_UUID, name: "Research", slug: "research" });
  });

  it("leaves an unwrapped body alone", async () => {
    const { client, http } = makeClient();
    http.push({ raw: JSON.stringify({ disks: [{ uuid: DISK_UUID, name: "n", slug: "s" }] }) });
    const disks = await client.disks.list();
    expect(disks).toHaveLength(1);
  });

  it("returns export bytes verbatim, envelope-free", async () => {
    const { client, http } = makeClient();
    http.push({ raw: "subject,predicate,object\nalex,works_at,northwind\n" });
    const csv = await client.tools.exportRaw(DISK_UUID, { format: "csv" });
    expect(csv).toBe("subject,predicate,object\nalex,works_at,northwind\n");
    expect(http.last.query.format).toBe("csv");
  });
});

describe("retry and backoff", () => {
  it("retries a 500 and returns the eventual success", async () => {
    const { client, http } = makeClient({ retry: { maxRetries: 2, initialDelayMs: 1, maxDelayMs: 2 } });
    http.push(
      { status: 500, body: { error: "chat_failed" } },
      { body: { disks: [{ uuid: DISK_UUID, name: "n", slug: "s" }] } },
    );
    const disks = await client.disks.list();
    expect(disks).toHaveLength(1);
    expect(http.calls).toHaveLength(2);
  });

  it("retries a 429 and honours Retry-After", async () => {
    const { client, http } = makeClient({ retry: { maxRetries: 1, initialDelayMs: 1, maxDelayMs: 2 } });
    http.push({ status: 429, body: { error: "rate_limited" }, headers: { "retry-after": "0" } }, { body: { disks: [] } });
    await client.disks.list();
    expect(http.calls).toHaveLength(2);
  });

  it("retries a 502 upstream failure", async () => {
    const { client, http } = makeClient({ retry: { maxRetries: 1, initialDelayMs: 1, maxDelayMs: 2 } });
    http.push({ status: 502, body: { error: "ocr_failed" } }, { body: { text: "hi", chars: 2 } });
    const parsed = await client.ocr({ image_b64: "aGk=" });
    expect(parsed.text).toBe("hi");
  });

  it("does not retry a 503 — that means the feature is not deployed here", async () => {
    const { client, http } = makeClient({ retry: { maxRetries: 3, initialDelayMs: 1, maxDelayMs: 2 } });
    http.always({ status: 503, body: { error: "not_migrated" } });
    await expect(client.tools.consolidationRuns(DISK_UUID)).rejects.toThrow(/not deployed/);
    expect(http.calls).toHaveLength(1);
  });

  it("does not retry a 4xx", async () => {
    const { client, http } = makeClient({ retry: { maxRetries: 3, initialDelayMs: 1, maxDelayMs: 2 } });
    http.always({ status: 404, body: { error: "disk_not_found" } });
    await expect(client.disks.delete(DISK_UUID)).rejects.toThrow(/no disk exists/);
    expect(http.calls).toHaveLength(1);
  });

  it("retries a network failure, then gives up as a connection error", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const client = new SmartDisk({
      apiKey: "sd_test_key",
      fetch: fetch as any,
      retry: { maxRetries: 1, initialDelayMs: 1, maxDelayMs: 2 },
    });
    await expect(client.disks.list()).rejects.toThrow(/could not reach the server/);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("timeouts", () => {
  it("reports a timeout as a timeout, not a connection failure", async () => {
    const fetch = async (_url: string, init: RequestInit = {}) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          (error as any).cause = (init.signal as any).reason;
          reject(error);
        });
      });
    const client = new SmartDisk({
      apiKey: "sd_test_key",
      fetch: fetch as any,
      timeoutMs: 5,
      retry: { maxRetries: 0 },
    });
    await expect(client.disks.list()).rejects.toThrow(/timed out after 5ms/);
  });
});
