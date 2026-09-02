import type { Metadata } from "next";
import "./globals.css";
import "./choosy.css";

export const metadata: Metadata = {
  title: "Choosy — Shopping that listens",
  description: "A bounded conversational buying agent with transparent recommendations and Razorpay Test Mode checkout.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
