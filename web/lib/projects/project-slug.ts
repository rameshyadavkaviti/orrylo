const PROJECT_SLUG_MAX_LENGTH = 63;
const PROJECT_SLUG_BASE_MAX_LENGTH = 52;

export function normalizeProjectSlug(
  displayName: string,
  assetCode: string,
): string {
  const normalizedName = normalizeSlugPart(displayName);
  const normalizedCode = normalizeSlugPart(assetCode);
  const base = normalizedName || normalizedCode || "project";

  return trimSlug(base.slice(0, PROJECT_SLUG_BASE_MAX_LENGTH)) || "project";
}

export function projectSlugCandidate(base: string, ordinal: number): string {
  if (ordinal < 1 || !Number.isInteger(ordinal)) {
    throw new Error("Slug ordinal must be a positive integer.");
  }

  if (ordinal === 1) {
    return trimSlug(base.slice(0, PROJECT_SLUG_MAX_LENGTH));
  }

  const suffix = `-${ordinal}`;
  const available = PROJECT_SLUG_MAX_LENGTH - suffix.length;
  const prefix = trimSlug(base.slice(0, available)) || "project";

  return prefix + suffix;
}

function normalizeSlugPart(value: string): string {
  return trimSlug(
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-"),
  );
}

function trimSlug(value: string): string {
  return value.replace(/^-+|-+$/g, "").replace(/-+/g, "-");
}
