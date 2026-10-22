import "server-only";
import { promises as fs } from "fs";
import path from "path";
import type { Student } from "@/lib/types";

const MAX_GOAL_STROOPS = "10000000000000000"; // 1,000,000 XLM cap per campaign.
const MAX_STUDENTS = 50;

function storeFile(): string {
  return (
    process.env.STUDENTS_FILE?.trim() ||
    path.join(process.cwd(), "data", "students.json")
  );
}

/** Strict structural validation; throws with a client-safe message on bad data. */
export function parseStudents(data: unknown): Student[] {
  if (!Array.isArray(data)) throw new Error("Students must be a list.");
  if (data.length === 0) throw new Error("Keep at least one student listed.");
  if (data.length > MAX_STUDENTS)
    throw new Error(`At most ${MAX_STUDENTS} students are allowed.`);
  const ids = new Set<string>();
  for (const item of data) {
    const s = item as Partial<Student> | null;
    if (
      !s ||
      typeof s !== "object" ||
      typeof s.id !== "string" ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s.id) ||
      s.id.length > 64 ||
      typeof s.name !== "string" ||
      s.name.trim().length === 0 ||
      s.name.length > 80 ||
      typeof s.story !== "string" ||
      s.story.trim().length === 0 ||
      s.story.length > 280 ||
      typeof s.goalStroops !== "string" ||
      !/^\d+$/.test(s.goalStroops) ||
      s.goalStroops.length > 39 ||
      BigInt(s.goalStroops) <= 0n ||
      BigInt(s.goalStroops) > BigInt(MAX_GOAL_STROOPS)
    )
      throw new Error(
        "Each student needs a slug id, a name (≤80), a story (≤280), and a positive goal within range.",
      );
    if (ids.has(s.id)) throw new Error(`Duplicate student id "${s.id}".`);
    ids.add(s.id);
  }
  return data.map((s) => ({
    id: (s as Student).id,
    name: (s as Student).name,
    story: (s as Student).story,
    goalStroops: (s as Student).goalStroops,
  }));
}

export async function listStudents(): Promise<Student[]> {
  try {
    const raw = await fs.readFile(storeFile(), "utf8");
    return parseStudents(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error instanceof SyntaxError
      ? new Error("Student directory is corrupt; restore data/students.json.")
      : error;
  }
}

/** Validates, then atomically replaces the student directory. */
export async function saveStudents(students: unknown): Promise<number> {
  const valid = parseStudents(students);
  const file = storeFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(valid, null, 2) + "\n", "utf8");
  await fs.rename(tmp, file);
  return valid.length;
}
