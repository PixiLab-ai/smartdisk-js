/**
 * Disks — a container for one body of memory. Disks are private to their owner.
 */

import type { ClientContext } from "./internal.js";
import { compact, required } from "./internal.js";
import type { CreateDiskParams, DeletedResponse, Disk, DiskListResponse, DiskRef } from "./types.js";

export class Disks {
  constructor(private readonly ctx: ClientContext) {}

  /**
   * Create a disk. Idempotent on `slug`: if a disk with that slug already exists
   * for you, the existing disk is returned rather than a second one.
   */
  async create(params: CreateDiskParams): Promise<Disk> {
    required(params?.name, "name");
    return this.ctx.transport.request<Disk>({
      method: "POST",
      path: "sd/disks",
      body: compact({ name: params.name, slug: params.slug, description: params.description }),
    });
  }

  /** Every disk this key's owner has, with document counts and stored tokens. */
  async list(): Promise<Disk[]> {
    const data = await this.ctx.transport.request<DiskListResponse | Disk[]>({
      method: "GET",
      path: "sd/disks",
    });
    if (Array.isArray(data)) return data;
    return data?.disks ?? [];
  }

  /** The disk a slug names, or `null` when this key owns no such disk. */
  async find(slug: string): Promise<Disk | null> {
    const wanted = required(slug, "slug");
    const disks = await this.list();
    return disks.find((disk) => disk.slug === wanted) ?? null;
  }

  /** The uuid behind any disk reference. Slugs are resolved once, then cached. */
  async resolve(disk: DiskRef): Promise<string> {
    return this.ctx.diskUuid(disk);
  }

  /** Remove the disk and everything under it. Irreversible. */
  async delete(disk: DiskRef): Promise<DeletedResponse> {
    const uuid = await this.ctx.diskUuid(disk);
    return this.ctx.transport.request<DeletedResponse>({
      method: "DELETE",
      path: `sd/disks/${uuid}`,
    });
  }
}
