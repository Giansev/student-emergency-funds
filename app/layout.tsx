import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "StellarAid",
  description: "StellarAid — student donations split 90/10 via a Paiflow flow",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
