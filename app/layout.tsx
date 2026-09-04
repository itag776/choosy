import type { Metadata } from "next";
import "./globals.css";
import "./choosy.css";
import "./shopper-modern.css";
import "./proof.css";
import "./api-page.css";

export const metadata: Metadata = {
  title: "Choosy — Shopping that listens",
  description: "A simpler way to find products that fit your budget and priorities.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
