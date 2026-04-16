import { Sidebar } from "@/components/admin/sidebar";
import { MobileTopBar } from "@/components/admin/mobile-top-bar";
import { FeedbackButton } from "@/components/public/feedback-button";
import { AdminHelperWrapper } from "@/components/admin/admin-helper-wrapper";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-[100dvh] lg:h-screen">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <MobileTopBar />
        <main className="flex-1 overflow-auto bg-zinc-50">{children}</main>
      </div>
      <FeedbackButton />
      <AdminHelperWrapper />
    </div>
  );
}
