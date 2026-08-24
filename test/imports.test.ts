import { describe, expect, it } from "vitest";
import { SmartDiskUnprocessableError, SmartDiskUsageError } from "../src/index.js";
import { DISK_UUID, makeClient } from "./helpers.js";

const MESSAGES = [
  { role: "user", content: "What did we decide about the schedule?" },
  { role: "assistant", content: "We moved the launch to March." },
];

describe("imports.chat", () => {
  it("uses the by-slug route when given a slug, and never looks the disk up", async () => {
    const { client, http } = makeClient();
    http.push({ body: { disk_uuid: DISK_UUID, content_uuid: "c1", messages_added: 2, skipped: false, status: "queued" } });
    const result = await client.imports.chat("research", { messages: MESSAGES, name: "planning" });
    expect(http.calls).toHaveLength(1);
    expect(http.last.path).toBe("sd/import/chatml");
    expect(http.last.body).toEqual({ disk_slug: "research", name: "planning", messages: MESSAGES });
    expect(result.messages_added).toBe(2);
  });

  it("passes disk_name through on the by-slug route", async () => {
    const { client, http } = makeClient();
    http.push({ body: { content_uuid: "c1", messages_added: 1, skipped: false, status: "queued" } });
    await client.imports.chat("research", { messages: MESSAGES, disk_name: "Research notes" });
    expect(http.last.body.disk_name).toBe("Research notes");
  });

  it("uses the by-uuid route when given a uuid", async () => {
    const { client, http } = makeClient();
    http.push({ body: { content_uuid: "c1", messages_added: 2, skipped: false, status: "queued" } });
    await client.imports.chat(DISK_UUID, { messages: MESSAGES });
    expect(http.last.path).toBe(`sd/disks/${DISK_UUID}/import/chatml`);
    expect(http.last.body).toEqual({ messages: MESSAGES });
  });

  it("carries per-message timestamps and source ids for incremental sync", async () => {
    const { client, http } = makeClient();
    http.push({ body: { content_uuid: "c1", messages_added: 1, skipped: false, status: "queued" } });
    const messages = [
      { role: "user", content: "hi", timestamp: "2026-05-31T08:00:00Z", uuid: "my-id-1" },
    ];
    await client.imports.chat(DISK_UUID, { messages, folder_path: "/imports", persona: "alex", source: "crm" });
    expect(http.last.body).toEqual({
      folder_path: "/imports",
      persona: "alex",
      source: "crm",
      messages,
    });
  });

  it("requires at least one message", async () => {
    const { client } = makeClient();
    await expect(client.imports.chat(DISK_UUID, { messages: [] })).rejects.toThrow(SmartDiskUsageError);
  });
});

describe("imports.document", () => {
  it("posts a text body to the doc route", async () => {
    const { client, http } = makeClient();
    http.push({ body: { content_uuid: "d1", skipped: false, status: "queued" } });
    await client.imports.document(DISK_UUID, {
      body: "# Q2 report",
      name: "Q2 report",
      folder_path: "/reports",
      title: "Q2 report",
      source: "sync",
    });
    expect(http.last.path).toBe(`sd/disks/${DISK_UUID}/import/doc`);
    expect(http.last.body).toEqual({
      body: "# Q2 report",
      title: "Q2 report",
      name: "Q2 report",
      folder_path: "/reports",
      source: "sync",
    });
  });

  it("sends binary documents as body_b64 with a format", async () => {
    const { client, http } = makeClient();
    http.push({ body: { content_uuid: "d1", skipped: false, status: "queued" } });
    await client.imports.document(DISK_UUID, { body_b64: "JVBERi0=", format: "pdf", name: "report.pdf" });
    expect(http.last.body).toEqual({ body_b64: "JVBERi0=", name: "report.pdf", format: "pdf" });
  });

  it("returns the chat-export shape when the server recognises one", async () => {
    const { client, http } = makeClient();
    http.push({ body: { mode: "chat-export", format: "claude-export", conversations: 97, messages: 2281, status: "queued" } });
    const result = await client.imports.document(DISK_UUID, { body: "{}" });
    expect("mode" in result && result.mode).toBe("chat-export");
  });

  it("requires a body or a base64 body", async () => {
    const { client } = makeClient();
    await expect(client.imports.document(DISK_UUID, {})).rejects.toThrow(SmartDiskUsageError);
  });
});

describe("imports.url", () => {
  it("posts the url and folder", async () => {
    const { client, http } = makeClient();
    http.push({ body: { content_uuid: "u1", skipped: false, status: "queued", source_type: "web", title: "Example" } });
    const result = await client.imports.url(DISK_UUID, { url: "https://example.com/article", folder_path: "/web" });
    expect(http.last.path).toBe(`sd/disks/${DISK_UUID}/import/url`);
    expect(http.last.body).toEqual({ url: "https://example.com/article", folder_path: "/web" });
    expect(result.source_type).toBe("web");
  });

  it("surfaces a bot-protection refusal as an unprocessable error", async () => {
    const { client, http } = makeClient();
    http.push({ status: 422, body: { error: "blocked" } });
    await expect(client.imports.url(DISK_UUID, { url: "https://example.com" })).rejects.toBeInstanceOf(
      SmartDiskUnprocessableError,
    );
  });
});

describe("imports.cursor and retry", () => {
  it("reads the import cursor", async () => {
    const { client, http } = makeClient();
    http.push({ body: { content_uuid: "c1", original_uuid: "my-id", original_timestamp: "2026-05-31T08:00:00Z", name: "chat", empty: false } });
    const cursor = await client.imports.cursor(DISK_UUID);
    expect(http.last.path).toBe(`sd/disks/${DISK_UUID}/import/last`);
    expect(cursor.empty).toBe(false);
    expect(cursor.original_uuid).toBe("my-id");
  });

  it("re-queues a failed source", async () => {
    const { client, http } = makeClient();
    http.push({ body: { status: "queued" } });
    const result = await client.imports.retry(DISK_UUID, "c1");
    expect(http.last.method).toBe("POST");
    expect(http.last.path).toBe(`sd/disks/${DISK_UUID}/contents/c1/retry`);
    expect(result.status).toBe("queued");
  });
});

describe("ocr", () => {
  it("posts the image without touching a disk", async () => {
    const { client, http } = makeClient();
    http.push({ body: { text: "Invoice", chars: 7 } });
    const result = await client.ocr({ image_b64: "iVBORw0KGgo=", format: "png" });
    expect(http.last.path).toBe("sd/ocr");
    expect(http.last.body).toEqual({ image_b64: "iVBORw0KGgo=", format: "png" });
    expect(result.chars).toBe(7);
  });

  it("requires the image bytes", async () => {
    const { client } = makeClient();
    await expect(client.ocr({ image_b64: "" })).rejects.toThrow(SmartDiskUsageError);
  });
});
