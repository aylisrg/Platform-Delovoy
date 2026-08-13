import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { TelegramProvider } from "@/components/webapp/TelegramProvider";
import { TabBar } from "@/components/webapp/TabBar";
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
  description: "Бизнес-парк «Деловой» — бронирования, кафе и уведомления",
};

/**
 * Вложенный layout Mini App — БЕЗ собственных <html>/<body> (ADR §8.3):
 * вложенные теги внутри корневого layout'а давали невалидную разметку и
 * гонку гидрации. SDK Telegram грузится обычным <script async> — позднее
 * появление window.Telegram.WebApp обрабатывает waitForWebApp().
 * Обёртку .webapp-root (с классом dark) рендерит TelegramProvider.
 */
export default function WebAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={inter.variable}>
      <script async src="https://telegram.org/js/telegram-web-app.js" />
      <TelegramProvider>
        <main className="webapp-content">{children}</main>
        <TabBar />
      </TelegramProvider>
    </div>
  );
}
