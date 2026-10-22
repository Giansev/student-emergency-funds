"use client";
import { useEffect, useRef, useState } from "react";
import type { PublicConfig, Prepared, Result, Student } from "@/lib/types";
import {
  MAX_DONATION_STROOPS,
  MIN_DONATION_STROOPS,
  STUDENT_SHARE_BPS,
  TOTAL_SHARE_BPS,
} from "@/lib/types";
import { fromStroops, toStroops } from "@/lib/amount";
import type { DonationStats } from "@/lib/donation-store";
import { ORGANIZATION } from "@/lib/students";

function shortAddress(address: string | null) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "A recipient";
}
function CardProgress({
  raisedStroops,
  goalStroops,
}: {
  raisedStroops?: string;
  goalStroops: string;
}) {
  if (raisedStroops === undefined) return null;
  const pct = Math.min(
    Number((BigInt(raisedStroops) * 100n) / BigInt(goalStroops)),
    100,
  );
  return (
    <span className="card-progress">
      <progress value={pct} max={100} />
      <span className="pct">{pct}% funded</span>
    </span>
  );
}
function statusChipClass(status: string) {
  if (status === "SUCCESS") return "success";
  if (status === "FAILED" || status === "REJECTED") return "failed";
  return "pending";
}
import {
  BrowserRequestError,
  browserRequest,
  RESPONSE_DEADLINE_MS,
} from "@/lib/browser-api";
import {
  assertStatus,
  confirmOriginal,
  CONFIRMATION_PENDING,
  CONFIRMATION_UNRESOLVED,
} from "@/lib/confirmation";
import { connectWallet, signPrepared } from "@/lib/wallet";
import { assertOriginal } from "@/lib/transaction";
import {
  readRecovery,
  saveRecovery,
  terminal,
  assertNoConflictingRecovery,
} from "@/lib/recovery";
import type { Recovery } from "@/lib/recovery";
import { UserMenu } from "@/components/user-menu";

type Operation = {
  signal: AbortSignal;
  valid: () => boolean;
  save: (record: Recovery) => void;
  message: (message: string) => void;
};

