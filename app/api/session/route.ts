import "server-only";
import { sameOrigin } from "@/lib/http";
import {
  issueSession,
  safeCompare,
  SESSION_COOKIE,
  SESSION_MAX_AGE_S,
  sessionSecret,
} from "@/lib/session";

function cookieHeader(token: string, maxAge: number): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

function respond(
  username: string,
  role: "donor" | "admin",
): Response {
  const token = issueSession(username, role);
  return Response.json(
    { data: { username, role } },
    { headers: { "set-cookie": cookieHeader(token, SESSION_MAX_AGE_S) } },
  );
}

function credentials(kind: "DEMO" | "ADMIN"): [string, string] | null {
  const user = process.env[`${kind}_USERNAME`]?.trim();
  const pass = process.env[`${kind}_PASSWORD`]?.trim();
  return user && pass ? [user, pass] : null;
}

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const text = await request.text();
    if (text.length > 4096) throw new Error("Request too large.");
    const b: unknown = JSON.parse(text);
    if (!b || typeof b !== "object" || Array.isArray(b))
      throw new Error("Invalid request.");
    const v = b as Record<string, unknown>;
    if (v.action === "logout" && Object.keys(v).length === 1)
      return Response.json(
        { data: { signedOut: true } },
        { headers: { "set-cookie": cookieHeader("", 0) } },
      );
    if (
      v.action === "login" &&
      typeof v.username === "string" &&
      v.username.length <= 64 &&
      typeof v.password === "string" &&
      v.password.length <= 128 &&
      Object.keys(v).length === 3
    ) {
      sessionSecret(); // fail loudly if session signing is unconfigured
      const admin = credentials("ADMIN");
      if (
        admin &&
        safeCompare(v.username, admin[0]) &&
        safeCompare(v.password, admin[1])
      )
        return respond(admin[0], "admin");
      const donor = credentials("DEMO");
      if (
        donor &&
        safeCompare(v.username, donor[0]) &&
        safeCompare(v.password, donor[1])
      )
        return respond(donor[0], "donor");
      if (!admin && !donor)
        throw new Error("Demo sign-in is not configured on the server.");
      return Response.json(
        {
          error: {
            code: "UNAUTHORIZED",
            message: "Invalid username or password.",
          },
        },
        { status: 401 },
      );
    }
    throw new Error("Invalid request.");
  } catch (error) {
    return Response.json(
      {
        error: {
          code: "UNRESOLVED",
          message:
            error instanceof Error
              ? error.message
              : "Request could not complete.",
        },
      },
      { status: 400 },
    );
  }
}
