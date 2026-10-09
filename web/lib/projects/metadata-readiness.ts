import { SHARED_ASSET_DOMAIN } from "../product/constants";
import type { ManagedProjectProfile } from "./project-profile";
import { projectPublicPath } from "./project-profile";
import { safeHttpsUrl } from "./project-metadata";
import {
  generateProjectCurrencyToml,
  hasValidStellarIssuer,
} from "./stellar-toml";

export type ReadinessState =
  | "ready"
  | "configured"
  | "missing"
  | "unverified"
  | "not_published"
  | "not_reachable"
  | "not_applicable";

export type MetadataReadinessKey =
  | "metadata_configured"
  | "asset_code"
  | "display_name"
  | "description"
  | "image_reference"
  | "image_reachability"
  | "metadata_home"
  | "issuer_linkage"
  | "toml_generated"
  | "toml_published"
  | "toml_reachable"
  | "public_landing"
  | "explorer_visibility"
  | "sac_visibility"
  | "stellar_asset";

export interface MetadataReadinessItem {
  key: MetadataReadinessKey;
  label: string;
  state: ReadinessState;
  value: string;
  detail: string;
}

export interface MetadataReadinessResult {
  metadataConfigured: boolean;
  publicationReady: boolean;
  blockers: MetadataReadinessKey[];
  items: MetadataReadinessItem[];
  toml: {
    generatable: boolean;
    generated: boolean;
    published: false;
    reachable: false;
    content: string | null;
  };
  publicLanding: {
    published: boolean;
    path: string;
  };
  explorerVisibility: {
    verified: false;
  };
  sacVisibility: {
    verified: false;
    applicable: false;
  };
}

