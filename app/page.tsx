import { cookies } from "next/headers";
import { publicConfig } from "@/lib/paiflow";
import { listStudents } from "@/lib/student-store";
import { SESSION_COOKIE, verifyToken } from "@/lib/session";
import { SignedInApp } from "@/components/signed-in-app";
import { LoginGate } from "@/components/login-gate";

export const dynamic = "force-dynamic";

export default async function Page() {
  const config = publicConfig();
  const jar = await cookies();
  const session = safeVerify(jar.get(SESSION_COOKIE)?.value);
  if (!session) return <LoginGate />;
  const students = await listStudents();
  return (
    <SignedInApp
      username={session.username}
      role={session.role}
      students={students}
      config={config}
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
