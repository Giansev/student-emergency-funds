import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

export const SESSION_COOKIE = "stellaraid_session";
export const SESSION_MAX_AGE_S = 12 * 60 * 60;
export type SessionRole = "donor" | "admin";
export type SessionUser = { username: string; role: SessionRole };

/** HMAC key for session cookies; falls back to the Paiflow token so existing setups keep working. */
export function sessionSecret(): string {
  const secret = process.env.APP_SESSION_SECRET?.trim();
  if (secret && secret.length >= 16) return secret;
  const token = process.env.PAIFLOW_API_TOKEN?.trim() ?? "";
  if (/^(pfk|pfd)_[a-f0-9]{64}$/.test(token)) return token;
  throw new Error(
    "Configure APP_SESSION_SECRET (at least 16 characters) on the server.",
  );
}

function sign(payload: string): string {
  return createHmac("sha256", sessionSecret())
    .update(payload)
    .digest("base64url");
}

export function issueSession(
  username: string,
  role: SessionRole = "donor",
  now = Date.now(),
): string {
  const payload = Buffer.from(
    JSON.stringify({ u: username, r: role, t: now }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(
  token: string | undefined | null,
): SessionUser | null {
  if (!token) return null;
  try {
    const i = token.lastIndexOf(".");
    if (i <= 0) return null;
    const payload = token.slice(0, i);
    const given = Buffer.from(token.slice(i + 1));
    const expected = Buffer.from(sign(payload));
    if (given.length !== expected.length || !timingSafeEqual(given, expected))
      return null;
    const data: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString(),
    );
    if (
      !data ||
      typeof data !== "object" ||
      typeof (data as { u?: unknown }).u !== "string" ||
      (data as { u: string }).u.length > 64 ||
      !["donor", "admin"].includes((data as { r?: unknown }).r as string) ||
      !Number.isFinite((data as { t?: unknown }).t)
    )
      return null;
    if (Date.now() - (data as { t: number }).t > SESSION_MAX_AGE_S * 1000)
      return null;
    return {
      username: (data as { u: string }).u,
      role: (data as { r: SessionRole }).r,
    };
  } catch {
    return null;
  }
}

/** Reads the signed session cookie from a request. */
export function sessionUser(request: Request): SessionUser | null {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    if (part.slice(0, eq).trim() !== SESSION_COOKIE) continue;
    try {
      return verifyToken(decodeURIComponent(part.slice(eq + 1).trim()));
    } catch {
      return null;
    }
  }
  return null;
}

/** Any valid session (donor or admin) suffices for payment actions. */
export function sessionUsername(request: Request): string | null {
  return sessionUser(request)?.username ?? null;
}

/** Length-checked constant-time string comparison for credentials. */
export function safeCompare(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
