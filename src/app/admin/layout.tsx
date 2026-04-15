import { Sidebar } from "@/components/admin/sidebar";
import { FeedbackButton } from "@/components/public/feedback-button";
import { AdminHelperWrapper } from "@/components/admin/admin-helper-wrapper";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto bg-zinc-50">{children}</main>
      <FeedbackButton />
      <AdminHelperWrapper />
    </div>
  );
}
