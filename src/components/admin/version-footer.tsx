import { version } from "@/version";

export function VersionFooter() {
  return (
    <div className="flex items-center justify-center gap-2 border-t border-zinc-200 bg-zinc-50 py-3 px-4 text-xs text-zinc-400">
      <span>Деловой Парк</span>
      <span>•</span>
      <span>v{version}</span>
    </div>
  );
}
