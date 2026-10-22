import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { beforeEach, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/donations/route";
import { listDonations, parseDonations } from "@/lib/donation-store";
import { issueSession, SESSION_COOKIE } from "@/lib/session";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ status: vi.fn(), payouts: vi.fn() }));
vi.mock("@/lib/paiflow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paiflow")>();
  return {
    ...actual,
    paymentStatus: mocks.status,
    paymentPayouts: mocks.payouts,
  };
});
const id = "12345678-1234-1234-1234-123456789abc";
const txHash = "a".repeat(64);
const txHash2 = "b".repeat(64);
const students = [
  {
    id: "amara-okafor",
    name: "Amara Okafor",
    story: "Second-year nursing student bridging a tuition gap.",
    goalStroops: "25000000000",
  },
];
function request(
  method: string,
  body?: unknown,
  role: "donor" | "admin" | "none" = "donor",
) {
  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    headers.origin = "https://starter.example";
  }
  if (role !== "none")
    headers.cookie = `${SESSION_COOKIE}=${issueSession("user", role)}`;
  return new Request("https://starter.example/api/donations", {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  const dir = mkdtempSync(path.join(tmpdir(), "donations-"));
  vi.stubEnv("DONATIONS_FILE", path.join(dir, "donations.json"));
  vi.stubEnv("STUDENTS_FILE", path.join(dir, "students.json"));
  writeFileSync(path.join(dir, "students.json"), JSON.stringify(students));
  vi.stubEnv("PAIFLOW_API_TOKEN", "pfd_" + "c".repeat(64));
  vi.stubEnv("PAIFLOW_DEPLOYMENT_ID", id);
  mocks.status.mockResolvedValue({
    txHash,
    status: "SUCCESS",
    network: "testnet",
  });
  mocks.payouts.mockResolvedValue([
    { eventId: "e1", address: "G" + "A".repeat(20), amountStroops: "22500000" },
    { eventId: "e2", address: "G" + "B".repeat(20), amountStroops: "2500000" },
  ]);
});
it("parseDonations rejects malformed ledgers", () => {
  const good = {
    txHash,
    studentId: "amara-okafor",
    amountStroops: "25000000",
    recordedAt: "2026-10-22T00:00:00Z",
    payouts: null,
  };
  expect(parseDonations([good])).toHaveLength(1);
  for (const bad of [
    { ...good, txHash: "nope" },
    { ...good, amountStroops: "0" },
    { ...good, studentId: "Bad Id" },
    { ...good, recordedAt: "not a date" },
    { ...good, payouts: [{ address: 5, amountStroops: "1" }] },
  ])
    expect(() => parseDonations([bad])).toThrow();
  expect(() =>
    parseDonations([
      good,
      { ...good, txHash: txHash2 },
      { ...good },
    ]),
  ).toThrow("Duplicate");
});
it("dashboard refuses unsigned readers", async () => {
  const response = await GET(request("GET", undefined, "none"));
  expect(response.ok).toBe(false);
});
it("records a confirmed donation with payout evidence and aggregates stats", async () => {
  const response = await POST(
    request("POST", {
      txHash,
      studentId: "amara-okafor",
      amountStroops: "25000000",
    }),
  );
  expect(response.ok).toBe(true);
  const body = (await response.json()) as {
    data: {
      totalStroops: string;
      count: number;
      byStudent: { id: string; raisedStroops: string }[];
      recent: { txHash: string; payouts: unknown[] | null }[];
    };
  };
  expect(body.data.totalStroops).toBe("25000000");
  expect(body.data.count).toBe(1);
  expect(body.data.byStudent).toEqual([
    {
      id: "amara-okafor",
      name: "Amara Okafor",
      count: 1,
      raisedStroops: "25000000",
      goalStroops: "25000000000",
    },
  ]);
  expect(body.data.recent[0]?.payouts).toHaveLength(2);
  // Second record of the same txHash is idempotent.
  mocks.status.mockResolvedValue({
    txHash: txHash2,
    status: "SUCCESS",
    network: "testnet",
  });
  await POST(
    request("POST", {
      txHash: txHash2,
      studentId: "amara-okafor",
      amountStroops: "10000000",
    }),
  );
  await POST(
    request("POST", { txHash: txHash2, amountStroops: "10000000" }),
  );
  const ledger = await listDonations();
  expect(ledger).toHaveLength(2);
  const stats = await GET(request("GET"));
  const statsBody = (await stats.json()) as {
    data: {
      totalStroops: string;
      count: number;
      byStudent: {
        id: string;
        name: string;
        count: number;
        raisedStroops: string;
        goalStroops: string;
      }[];
    };
  };
  expect(statsBody.data.totalStroops).toBe("35000000");
  expect(statsBody.data.count).toBe(2);
  // The dashboard matrix counts per-student donations (duplicate txHash is idempotent).
  expect(statsBody.data.byStudent).toEqual([
    {
      id: "amara-okafor",
      name: "Amara Okafor",
      count: 2,
      raisedStroops: "35000000",
      goalStroops: "25000000000",
    },
  ]);
});
it("buckets unattributed donations into their own matrix row", async () => {
  const txHash3 = "c".repeat(64);
  mocks.status.mockResolvedValue({
    txHash: txHash3,
    status: "SUCCESS",
    network: "testnet",
  });
  const response = await POST(
    request("POST", { txHash: txHash3, amountStroops: "10000000" }),
  );
  expect(response.ok).toBe(true);
  const stats = await GET(request("GET"));
  const body = (await stats.json()) as {
    data: {
      count: number;
      byStudent: {
        id: string;
        name: string;
        count: number;
        raisedStroops: string;
        goalStroops: string;
      }[];
    };
  };
  expect(body.data.count).toBe(1);
  expect(body.data.byStudent).toEqual([
    {
      id: "amara-okafor",
      name: "Amara Okafor",
      count: 0,
      raisedStroops: "0",
      goalStroops: "25000000000",
    },
    {
      id: "",
      name: "Unassigned donations",
      count: 1,
      raisedStroops: "10000000",
      goalStroops: "0",
    },
  ]);
});
it("refuses to record transactions that are not successful", async () => {
  mocks.status.mockResolvedValue({
    txHash,
    status: "PENDING",
    network: "testnet",
  });
  const response = await POST(
    request("POST", { txHash, amountStroops: "25000000" }),
  );
  expect(response.ok).toBe(false);
  expect(await listDonations()).toEqual([]);
});
it("rejects malformed record bodies before touching the platform", async () => {
  for (const body of [
    { txHash, amountStroops: "25000000", extra: true },
    { txHash: "bad", amountStroops: "25000000" },
    { txHash, amountStroops: "0" },
    { txHash, amountStroops: "25000000", studentId: "Bad Id" },
  ]) {
    const response = await POST(request("POST", body));
    expect(response.ok).toBe(false);
  }
  expect(mocks.status).not.toHaveBeenCalled();
  expect(await listDonations()).toEqual([]);
});
