import { randomUUID } from "node:crypto";

import {
  readMainnetCreationConfiguration,
  verifyMainnetIssuance,
} from "../../stellar/mainnet-creation";
import {
  confirmMainnetTrustline,
  prepareMainnetIssuance,
  prepareMainnetTrustline,
} from "../../stellar/mainnet-horizon";
import { PrivateMainnetSignerClient } from "../../stellar/private-mainnet-signer";
import { getDatabaseClient } from "../persistence/database";
import { PostgresMainnetCreationStore } from "./mainnet-creation-store";
import { MainnetCreationService } from "./mainnet-creation-service";
import { createServerMainnetPublicationService } from "./mainnet-publication-service";

function required(
  env: Readonly<Record<string, string | undefined>>,
  key: string,
): string {
  const value = env[key]?.trim();
  if (!value) throw new Error("mainnet_configuration_unavailable");
  return value;
}

export function createMainnetCreationRuntime(
  env: Readonly<Record<string, string | undefined>> = process.env,
): MainnetCreationService {
  const configuration = readMainnetCreationConfiguration(env);
  const sql = getDatabaseClient(env as NodeJS.ProcessEnv);
  const store = new PostgresMainnetCreationStore(sql);
  const signer = new PrivateMainnetSignerClient({
    privateBaseUrl: required(env, "ORRYLO_MAINNET_SIGNER_PRIVATE_URL"),
    requestAuthSecret: required(env, "ORRYLO_MAINNET_SIGNER_REQUEST_AUTH_SECRET"),
  });
  const publication = createServerMainnetPublicationService(sql);
  return new MainnetCreationService({
    store,
    now: Date.now,
    createId: randomUUID,
    signer,
    maxIssuerFeeStroops: configuration.issuerFeeStroops,
    prepareTrustline: (order) =>
      prepareMainnetTrustline({
        ownerPublicKey: order.ownerPublicKey,
        assetCode: order.assetCode,
        amount: order.amount,
        maxFeeStroops: configuration.customerTrustlineMaxFeeStroops,
      }),
    confirmTrustline: (order, hash) =>
      confirmMainnetTrustline({
        transactionHash: hash,
        ownerPublicKey: order.ownerPublicKey,
        assetCode: order.assetCode,
        amount: order.amount,
        maxFeeStroops: configuration.customerTrustlineMaxFeeStroops,
      }),
    prepareIssuance: (order) =>
      prepareMainnetIssuance({
        destinationPublicKey: order.destinationPublicKey,
        assetCode: order.assetCode,
        amount: order.amount,
        feeStroops: configuration.issuerFeeStroops,
        maxFeeStroops: configuration.issuerFeeStroops,
      }),
    verifyIssuance: (order, transactionHash) =>
      verifyMainnetIssuance({
        transactionHash,
        destinationPublicKey: order.destinationPublicKey,
        assetCode: order.assetCode,
        amount: order.amount,
      }),
    publish: (order) =>
      publication.reconcile(order.projectId, order.ownerPublicKey).then(() => undefined),
  });
}
