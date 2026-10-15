import type { SharedIssuanceApplicationDatabaseBoundary } from "../persistence/issuance-database-boundaries";
import {
  PostgresSharedIssuancePersistenceRepository,
  type ImmutableSharedIssuanceTransactionAttempt,
  type SharedIssuanceSigningMode,
} from "./shared-issuance-persistence";
import type { SharedIssuanceOrchestrationStore } from "./shared-issuance-orchestrator";
import type { TestnetIssuanceStatus } from "./testnet-issuance-service";

type DurableStatus = Exclude<TestnetIssuanceStatus, "not_started">;

const ALLOWED_TRANSITIONS: Record<DurableStatus, readonly DurableStatus[]> = {
  awaiting_issuer_integration: ["pending_execution", "failed"],
  pending_execution: ["submitted", "failed", "reconciliation_required"],
  submitted: ["confirmed", "failed", "reconciliation_required"],
  confirmed: [],
  failed: [],
  reconciliation_required: ["submitted", "confirmed", "failed"],
};

export class PostgresSharedIssuanceOrchestrationStore implements SharedIssuanceOrchestrationStore {
  private readonly repository: PostgresSharedIssuancePersistenceRepository;

  constructor(
    private readonly boundary: SharedIssuanceApplicationDatabaseBoundary,
  ) {
    boundary.assertAuthorized();
    this.repository = new PostgresSharedIssuancePersistenceRepository(boundary);
  }

  getIntent(requestId: string) {
    return this.repository.getIntent(requestId);
  }
  getAttempt(attemptId: string) {
    return this.repository.getAttempt(attemptId);
  }
  listAttempts(requestId: string) {
    return this.repository.listAttempts(requestId);
  }
  appendAttempt(attempt: ImmutableSharedIssuanceTransactionAttempt) {
    return this.repository.appendAttempt(attempt);
  }
  claimSigningMode(input: {
    attemptId: string;
    transactionHash: string;
    signingMode: SharedIssuanceSigningMode;
  }) {
    return this.repository.claimSigningMode(input);
  }
  recordSignedEnvelope(input: {
    attemptId: string;
    transactionHash: string;
    signedEnvelopeXdrSha256: string;
  }) {
    return this.repository.recordSignedEnvelope(input);
  }
  getConfirmation(requestId: string) {
    return this.repository.getConfirmation(requestId);
  }

  async getLifecycle(issuanceRequestId: string) {
    const [row] = await this.boundary.sql<
      { status: DurableStatus; failure_code: string | null }[]
    >`
      SELECT status, failure_code
      FROM project_issuance_intents
      WHERE request_id = ${issuanceRequestId}
    `;
    return row ? { status: row.status, failureCode: row.failure_code } : null;
  }

  async transition(
    issuanceRequestId: string,
    status: DurableStatus,
    failureCode: string | null = null,
  ): Promise<boolean> {
    const current = await this.getLifecycle(issuanceRequestId);
    if (!current) throw new Error("issuance_lifecycle_not_found");
    if (current.status === status) return false;
    if (!ALLOWED_TRANSITIONS[current.status].includes(status)) {
      throw new Error("invalid_issuance_state_transition");
    }
    const rows = await this.boundary.sql<{ status: DurableStatus }[]>`
      UPDATE project_issuance_intents
      SET status = ${status}, failure_code = ${failureCode}, updated_at = now()
      WHERE request_id = ${issuanceRequestId} AND status = ${current.status}
      RETURNING status
    `;
    if (rows.length === 0) return false;
    const updated = await this.getLifecycle(issuanceRequestId);
    if (!updated || updated.status !== status) {
      throw new Error("issuance_state_transition_conflict");
    }
    return true;
  }
}
