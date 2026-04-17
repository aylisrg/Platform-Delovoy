import { redirect } from "next/navigation";

export default function ClientsRedirect() {
  redirect("/admin/users?tab=clients");
}
