import { describe, expect, it } from "vitest";
import { SmartDiskUsageError } from "../src/index.js";
import { DISK_UUID, makeClient } from "./helpers.js";

const DISK = { uuid: DISK_UUID, name: "Research notes", slug: "research" };

describe("disks", () => {
  it("create posts the documented body", async () => {
    const { client, http } = makeClient();
    http.push({ body: DISK });
    const disk = await client.disks.create({ name: "Research notes", slug: "research", description: "d" });
    expect(http.last.method).toBe("POST");
    expect(http.last.path).toBe("sd/disks");
    expect(http.last.body).toEqual({ name: "Research notes", slug: "research", description: "d" });
    expect(disk.uuid).toBe(DISK_UUID);
  });

  it("create omits the fields it was not given", async () => {
    const { client, http } = makeClient();
    http.push({ body: DISK });
    await client.disks.create({ name: "Research notes" });
    expect(http.last.body).toEqual({ name: "Research notes" });
  });

  it("create requires a name", async () => {
    const { client } = makeClient();
    await expect(client.disks.create({ name: "  " })).rejects.toThrow(SmartDiskUsageError);
  });

  it("list unwraps the disks array", async () => {
    const { client, http } = makeClient();
    http.push({ body: { disks: [DISK] } });
    const disks = await client.disks.list();
    expect(http.last.method).toBe("GET");
    expect(http.last.path).toBe("sd/disks");
    expect(disks).toEqual([DISK]);
  });

  it("find returns null when the slug is not this key's", async () => {
    const { client, http } = makeClient();
    http.push({ body: { disks: [DISK] } });
    expect(await client.disks.find("other")).toBeNull();
  });

  it("delete targets the uuid", async () => {
    const { client, http } = makeClient();
    http.push({ body: { deleted: true } });
    const result = await client.disks.delete(DISK);
    expect(http.last.method).toBe("DELETE");
    expect(http.last.path).toBe(`sd/disks/${DISK_UUID}`);
    expect(result.deleted).toBe(true);
  });
});

describe("disk references", () => {
  it("resolves a slug through the listing, once", async () => {
    const { client, http } = makeClient();
    http.push(
      { body: { disks: [DISK] } },
      { body: { facts: [], summary: "", tags: [] } },
      { body: { facts: [], summary: "", tags: [] } },
    );
    await client.memory.facts("research");
    await client.memory.facts("research");
    expect(http.calls.map((call) => call.path)).toEqual([
      "sd/disks",
      `sd/disks/${DISK_UUID}/memory`,
      `sd/disks/${DISK_UUID}/memory`,
    ]);
  });

  it("re-resolves after the cache is cleared", async () => {
    const { client, http } = makeClient();
    http.always({ body: { disks: [DISK] } });
    await client.resolveDisk("research");
    client.clearDiskCache();
    await client.resolveDisk("research");
    expect(http.calls).toHaveLength(2);
  });

  it("uses a uuid string without any lookup", async () => {
    const { client, http } = makeClient();
    http.push({ body: { facts: [], summary: "", tags: [] } });
    await client.memory.facts(DISK_UUID);
    expect(http.calls).toHaveLength(1);
  });

  it("explains an unknown slug instead of guessing a uuid", async () => {
    const { client, http } = makeClient();
    http.push({ body: { disks: [] } });
    await expect(client.memory.facts("nope")).rejects.toThrow(/no disk with slug "nope"/);
  });

  it("rejects an empty reference", async () => {
    const { client } = makeClient();
    await expect(client.memory.facts("")).rejects.toThrow(SmartDiskUsageError);
  });
});
