/** The student organization receiving the 10% share of every donation. */
export const ORGANIZATION = {
  name: "Campus Care Student Organization",
  shareBps: 1000n,
} as const;

/**
 * NOTE: the student directory lives in data/students.json and is served via
 * lib/student-store.ts so admins can curate it. This module only holds the
 * static organization facts safe for client components.
 */
