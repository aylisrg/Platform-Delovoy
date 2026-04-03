import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Деловой Парк — Платформа управления",
  description: "Бизнес-парк Деловой, Селятино — бронирование, кафе, аренда офисов",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
