"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Tab = {
  label: string;
  href: string;
  badge?: number;
};

type ModuleTabsProps = {
  tabs: Tab[];
};

export function ModuleTabs({ tabs }: ModuleTabsProps) {
  const pathname = usePathname();

  function isActive(href: string) {
    // Exact match for the base path, startsWith for sub-paths
    return pathname === href;
  }

  return (
    <div className="border-b border-zinc-200 mb-6">
      <nav className="flex gap-1 -mb-px overflow-x-auto">
        {tabs.map((tab) => {
          const active = isActive(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                active
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-zinc-500 hover:text-zinc-700 hover:border-zinc-300"
              }`}
            >
              {tab.label}
              {tab.badge !== undefined && tab.badge > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-red-100 text-red-700 text-xs font-medium min-w-[18px] h-[18px] px-1">
                  {tab.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
