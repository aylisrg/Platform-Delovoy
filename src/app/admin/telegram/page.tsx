import { redirect } from "next/navigation";

export default function TelegramRedirect() {
  redirect("/admin/monitoring");
}
