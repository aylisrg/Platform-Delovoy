import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Inter } from "next/font/google";
import { TelegramProvider } from "@/components/webapp/TelegramProvider";
import { TabBar } from "@/components/webapp/TabBar";
import "../globals.css";
import "./webapp.css";

const inter = Inter({
  subsets: ["latin", "cyrillic"],
  variable: "--font-inter",
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "Деловой Парк",
  description: "Бронируйте беседки и столы в Плей Парке",
};

export default function WebAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru" className={inter.variable}>
      {/* Telegram WebApp SDK — must load before React hydration */}
      <Script
        src="https://telegram.org/js/telegram-web-app.js"
        strategy="beforeInteractive"
      />
      <body className="webapp-root">
        <TelegramProvider>
          <main className="webapp-content">{children}</main>
          <TabBar />
        </TelegramProvider>
      </body>
    </html>
  );
}
