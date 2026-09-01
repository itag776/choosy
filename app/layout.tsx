import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kept — Revenue recovery, governed",
  description: "Find revenue at risk, test the safest recovery, and win it back.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
