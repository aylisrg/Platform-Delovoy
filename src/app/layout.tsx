import type { Metadata } from "next";
import { Manrope, Inter } from "next/font/google";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-manrope",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin", "cyrillic"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Деловой Парк — Бизнес-парк в Селятино",
  description:
    "Бизнес-парк Деловой в Селятино, Московская область. 300+ отзывов ★★★★★ на Яндекс Картах. Аренда офисов, беседки, PS Park, кафе.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ru"
      className={`h-full antialiased ${manrope.variable} ${inter.variable}`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
