import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "StarFace UZ",
  description: "Узнай на кого из знаменитостей ты похож",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
