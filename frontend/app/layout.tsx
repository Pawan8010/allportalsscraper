import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "RRP Groups",
  description: "RRP Groups GeM tender scraper, PostgreSQL storage, and live search",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
