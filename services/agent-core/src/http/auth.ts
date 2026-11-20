import { createHash, timingSafeEqual } from "node:crypto";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function isAuthorized(authorization: string | undefined, current: string, previous?: string): boolean {
  const prefix = "Bearer ";
  const candidate = authorization?.startsWith(prefix) ? authorization.slice(prefix.length) : "";
  const candidateDigest = digest(candidate);
  const currentMatch = timingSafeEqual(candidateDigest, digest(current));
  const previousMatch = previous !== undefined && timingSafeEqual(candidateDigest, digest(previous));
  return candidate.length > 0 && (currentMatch || previousMatch);
}
