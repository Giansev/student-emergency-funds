"use client";
import { useState } from "react";
import type { PublicConfig, Student } from "@/lib/types";
import { StarterApp } from "@/components/starter-app";
import { AdminApp } from "@/components/admin-app";

/** Signed-in shell: donors go straight to the app; admins can switch views. */
export function SignedInApp({
  username,
  role,
  students,
  config,
}: {
  username: string;
  role: "donor" | "admin";
  students: Student[];
  config: PublicConfig;
}) {
  const [view, setView] = useState<"donate" | "admin">(
    role === "admin" ? "admin" : "donate",
  );
  if (view === "admin" && role === "admin")
    return (
      <AdminApp
        username={username}
        students={students}
        view={view}
        onSwitchView={setView}
      />
    );
  return (
    <StarterApp
      config={config}
      students={students}
      username={username}
      role={role}
      view={view}
      onSwitchView={setView}
    />
  );
}
