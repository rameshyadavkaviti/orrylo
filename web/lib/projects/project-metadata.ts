import { TOKEN_DESCRIPTION_MAX_LENGTH } from "../validation/token";

const PROJECT_DISPLAY_NAME_MIN_LENGTH = 2;
const PROJECT_DISPLAY_NAME_MAX_LENGTH = 40;
const PROJECT_URL_MAX_LENGTH = 2048;

export interface EditableProjectMetadataInput {
  displayName: string;
  description: string;
  logoUrl: string;
  websiteUrl: string;
  communityUrl: string;
}

export interface NormalizedProjectMetadata {
  displayName: string;
  description: string | null;
  logoUrl: string | null;
  websiteUrl: string | null;
  communityUrl: string | null;
}

export type ProjectMetadataField = keyof EditableProjectMetadataInput;
export type ProjectMetadataErrors = Partial<
  Record<ProjectMetadataField, string>
>;

export interface ProjectMetadataValidationResult {
  valid: boolean;
  normalized: NormalizedProjectMetadata;
  errors: ProjectMetadataErrors;
}

export function parseEditableProjectMetadataInput(
  input: unknown,
): EditableProjectMetadataInput | null {
  if (!isRecord(input)) {
    return null;
  }

  const fields: ProjectMetadataField[] = [
    "displayName",
    "description",
    "logoUrl",
    "websiteUrl",
    "communityUrl",
  ];

  for (const field of fields) {
    if (typeof input[field] !== "string") {
      return null;
    }
  }

  return {
    displayName: input.displayName as string,
    description: input.description as string,
    logoUrl: input.logoUrl as string,
    websiteUrl: input.websiteUrl as string,
    communityUrl: input.communityUrl as string,
  };
}

export function validateEditableProjectMetadata(
  input: EditableProjectMetadataInput,
): ProjectMetadataValidationResult {
  const errors: ProjectMetadataErrors = {};
  const displayName = input.displayName.trim();
  const description = input.description.trim();

  if (
    displayName.length < PROJECT_DISPLAY_NAME_MIN_LENGTH ||
    displayName.length > PROJECT_DISPLAY_NAME_MAX_LENGTH
  ) {
    errors.displayName = "Display name must be between 2 and 40 characters.";
  }

  if (description.length > TOKEN_DESCRIPTION_MAX_LENGTH) {
    errors.description = "Description must be 280 characters or fewer.";
  }

  const logo = normalizeOptionalHttpsUrl(input.logoUrl);
  const website = normalizeOptionalHttpsUrl(input.websiteUrl);
  const community = normalizeOptionalHttpsUrl(input.communityUrl);

  if (!logo.valid) {
    errors.logoUrl =
      "Logo URL must be an HTTPS URL. Browser-local, data, blob, file, and script URLs are not accepted.";
  }

  if (!website.valid) {
    errors.websiteUrl = "Website URL must be an HTTPS URL.";
  }

  if (!community.valid) {
    errors.communityUrl = "Community URL must be an HTTPS URL.";
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    normalized: {
      displayName,
      description: description || null,
      logoUrl: logo.value,
      websiteUrl: website.value,
      communityUrl: community.value,
    },
  };
}

export function safeHttpsUrl(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = normalizeOptionalHttpsUrl(value);
  return normalized.valid ? normalized.value : null;
}

function normalizeOptionalHttpsUrl(
  rawValue: string,
): { valid: true; value: string | null } | { valid: false; value: null } {
  const value = rawValue.trim();

  if (!value) {
    return { valid: true, value: null };
  }

  if (value.length > PROJECT_URL_MAX_LENGTH) {
    return { valid: false, value: null };
  }

  try {
    const url = new URL(value);

    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password
    ) {
      return { valid: false, value: null };
    }

    return { valid: true, value: url.toString() };
  } catch {
    return { valid: false, value: null };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
