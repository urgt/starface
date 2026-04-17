import type { Metadata } from "next";
import { Inter, Manrope, Space_Grotesk, Unbounded } from "next/font/google";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin", "cyrillic"],
  variable: "--font-manrope",
  display: "swap",
});
const inter = Inter({
  subsets: ["latin", "cyrillic"],
  variable: "--font-inter",
  display: "swap",
});
const unbounded = Unbounded({
  subsets: ["latin", "cyrillic"],
  variable: "--font-unbounded",
  display: "swap",
  weight: ["400", "500", "700", "800", "900"],
});
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
});

export const metadata: Metadata = {
  title: "StarFace UZ",
  description: "Узнай на кого из знаменитостей ты похож",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const fontVars = `${manrope.variable} ${inter.variable} ${unbounded.variable} ${spaceGrotesk.variable}`;
  return (
    <html lang="ru" className={fontVars}>
      <body>{children}</body>
    </html>
  );
}