export function buildMetadataReadiness(
  project: ManagedProjectProfile,
): MetadataReadinessResult {
  const assetCodeValid = /^[A-Z0-9]{1,12}$/.test(project.assetCode);
  const displayNameConfigured = project.displayName.trim().length > 0;
  const descriptionConfigured = Boolean(project.description?.trim());
  const durableImage = safeHttpsUrl(project.logoUrl);
  const metadataHomeConfigured = Boolean(project.metadataHome?.trim());
  const sharedHostCompatible =
    project.issuerModel !== "shared" ||
    project.metadataHome === SHARED_ASSET_DOMAIN;
  const issuerLinked = hasValidStellarIssuer(project.issuerPublicKey);
  const generatedToml = generateProjectCurrencyToml(project);
  const metadataConfigured =
    displayNameConfigured &&
    descriptionConfigured &&
    metadataHomeConfigured &&
    sharedHostCompatible;
  const publicationReady = metadataConfigured && assetCodeValid && issuerLinked;
  const blockers: MetadataReadinessKey[] = [];

  if (!assetCodeValid) blockers.push("asset_code");
  if (!displayNameConfigured) blockers.push("display_name");
  if (!descriptionConfigured) blockers.push("description");
  if (!metadataHomeConfigured || !sharedHostCompatible)
    blockers.push("metadata_home");
  if (!issuerLinked) blockers.push("issuer_linkage");

  const items: MetadataReadinessItem[] = [
    {
      key: "metadata_configured",
      label: "Project metadata",
      state: metadataConfigured ? "ready" : "missing",
      value: metadataConfigured ? "Configured" : "Needs attention",
      detail: metadataConfigured
        ? "The current Project Profile has the core presentation metadata needed for a publication-ready record."
        : "Complete the missing Project Profile fields shown below before publication infrastructure is added.",
    },
    {
      key: "asset_code",
      label: "Asset code",
      state: assetCodeValid ? "ready" : "missing",
      value: assetCodeValid ? project.assetCode : "Invalid",
      detail:
        "Asset code is project identity input and remains read-only in this metadata editor.",
    },
    {
      key: "display_name",
      label: "Display name",
      state: displayNameConfigured ? "configured" : "missing",
      value: displayNameConfigured ? "Configured" : "Missing",
      detail: displayNameConfigured
        ? project.displayName
        : "Add a project display name.",
    },
    {
      key: "description",
      label: "Description",
      state: descriptionConfigured ? "configured" : "missing",
      value: descriptionConfigured ? "Configured" : "Missing",
      detail: descriptionConfigured
        ? "A project description is stored in the Project Profile."
        : "Add a short project description.",
    },
    {
      key: "image_reference",
      label: "Project image",
      state: durableImage ? "configured" : "missing",
      value: durableImage ? "HTTPS URL configured" : "Missing",
      detail: durableImage
        ? "A durable HTTPS image reference is configured."
        : "Builder-local images are not persistent. Add a durable HTTPS image URL when one exists.",
    },
    {
      key: "image_reachability",
      label: "Image reachability",
      state: durableImage ? "unverified" : "not_applicable",
      value: durableImage ? "Not yet verified" : "No durable image",
      detail:
        "This slice does not fetch or externally verify image availability.",
    },
    {
      key: "metadata_home",
      label: "Metadata home",
      state:
        metadataHomeConfigured && sharedHostCompatible
          ? "configured"
          : "missing",
      value: project.metadataHome ?? "Not configured",
      detail:
        project.issuerModel === "shared"
          ? `Shared Issuer metadata remains bound to the canonical ${SHARED_ASSET_DOMAIN} context.`
          : "Dedicated Issuer metadata hosting remains a separate future infrastructure concern.",
    },
    {
      key: "issuer_linkage",
      label: "Issuer linkage",
      state: issuerLinked ? "configured" : "missing",
      value: issuerLinked ? "Issuer recorded" : "Not linked",
      detail: issuerLinked
        ? "A checksum-valid Stellar issuer public key is stored for this project."
        : "No verified Stellar issuer public key is linked yet, so publication is not ready.",
    },
    {
      key: "toml_generated",
      label: "stellar.toml preview",
      state: generatedToml ? "ready" : "missing",
      value: generatedToml ? "Generated locally" : "Not generatable",
      detail: generatedToml
        ? "A deterministic application-side [[CURRENCIES]] preview can be generated from the Project Profile."
        : "The current Project Profile cannot generate a metadata preview.",
    },
    {
      key: "toml_published",
      label: "stellar.toml published",
      state: "not_published",
      value: "No",
      detail:
        "No TOML publication mechanism is activated by this feature.",
    },
    {
      key: "toml_reachable",
      label: "stellar.toml reachable",
      state: "not_reachable",
      value: "No",
      detail:
        "Orrylo has not published or externally verified a reachable stellar.toml for this project.",
    },
    {
      key: "public_landing",
      label: "Public landing page",
      state: project.publicStatus === "published" ? "ready" : "not_published",
      value:
        project.publicStatus === "published" ? "Published" : "Private draft",
      detail:
        project.publicStatus === "published"
          ? `Available at ${projectPublicPath(project.slug)}. This is not a metadata-host URL.`
          : "The Orrylo landing page has not been published.",
    },
    {
      key: "explorer_visibility",
      label: "Explorer visibility",
      state: "unverified",
      value: "No verified evidence",
      detail:
        "Generation or landing-page publication does not imply explorer visibility.",
    },
    {
      key: "sac_visibility",
      label: "SAC visibility",
      state: "not_applicable",
      value: "Not verified",
      detail:
        "No SAC visibility claim is made because this managed project has no verified on-chain asset state in this slice.",
    },
    {
      key: "stellar_asset",
      label: "Stellar asset",
      state: "not_applicable",
      value: "Not created",
      detail:
        "Metadata readiness does not issue or mutate a Stellar asset.",
    },
  ];

  return {
    metadataConfigured,
    publicationReady,
    blockers,
    items,
    toml: {
      generatable: Boolean(generatedToml),
      generated: Boolean(generatedToml),
      published: false,
      reachable: false,
      content: generatedToml?.content ?? null,
    },
    publicLanding: {
      published: project.publicStatus === "published",
      path: projectPublicPath(project.slug),
    },
    explorerVisibility: { verified: false },
    sacVisibility: { verified: false, applicable: false },
  };
}
