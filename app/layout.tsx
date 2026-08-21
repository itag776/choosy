import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RecoverOS — Canary Commander",
  description: "Governed, evidence-led recovery for payment incidents.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
