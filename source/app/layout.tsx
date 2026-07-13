import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "水墨 — 水に、墨をほどく。",
  description:
    "黒・朱・緑・蒼の墨が水面で滲み、混ざり、流れる。手描きと自動墨流しを楽しむインタラクティブな水墨実験室。",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f2f0e8",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
