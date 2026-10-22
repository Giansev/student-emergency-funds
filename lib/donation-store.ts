import "server-only";
import { promises as fs } from "fs";
import path from "path";
import type { Student } from "@/lib/types";

export type DonationPayout = {
  address: string | null;
  amountStroops: string;
};
export type Donation = {
  txHash: string;
  studentId: string | null;
  amountStroops: string;
  recordedAt: string;
  payouts: DonationPayout[] | null;
};
export type DonationStats = {
  totalStroops: string;
  count: number;
  byStudent: {
    id: string;
    name: string;
    count: number;
    raisedStroops: string;
    goalStroops: string;
  }[];
  recent: (Donation & { studentName: string | null })[];
};

const MAX_DONATIONS = 500;
const RECENT_SHOWN = 10;

function storeFile(): string {
  return (
    process.env.DONATIONS_FILE?.trim() ||
    path.join(process.cwd(), "data", "donations.json")
  );
}

function isPayouts(value: unknown): value is DonationPayout[] {
  if (value === null) return true;
  if (!Array.isArray(value)) return false;
  return value.every((p) => {
    const item = p as Partial<DonationPayout> | null;
    return (
      !!item &&
      typeof item === "object" &&
      (item.address === null ||
        (typeof item.address === "string" && item.address.length <= 64)) &&
      typeof item.amountStroops === "string" &&
      /^\d+$/.test(item.amountStroops) &&
      item.amountStroops.length <= 39
    );
  });
}

/** Strict structural validation; throws with a client-safe message on bad data. */
export function parseDonations(data: unknown): Donation[] {
  if (!Array.isArray(data)) throw new Error("Donations must be a list.");
  if (data.length > MAX_DONATIONS)
    throw new Error(`At most ${MAX_DONATIONS} donations are recorded.`);
  const seen = new Set<string>();
  for (const item of data) {
    const d = item as Partial<Donation> | null;
    if (
      !d ||
      typeof d !== "object" ||
      typeof d.txHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(d.txHash) ||
      (d.studentId !== null &&
        (typeof d.studentId !== "string" ||
          !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(d.studentId) ||
          d.studentId.length > 64)) ||
      typeof d.amountStroops !== "string" ||
      !/^\d+$/.test(d.amountStroops) ||
      d.amountStroops.length > 39 ||
      BigInt(d.amountStroops) <= 0n ||
      typeof d.recordedAt !== "string" ||
      !Number.isFinite(Date.parse(d.recordedAt)) ||
      !isPayouts(d.payouts)
    )
      throw new Error("Each donation needs a txHash, amount, date, and payouts.");
    if (seen.has(d.txHash)) throw new Error("Duplicate donation txHash.");
    seen.add(d.txHash);
  }
  return data as Donation[];
}

export async function listDonations(): Promise<Donation[]> {
  try {
    const raw = await fs.readFile(storeFile(), "utf8");
    return parseDonations(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error instanceof SyntaxError
      ? new Error("Donation ledger is corrupt; restore data/donations.json.")
      : error;
  }
}

/** Appends one confirmed donation, idempotent by txHash. Returns the full ledger. */
export async function recordDonation(input: {
  txHash: string;
  studentId: string | null;
  amountStroops: string;
  payouts: DonationPayout[] | null;
}): Promise<{ recorded: boolean; donations: Donation[] }> {
  const current = await listDonations();
  if (current.some((d) => d.txHash === input.txHash))
    return { recorded: false, donations: current };
  const next = parseDonations([
    ...current,
    { ...input, recordedAt: new Date().toISOString() },
  ]);
  const file = storeFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(next, null, 2) + "\n", "utf8");
  await fs.rename(tmp, file);
  return { recorded: true, donations: next };
}

/** Aggregates the ledger for the transparency dashboard. */
export function donationStats(
  donations: Donation[],
  students: Student[],
): DonationStats {
  let total = 0n;
  const raisedByStudent = new Map<string, bigint>();
  const countByStudent = new Map<string, number>();
  let unattributed = 0n;
  let unattributedCount = 0;
  for (const d of donations) {
    const amount = BigInt(d.amountStroops);
    total += amount;
    if (d.studentId && students.some((s) => s.id === d.studentId)) {
      raisedByStudent.set(
        d.studentId,
        (raisedByStudent.get(d.studentId) ?? 0n) + amount,
      );
      countByStudent.set(d.studentId, (countByStudent.get(d.studentId) ?? 0) + 1);
    } else {
      unattributed += amount;
      unattributedCount += 1;
    }
  }
  const byStudent = students.map((s) => ({
    id: s.id,
    name: s.name,
    count: countByStudent.get(s.id) ?? 0,
    raisedStroops: (raisedByStudent.get(s.id) ?? 0n).toString(),
    goalStroops: s.goalStroops,
  }));
  if (unattributed > 0n)
    byStudent.push({
      id: "",
      name: "Unassigned donations",
      count: unattributedCount,
      raisedStroops: unattributed.toString(),
      goalStroops: "0",
    });
  const nameOf = (id: string | null) =>
    id ? (students.find((s) => s.id === id)?.name ?? null) : null;
  return {
    totalStroops: total.toString(),
    count: donations.length,
    byStudent,
    recent: [...donations]
      .reverse()
      .slice(0, RECENT_SHOWN)
      .map((d) => ({ ...d, studentName: nameOf(d.studentId) })),
  };
}
