import type { Metadata } from "next";
import { Barlow, Barlow_Condensed } from "next/font/google";
import "./globals.css";

const barlow = Barlow({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-barlow" });
const barlowCondensed = Barlow_Condensed({
  subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-barlow-condensed",
});

export const metadata: Metadata = {
  title: { default: "CORWADO e-Procurement", template: "%s · CORWADO" },
  description: "Requisitions, sourcing, purchasing, receipts and invoice matching with a full audit trail.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${barlow.variable} ${barlowCondensed.variable}`}>
      <body>{children}</body>
    </html>
  );
}
