import { beforeEach, expect, it, vi } from "vitest";
import { POST } from "@/app/api/session/route";
import {
  issueSession,
  safeCompare,
  SESSION_COOKIE,
  sessionSecret,
  sessionUsername,
  verifyToken,
} from "@/lib/session";
vi.mock("server-only", () => ({}));
const id = "12345678-1234-1234-1234-123456789abc";
function request(body: unknown, cookie?: string) {
  return new Request("https://starter.example/api/session", {
    method: "POST",
    headers: {
      origin: "https://starter.example",
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("PAIFLOW_BASE_URL", "https://beta.app.paiflow.xyz");
  vi.stubEnv("PAIFLOW_DEPLOYMENT_ID", id);
  vi.stubEnv("PAIFLOW_API_TOKEN", "pfd_" + "a".repeat(64));
  vi.stubEnv("DEMO_USERNAME", "donor");
  vi.stubEnv("DEMO_PASSWORD", "s3cret-pass");
  vi.stubEnv("ADMIN_USERNAME", "boss");
  vi.stubEnv("ADMIN_PASSWORD", "admin-pass-123");
});
it("issues a signed cookie that verifies back to the username and role", async () => {
  const token = issueSession("donor");
  expect(verifyToken(token)).toEqual({ username: "donor", role: "donor" });
  expect(verifyToken(issueSession("boss", "admin"))).toEqual({
    username: "boss",
    role: "admin",
  });
  expect(
    sessionUsername(
      new Request("https://starter.example/", {
        headers: { cookie: `${SESSION_COOKIE}=${token}` },
      }),
    ),
  ).toBe("donor");
});
it("rejects tampered, expired, or wrongly-signed tokens", () => {
  const token = issueSession("donor");
  expect(verifyToken(token.slice(0, -2) + "xx")).toBeNull();
  const i = token.lastIndexOf(".");
  expect(verifyToken(token.slice(0, i - 2) + "xx" + token.slice(i))).toBeNull();
  expect(verifyToken("garbage")).toBeNull();
  expect(verifyToken(undefined)).toBeNull();
  const expired = issueSession("donor", "donor", Date.now() - 13 * 60 * 60 * 1000);
  expect(verifyToken(expired)).toBeNull();
  vi.stubEnv("APP_SESSION_SECRET", "different-secret-0123456789");
  expect(verifyToken(token)).toBeNull();
  expect(sessionUsername(new Request("https://x/"))).toBeNull();
});
it("prefers APP_SESSION_SECRET and falls back to the Paiflow token", () => {
  vi.stubEnv("APP_SESSION_SECRET", "0123456789abcdef");
  expect(sessionSecret()).toBe("0123456789abcdef");
  vi.stubEnv("APP_SESSION_SECRET", "short");
  expect(sessionSecret()).toBe("pfd_" + "a".repeat(64));
  vi.stubEnv("PAIFLOW_API_TOKEN", "");
  expect(() => sessionSecret()).toThrow("APP_SESSION_SECRET");
});
it("safeCompare compares without throwing on length mismatch", () => {
  expect(safeCompare("abc", "abc")).toBe(true);
  expect(safeCompare("abc", "abd")).toBe(false);
  expect(safeCompare("abc", "abcd")).toBe(false);
});
it("login sets an HttpOnly cookie only for correct credentials", async () => {
  const bad = await POST(
    request({ action: "login", username: "donor", password: "wrong" }),
  );
  expect(bad.status).toBe(401);
  expect(bad.headers.get("set-cookie")).toBeNull();
  const good = await POST(
    request({ action: "login", username: "donor", password: "s3cret-pass" }),
  );
  expect(good.status).toBe(200);
  const cookie = good.headers.get("set-cookie")!;
  expect(cookie).toContain(`${SESSION_COOKIE}=`);
  expect(cookie).toContain("HttpOnly");
  expect(cookie).not.toContain("s3cret-pass");
  const body = (await good.json()) as {
    data: { username: string; role: string };
  };
  expect(body.data.username).toBe("donor");
  expect(body.data.role).toBe("donor");
});
it("admin credentials receive the admin role", async () => {
  const response = await POST(
    request({ action: "login", username: "boss", password: "admin-pass-123" }),
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    data: { username: string; role: string };
  };
  expect(body.data).toEqual({ username: "boss", role: "admin" });
  expect(response.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=`);
});
it("logout clears the session cookie", async () => {
  const response = await POST(request({ action: "logout" }));
  expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
});
it("refuses malformed login bodies, cross-origin posts, and unconfigured credentials", async () => {
  for (const [body, origin] of [
    [JSON.stringify({ action: "login", username: "donor" }), "https://starter.example"],
    ["{bad", "https://starter.example"],
    [
      JSON.stringify({ action: "login", username: "donor", password: "s3cret-pass" }),
      "https://evil.example",
    ],
  ] as const) {
    const response = await POST(
      new Request("https://starter.example/api/session", {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body,
      }),
    );
    expect(response.ok).toBe(false);
  }
  vi.stubEnv("DEMO_USERNAME", "");
  vi.stubEnv("ADMIN_USERNAME", "");
  const unconfigured = await POST(
    request({ action: "login", username: "donor", password: "s3cret-pass" }),
  );
  expect(unconfigured.status).toBe(400);
  expect(await unconfigured.text()).toContain("not configured");
});
