import type { Metadata } from "next";
import { Sidebar } from "@/components/admin/sidebar";
import { MobileTopBar } from "@/components/admin/mobile-top-bar";
import { VersionFooter } from "@/components/admin/version-footer";
import { FeedbackButton } from "@/components/public/feedback-button";
import { AdminHelperWrapper } from "@/components/admin/admin-helper-wrapper";
import { AdminThemeProvider } from "@/components/admin/theme-provider";

// PWA: manifest подключается ТОЛЬКО для /admin/* — публичный сайт остаётся
// классическим веб-сайтом, не PWA. См. ADR §Service Worker и PWA, §scope.
//
// `apple-mobile-web-app-capable` — для iOS, чтобы при «Add to Home Screen»
// сайт открывался без Safari-хрома и Push API стал доступен.
export const metadata: Metadata = {
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "Деловой Админ",
    statusBarStyle: "black-translucent",
  },
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AdminThemeProvider>
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <MobileTopBar />
        <main className="flex-1 overflow-auto bg-zinc-50 flex flex-col">
          <div className="flex-1">{children}</div>
          <VersionFooter />
        </main>
      </div>
      <FeedbackButton />
      <AdminHelperWrapper />
    </AdminThemeProvider>
  );
}
