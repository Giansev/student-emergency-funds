import { cookies } from "next/headers";
import { publicConfig } from "@/lib/paiflow";
import { listStudents } from "@/lib/student-store";
import { SESSION_COOKIE, verifyToken } from "@/lib/session";
import { StarterApp } from "@/components/starter-app";
import { LoginGate } from "@/components/login-gate";
import { AdminApp } from "@/components/admin-app";

export const dynamic = "force-dynamic";

export default async function Page() {
  const config = publicConfig();
  const jar = await cookies();
  const session = safeVerify(jar.get(SESSION_COOKIE)?.value);
  if (!session) return <LoginGate />;
  const students = await listStudents();
  if (session.role === "admin")
    return <AdminApp username={session.username} students={students} />;
  return (
    <StarterApp
      config={config}
      students={students}
      username={session.username}
    />
  );
}

function safeVerify(token: string | undefined) {
  try {
    return verifyToken(token);
  } catch {
    return null;
  }
}
