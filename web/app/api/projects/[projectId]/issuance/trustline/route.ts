import { NextRequest, NextResponse } from "next/server";

import { SESSION_COOKIE_NAME } from "../../../../../../lib/auth/constants";
import { isTrustedAuthOrigin } from "../../../../../../lib/auth/origin";
import {
  getWalletAuthService,
  readServerAuthConfig,
} from "../../../../../../lib/auth/runtime";
import type { AuthSession } from "../../../../../../lib/auth/stores";
import { isValidProjectId } from "../../../../../../lib/projects/project-profile";
import type { ManagedProjectProfile } from "../../../../../../lib/projects/project-profile";
import { getDatabaseClient } from "../../../../../../lib/server/persistence/database";
import { PostgresProjectProfileRepository } from "../../../../../../lib/server/persistence/project-profile-repository";
import {
  confirmCustomerTrustline,
  CustomerTrustlineError,
  inspectCustomerTrustline,
  reconcileCustomerTrustline,
  readCustomerTrustlineConfiguration,
  type CustomerTrustlinePlan,
} from "../../../../../../lib/server/projects/customer-testnet-trustline";
import { validateInitialSupply } from "../../../../../../lib/validation/initial-supply";

export const runtime = "nodejs";

interface Context {
  params: Promise<{ projectId: string }>;
}

export interface CustomerTrustlineRouteDependencies {
  authDomain: string;
  getSession(token: string | undefined): Promise<AuthSession | null>;
  getOwnedProject(
    projectId: string,
    owner: string,
  ): Promise<ManagedProjectProfile | null>;
  inspect(
    project: ManagedProjectProfile,
    amount: string,
  ): Promise<CustomerTrustlinePlan>;
  confirm(
    project: ManagedProjectProfile,
    amount: string,
    hash: string,
  ): Promise<CustomerTrustlinePlan>;
  reconcile?(input: {
    project: ManagedProjectProfile;
    amount: string;
    transactionHash: string;
    unsignedXdr: string;
  }): ReturnType<typeof reconcileCustomerTrustline>;
}

function dependencies(): CustomerTrustlineRouteDependencies {
  const auth = readServerAuthConfig();
  const projects = new PostgresProjectProfileRepository(getDatabaseClient());
  return {
    authDomain: auth.domain,
    getSession: (token) => getWalletAuthService().getSession(token),
    getOwnedProject: (id, owner) => projects.findOwnedById(id, owner),
    inspect: (project, amount) =>
      inspectCustomerTrustline({
        configuration: readCustomerTrustlineConfiguration(),
        destinationPublicKey: project.ownerPublicKey,
        assetCode: project.assetCode,
        initialSupply: amount,
      }),
    confirm: (project, amount, hash) =>
      confirmCustomerTrustline({
        configuration: readCustomerTrustlineConfiguration(),
        destinationPublicKey: project.ownerPublicKey,
        assetCode: project.assetCode,
        initialSupply: amount,
        transactionHash: hash,
      }),
    reconcile: ({ project, amount, transactionHash, unsignedXdr }) =>
      reconcileCustomerTrustline({
        configuration: readCustomerTrustlineConfiguration(),
        destinationPublicKey: project.ownerPublicKey,
        assetCode: project.assetCode,
        initialSupply: amount,
        transactionHash,
        unsignedXdr,
      }),
  };
}

export async function GET(request: NextRequest, context: Context) {
  return handleInspectTrustline(request, context, dependencies());
}

export async function POST(request: NextRequest, context: Context) {
  return handleConfirmTrustline(request, context, dependencies());
}

