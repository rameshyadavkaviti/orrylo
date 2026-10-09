import type { ManagedProjectProfile } from "./project-profile";

export type ReadinessState =
  | "ready"
  | "configured"
  | "pending"
  | "not_published"
  | "not_hosted"
  | "unverified";

export interface MetadataReadinessItem {
  key:
    | "project_profile"
    | "public_landing"
    | "metadata_host"
    | "toml_publication"
    | "project_image"
    | "issuer_linkage"
    | "explorer_visibility";
  label: string;
  state: ReadinessState;
  value: string;
  detail: string;
}

export function buildMetadataReadiness(
  project: ManagedProjectProfile,
): MetadataReadinessItem[] {
  return [
    {
      key: "project_profile",
      label: "Project Profile",
      state: "ready",
      value: "Ready",
      detail:
        "Orrylo has a persistent Project Profile for this managed project.",
    },
    {
      key: "public_landing",
      label: "Public landing page",
      state: project.publicStatus === "published" ? "ready" : "pending",
      value:
        project.publicStatus === "published" ? "Published" : "Private draft",
      detail:
        project.publicStatus === "published"
          ? `Available at /p/${project.slug}.`
          : "The Orrylo landing page has not been published yet.",
    },
    {
      key: "metadata_host",
      label: "Metadata host",
      state: project.metadataHome ? "configured" : "pending",
      value: project.metadataHome ?? "Not configured",
      detail:
        "This is the Stellar metadata hosting context, separate from the public landing-page URL.",
    },
    {
      key: "toml_publication",
      label: "stellar.toml",
      state: "not_published",
      value: "Not published",
      detail:
        "Orrylo has not published stellar.toml for this project in the current prototype.",
    },
    {
      key: "project_image",
      label: "Project image",
      state: project.logoUrl ? "configured" : "not_hosted",
      value: project.logoUrl ? "Hosted URL configured" : "Not hosted",
      detail: project.logoUrl
        ? "A durable project image URL is present in the Project Profile."
        : "Builder logo previews are browser-local until persistent media hosting is implemented.",
    },
    {
      key: "issuer_linkage",
      label: "Issuer linkage",
      state: project.issuerPublicKey ? "configured" : "pending",
      value: project.issuerPublicKey ? "Issuer recorded" : "Not linked",
      detail: project.issuerPublicKey
        ? "An issuer public key is recorded for this Project Profile."
        : "No Stellar issuer has been linked to this managed project yet.",
    },
    {
      key: "explorer_visibility",
      label: "Explorer visibility",
      state: "unverified",
      value: "Unverified",
      detail:
        "Explorer visibility is not claimed until Orrylo has explicit external verification evidence.",
    },
  ];
}