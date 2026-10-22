"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { browserRequest } from "@/lib/browser-api";

export function LoginGate() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await browserRequest("/api/session", {
        action: "login",
        username,
        password,
      });
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Sign-in failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main>
      <header>
        <h1>ScholarFund — student donations</h1>
        <span className="chip" data-testid="network-chip">
          TESTNET
        </span>
      </header>
      <section>
        <h2>Sign in</h2>
        <p>Enter the demo username and password to enter the donation app.</p>
        <form onSubmit={submit}>
          <label>
            Username
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              disabled={busy}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              disabled={busy}
            />
          </label>
          <button disabled={busy || !username || !password} type="submit">
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p role="status" aria-live="polite">
          {message}
        </p>
      </section>
      <aside>
        Demo-grade sign-in: one shared username and password, checked on the
        server and remembered in a signed HttpOnly cookie. There are no
        per-user accounts, roles, or password reset. A production fundraiser
        needs real authentication, authorization, and rate limiting.
      </aside>
    </main>
  );
}
