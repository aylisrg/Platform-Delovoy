"use client";

import type { ReactNode } from "react";

type Props = {
  typingUsers: Array<{ userId: string; userName: string | null }>;
};

function nameOf(u: { userName: string | null }): string {
  return u.userName?.trim() || "Кто-то";
}

export function TypingIndicator({ typingUsers }: Props): ReactNode {
  if (typingUsers.length === 0) return null;

  let label: string;
  if (typingUsers.length === 1) {
    label = `${nameOf(typingUsers[0]!)} печатает`;
  } else if (typingUsers.length === 2) {
    label = `${nameOf(typingUsers[0]!)} и ${nameOf(typingUsers[1]!)} печатают`;
  } else {
    label = "Несколько человек печатают";
  }

  return (
    <div
      className="flex items-center gap-2 px-4 py-1 text-xs text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      <span>{label}</span>
      <span className="inline-flex items-end gap-0.5" aria-hidden="true">
        <span
          className="inline-block h-1 w-1 animate-bounce rounded-full bg-current"
          style={{ animationDelay: "0ms" }}
        />
        <span
          className="inline-block h-1 w-1 animate-bounce rounded-full bg-current"
          style={{ animationDelay: "150ms" }}
        />
        <span
          className="inline-block h-1 w-1 animate-bounce rounded-full bg-current"
          style={{ animationDelay: "300ms" }}
        />
      </span>
    </div>
  );
}
