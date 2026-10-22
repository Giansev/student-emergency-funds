import {
  donationStats,
  listDonations,
  recordDonation,
} from "@/lib/donation-store";
import { listStudents } from "@/lib/student-store";
import { paymentPayouts, paymentStatus } from "@/lib/paiflow";
import { sessionUser } from "@/lib/session";
import { handle, sameOrigin } from "@/lib/http";
import { MAX_DONATION_STROOPS } from "@/lib/types";

function requireUser(request: Request) {
  const user = sessionUser(request);
  if (!user) throw new Error("Sign in required.");
  return user;
}

async function statsResponse() {
  const [donations, students] = await Promise.all([
    listDonations(),
    listStudents(),
  ]);
  return donationStats(donations, students);
}

/** Any signed-in visitor can read the transparency dashboard. */
export async function GET(request: Request) {
  return handle(async () => {
    requireUser(request);
    return statsResponse();
  });
}

/**
 * Records one confirmed donation. The server re-verifies the transaction
 * with the platform before writing; recording is idempotent by txHash.
 */
export async function POST(request: Request) {
  return handle(async () => {
    sameOrigin(request);
    requireUser(request);
    const text = await request.text();
    if (text.length > 4096) throw new Error("Request too large.");
    const b: unknown = JSON.parse(text);
    if (!b || typeof b !== "object" || Array.isArray(b))
      throw new Error("Invalid request.");
    const v = b as Record<string, unknown>;
    if (
      typeof v.txHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(v.txHash) ||
      typeof v.amountStroops !== "string" ||
      !/^\d+$/.test(v.amountStroops) ||
      v.amountStroops.length > 39 ||
      BigInt(v.amountStroops) <= 0n ||
      BigInt(v.amountStroops) > BigInt(MAX_DONATION_STROOPS) ||
      (v.studentId !== undefined &&
        (typeof v.studentId !== "string" ||
          !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v.studentId) ||
          v.studentId.length > 64)) ||
      !Object.keys(v).every((k) =>
        ["txHash", "studentId", "amountStroops"].includes(k),
      )
    )
      throw new Error("Invalid request.");
    const status = await paymentStatus(v.txHash);
    if (status.status !== "SUCCESS")
      throw new Error("Only successful transactions are recorded.");
    let payouts: Awaited<ReturnType<typeof paymentPayouts>> | null = null;
    try {
      payouts = await paymentPayouts(v.txHash);
    } catch {
      payouts = null; // payout evidence is best-effort, never blocks recording
    }
    await recordDonation({
      txHash: v.txHash,
      studentId: (v.studentId as string | undefined) ?? null,
      amountStroops: v.amountStroops,
      payouts,
    });
    return statsResponse();
  });
}
