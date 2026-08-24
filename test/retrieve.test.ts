import { describe, expect, it } from "vitest";
import { SmartDiskUsageError } from "../src/index.js";
import { DISK_UUID, makeClient } from "./helpers.js";

const RESPONSE = {
  block: "[1] Planning call › Schedule\nWe moved the launch to March.",
  citations: [
    {
      n: 1,
      type: "message_chunk",
      content_uuid: "4a7b",
      content_name: "Planning call",
      heading_path: "Schedule",
      snippet: "We moved the launch to March.",
      score: 0.91,
      object_uuid: "b18f",
    },
  ],
  tokens_used: 1840,
  drilled: true,
  expanded: false,
  stable: { block: "# Disk profile", hash: "749cf4a0", tokens: 512 },
  retrieve_ms: 320,
};

describe("retrieve", () => {
  it("posts only the query when no options are given", async () => {
    const { client, http } = makeClient();
    http.push({ body: RESPONSE });
    const result = await client.retrieve(DISK_UUID, "When did we move the launch?");
    expect(http.last.method).toBe("POST");
    expect(http.last.path).toBe(`sd/disks/${DISK_UUID}/retrieve`);
    expect(http.last.body).toEqual({ query: "When did we move the launch?" });
    expect(result.citations[0]?.object_uuid).toBe("b18f");
    expect(result.stable?.hash).toBe("749cf4a0");
  });

  it("passes every documented knob through under its wire name", async () => {
    const { client, http } = makeClient();
    http.push({ body: RESPONSE });
    await client.retrieve(DISK_UUID, "q", {
      path: "/research",
      context_tokens: 2000,
      categories: ["health"],
      tags: ["work"],
      since: "2026-01-01T00:00:00Z",
      until: "2026-06-01T00:00:00Z",
      graph_expand: true,
      graph_hops: 2,
      expand: true,
      expand_max: 3,
      min_score: 0.5,
      exclude: ["b18f"],
      session_id: "chat-8412",
      dedup_turns: 8,
      recency: true,
      explain: true,
    });
    expect(http.last.body).toEqual({
      query: "q",
      path: "/research",
      context_tokens: 2000,
      categories: ["health"],
      tags: ["work"],
      since: "2026-01-01T00:00:00Z",
      until: "2026-06-01T00:00:00Z",
      graph_expand: true,
      graph_hops: 2,
      expand: true,
      expand_max: 3,
      min_score: 0.5,
      exclude: ["b18f"],
      session_id: "chat-8412",
      dedup_turns: 8,
      recency: true,
      explain: true,
    });
  });

  it("keeps a negative min_score, which means no floor at all", async () => {
    const { client, http } = makeClient();
    http.push({ body: RESPONSE });
    await client.retrieve(DISK_UUID, "q", { min_score: -1 });
    expect(http.last.body.min_score).toBe(-1);
  });

  it("keeps an explicit false rather than dropping it", async () => {
    const { client, http } = makeClient();
    http.push({ body: RESPONSE });
    await client.retrieve(DISK_UUID, "q", { recency: false, expand: false });
    expect(http.last.body).toEqual({ query: "q", recency: false, expand: false });
  });

  it("merges the extra escape hatch over the typed body", async () => {
    const { client, http } = makeClient();
    http.push({ body: RESPONSE });
    await client.retrieve(DISK_UUID, "q", { extra: { candidates: 48 } });
    expect(http.last.body).toEqual({ query: "q", candidates: 48 });
  });

  it("surfaces the ledger when the server sends one", async () => {
    const { client, http } = makeClient();
    http.push({ body: { ...RESPONSE, ledger: { session_id: "chat-8412", dedup_turns: 8, excluded: 37, recorded: 24 } } });
    const result = await client.retrieve(DISK_UUID, "q", { session_id: "chat-8412", dedup_turns: 8 });
    expect(result.ledger?.excluded).toBe(37);
  });

  it("requires a query", async () => {
    const { client } = makeClient();
    await expect(client.retrieve(DISK_UUID, "   ")).rejects.toThrow(SmartDiskUsageError);
  });
});

describe("memory.ask", () => {
  it("posts to the chat route with the answer options", async () => {
    const { client, http } = makeClient();
    http.push({ body: { answer: "March.", citations: [], drilled: false, tokens_used: 10, retrieve_ms: 5, answer_ms: 900 } });
    const result = await client.memory.ask(DISK_UUID, "When did we move the launch?", {
      model: "fast",
      language: "en",
      path: "/research",
      history: [{ role: "user", content: "hi" }],
      expand: true,
    });
    expect(http.last.path).toBe(`sd/disks/${DISK_UUID}/chat`);
    expect(http.last.body).toEqual({
      query: "When did we move the launch?",
      path: "/research",
      model: "fast",
      language: "en",
      history: [{ role: "user", content: "hi" }],
      expand: true,
    });
    expect(result.answer).toBe("March.");
    expect(result.answer_ms).toBe(900);
  });

  it("requires a query", async () => {
    const { client } = makeClient();
    await expect(client.memory.ask(DISK_UUID, "")).rejects.toThrow(SmartDiskUsageError);
  });
});
