import { Keypair } from "@stellar/stellar-sdk/base";

import type { ProjectProfile } from "./project-profile";
import { safeHttpsUrl } from "./project-metadata";

export interface GeneratedStellarToml {
  content: string;
  issuerIncluded: boolean;
  issuerPublicKey: string | null;
  imageIncluded: boolean;
}

export function generateProjectCurrencyToml(
  project: ProjectProfile,
): GeneratedStellarToml | null {
  const code = project.assetCode.trim().toUpperCase();
  const name = project.displayName.trim();

  if (!/^[A-Z0-9]{1,12}$/.test(code) || !name) {
    return null;
  }

  const lines = ["[[CURRENCIES]]", `code = ${tomlString(code)}`];
  const issuer = normalizedIssuer(project.issuerPublicKey);

  if (issuer) {
    lines.push(`issuer = ${tomlString(issuer)}`);
  }

  lines.push(`name = ${tomlString(name)}`);

  const description = project.description?.trim();

  if (description) {
    lines.push(`desc = ${tomlString(description)}`);
  }

  const image = safeHttpsUrl(project.logoUrl);

  if (image) {
    lines.push(`image = ${tomlString(image)}`);
  }

  return {
    content: `${lines.join("\n")}\n`,
    issuerIncluded: Boolean(issuer),
    issuerPublicKey: issuer,
    imageIncluded: Boolean(image),
  };
}

export function hasValidStellarIssuer(
  publicKey: string | null | undefined,
): boolean {
  return Boolean(normalizedIssuer(publicKey));
}

function normalizedIssuer(publicKey: string | null | undefined): string | null {
  if (!publicKey) {
    return null;
  }

  try {
    return Keypair.fromPublicKey(publicKey.trim().toUpperCase()).publicKey();
  } catch {
    return null;
  }
}

function tomlString(value: string): string {
  return JSON.stringify(value.normalize("NFC"))
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}
