import "server-only";
import { Paiflow } from "@paiflow/sdk";
import { StrKey } from "@stellar/stellar-sdk";
import {
  MAX_DONATION_STROOPS,
  MIN_DONATION_STROOPS,
  TESTNET,
} from "@/lib/types";
import type { PublicConfig, Prepared } from "@/lib/types";
import { envelopeHash } from "@/lib/transaction";
export function configuration() {
  const token = process.env.PAIFLOW_API_TOKEN?.trim();
  const deploymentId = process.env.PAIFLOW_DEPLOYMENT_ID?.trim();
  const url = new URL(
    process.env.PAIFLOW_BASE_URL || "https://beta.app.paiflow.xyz",
  );
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname)
      ))
  )
    throw new Error("Configure a secure platform origin.");
  if (
    !token ||
    !/^(pfk|pfd)_[a-f0-9]{64}$/.test(token) ||
    !deploymentId ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      deploymentId,
    )
  )
    throw new Error(
      "Configure PAIFLOW_API_TOKEN and PAIFLOW_DEPLOYMENT_ID on the server.",
    );
  return { token, deploymentId, baseUrl: url.origin };
}
export function publicConfig(): PublicConfig {
  try {
    const c = configuration();
    return {
      ready: true,
      scope: `${c.baseUrl}/${c.deploymentId}`,
      deploymentUrl: `${c.baseUrl}/deployments/${c.deploymentId}`,
    };
  } catch {
    return {
      ready: false,
      message:
        "Configure the server environment to enable this testnet payment demo.",
    };
  }
}
function deployment() {
  const c = configuration();
  return new Paiflow({ baseUrl: c.baseUrl, token: c.token }).deployment(
    c.deploymentId,
  );
}
export async function paymentReady() {
  const d = deployment();
  const { data } = await d.capabilities.get();
  if (
    data.network !== "testnet" ||
    data.inputAsset?.kind !== "native" ||
    data.triggerType !== "deposit" ||
    data.operations.execute.status !== "supported"
  )
    throw new Error(
      "Use an active testnet native-XLM Receive deployment with execute support.",
    );
  return d;
}
export async function preparePayment(
  from: string,
  amountStroops: string,
): Promise<Prepared> {
  if (!StrKey.isValidEd25519PublicKey(from))
    throw new Error("Supply a public Stellar account.");
  if (
    !/^\d+$/.test(amountStroops) ||
    amountStroops.length > 39 ||
    BigInt(amountStroops) < BigInt(MIN_DONATION_STROOPS) ||
    BigInt(amountStroops) > BigInt(MAX_DONATION_STROOPS)
  )
    throw new Error(
      `Donation must be between ${MIN_DONATION_STROOPS} and ${MAX_DONATION_STROOPS} stroops.`,
    );
  const d = await paymentReady();
  const response = await d.execute.prepare({ from, amount: amountStroops });
  const p = response.data;
  if (p.network !== "testnet" || p.networkPassphrase !== TESTNET)
    throw new Error("Only Testnet is allowed.");
  return {
    ...p,
    txHash: envelopeHash(p.xdr),
    preparationRequestId: response.metadata.historyRequestId,
  };
}
export async function submitPayment(
  signedXdr: string,
  preparationRequestId?: string,
) {
  const hash = envelopeHash(signedXdr);
  const d = await paymentReady();
  const { data } = await d.execute.submit(
    { signedXdr },
    { wait: false, preparationRequestId },
  );
  if (data.txHash !== hash)
    throw new Error(
      "Transaction hash mismatch; retain the original envelope and check its status.",
    );
  return data;
}
export async function paymentStatus(txHash: string) {
  if (!/^[a-f0-9]{64}$/.test(txHash))
    throw new Error("Invalid transaction hash.");
  const { data } = await deployment().transactions.get(txHash);
  if (data.txHash !== txHash || data.network !== "testnet")
    throw new Error(
      "Transaction evidence mismatch; retain the original record.",
    );
  return data;
}
export type PayoutEvidence = {
  eventId: string;
  address: string | null;
  amountStroops: string;
};
/** PAYOUT events recorded by the deployment for one transaction. */
export async function paymentPayouts(
  txHash: string,
): Promise<PayoutEvidence[]> {
  if (!/^[a-f0-9]{64}$/.test(txHash))
    throw new Error("Invalid transaction hash.");
  const { data } = await deployment().events.list({ txHash, limit: 100 });
  const items = (data as { items?: unknown }).items;
  if (!Array.isArray(items)) throw new Error("Unexpected events response.");
  const payouts: PayoutEvidence[] = [];
  for (const item of items) {
    const e = item as {
      eventId?: unknown;
      txHash?: unknown;
      kind?: unknown;
      data?: unknown;
    };
    if (e?.kind !== "PAYOUT" || e?.txHash !== txHash) continue;
    const d = (e.data ?? {}) as Record<string, unknown>;
    const amount =
      typeof d.amountStroops === "string"
        ? d.amountStroops
        : typeof d.amountOut === "string"
          ? d.amountOut
          : typeof d.amount === "string"
            ? d.amount
            : null;
    if (!amount || !/^\d+$/.test(amount)) continue;
    const address = [d.to, d.recipient, d.address].find(
      (x): x is string => typeof x === "string" && x.length <= 64,
    );
    payouts.push({
      eventId: String(e.eventId ?? ""),
      address: address ?? null,
      amountStroops: amount,
    });
  }
  return payouts;
}
