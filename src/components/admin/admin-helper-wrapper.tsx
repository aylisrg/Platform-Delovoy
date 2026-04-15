"use client";

import { usePathname } from "next/navigation";
import { AdminHelper } from "./admin-helper";

export function AdminHelperWrapper() {
  const pathname = usePathname();
  // Extract section slug: /admin/gazebos/bookings -> "gazebos"
  const match = pathname.match(/^\/admin\/([^/]+)/);
  const slug = match?.[1] || "dashboard";

  return <AdminHelper sectionSlug={slug} />;
}
