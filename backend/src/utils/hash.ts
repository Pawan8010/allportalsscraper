import crypto from "crypto";

/**
 * Deterministic content hash for a tender's normalised field set.
 * Used by the orchestrator to skip writes when nothing has actually changed
 * between two observations of the same (portal, tenderId) row.
 */
export function computeContentHash(fields: Record<string, unknown>): string {
  const ordered = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k] ?? ""}`)
    .join("|");
  return crypto.createHash("sha256").update(ordered).digest("hex");
}
