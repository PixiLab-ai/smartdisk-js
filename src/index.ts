/**
 * smartdisk — the official TypeScript SDK for the SmartDisk memory engine.
 *
 * ```ts
 * import { SmartDisk } from "@fy-/smartdisk";
 *
 * const client = new SmartDisk({ apiKey: process.env.SMARTDISK_API_KEY });
 * const disk = await client.disks.create({ name: "support-bot" });
 *
 * await client.imports.chat(disk, { name: "ticket-4417", messages });
 * const ctx = await client.retrieve(disk, "what does this customer prefer?");
 * const { answer } = await client.memory.ask(disk, "what does this customer prefer?");
 * ```
 */

export { SmartDisk, type SmartDiskOptions } from "./client.js";
export { Disks } from "./disks.js";
export { Imports } from "./imports.js";
export { Memory } from "./memory.js";
export { Tools } from "./tools.js";
export { DEFAULT_BASE_URL, type FetchLike, type RetryOptions } from "./http.js";

export {
  SmartDiskError,
  SmartDiskUsageError,
  SmartDiskConnectionError,
  SmartDiskTimeoutError,
  SmartDiskBadRequestError,
  SmartDiskAuthenticationError,
  SmartDiskPermissionError,
  SmartDiskNotFoundError,
  SmartDiskTooLargeError,
  SmartDiskUnprocessableError,
  SmartDiskRateLimitError,
  SmartDiskServerError,
  SmartDiskUpstreamError,
  SmartDiskUnavailableError,
  type SmartDiskErrorBody,
} from "./errors.js";

export type * from "./types.js";
