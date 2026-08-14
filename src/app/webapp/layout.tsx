import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { TelegramProvider } from "@/components/webapp/TelegramProvider";
import { TabBar } from "@/components/webapp/TabBar";
import "./webapp.css";

// #495: next/font/google скачивает шрифты во время `npm run build` — сбой
// доступа к Google Fonts валит прод-сборку целиком. Те же файлы, что в
// корневом layout (../fonts/), веса 400-700 покрывают весь используемый в
// webapp набор (font-medium/-semibold/-bold + обычный текст).
const inter = localFont({
  src: [
    { path: "../fonts/inter-400.woff2", weight: "400", style: "normal" },
    { path: "../fonts/inter-500.woff2", weight: "500", style: "normal" },
    { path: "../fonts/inter-600.woff2", weight: "600", style: "normal" },
    { path: "../fonts/inter-700.woff2", weight: "700", style: "normal" },
  ],
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