async function authorize(
  request: NextRequest,
  context: Context,
  deps: CustomerTrustlineRouteDependencies,
): Promise<{ project: ManagedProjectProfile } | Response> {
  const session = await deps.getSession(
    request.cookies.get(SESSION_COOKIE_NAME)?.value,
  );
  if (!session) return failure("unauthenticated", 401);
  const { projectId } = await context.params;
  if (!isValidProjectId(projectId)) return failure("invalid_request", 400);
  const project = await deps.getOwnedProject(projectId, session.publicKey);
  if (!project) return failure("project_not_found", 404);
  if (
    project.network !== "testnet" ||
    project.issuerModel !== "shared" ||
    project.issuerPublicKey !== null
  )
    return failure("ineligible_project", 409);
  return { project };
}

export async function handleInspectTrustline(
  request: NextRequest,
  context: Context,
  deps: CustomerTrustlineRouteDependencies,
) {
  try {
    const authorized = await authorize(request, context, deps);
    if (authorized instanceof Response) return authorized;
    const amount = request.nextUrl.searchParams.get("amount");
    if (
      !amount ||
      !validateInitialSupply(amount).valid ||
      [...request.nextUrl.searchParams.keys()].some((key) => key !== "amount")
    ) {
      return failure("invalid_request", 400);
    }
    const plan = await deps.inspect(authorized.project, amount);
    return NextResponse.json(
      { ok: true, trustline: plan },
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    return mapError(error);
  }
}

export async function handleConfirmTrustline(
  request: NextRequest,
  context: Context,
  deps: CustomerTrustlineRouteDependencies,
) {
  if (!isTrustedAuthOrigin(request.headers.get("origin"), deps.authDomain)) {
    return failure("untrusted_origin", 403);
  }
  try {
    const authorized = await authorize(request, context, deps);
    if (authorized instanceof Response) return authorized;
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body))
      return failure("invalid_request", 400);
    const fields = body as Record<string, unknown>;
    const keys = Object.keys(fields).sort().join(",");
    if (
      (keys !== "amount,transactionHash" &&
        keys !== "amount,transactionHash,unsignedXdr") ||
      typeof fields.amount !== "string" ||
      !validateInitialSupply(fields.amount).valid ||
      typeof fields.transactionHash !== "string" ||
      !/^[0-9a-f]{64}$/.test(fields.transactionHash)
    ) {
      return failure("invalid_request", 400);
    }
    if (keys === "amount,transactionHash,unsignedXdr") {
      if (
        typeof fields.unsignedXdr !== "string" ||
        fields.unsignedXdr.length === 0 ||
        fields.unsignedXdr.length > 4096 ||
        !deps.reconcile
      ) {
        return failure("invalid_request", 400);
      }
      const reconciliation = await deps.reconcile({
        project: authorized.project,
        amount: fields.amount,
        transactionHash: fields.transactionHash,
        unsignedXdr: fields.unsignedXdr,
      });
      return NextResponse.json(
        { ok: true, reconciliation },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const plan = await deps.confirm(
      authorized.project,
      fields.amount,
      fields.transactionHash,
    );
    if (plan.status !== "ready") return failure("trustline_unconfirmed", 409);
    return NextResponse.json(
      { ok: true, trustline: plan },
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    return mapError(error);
  }
}

function mapError(error: unknown) {
  const code =
    error instanceof CustomerTrustlineError
      ? error.code
      : error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "trustline_unavailable";
  if (code === "invalid_request" || code === "invalid_destination")
    return failure(code, 400);
  if (
    code === "not_found" ||
    code === "trustline_unconfirmed" ||
    code === "trustline_transaction_mismatch" ||
    code === "trustline_unauthorized" ||
    code === "trustline_fee_cap_exceeded" ||
    code === "insufficient_customer_xlm" ||
    code === "trustline_capacity_exceeded" ||
    code === "issuer_policy_mismatch" ||
    code === "insufficient_issuer_native_balance" ||
    code === "fee_below_network_minimum"
  ) {
    return failure(code, 409);
  }
  return failure(code, 503);
}

function failure(code: string, status: number) {
  return NextResponse.json(
    { ok: false, code },
    {
      status,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
