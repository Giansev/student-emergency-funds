export const TESTNET = "Test SDF Network ; September 2015";
export const MIN_DONATION_STROOPS = "1000000"; // 0.1 XLM keeps the 10% leg above dust.
export const MAX_DONATION_STROOPS = "10000000000000"; // 1000 XLM sanity cap.
export const STUDENT_SHARE_BPS = 9000n;
export const TOTAL_SHARE_BPS = 10000n;
export type Student = {
  id: string;
  name: string;
  story: string;
  goalStroops: string;
};
export type Prepared = {
  xdr: string;
  network: "testnet" | "mainnet";
  networkPassphrase: string;
  expiresAt: string;
  preparationRequestId?: string;
  txHash: string;
};
export type PublicConfig =
  | { ready: false; message: string }
  | { ready: true; scope: string; deploymentUrl: string };
export type Result = { txHash: string; status: string; network?: string };
