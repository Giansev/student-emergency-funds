"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { browserRequest } from "@/lib/browser-api";

/**
 * Header user menu: shows the signed-in identity and hides view switching and
 * logout behind one disclosure so the header stays compact.
 */
export function UserMenu({
  username,
  role,
  view,
  onSwitchView,
}: {
  username: string;
  role: "donor" | "admin";
  view: "donate" | "admin";
  onSwitchView: (view: "donate" | "admin") => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function onPointerDown(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);
  return (
    <div className="user-menu" ref={ref}>
      <button
        type="button"
        className="user-menu-button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="avatar" aria-hidden="true">
          {username.slice(0, 1).toUpperCase()}
        </span>
        {username}
      </button>
      {open && (
        <div className="user-menu-items" role="menu">
          <p className="user-menu-role">
            Signed in as {username} · {role === "admin" ? "Administrator" : "Donor"}
          </p>
          {role === "admin" && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onSwitchView(view === "admin" ? "donate" : "admin");
              }}
            >
              {view === "admin" ? "Donate instead" : "Manage students"}
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() =>
              void browserRequest("/api/session", { action: "logout" })
                .catch(() => undefined)
                .finally(() => router.refresh())
            }
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
