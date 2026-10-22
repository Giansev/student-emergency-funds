import { saveStudents } from "@/lib/student-store";
import { sessionUser } from "@/lib/session";
import { handle, sameOrigin } from "@/lib/http";

function requireAdmin(request: Request) {
  const user = sessionUser(request);
  if (!user) throw new Error("Sign in required.");
  if (user.role !== "admin") throw new Error("Admin access required.");
  return user;
}

/** Admin-only replacement of the student directory. */
export async function PUT(request: Request) {
  return handle(async () => {
    sameOrigin(request);
    requireAdmin(request);
    const text = await request.text();
    if (text.length > 100000) throw new Error("Request too large.");
    const b: unknown = JSON.parse(text);
    if (!b || typeof b !== "object" || Array.isArray(b))
      throw new Error("Invalid request.");
    const v = b as Record<string, unknown>;
    if (Object.keys(v).length === 1 && Array.isArray(v.students))
      return { saved: await saveStudents(v.students) };
    throw new Error("Invalid request.");
  });
}