export function StarterApp({
  config,
  students,
  username,
  role = "donor",
  view = "donate",
  onSwitchView = () => undefined,
}: {
  config: PublicConfig;
  students: Student[];
  username: string;
  role?: "donor" | "admin";
  view?: "donate" | "admin";
  onSwitchView?: (view: "donate" | "admin") => void;
}) {
  const [address, setAddress] = useState("");
  const [selected, setSelected] = useState("");
  const [amount, setAmount] = useState("");
  const [record, setRecord] = useState<Recovery | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState("");
  const [blocked, setBlocked] = useState(true);
  const key = config.ready ? `paiflow-sdk-payment-v2:${config.scope}` : "";
  let stroops = "";
  let amountError = "";
  try {
    if (amount) {
      stroops = toStroops(amount);
      const value = BigInt(stroops);
      if (value < BigInt(MIN_DONATION_STROOPS))
        amountError = `Minimum donation is ${fromStroops(MIN_DONATION_STROOPS)} XLM.`;
      else if (value > BigInt(MAX_DONATION_STROOPS))
        amountError = `Maximum donation is ${fromStroops(MAX_DONATION_STROOPS)} XLM.`;
    }
  } catch (error) {
    amountError =
      error instanceof Error ? error.message : "Enter a valid amount.";
    stroops = "";
  }
  const studentShare = stroops
    ? ((BigInt(stroops) * STUDENT_SHARE_BPS) / TOTAL_SHARE_BPS).toString()
    : "";
  const orgShare = stroops
    ? (BigInt(stroops) - BigInt(studentShare)).toString()
    : "";
  const student = students.find((s) => s.id === selected);
  const [stats, setStats] = useState<DonationStats | null>(null);
  const [opsOpen, setOpsOpen] = useState(false);
  const [recOpen, setRecOpen] = useState(false);
  const expectedStudent = stats
    ? (
        (BigInt(stats.totalStroops) * STUDENT_SHARE_BPS) /
        TOTAL_SHARE_BPS
      ).toString()
    : "0";
  const expectedOrg = stats
    ? (BigInt(stats.totalStroops) - BigInt(expectedStudent)).toString()
    : "0";
  async function loadStats() {
    try {
      const s = await browserRequest<DonationStats>("/api/donations");
      if (
        !s ||
        typeof s.totalStroops !== "string" ||
        !/^\d+$/.test(s.totalStroops) ||
        !Array.isArray(s.byStudent) ||
        !Array.isArray(s.recent)
      )
        return;
      setStats(s);
    } catch {
      /* the dashboard is best-effort and never blocks payments */
    }
  }
  function recordDonation(current: Recovery) {
    if (!current.amountStroops) return;
    const body: Record<string, string> = {
      txHash: current.prepared.txHash,
      amountStroops: current.amountStroops,
    };
    if (current.studentId) body.studentId = current.studentId;
    void browserRequest<DonationStats>("/api/donations", body)
      .then((s) => {
        if (s && typeof s.totalStroops === "string") setStats(s);
      })
      .catch(() => undefined);
  }
  // Load transparency data when there is no unresolved payment in this browser.
  useEffect(() => {
    if (!blocked && !record && loadedKey.current === key) void loadStats();
  }, [key, blocked, record]);
  const scopeKey = useRef(key);
  scopeKey.current = key;
  const loadedKey = useRef<string | null>(null);
  const active = useRef<AbortController | null>(null);
  const resumed = useRef(new Set<string>());
  useEffect(() => {
    loadedKey.current = null;
    active.current?.abort();
    active.current = null;
    setBusy(false);
    setConfirming(false);
    resumed.current.clear();
    setBlocked(true);
    setRecord(null);
    setAddress("");
    setMessage("");
    if (!config.ready) return;
    try {
      assertNoConflictingRecovery(localStorage, key);
      const raw = localStorage.getItem(key);
      if (raw) setRecord(readRecovery(config.scope, raw));
      loadedKey.current = key;
      setBlocked(false);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Recovery storage could not be read. Preserve it for support before starting another payment.",
      );
    }
    return () => {
      loadedKey.current = null;
      active.current?.abort();
    };
  }, [key, config.ready]);

  async function run(
    action: (current: Recovery | null, op: Operation) => Promise<void>,
  ) {
    if (!config.ready || active.current || blocked || loadedKey.current !== key)
      return;
    const controller = new AbortController();
    active.current = controller;
    const valid = () =>
      !controller.signal.aborted &&
      scopeKey.current === key &&
      loadedKey.current === key;
    const op: Operation = {
      signal: controller.signal,
      valid,
      save: (r) => {
        if (!valid())
          throw new DOMException("Operation cancelled", "AbortError");
        if (r.scope !== config.scope)
          throw new Error(
            "Recovery scope mismatch. Retain the original record.",
          );
        saveRecovery(localStorage, key, r);
        setRecord(r);
      },
      message: (text) => {
        if (valid()) setMessage(text);
      },
    };
    setBusy(true);
    setMessage("");
    try {
      if (!navigator.locks)
        throw new Error(
          "This browser needs Web Locks support for safe payment recovery.",
        );
      await navigator.locks.request(
        key,
        { ifAvailable: true },
        async (lock) => {
          if (!valid()) return;
          if (!lock)
            throw new Error(
              "Another tab is handling this deployment's payment. Return to that tab.",
            );
          assertNoConflictingRecovery(localStorage, key);
          const raw = localStorage.getItem(key);
          const current = raw ? readRecovery(config.scope, raw) : null;
          setRecord(current);
          await action(current, op);
        },
      );
    } catch (error) {
      op.message(
        error instanceof Error
          ? error.message
          : "Unresolved operation. Keep the original record.",
      );
    } finally {
      if (active.current === controller) {
        active.current = null;
        if (scopeKey.current === key && loadedKey.current === key) {
          setBusy(false);
          setConfirming(false);
        }
      }
    }
  }

  function statusMessage(result: Result, current?: Recovery | null) {
    const championed = current?.studentId
      ? students.find((s) => s.id === current.studentId)
      : undefined;
    const thanks = championed
      ? ` Thank you for supporting ${championed.name}.`
      : "";
    if (result.status === "SUCCESS")
      return `Original transaction confirmed.${thanks} This does not verify the deployed split's payouts or fulfil a donation.`;
    if (result.status === "FAILED")
      return "Original transaction failed on the network. Its evidence is retained until acknowledged.";
    return `Original transaction: ${result.status}. UNKNOWN, rejection, expiry or missing history never prove replacement is safe.`;
  }
  async function checkOriginal(current: Recovery, op: Operation) {
    if (!op.valid()) return;
    resumed.current.add(`${key}:${current.prepared.txHash}`);
    op.message(CONFIRMATION_PENDING);
    setConfirming(true);
    const outcome = await confirmOriginal({
      txHash: current.prepared.txHash,
      signal: op.signal,
      lookup: (signal, remainingMs) =>
        browserRequest<Result>(
          "/api/pay",
          { action: "status", txHash: current.prepared.txHash },
          signal,
          remainingMs,
        ),
      onResult: (result) => {
        op.save({ ...current, status: result.status });
        if (
          result.status === "SUCCESS" ||
          result.status === "FAILED" ||
          result.status === "REJECTED"
        )
          op.message(statusMessage(result, current));
        if (result.status === "SUCCESS") recordDonation(current);
      },
    });
    if (outcome === "unresolved") op.message(CONFIRMATION_UNRESOLVED);
  }
  useEffect(() => {
    if (
      blocked ||
      busy ||
      !record?.attempted ||
      !record.signedXdr ||
      terminal(record)
    )
      return;
    const identity = `${key}:${record.prepared.txHash}`;
    if (resumed.current.has(identity)) return;
    resumed.current.add(identity);
    void run(async (current, op) => {
      if (current?.attempted && current.signedXdr && !terminal(current))
        await checkOriginal(current, op);
    });
  }, [key, blocked, busy, record]);

  async function prepare(current: Recovery | null, op: Operation) {
    if (current)
      throw new Error("Resolve the existing payment before preparing another.");
    if (!address) throw new Error("Connect Freighter first.");
    if (!student) throw new Error("Choose a student to support first.");
    if (!stroops || amountError)
      throw new Error(amountError || "Enter a valid donation amount.");
    const prepared = await browserRequest<Prepared>(
      "/api/pay",
      { action: "prepare", from: address, amount },
      op.signal,
    );
    if (!config.ready) return;
    op.save({
      version: 2,
      scope: config.scope,
      address,
      prepared,
      studentId: student.id,
      amountStroops: stroops,
    });
    op.message(
      "Prepared and saved. Review the wallet transaction before approving.",
    );
  }
  async function sign(current: Recovery | null, op: Operation) {
    if (!current || current.signedXdr || terminal(current)) return;
    if (address !== current.address)
      throw new Error("Connect the original consenting wallet.");
    const next = { ...current, signing: true };
    op.save(next);
    const signedXdr = await signPrepared(current.prepared, current.address);
    assertOriginal(current.prepared.xdr, signedXdr, current.prepared.txHash);
    op.save({ ...next, signing: false, signedXdr });
    op.message("Exact signed envelope saved. Submit when ready.");
  }
  async function submit(current: Recovery | null, op: Operation) {
    if (!current?.signedXdr || terminal(current)) return;
    assertOriginal(
      current.prepared.xdr,
      current.signedXdr,
      current.prepared.txHash,
    );
    const next = { ...current, attempted: true };
    resumed.current.add(`${key}:${current.prepared.txHash}`);
    op.save(next);
    let result: Result;
    try {
      result = await browserRequest<Result>(
        "/api/pay",
        {
          action: "submit",
          signedXdr: current.signedXdr,
          preparationRequestId: current.prepared.preparationRequestId,
        },
        op.signal,
        RESPONSE_DEADLINE_MS,
      );
    } catch (error) {
      if (!op.valid()) return;
      if (
        error instanceof BrowserRequestError &&
        error.status < 500 &&
        error.code !== "UPSTREAM_RPC"
      )
        throw error;
      await checkOriginal(next, op);
      return;
    }
    if (!op.valid()) return;
    if (result.txHash !== current.prepared.txHash)
      throw new Error("Response hash mismatch. Keep the original record.");
    if (result.status === "REJECTED") {
      op.save({ ...next, status: "REJECTED" });
      op.message(statusMessage(result, next));
      return;
    }
    // Confirmation uses the original status route even when submission reports success.
    await checkOriginal(next, op);
  }
  async function status(current: Recovery | null, op: Operation) {
    if (!current) return;
    const result = await browserRequest<Result>(
      "/api/pay",
      { action: "status", txHash: current.prepared.txHash },
      op.signal,
      RESPONSE_DEADLINE_MS,
    );
    if (!op.valid()) return;
    assertStatus(result, current.prepared.txHash);
    op.save({ ...current, status: result.status });
    op.message(statusMessage(result, current));
    if (result.status === "SUCCESS") recordDonation(current);
  }
  async function clear(current: Recovery | null, op: Operation) {
    if (!current || !terminal(current))
      throw new Error(
        "Check final SUCCESS or FAILED before clearing this record.",
      );
    if (!op.valid()) return;
    localStorage.removeItem(key);
    if (localStorage.getItem(key) !== null)
      throw new Error("Could not clear stored evidence.");
    setRecord(null);
    op.message(
      "Final transaction acknowledged. A new donation is now possible.",
    );
  }
  return (
    <main>
      <header>
        <img
          className="logo"
          src="/stellaraid-logo.jpeg"
          alt="StellarAid logo"
        />
        <h1>StellarAid</h1>
        <span className="chip" data-testid="network-chip">
          TESTNET
        </span>
        <span className="session">
          <UserMenu
            username={username}
            role={role}
            view={view}
            onSwitchView={onSwitchView}
          />
        </span>
      </header>
      <nav className="subnav" aria-label="Sections">
        <a href="#transparency">Transparency</a>
        <a href="#students">Students</a>
        <a href="#donate">Donate</a>
        <a href="#activity">Activity</a>
      </nav>
      <p>
        Donate testnet XLM to support students in need. Every donation is split
        by the deployed Paiflow flow: 90% to the student and 10% to the{" "}
        {ORGANIZATION.name}. Freighter signs in your browser; this app never
        handles private keys.
      </p>
      {!config.ready ? (
        <aside>{config.message}</aside>
      ) : (
        <p>
          <a href={config.deploymentUrl} target="_blank" rel="noreferrer">
            Review your deployment and its recipients
          </a>
        </p>
      )}
      <section id="transparency">
        <h2>1. Fund transparency</h2>
        <p className="muted">
          Totals are recorded by this app from confirmed transactions. Per-student
          amounts reflect donor intent; the deployed flow decides actual on-chain
          routing. Inspect the deployment activity to verify payouts.
        </p>
        {stats ? (
          <>
            <div className="stat-tiles">
              <div className="stat-tile">
                <span className="value">
                  {fromStroops(stats.totalStroops)} XLM
                </span>
                <span className="label">Total raised</span>
              </div>
              <div className="stat-tile">
                <span className="value">{stats.count}</span>
                <span className="label">
                  Confirmed donation{stats.count === 1 ? "" : "s"}
                </span>
              </div>
              <div className="stat-tile">
                <span className="value">
                  {stats.count > 0
                    ? fromStroops(
                        (
                          BigInt(stats.totalStroops) / BigInt(stats.count)
                        ).toString(),
                      )
                    : "0"}{" "}
                  XLM
                </span>
                <span className="label">Average donation</span>
              </div>
            </div>
            <div className="table-scroll">
            <table className="matrix">
              <caption className="muted">
                Donations × funding legs, split per the deployed 90/10 flow.
                Rounding remainder goes to the {ORGANIZATION.name}. Amounts
                reflect donor intent, not verified on-chain payouts.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Student</th>
                  <th scope="col">Donations</th>
                  <th scope="col">Raised</th>
                  <th scope="col">to student (90%)</th>
                  <th scope="col">to {ORGANIZATION.name} (10%)</th>
                  <th scope="col">Goal</th>
                  <th scope="col">Funded</th>
                </tr>
              </thead>
              <tbody>
                {stats.byStudent.map((s) => {
                  const studentLeg = (
                    (BigInt(s.raisedStroops) * STUDENT_SHARE_BPS) /
                    TOTAL_SHARE_BPS
                  ).toString();
                  const orgLeg = (
                    BigInt(s.raisedStroops) - BigInt(studentLeg)
                  ).toString();
                  const showBar = s.goalStroops !== "0";
                  const pct = showBar
                    ? Number(
                        (BigInt(s.raisedStroops) * 100n) /
                          BigInt(s.goalStroops),
                      )
                    : null;
                  return (
                    <tr key={s.id || "unassigned"}>
                      <th scope="row">{s.name}</th>
                      <td>{s.count}</td>
                      <td>{fromStroops(s.raisedStroops)} XLM</td>
                      <td>{fromStroops(studentLeg)} XLM</td>
                      <td>{fromStroops(orgLeg)} XLM</td>
                      <td>
                        {showBar ? `${fromStroops(s.goalStroops)} XLM` : "—"}
                      </td>
                      <td>
                        {pct === null ? (
                          "—"
                        ) : (
                          <>
                            <progress value={Math.min(pct, 100)} max={100} />{" "}
                            {pct}%
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">All donations</th>
                  <td>{stats.count}</td>
                  <td>{fromStroops(stats.totalStroops)} XLM</td>
                  <td>{fromStroops(expectedStudent)} XLM</td>
                  <td>{fromStroops(expectedOrg)} XLM</td>
                  <td>—</td>
                  <td>—</td>
                </tr>
              </tfoot>
            </table>
            </div>
            {stats.recent.length > 0 && (
              <ol>
                {stats.recent.map((d) => (
                  <li key={d.txHash}>
                    <code>{d.txHash.slice(0, 12)}…</code> —{" "}
                    {fromStroops(d.amountStroops)} XLM
                    {d.studentName ? ` for ${d.studentName}` : ""}.{" "}
                    {d.payouts === null
                      ? "Payout events unavailable."
                      : d.payouts.length === 0
                        ? "No payout events recorded yet."
                        : `${d.payouts
                            .map(
                              (p) =>
                                `${shortAddress(p.address)} received ${fromStroops(p.amountStroops)} XLM`,
                            )
                            .join("; ")}.`}
                  </li>
                ))}
              </ol>
            )}
          </>
        ) : (
          <p>Transparency data is not loaded yet.</p>
        )}
        <button type="button" disabled={busy} onClick={() => void loadStats()}>
          Refresh transparency data
        </button>
      </section>
      <section id="students">
        <h2>2. Choose a student</h2>
        <p className="muted">
          Your choice is recorded with the donation and shown in the thank-you
          message. On-chain routing always follows the recipients configured in
          the deployed flow.
        </p>
        <div className="cards">
          {students.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={selected === s.id}
              className={`card${selected === s.id ? " selected" : ""}`}
              onClick={() => setSelected(s.id)}
            >
              <strong>{s.name}</strong>
              <span>{s.story}</span>
              <span>Goal: {fromStroops(s.goalStroops)} XLM</span>
              <CardProgress
                raisedStroops={
                  stats?.byStudent.find((b) => b.id === s.id)?.raisedStroops
                }
                goalStroops={s.goalStroops}
              />
            </button>
          ))}
        </div>
        {student && <p>Supporting: {student.name}</p>}
      </section>
      <section id="donate">
        <h2>3. Connect and prepare</h2>
        <button
          disabled={busy || !config.ready || blocked}
          onClick={() =>
            run(async (_current, op) => {
              await browserRequest("/api/integration", undefined, op.signal);
              const address = await connectWallet();
              if (op.valid()) setAddress(address);
            })
          }
        >
          Connect Freighter
        </button>
        <p>Wallet: {address || "Not connected"}</p>
        <label>
          Donation amount (XLM)
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="5.00"
            inputMode="decimal"
            disabled={busy || !!record}
          />
        </label>
        <div className="amount-chips" role="group" aria-label="Quick amount choices">
          {["5", "10", "25", "50"].map((chip) => (
            <button
              key={chip}
              type="button"
              disabled={busy || !!record}
              className={amount === chip ? "selected" : ""}
              onClick={() => setAmount(chip)}
            >
              {chip} XLM
            </button>
          ))}
        </div>
        {record && (
          <p role="alert">
            {terminal(record)
              ? "The saved payment is final, so the amount stays locked. Use “Acknowledge final result and clear” in Verify and recover below to unlock a new donation."
              : "A previous payment is saved in this browser, so the amount stays locked until it is resolved. Use “Check original transaction” in Verify and recover below; a new donation is possible only after the final result is acknowledged."}
          </p>
        )}
        {amountError ? (
          <p role="alert">{amountError}</p>
        ) : (
          stroops && (
            <div className="split-preview">
              <div
                className="split-bar"
                role="img"
                aria-label="90 percent to the student and 10 percent to the student organization"
              >
                <span
                  className="split-student"
                  style={{ width: `${Number(STUDENT_SHARE_BPS) / 100}%` }}
                />
                <span
                  className="split-org"
                  style={{
                    width: `${Number(TOTAL_SHARE_BPS - STUDENT_SHARE_BPS) / 100}%`,
                  }}
                />
              </div>
              <p className="split-legend">
                <strong>{fromStroops(studentShare)} XLM</strong> (90%) to the
                student and <strong>{fromStroops(orgShare)} XLM</strong> (
                {Number(ORGANIZATION.shareBps) / 100}%) to the{" "}
                {ORGANIZATION.name}. The deployed flow is authoritative for
                rounding.
              </p>
            </div>
          )
        )}
        <button
          className="primary"
          disabled={
            busy ||
            blocked ||
            !address ||
            !!record ||
            !student ||
            !stroops ||
            !!amountError
          }
          onClick={() => run(prepare)}
        >
          Prepare donation
        </button>
      </section>
      <details
        className="step"
        open={opsOpen || !!record}
        onToggle={(e) => setOpsOpen(e.currentTarget.open)}
      >
        <summary>
          <h2>4. Sign and submit</h2>
        </summary>
        <button
          disabled={
            busy || !record || !!record.signedXdr || terminal(record) || blocked
          }
          onClick={() => run(sign)}
        >
          Sign original transaction
        </button>{" "}
        <button
          className="primary"
          disabled={
            busy ||
            !record?.signedXdr ||
            (!!record && terminal(record)) ||
            blocked
          }
          onClick={() => run(submit)}
        >
          {record?.attempted
            ? "Retry exact saved envelope"
            : "Submit saved envelope"}
        </button>
      </details>
      <details
        className="step"
        id="activity"
        open={recOpen || !!record}
        onToggle={(e) => setRecOpen(e.currentTarget.open)}
      >
        <summary>
          <h2>5. Verify and recover</h2>
        </summary>
        <p>
          Reloading restores the original preparation and signed envelope. Keep
          this browser's storage until the original transaction is resolved.
          Re-signing uses the same body; it never prepares a replacement.
        </p>
        {record && (
          <>
            <p>
              Original transaction: <code>{record.prepared.txHash}</code>
            </p>
            <p>Preparation expires: {record.prepared.expiresAt}</p>
            <p>
              Status:{" "}
              {record.status ? (
                <span className={`status-chip ${statusChipClass(record.status)}`}>
                  {record.status}
                </span>
              ) : (
                "Not checked"
              )}
            </p>
          </>
        )}
        <button
          disabled={busy || !record || blocked}
          onClick={() => run(status)}
        >
          Check original transaction
        </button>{" "}
        <button
          disabled={busy || !record || !terminal(record) || blocked}
          onClick={() => run(clear)}
        >
          Acknowledge final result and clear
        </button>
        <p>
          Inspect the deployment's activity and recipient balances separately to
          verify your intended payment and payout rules. Transaction
          confirmation alone is not application payment verification.
        </p>
      </details>
      <p role="status" aria-live="polite">
        {confirming ? message : busy ? "Working…" : message}
      </p>
      {confirming && (
        <button
          className="danger"
          onClick={() => {
            active.current?.abort();
            setMessage(CONFIRMATION_UNRESOLVED);
          }}
        >
          Stop checking
        </button>
      )}
      <aside>
        This local demo has no donor authentication, donation database, rate
        limit or student identity verification. Do not deploy it as a
        production fundraiser. A production application must bind prepared
        transactions to authorised donations and keep durable server-side
        recovery evidence. Browser storage is not a backup; deleting it loses
        recovery.
      </aside>
    </main>
  );
}
