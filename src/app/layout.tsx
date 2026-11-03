import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import "./globals.css";
import "./v2.css";

const montserrat = Montserrat({
  subsets: ["latin", "latin-ext"],
  variable: "--font-montserrat",
  weight: ["400", "500", "600", "700", "800", "900"],
});

export const metadata: Metadata = {
  title: "EESTEC LC Sarajevo Events",
  description: "Agende, ankete za ručak i feedback za EESTEC LC Sarajevo događaje.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="bs" className={montserrat.variable}>
      <body>{children}</body>
    </html>
  );
}
