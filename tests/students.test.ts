import { mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PUT } from "@/app/api/students/route";
import { listStudents, parseStudents, saveStudents } from "@/lib/student-store";
import { issueSession, SESSION_COOKIE } from "@/lib/session";
vi.mock("server-only", () => ({}));
const id = "12345678-1234-1234-1234-123456789abc";
const valid = [
  {
    id: "amara-okafor",
    name: "Amara Okafor",
    story: "Second-year nursing student bridging a tuition gap.",
    goalStroops: "25000000000",
  },
  {
    id: "mei-lin",
    name: "Mei Lin",
    story: "First-generation student closing an aid shortfall.",
    goalStroops: "30000000000",
  },
];
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "students-"));
  vi.stubEnv("STUDENTS_FILE", path.join(dir, "students.json"));
  vi.stubEnv("PAIFLOW_API_TOKEN", "pfd_" + "a".repeat(64));
  vi.stubEnv("PAIFLOW_DEPLOYMENT_ID", id);
});
afterEach(() => {
  vi.unstubAllEnvs();
});
it("parseStudents accepts a valid directory and normalizes it", () => {
  expect(parseStudents(valid)).toEqual(valid);
});
it.each([
  ["empty list", []],
  ["duplicate ids", [valid[0], valid[0]]],
  ["bad slug id", [{ ...valid[0], id: "Amara Okafor!" }]],
  ["empty name", [{ ...valid[0], name: "  " }]],
  ["over-long story", [{ ...valid[0], story: "x".repeat(281) }]],
  ["zero goal", [{ ...valid[0], goalStroops: "0" }]],
  ["negative-ish goal", [{ ...valid[0], goalStroops: "-5" }]],
  [
    "huge goal",
    [{ ...valid[0], goalStroops: "999999999999999999999999999999999999999" }],
  ],
  ["missing field", [{ id: "x", name: "X" }]],
])("parseStudents rejects %s", (_label, data) => {
  expect(() => parseStudents(data)).toThrow();
});
it("saveStudents writes atomically and listStudents reads back", async () => {
  await saveStudents(valid);
  expect(readFileSync(path.join(dir, "students.json"), "utf8")).toContain(
    "amara-okafor",
  );
  expect(await listStudents()).toEqual(valid);
  await expect(saveStudents([{ ...valid[0], id: "bad id" }])).rejects.toThrow();
  // a rejected save must not clobber the stored directory
  expect(await listStudents()).toEqual(valid);
});
it("listStudents returns an empty directory when the file is absent", async () => {
  expect(await listStudents()).toEqual([]);
});
function request(body: unknown, role: "donor" | "admin" | "none") {
  const headers: Record<string, string> = {
    origin: "https://starter.example",
    "content-type": "application/json",
  };
  if (role !== "none")
    headers.cookie = `${SESSION_COOKIE}=${issueSession("user", role)}`;
  return new Request("https://starter.example/api/students", {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });
}
it("students route saves for admins and refuses donors, unsigned, and bad bodies", async () => {
  const admin = await PUT(request({ students: valid }, "admin"));
  expect(admin.status).toBe(200);
  expect(await listStudents()).toEqual(valid);
  const donor = await PUT(
    request(
      [{ id: "evil", name: "Evil", story: "y", goalStroops: "1" }],
      "donor",
    ),
  );
  expect(donor.status).toBe(502);
  expect(await listStudents()).toEqual(valid);
  const unsigned = await PUT(request({ students: valid }, "none"));
  expect(unsigned.status).toBe(502);
  const wrongShape = await PUT(
    request({ students: valid, extra: true }, "admin"),
  );
  expect(wrongShape.status).toBe(502);
});
