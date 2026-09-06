import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HackerBlocks Browser",
  description: "A fast browser for collected HackerBlocks contests and questions.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
