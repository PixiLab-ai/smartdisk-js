import { describe, expect, it } from "vitest";
import { SmartDiskTooLargeError, SmartDiskUsageError } from "../src/index.js";
import { DISK_UUID, makeClient } from "./helpers.js";

const D = `sd/disks/${DISK_UUID}`;

describe("tools.read", () => {
  it("pages a document by byte offset", async () => {
    const { client, http } = makeClient();
    http.push({ body: { content: { uuid: "d1", name: "Q2", content_type: "doc", folder_path: "/reports", status: "processed", created_at: "t" }, body: "# Q2", total: 412903, offset: 0, limit: 200, truncated: true } });
    const source = await client.tools.read(DISK_UUID, "d1", { offset: 0, limit: 200 });
    expect(http.last.path).toBe(`${D}/contents/d1`);
    expect(http.last.query).toEqual({ offset: "0", limit: "200" });
    expect(source.truncated).toBe(true);
  });

  it("returns a conversation's messages", async () => {
    const { client, http } = makeClient();
    http.push({ body: { content: { uuid: "c1", name: "Planning", content_type: "chat", folder_path: "/imports", status: "processed", created_at: "t" }, messages: [{ uuid: "m1", role: "user", text: "hi", sort_order: 0 }], total: 240, offset: 0, limit: 200, truncated: true } });
    const source = await client.tools.read(DISK_UUID, "c1");
    expect(source.messages?.[0]?.role).toBe("user");
  });

  it("requires a content uuid", async () => {
    const { client } = makeClient();
    await expect(client.tools.read(DISK_UUID, "")).rejects.toThrow(SmartDiskUsageError);
  });
});

describe("tools.grep", () => {
  it("sends the pattern and its options", async () => {
    const { client, http } = makeClient();
    http.push({ body: { hits: [], pattern: "ERR_[A-Z_]+", path: "/", limit: 50, truncated: false } });
    await client.tools.grep(DISK_UUID, "ERR_[A-Z_]+", { path: "/imports", limit: 10, case_insensitive: true });
    expect(http.last.path).toBe(`${D}/grep`);
    expect(http.last.query).toEqual({
      pattern: "ERR_[A-Z_]+",
      path: "/imports",
      limit: "10",
      case_insensitive: "true",
    });
  });

  it("omits case_insensitive when it was not asked for", async () => {
    const { client, http } = makeClient();
    http.push({ body: { hits: [], pattern: "x", path: "/", limit: 50, truncated: false } });
    await client.tools.grep(DISK_UUID, "x");
    expect(http.last.query).toEqual({ pattern: "x" });
  });

  it("requires a pattern", async () => {
    const { client } = makeClient();
    await expect(client.tools.grep(DISK_UUID, "  ")).rejects.toThrow(SmartDiskUsageError);
  });
});

describe("tools.export", () => {
  it("asks for json and parses the fact graph", async () => {
    const { client, http } = makeClient();
    http.push({ raw: JSON.stringify({ disk: DISK_UUID, disk_name: "Research", path: "/", exported_at: "t", facts: [], edges: [] }) });
    const graph = await client.tools.export(DISK_UUID, { include: "facts,edges,summaries", path: "/research" });
    expect(http.last.path).toBe(`${D}/export`);
    expect(http.last.query).toEqual({ format: "json", include: "facts,edges,summaries", path: "/research" });
    expect(graph.disk_name).toBe("Research");
  });

  it("maps a 413 to a too-large error carrying its limits", async () => {
    const { client, http } = makeClient();
    http.push({ status: 413, body: { error: "too_large", facts_total: 40123, max_facts: 20000, detail: "narrow it" } });
    const failure = await client.tools.export(DISK_UUID).catch((error) => error);
    expect(failure).toBeInstanceOf(SmartDiskTooLargeError);
    expect(failure.factsTotal).toBe(40123);
    expect(failure.maxFacts).toBe(20000);
  });
});

describe("tools.hubs and lint", () => {
  it("hubs sends top and path", async () => {
    const { client, http } = makeClient();
    http.push({ body: { hubs: [], nodes: 0, edges: 0, top: 20, hubs_total: 0, truncated: false, path: "/" } });
    await client.tools.hubs(DISK_UUID, { top: 50, path: "/research" });
    expect(http.last.path).toBe(`${D}/hubs`);
    expect(http.last.query).toEqual({ top: "50", path: "/research" });
  });

  it("hubs refuses rather than truncates above the edge ceiling", async () => {
    const { client, http } = makeClient();
    http.push({ status: 413, body: { error: "too_large", edges_total: 90000, max_edges: 50000 } });
    const failure = await client.tools.hubs(DISK_UUID).catch((error) => error);
    expect(failure).toBeInstanceOf(SmartDiskTooLargeError);
    expect(failure.edgesTotal).toBe(90000);
    expect(failure.maxEdges).toBe(50000);
  });

  it("lint keeps a failed section's own error inside its slot", async () => {
    const { client, http } = makeClient();
    http.push({ body: { disk: DISK_UUID, generated_at: "t", path: "/", limit: 50, sections: { dirty_backlog: { total: 42, returned: 42, items: [] }, dup_summaries: { total: null, error: "lens broke" } }, totals: { dirty_backlog: 42, dup_summaries: null } } });
    const report = await client.tools.lint(DISK_UUID, { path: "/", limit: 50 });
    expect(http.last.query).toEqual({ path: "/", limit: "50" });
    expect(report.sections.dup_summaries?.error).toBe("lens broke");
    expect(report.sections.dup_summaries?.total).toBeNull();
  });
});

describe("tools.extractPreview", () => {
  it("posts the text and aliases", async () => {
    const { client, http } = makeClient();
    http.push({ body: { facts: [], dropped: 2, chars: 1841, truncated: false } });
    const preview = await client.tools.extractPreview(DISK_UUID, {
      text: "Alex joined Northwind in March 2022.",
      aliases: { user: "alex" },
    });
    expect(http.last.path).toBe(`${D}/extract-preview`);
    expect(http.last.body).toEqual({ text: "Alex joined Northwind in March 2022.", aliases: { user: "alex" } });
    expect(preview.dropped).toBe(2);
  });

  it("requires text", async () => {
    const { client } = makeClient();
    await expect(client.tools.extractPreview(DISK_UUID, { text: "" })).rejects.toThrow(SmartDiskUsageError);
  });
});

describe("tools consolidation audit", () => {
  it("lists runs newest first", async () => {
    const { client, http } = makeClient();
    http.push({ body: { runs: [], returned: 0, limit: 20 } });
    await client.tools.consolidationRuns(DISK_UUID, { limit: 5 });
    expect(http.last.path).toBe(`${D}/consolidation/runs`);
    expect(http.last.query).toEqual({ limit: "5" });
  });

  it("reads one run, and asks for the undo plan only when told to", async () => {
    const { client, http } = makeClient();
    http.push({ body: { uuid: "r1" } }, { body: { uuid: "r1", plan: { applicable: true } } });
    await client.tools.consolidationRun(DISK_UUID, "r1");
    expect(http.last.path).toBe(`${D}/consolidation/runs/r1`);
    expect(http.last.query).toEqual({});
    await client.tools.consolidationRun(DISK_UUID, "r1", { plan: true });
    expect(http.last.query).toEqual({ plan: "1" });
  });
});
