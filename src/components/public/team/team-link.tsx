import Link from "next/link";
import { isTeamRole } from "@/lib/team-services";

/**
 * Ссылка «For team» на /for-team. Видна только сотрудникам — тем же ролям,
 * что пускает сама страница /for-team (#1090). Гостям и клиентам не рендерится.
 */
export function TeamLink({
  role,
  className,
}: {
  role: string | null | undefined;
  className?: string;
}) {
  if (!isTeamRole(role)) return null;
  return (
    <Link href="/for-team" className={className}>
      For team
    </Link>
  );
}
