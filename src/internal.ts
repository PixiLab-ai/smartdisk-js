/** Shared plumbing between the resource namespaces. Not part of the public API. */

import type { Transport } from "./http.js";
import type { DiskRef } from "./types.js";
import { SmartDiskUsageError } from "./errors.js";

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export interface ClientContext {
  transport: Transport;
  /** A disk uuid for any reference, resolving a slug through the disk listing once. */
  diskUuid(ref: DiskRef): Promise<string>;
}

/** `true` when the string is a uuid rather than a slug. */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

/** The slug a reference names, or `null` when it already carries a uuid. */
export function slugOf(ref: DiskRef): string | null {
  if (typeof ref !== "string") return null;
  const value = ref.trim();
  if (!value) throw new SmartDiskUsageError("a disk reference cannot be an empty string");
  return isUuid(value) ? null : value;
}

/** The uuid a reference carries directly, or `null` when it has to be resolved. */
export function uuidOf(ref: DiskRef): string | null {
  if (typeof ref === "string") {
    const value = ref.trim();
    if (!value) throw new SmartDiskUsageError("a disk reference cannot be an empty string");
    return isUuid(value) ? value : null;
  }
  if (ref && typeof ref === "object" && typeof ref.uuid === "string" && ref.uuid.trim()) {
    return ref.uuid.trim();
  }
  throw new SmartDiskUsageError(
    "a disk reference must be a disk uuid, a disk slug, or an object with a `uuid` field",
  );
}

/** Trim a required string argument, or say which one was missing. */
export function required(value: string | undefined | null, what: string): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) throw new SmartDiskUsageError(`${what} is required`);
  return trimmed;
}

/** Drop `undefined` entries so an omitted option never reaches the wire as `null`. */
export function compact<T extends Record<string, unknown>>(body: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** Merge the typed options with the untyped `extra` escape hatch. */
export function withExtra(
  body: Record<string, unknown>,
  extra: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return extra ? { ...body, ...extra } : body;
}
