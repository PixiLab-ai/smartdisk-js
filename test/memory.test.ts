import { describe, expect, it } from "vitest";
import { SmartDiskUsageError } from "../src/index.js";
import { DISK_UUID, makeClient } from "./helpers.js";

const D = `sd/disks/${DISK_UUID}`;

describe("memory reads", () => {
  it("facts hits /memory", async () => {
    const { client, http } = makeClient();
    http.push({ body: { facts: [{ text: "The launch is in March.", category: "schedule", reinforced_count: 2, origin: "chat" }], summary: "s", tags: [] } });
    const memory = await client.memory.facts(DISK_UUID);
    expect(http.last.path).toBe(`${D}/memory`);
    expect(memory.facts[0]?.origin).toBe("chat");
  });

  it("groups hits /groups and exposes the history counts", async () => {
    const { client, http } = makeClient();
    http.push({ body: { groups: [{ subject: "alex", predicate: "works_at", kind: "functional", current: [], history: [], history_count: 1 }], total_groups: 612, ungrouped: 44 } });
    const groups = await client.memory.groups(DISK_UUID);
    expect(http.last.path).toBe(`${D}/groups`);
    expect(groups.total_groups).toBe(612);
    expect(groups.ungrouped).toBe(44);
  });

  it("groupList returns just the array", async () => {
    const { client, http } = makeClient();
    http.push({ body: { groups: [{ subject: "alex", predicate: "works_at", kind: "multi", current: [], history: [], history_count: 0 }], total_groups: 1, ungrouped: 0 } });
    expect(await client.memory.groupList(DISK_UUID)).toHaveLength(1);
  });

  it("subjects passes limit", async () => {
    const { client, http } = makeClient();
    http.push({ body: { subjects: [], edges: [], subjects_total: 0, subjects_returned: 0, edges_total: 0, edges_returned: 0, edges_cap: 1500, truncated: false } });
    await client.memory.subjects(DISK_UUID, { limit: 0 });
    expect(http.last.path).toBe(`${D}/subjects`);
    expect(http.last.query).toEqual({ limit: "0" });
  });

  it("profile reads the generated profile and index", async () => {
    const { client, http } = makeClient();
    http.push({ body: { profile: { body: "b", headline: "h", generated_at: "t", facts_at_gen: 4213, gen_count: 3, hash: "749c" }, index: null } });
    const profile = await client.memory.profile(DISK_UUID);
    expect(http.last.path).toBe(`${D}/profile`);
    expect(profile.profile?.hash).toBe("749c");
    expect(profile.index).toBeNull();
  });

  it("regenerateProfile posts to profile/regen", async () => {
    const { client, http } = makeClient();
    http.push({ body: { profile: null, index: null } });
    await client.memory.regenerateProfile(DISK_UUID);
    expect(http.last.method).toBe("POST");
    expect(http.last.path).toBe(`${D}/profile/regen`);
  });

  it("tags unwraps the vocabulary and scopes by path", async () => {
    const { client, http } = makeClient();
    http.push({ body: { tags: [{ slug: "launch", text: "launch", uses: 5 }] } });
    const tags = await client.memory.tags(DISK_UUID, { path: "/research" });
    expect(http.last.path).toBe(`${D}/tags`);
    expect(http.last.query).toEqual({ path: "/research" });
    expect(tags[0]?.uses).toBe(5);
  });

  it("ecosystem reports the cap honestly", async () => {
    const { client, http } = makeClient();
    http.push({ body: { sources: [], tags: [], facts: [], links: { source_tag: [], source_fact: [], fact_tag: [] }, facts_total: 4213, facts_returned: 100, facts_cap: 100, truncated: true } });
    const graph = await client.memory.ecosystem(DISK_UUID, { limit: 100 });
    expect(http.last.path).toBe(`${D}/ecosystem`);
    expect(graph.truncated).toBe(true);
  });

  it("graphQuery sends q and depth", async () => {
    const { client, http } = makeClient();
    http.push({ body: { mode: "path", query: "alex..northwind", edges: [] } });
    const result = await client.memory.graphQuery(DISK_UUID, "alex..northwind", { depth: 4 });
    expect(http.last.path).toBe(`${D}/graph-query`);
    expect(http.last.query).toEqual({ q: "alex..northwind", depth: "4" });
    expect(result.mode).toBe("path");
  });
});

