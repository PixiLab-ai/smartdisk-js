import { describe, expect, it } from "vitest";
import {
  SmartDiskAuthenticationError,
  SmartDiskBadRequestError,
  SmartDiskError,
  SmartDiskNotFoundError,
  SmartDiskPermissionError,
  SmartDiskRateLimitError,
  SmartDiskServerError,
  SmartDiskTooLargeError,
  SmartDiskUnavailableError,
  SmartDiskUnprocessableError,
  SmartDiskUpstreamError,
} from "../src/index.js";
import { DISK_UUID, makeClient } from "./helpers.js";

/** Every code in the API's error reference, mapped to the class it must become. */
const CASES: [number, string, new (...args: any[]) => SmartDiskError][] = [
  [400, "invalid_json", SmartDiskBadRequestError],
  [400, "empty_text", SmartDiskBadRequestError],
  [400, "invalid_since", SmartDiskBadRequestError],
  [400, "invalid_until", SmartDiskBadRequestError],
  [400, "bad_pattern", SmartDiskBadRequestError],
  [400, "bad_format", SmartDiskBadRequestError],
  [400, "bad_include", SmartDiskBadRequestError],
  [400, "unsupported_format", SmartDiskBadRequestError],
  [400, "invalid_body_b64", SmartDiskBadRequestError],
  [400, "conversion_failed", SmartDiskBadRequestError],
  [401, "invalid_api_key", SmartDiskAuthenticationError],
  [401, "unauthorized", SmartDiskAuthenticationError],
  [403, "smartdisk_access_required", SmartDiskPermissionError],
  [403, "session_required", SmartDiskPermissionError],
  [403, "forbidden", SmartDiskPermissionError],
  [404, "disk_not_found", SmartDiskNotFoundError],
  [404, "content_not_found", SmartDiskNotFoundError],
  [404, "run_not_found", SmartDiskNotFoundError],
  [413, "too_large", SmartDiskTooLargeError],
  [422, "blocked", SmartDiskUnprocessableError],
  [422, "no_content", SmartDiskUnprocessableError],
  [422, "no_transcript", SmartDiskUnprocessableError],
  [422, "unavailable", SmartDiskUnprocessableError],
  [500, "ingest_failed", SmartDiskServerError],
  [500, "chat_failed", SmartDiskServerError],
  [502, "ocr_failed", SmartDiskUpstreamError],
  [502, "extract_failed", SmartDiskUpstreamError],
  [502, "remember_failed", SmartDiskUpstreamError],
  [503, "not_migrated", SmartDiskUnavailableError],
];

describe("error mapping", () => {
  for (const [status, code, expected] of CASES) {
    it(`maps ${status} ${code} to ${expected.name}`, async () => {
      const { client, http } = makeClient();
      http.push({ status, body: { error: code } });
      const failure = await client.memory.facts(DISK_UUID).catch((error) => error);
      expect(failure).toBeInstanceOf(expected);
      expect(failure.status).toBe(status);
      expect(failure.code).toBe(code);
    });
  }

  it("maps 429 to a rate-limit error carrying Retry-After", async () => {
    const { client, http } = makeClient();
    http.push({ status: 429, body: { error: "rate_limited" }, headers: { "retry-after": "3" } });
    const failure = await client.memory.facts(DISK_UUID).catch((error) => error);
    expect(failure).toBeInstanceOf(SmartDiskRateLimitError);
    expect(failure.retryAfter).toBe(3);
  });

  it("keeps the detail string and the raw body", async () => {
    const { client, http } = makeClient();
    http.push({ status: 400, body: { error: "invalid_json", detail: "unexpected end of input" } });
    const failure = await client.memory.facts(DISK_UUID).catch((error) => error);
    expect(failure.detail).toBe("unexpected end of input");
    expect(failure.body).toEqual({ error: "invalid_json", detail: "unexpected end of input" });
    expect(failure.message).toContain("unexpected end of input");
  });

  it("reads an error nested inside the data envelope", async () => {
    const { client, http } = makeClient();
    http.push({ status: 404, raw: JSON.stringify({ data: { error: "disk_not_found" }, result: "error" }) });
    const failure = await client.memory.facts(DISK_UUID).catch((error) => error);
    expect(failure).toBeInstanceOf(SmartDiskNotFoundError);
    expect(failure.code).toBe("disk_not_found");
  });

  it("survives a non-JSON error body", async () => {
    const { client, http } = makeClient();
    http.push({ status: 500, raw: "<html>gateway</html>" });
    const failure = await client.memory.facts(DISK_UUID).catch((error) => error);
    expect(failure).toBeInstanceOf(SmartDiskServerError);
    expect(failure.code).toBe("");
  });

  it("records the method and url on the error", async () => {
    const { client, http } = makeClient();
    http.push({ status: 403, body: { error: "forbidden" } });
    const failure = await client.memory.facts(DISK_UUID).catch((error) => error);
    expect(failure.method).toBe("GET");
    expect(failure.url).toContain(`sd/disks/${DISK_UUID}/memory`);
  });

  it("every error is a SmartDiskError", async () => {
    const { client, http } = makeClient();
    http.push({ status: 418, body: { error: "teapot" } });
    const failure = await client.memory.facts(DISK_UUID).catch((error) => error);
    expect(failure).toBeInstanceOf(SmartDiskError);
    expect(failure.name).toBe("SmartDiskError");
  });
});
