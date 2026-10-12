import {
  SHARED_METADATA_TOML_ENDPOINT,
  type MetadataPublicationState,
} from "./metadata-publication";
import type { ManagedProjectProfile } from "./project-profile";
import { projectPublicPath } from "./project-profile";
import { safeHttpsUrl } from "./project-metadata";
import {
  generateProjectCurrencyToml,
  hasValidStellarIssuer,
} from "./stellar-toml";
import { SHARED_ASSET_DOMAIN } from "../product/constants";

export type ReadinessState =
  | "ready"
  | "configured"
  | "missing"
  | "unverified"
  | "outdated"
  | "unsupported"
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
  | "issuer_model"
  | "network"
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
    published: boolean;
    reachable: boolean;
    verifiedAt: string | null;
    publishedContentCurrent: boolean;
    endpoint: string;
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
  publication: MetadataPublicationState | null = null,
): MetadataReadinessResult {
  const assetCodeValid = /^[A-Z0-9]{1,12}$/.test(project.assetCode);
  const displayNameConfigured = project.displayName.trim().length > 0;
  const descriptionConfigured = Boolean(project.description?.trim());
  const durableImage = safeHttpsUrl(project.logoUrl);
  const metadataHomeConfigured = Boolean(project.metadataHome?.trim());
  const sharedHostCompatible =
    project.issuerModel !== "shared" ||
    project.metadataHome === SHARED_ASSET_DOMAIN;
  const sharedIssuerSupported = project.issuerModel === "shared";
  const testnetSupported = project.network === "testnet";
  const issuerLinked = hasValidStellarIssuer(project.issuerPublicKey);
  const generatedToml = generateProjectCurrencyToml(project);
  const metadataConfigured =
    displayNameConfigured && metadataHomeConfigured && sharedHostCompatible;
  const publicationReady =
    metadataConfigured &&
    assetCodeValid &&
    issuerLinked &&
    sharedIssuerSupported &&
    testnetSupported;
  const publishedContentCurrent = Boolean(
    publication &&
    generatedToml &&
    publication.currencyToml === generatedToml.content,
  );
  const blockers: MetadataReadinessKey[] = [];

  if (!assetCodeValid) blockers.push("asset_code");
  if (!displayNameConfigured) blockers.push("display_name");
  if (!metadataHomeConfigured || !sharedHostCompatible)
    blockers.push("metadata_home");
  if (!sharedIssuerSupported) blockers.push("issuer_model");
  if (!testnetSupported) blockers.push("network");
  if (!issuerLinked) blockers.push("issuer_linkage");

  const items: MetadataReadinessItem[] = [
    {
      key: "metadata_configured",
      label: "Project metadata",
      state: metadataConfigured ? "ready" : "missing",
      value: metadataConfigured ? "Configured" : "Needs attention",
      detail: metadataConfigured
        ? "The baseline Project Profile metadata context is configured; optional presentation fields may still be missing."
        : "Complete the missing required Project Profile fields shown below before publication.",
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
        : "Description remains optional for this publication foundation.",
    },
    {
      key: "image_reference",
      label: "Project image",
      state: durableImage ? "configured" : "missing",
      value: durableImage ? "HTTPS URL configured" : "Missing",
      detail: durableImage
        ? "A durable HTTPS image reference is configured."
        : "Builder-local images are not persistent. A durable image remains optional here.",
    },
    {
      key: "image_reachability",
      label: "Image reachability",
      state: durableImage ? "unverified" : "not_applicable",
      value: durableImage ? "Not yet verified" : "No durable image",
      detail:
        "This publication slice does not fetch arbitrary project image URLs.",
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
      key: "issuer_model",
      label: "Issuer model",
      state: sharedIssuerSupported ? "ready" : "unsupported",
      value: sharedIssuerSupported
        ? "Shared Issuer"
        : "Dedicated publication unavailable",
      detail: sharedIssuerSupported
        ? "This Testnet publication path aggregates Shared Issuer metadata."
        : "Dedicated Issuer metadata is not routed through Shared Issuer hosting.",
    },
    {
      key: "network",
      label: "Publication network",
      state: testnetSupported ? "ready" : "unsupported",
      value: testnetSupported ? "Testnet" : "Not supported",
      detail: testnetSupported
        ? "This bounded publication path is Testnet-only."
        : "Mainnet publication is intentionally unavailable in this slice.",
    },
    {
      key: "issuer_linkage",
      label: "Issuer linkage",
      state: issuerLinked ? "configured" : "missing",
      value: issuerLinked ? "Issuer recorded" : "Not linked",
      detail: issuerLinked
        ? "A checksum-valid Stellar issuer public key is stored for this project."
        : "No verified Stellar issuer public key is linked yet, so publication is blocked.",
    },
    {
      key: "toml_generated",
      label: "stellar.toml generated",
      state: generatedToml ? "ready" : "missing",
      value: generatedToml ? "Yes" : "No",
      detail: generatedToml
        ? "A deterministic [[CURRENCIES]] representation is generated from the current Project Profile."
        : "The current Project Profile cannot generate a metadata representation.",
    },
    {
      key: "toml_published",
      label: "stellar.toml published",
      state: !publication
        ? "not_published"
        : publishedContentCurrent
          ? "ready"
          : "outdated",
      value: !publication
        ? "No"
        : publishedContentCurrent
          ? "Yes"
          : "Yes · update available",
      detail: !publication
        ? "No metadata snapshot has been published."
        : publishedContentCurrent
          ? `Revision ${publication.revision} matches the current Project Profile.`
          : `Revision ${publication.revision} is still published, but the Project Profile has changed since that snapshot.`,
    },
    {
      key: "toml_reachable",
      label: "stellar.toml reachable",
      state: publication?.reachable ? "ready" : "not_reachable",
      value: publication?.reachable ? "Yes" : "No",
      detail: publication?.reachable
        ? `Canonical HTTPS content was verified at ${publication.verifiedAt ?? "an unknown time"}.`
        : publication
          ? `The snapshot is published in Orrylo, but canonical HTTPS verification has not succeeded${publication.verificationErrorCode ? ` (${publication.verificationErrorCode})` : ""}.`
          : "Nothing has been published to verify yet.",
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
      value: "Not verified",
      detail:
        "TOML publication and reachability do not prove that an external explorer has indexed the project.",
    },
    {
      key: "sac_visibility",
      label: "SAC visibility",
      state: "not_applicable",
      value: "Not verified",
      detail:
        "No SAC visibility claim is made because this slice performs no on-chain asset or contract operation.",
    },
    {
      key: "stellar_asset",
      label: "Stellar asset",
      state: "not_applicable",
      value: "Not created",
      detail: "Metadata publication is separate from Stellar asset creation.",
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
      published: Boolean(publication),
      reachable: publication?.reachable ?? false,
      verifiedAt: publication?.verifiedAt ?? null,
      publishedContentCurrent,
      endpoint: SHARED_METADATA_TOML_ENDPOINT,
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
