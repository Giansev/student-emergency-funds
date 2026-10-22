"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Student } from "@/lib/types";
import { fromStroops, toStroops } from "@/lib/amount";
import { browserRequest } from "@/lib/browser-api";

type Draft = { id: string; name: string; story: string; goalXlm: string };

function toDrafts(students: Student[]): Draft[] {
  return students.map((s) => ({
    id: s.id,
    name: s.name,
    story: s.story,
    goalXlm: fromStroops(s.goalStroops),
  }));
}

export function AdminApp({
  username,
  students,
}: {
  username: string;
  students: Student[];
}) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Draft[]>(() => toDrafts(students));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  function update(index: number, patch: Partial<Draft>) {
    setDrafts((current) =>
      current.map((d, i) => (i === index ? { ...d, ...patch } : d)),
    );
  }
  function addStudent() {
    setDrafts((current) => [
      ...current,
      {
        id: `student-${current.length + 1}`,
        name: "",
        story: "",
        goalXlm: "100",
      },
    ]);
  }
  function removeStudent(index: number) {
    setDrafts((current) => current.filter((_, i) => i !== index));
  }
  async function save() {
    setBusy(true);
    setMessage("");
    try {
      const payload = drafts.map((d) => ({
        id: d.id,
        name: d.name,
        story: d.story,
        goalStroops: toStroops(d.goalXlm || "0"),
      }));
      const result = await browserRequest<{ saved: number }>(
        "/api/students",
        { students: payload },
      );
      setMessage(`Saved ${result.saved} students.`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main>
      <header>
        <h1>ScholarFund — admin</h1>
        <span className="chip" data-testid="network-chip">
          TESTNET
        </span>
        <span className="session">
          Signed in as {username} (admin){" "}
          <button
            type="button"
            className="link"
            onClick={() =>
              void browserRequest("/api/session", { action: "logout" })
                .catch(() => undefined)
                .finally(() => router.refresh())
            }
          >
            Log out
          </button>
        </span>
      </header>
      <p>
        Curate the student directory: names, stories, and funding goals. Donors
        see exactly what you save here. Goals are amounts of XLM.
      </p>
      <section>
        <h2>Students seeking support</h2>
        {drafts.map((draft, index) => (
          <fieldset key={index} className="editor">
            <legend>Student {index + 1}</legend>
            <label>
              ID (slug)
              <input
                value={draft.id}
                onChange={(e) => update(index, { id: e.target.value })}
                disabled={busy}
              />
            </label>
            <label>
              Name
              <input
                value={draft.name}
                onChange={(e) => update(index, { name: e.target.value })}
                disabled={busy}
              />
            </label>
            <label>
              Story
              <textarea
                value={draft.story}
                onChange={(e) => update(index, { story: e.target.value })}
                rows={3}
                disabled={busy}
              />
            </label>
            <label>
              Goal (XLM)
              <input
                value={draft.goalXlm}
                onChange={(e) => update(index, { goalXlm: e.target.value })}
                inputMode="decimal"
                disabled={busy}
              />
            </label>
            <button
              type="button"
              disabled={busy || drafts.length === 1}
              onClick={() => removeStudent(index)}
            >
              Remove student
            </button>
          </fieldset>
        ))}
        <button type="button" disabled={busy} onClick={addStudent}>
          Add student
        </button>{" "}
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
        >
          {busy ? "Saving…" : "Save directory"}
        </button>
        <p role="status" aria-live="polite">
          {message}
        </p>
      </section>
      <aside>
        Demo-grade administration: any signed-in admin edits one shared
        directory stored in a server-side JSON file. A production fundraiser
        needs per-admin audit trails, review workflows, and durable storage.
      </aside>
    </main>
  );
}