describe("contents and folders", () => {
  it("contents unwraps the rows", async () => {
    const { client, http } = makeClient();
    http.push({ body: { contents: [{ uuid: "c1", name: "Planning call", folder_path: "/imports", content_type: "chat", status: "processed", chunking_done: true, facts_done: true, summary_done: true, tags_done: true, created_at: "t", stale: true }] } });
    const contents = await client.memory.contents(DISK_UUID);
    expect(http.last.path).toBe(`${D}/contents`);
    expect(contents[0]?.stale).toBe(true);
  });

  it("contentsEnvelope keeps the consolidating flag", async () => {
    const { client, http } = makeClient();
    http.push({ body: { contents: [], consolidating: true } });
    expect((await client.memory.contentsEnvelope(DISK_UUID)).consolidating).toBe(true);
  });

  it("deleteContent reports the chunks removed", async () => {
    const { client, http } = makeClient();
    http.push({ body: { deleted: true, chunks_removed: 18 } });
    const result = await client.memory.deleteContent(DISK_UUID, "c1");
    expect(http.last.method).toBe("DELETE");
    expect(http.last.path).toBe(`${D}/contents/c1`);
    expect(result.chunks_removed).toBe(18);
  });

  it("moveContent posts the destination folder", async () => {
    const { client, http } = makeClient();
    http.push({ body: { moved: true } });
    await client.memory.moveContent(DISK_UUID, "c1", "/research");
    expect(http.last.path).toBe(`${D}/contents/c1/move`);
    expect(http.last.body).toEqual({ folder_path: "/research" });
  });

  it("folders lists, creates and deletes", async () => {
    const { client, http } = makeClient();
    http.push(
      { body: { folders: [{ path: "/research", name: "research", parent_path: "", content_count: 3 }] } },
      { body: {} },
      { body: { deleted: true } },
    );
    expect(await client.memory.folders(DISK_UUID)).toHaveLength(1);
    await client.memory.createFolder(DISK_UUID, "research/papers");
    expect(http.last.body).toEqual({ path: "research/papers" });
    await client.memory.deleteFolder(DISK_UUID, "/research/papers");
    expect(http.last.method).toBe("DELETE");
    expect(http.last.query).toEqual({ path: "/research/papers" });
  });
});

describe("aliases", () => {
  it("reads and writes the disk alias map", async () => {
    const { client, http } = makeClient();
    http.push({ body: { aliases: { user: "alex" } } }, { body: { status: "ok", aliases: { user: "alex" } } });
    expect(await client.memory.aliases(DISK_UUID)).toEqual({ user: "alex" });
    await client.memory.setAliases(DISK_UUID, { user: "alex" });
    expect(http.last.method).toBe("PUT");
    expect(http.last.path).toBe(`${D}/aliases`);
    expect(http.last.body).toEqual({ aliases: { user: "alex" } });
  });

  it("reads and writes one content's alias map", async () => {
    const { client, http } = makeClient();
    http.push({ body: { aliases: {} } }, { body: { status: "ok", aliases: { user: "Alex" } } });
    await client.memory.contentAliases(DISK_UUID, "c1");
    expect(http.last.path).toBe(`${D}/contents/c1/aliases`);
    await client.memory.setContentAliases(DISK_UUID, "c1", { user: "Alex" });
    expect(http.last.method).toBe("PUT");
    expect(http.last.body).toEqual({ aliases: { user: "Alex" } });
  });
});

describe("memory writes", () => {
  it("remember defaults category and priority", async () => {
    const { client, http } = makeClient();
    http.push({ body: { fact_uuid: "f1" } });
    const result = await client.memory.remember(DISK_UUID, { text: "Alex works at Northwind." });
    expect(http.last.path).toBe(`${D}/remember`);
    expect(http.last.body).toEqual({ text: "Alex works at Northwind.", category: "personal", priority: 50 });
    expect(result.fact_uuid).toBe("f1");
  });

  it("remember sends the triple when it is given", async () => {
    const { client, http } = makeClient();
    http.push({ body: { fact_uuid: "f1" } });
    await client.memory.remember(DISK_UUID, {
      text: "Alex works at Northwind.",
      subject: "alex",
      predicate: "works_at",
      object: "northwind",
      category: "career",
      priority: 80,
    });
    expect(http.last.body).toEqual({
      text: "Alex works at Northwind.",
      subject: "alex",
      predicate: "works_at",
      object: "northwind",
      category: "career",
      priority: 80,
    });
  });

  it("forget closes one fact", async () => {
    const { client, http } = makeClient();
    http.push({ body: { closed: 1 } });
    const result = await client.memory.forget(DISK_UUID, "f1");
    expect(http.last.path).toBe(`${D}/forget`);
    expect(http.last.body).toEqual({ fact_uuid: "f1" });
    expect(result.closed).toBe(1);
  });

  it("feedback rates a list of facts", async () => {
    const { client, http } = makeClient();
    http.push({ body: { updated: 2 } });
    const result = await client.memory.feedback(DISK_UUID, ["f1", " f2 "], -1);
    expect(http.last.path).toBe(`${D}/feedback`);
    expect(http.last.body).toEqual({ fact_uuids: ["f1", "f2"], score: -1 });
    expect(result.updated).toBe(2);
  });

  it("feedback refuses an empty list", async () => {
    const { client } = makeClient();
    await expect(client.memory.feedback(DISK_UUID, [], 1)).rejects.toThrow(SmartDiskUsageError);
  });

  it("reprioritize sends the new standing", async () => {
    const { client, http } = makeClient();
    http.push({ body: { updated: 1 } });
    await client.memory.reprioritize(DISK_UUID, "f1", 90);
    expect(http.last.path).toBe(`${D}/reprioritize`);
    expect(http.last.body).toEqual({ fact_uuid: "f1", priority: 90 });
  });

  it("reprioritize refuses a priority outside 1..100", async () => {
    const { client } = makeClient();
    await expect(client.memory.reprioritize(DISK_UUID, "f1", 0)).rejects.toThrow(SmartDiskUsageError);
    await expect(client.memory.reprioritize(DISK_UUID, "f1", 101)).rejects.toThrow(SmartDiskUsageError);
  });
});
