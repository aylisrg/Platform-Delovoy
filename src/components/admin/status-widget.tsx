"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type SubLink = {
  label: string;
  href: string;
  count?: number;
};

type StatusWidgetProps = {
  title: string;
  value: string | number;
  status?: "success" | "warning" | "danger" | "info";
  description?: string;
  href?: string;
  subLinks?: SubLink[];
};

export function StatusWidget({ title, value, status, description, href, subLinks }: StatusWidgetProps) {
  const inner = (
    <Card className={href ? "transition-shadow hover:shadow-md cursor-pointer" : undefined}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-zinc-500">{title}</span>
          {status && (
            <Badge variant={status}>
              {status === "success" ? "OK" : status === "warning" ? "Внимание" : status === "danger" ? "Ошибка" : "Инфо"}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold text-zinc-900">{value}</p>
        {description && (
          <p className="mt-1 text-sm text-zinc-500">{description}</p>
        )}
        {subLinks && subLinks.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-3">
            {subLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={(e) => e.stopPropagation()}
                className="text-xs text-blue-600 hover:underline"
              >
                {link.label}{link.count !== undefined ? ` (${link.count})` : ""}
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );

  if (href) {
    return <Link href={href} className="block">{inner}</Link>;
  }

  return inner;
}
