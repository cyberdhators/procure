import type { Metadata } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["600", "700", "800"], variable: "--font-jakarta" });

export const metadata: Metadata = {
  title: { default: "Cyber Procurement", template: "%s · C-Procurement" },
  description: "Cyber Procurement (C-Procurement): requisitions, sourcing, purchasing, receipts and invoice matching with a full audit trail. Developed by cyberdhators.",
  applicationName: "C-Procurement",
  authors: [{ name: "cyberdhators" }],
  creator: "cyberdhators",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jakarta.variable}`}>
      <body>
        {children}
        <div className="watermark" aria-label="Developed by cyberdhators">
          Cyber Procurement · Developed by <strong>cyberdhators</strong>
        </div>
      </body>
    </html>
  );
}
