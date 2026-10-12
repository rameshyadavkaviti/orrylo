import { canonicalJson, hashJson } from "../../persistence/json";
import type { DatabaseClient } from "../persistence/database";
import { normalizeWalletPublicKey } from "../persistence/wallet";

const WORKFLOW_SCOPE = "asset:testnet-shared-issuance";
const WORKFLOW_TYPE = "shared_asset_issuance";
const POLICY_VERSION = "testnet-shared-issuance-foundation-v2";
const PREPARATION_POLICY = "shared-issuer-testnet-v1";

export interface VerifiedSharedAssetProvenance {
  projectId: string;
  ownerPublicKey: string;
  network: "testnet";
  assetCode: string;
  issuerPublicKey: string;
  issuanceRequestId: string;
  reservationFingerprint: string;
  transactionHash: string;
  ledgerSequence: number;
}

interface ProvenanceRow {
  project_id: string;
  owner_public_key: string;
  network: string;
  asset_code: string;
  reservation_issuer_public_key: string;
  reservation_fingerprint: string;
  request_id: string;
  status: string;
  issuer_public_key: string | null;
  transaction_hash: string | null;
  ledger_sequence: string | null;
  subject_public_key: string | null;
  workflow_scope: string;
  workflow_type: string;
  workflow_state: string;
  policy_version: string;
  payload_hash: string;
  payload: unknown;
}

/**
 * Read ONLY from the future reviewed issuance boundary (migration 007). A
 * project profile, environment variable, or valid G-address alone cannot
 * create provenance. Until migration 007 and genuine confirmed records exist,
 * this reader returns null: metadata publication is unavailable.
 */
export class PostgresSharedAssetProvenanceReader {
  private readonly approvedIssuer: string | null;

  constructor(
    private readonly sql: DatabaseClient,
    approvedIssuer: string | null | undefined = process.env
      .ORRYLO_APPROVED_TESTNET_SHARED_ISSUER_PUBLIC_KEY,
  ) {
    try {
      this.approvedIssuer = approvedIssuer
        ? normalizeWalletPublicKey(approvedIssuer)
        : null;
    } catch {
      this.approvedIssuer = null;
    }
  }

  async findConfirmed(
    projectId: string,
    ownerPublicKey: string,
  ): Promise<VerifiedSharedAssetProvenance | null> {
    if (!this.approvedIssuer) return null;

    const [presence] = await this.sql<{ exists: string | null }[]>`
      SELECT to_regclass(
        format('%I.%I', current_schema(), 'project_issuance_intents')
      )::text AS "exists"
    `;
    if (!presence?.exists) return null;

    const owner = normalizeWalletPublicKey(ownerPublicKey);
    const [r] = await this.sql<ProvenanceRow[]>`
      SELECT i.project_id, i.owner_public_key, i.network, i.asset_code,
        i.reservation_issuer_public_key, i.reservation_fingerprint,
        i.request_id, i.status, i.issuer_public_key, i.transaction_hash,
        i.ledger_sequence::text AS ledger_sequence,
        w.subject_public_key, w.workflow_scope, w.workflow_type,
        w.state AS workflow_state, w.policy_version,
        w.payload_hash, w.payload
      FROM project_issuance_intents i
      JOIN workflow_intents w ON w.request_id = i.request_id
      WHERE i.project_id = ${projectId}
        AND i.owner_public_key = ${owner}
        AND i.network = 'testnet'
        AND i.status = 'confirmed'
        AND i.reservation_issuer_public_key = ${this.approvedIssuer}
        AND i.issuer_public_key = ${this.approvedIssuer}
        AND i.transaction_hash IS NOT NULL
        AND i.ledger_sequence > 0
      LIMIT 1
      FOR SHARE OF i, w
    `;
    if (!r) return null;

    const code = r.asset_code.trim();
    const hash = r.transaction_hash?.trim();
    const fingerprint = r.reservation_fingerprint.trim();
    const ledger = Number(r.ledger_sequence);
    const issuer = this.approvedIssuer;
    const payload = {
      projectId: r.project_id,
      network: "testnet",
      issuerModel: "shared",
      assetCode: code,
      issuerPublicKey: issuer,
      preparationPolicyVersion: PREPARATION_POLICY,
    };
    const expectedHash = hashJson({
      workflowType: WORKFLOW_TYPE,
      subjectPublicKey: owner,
      policyVersion: POLICY_VERSION,
      payload,
    });
    if (
      !/^[A-Z0-9]{1,12}$/.test(code) ||
      !hash ||
      !/^[a-f0-9]{64}$/.test(hash) ||
      !Number.isSafeInteger(ledger) ||
      ledger <= 0 ||
      r.owner_public_key.trim() !== owner ||
      r.subject_public_key?.trim() !== owner ||
      r.reservation_issuer_public_key.trim() !== issuer ||
      r.issuer_public_key?.trim() !== issuer ||
      r.workflow_scope !== WORKFLOW_SCOPE ||
      r.workflow_type !== WORKFLOW_TYPE ||
      r.policy_version !== POLICY_VERSION ||
      r.workflow_state !== "confirmed" ||
      r.payload_hash.trim() !== expectedHash ||
      fingerprint !== expectedHash ||
      canonicalJson(r.payload as Parameters<typeof canonicalJson>[0]) !==
        canonicalJson(payload)
    )
      return null;

    // Both origin events must be durable and authored by the trusted
    // application workflow. The publication writer cannot create these.
    const audit = await this.sql<
      {
        event_type: string;
        metadata: unknown;
        source: string;
        target_public_key: string | null;
      }[]
    >`
      SELECT event_type, metadata, source, target_public_key
      FROM audit_events
      WHERE request_id = ${r.request_id}
        AND event_type IN (
          'SHARED_ISSUANCE_INTENT_CREATED',
          'SHARED_ISSUANCE_ASSET_CODE_RESERVED'
        )
    `;
    if (
      audit.length !== 2 ||
      new Set(audit.map((e) => e.event_type)).size !== 2 ||
      audit.some(
        (e) =>
          e.source !== "testnet-issuance-service" ||
          e.target_public_key?.trim() !== owner ||
          !e.metadata ||
          typeof e.metadata !== "object" ||
          (e.metadata as Record<string, unknown>).projectId !== projectId ||
          (e.metadata as Record<string, unknown>).assetCode !== code ||
          (e.metadata as Record<string, unknown>).issuerPublicKey !== issuer,
      )
    )
      return null;

    return {
      projectId,
      ownerPublicKey: owner,
      network: "testnet",
      assetCode: code,
      issuerPublicKey: issuer,
      issuanceRequestId: r.request_id,
      reservationFingerprint: fingerprint,
      transactionHash: hash,
      ledgerSequence: ledger,
    };
  }
}
