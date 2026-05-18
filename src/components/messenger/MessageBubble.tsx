"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type Props = {
  message: {
    id: string;
    body: string;
    senderUserId: string;
    senderName: string | null;
    createdAt: string;
    editedAt: string | null;
    deletedAt: string | null;
    clientId: string | null;
  };
  isMine: boolean;
  showAvatar: boolean;
  readByAll: boolean;
  deliveredToAll: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
};

const EDIT_WINDOW_MS = 15 * 60 * 1000;
const URL_REGEX = /(https?:\/\/\S+)/g;

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function initials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 1).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

const GRADIENTS = [
  "from-rose-400 to-pink-600",
  "from-amber-400 to-orange-600",
  "from-emerald-400 to-teal-600",
  "from-sky-400 to-blue-600",
  "from-violet-400 to-purple-600",
  "from-fuchsia-400 to-pink-600",
  "from-lime-400 to-green-600",
  "from-cyan-400 to-sky-600",
];

function gradientFor(userId: string): string {
  return GRADIENTS[hashString(userId) % GRADIENTS.length]!;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function renderBody(body: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  URL_REGEX.lastIndex = 0;
  let key = 0;
  while ((match = URL_REGEX.exec(body)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(<span key={`t-${key++}`}>{body.slice(lastIndex, match.index)}</span>);
    }
    const url = match[0];
    nodes.push(
      <a
        key={`l-${key++}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="underline break-all"
      >
        {url}
      </a>,
    );
    lastIndex = match.index + url.length;
  }
  if (lastIndex < body.length) {
    nodes.push(<span key={`t-${key++}`}>{body.slice(lastIndex)}</span>);
  }
  return nodes;
}

function ReadIndicator({ delivered, read }: { delivered: boolean; read: boolean }): ReactNode {
  if (read) {
    return (
      <span className="ml-1 text-blue-300" aria-label="прочитано">
        ✓✓
      </span>
    );
  }
  if (delivered) {
    return (
      <span className="ml-1 opacity-70" aria-label="доставлено">
        ✓✓
      </span>
    );
  }
  return (
    <span className="ml-1 opacity-70" aria-label="отправлено">
      ✓
    </span>
  );
}

export function MessageBubble(props: Props): ReactNode {
  const { message, isMine, showAvatar, readByAll, deliveredToAll, onEdit, onDelete } = props;
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isDeleted = message.deletedAt !== null;
  const isEdited = message.editedAt !== null && !isDeleted;
  const canEdit = isMine && !isDeleted && Date.now() - Date.parse(message.createdAt) < EDIT_WINDOW_MS;

  useEffect(() => {
    if (menuPos === null) return;
    const handler = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuPos(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuPos]);

  const openMenu = (x: number, y: number): void => {
    if (!isMine || isDeleted) return;
    setMenuPos({ x, y });
  };

  const handleContextMenu = (e: React.MouseEvent): void => {
    if (!isMine || isDeleted) return;
    e.preventDefault();
    openMenu(e.clientX, e.clientY);
  };

  const handleTouchStart = (e: React.TouchEvent): void => {
    if (!isMine || isDeleted) return;
    const t = e.touches[0];
    if (!t) return;
    const x = t.clientX;
    const y = t.clientY;
    longPressTimer.current = setTimeout(() => openMenu(x, y), 500);
  };

  const cancelLongPress = (): void => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const alignClass = isMine ? "justify-end" : "justify-start";
  const bubbleColor = isMine
    ? "bg-primary text-primary-foreground rounded-br-sm"
    : "bg-muted text-foreground rounded-bl-sm";

  return (
    <div className={`flex w-full ${alignClass} gap-2 px-2`}>
      {!isMine && (
        <div className="w-8 shrink-0">
          {showAvatar && (
            <div
              className={`h-8 w-8 rounded-full bg-gradient-to-br ${gradientFor(message.senderUserId)} flex items-center justify-center text-xs font-medium text-white`}
              aria-hidden="true"
            >
              {initials(message.senderName)}
            </div>
          )}
        </div>
      )}
      <div
        className={`relative max-w-[75%] rounded-2xl px-3 py-2 ${bubbleColor} ${isDeleted ? "italic opacity-60" : ""}`}
        onContextMenu={handleContextMenu}
        onTouchStart={handleTouchStart}
        onTouchEnd={cancelLongPress}
        onTouchMove={cancelLongPress}
        onTouchCancel={cancelLongPress}
      >
        {!isMine && showAvatar && message.senderName && (
          <div className="mb-0.5 text-xs font-medium opacity-80">{message.senderName}</div>
        )}
        <div className="whitespace-pre-wrap break-words text-sm">
          {isDeleted ? "Сообщение удалено" : renderBody(message.body)}
        </div>
        <div className="mt-1 flex items-center justify-end text-xs opacity-70">
          {isEdited && <span className="mr-1">изм.</span>}
          <span>{formatTime(message.createdAt)}</span>
          {isMine && !isDeleted && (
            <ReadIndicator delivered={deliveredToAll} read={readByAll} />
          )}
        </div>
        {menuPos !== null && (
          <div
            ref={menuRef}
            style={{ position: "fixed", left: menuPos.x, top: menuPos.y }}
            className="z-50 min-w-[140px] rounded-md border border-border bg-popover py-1 text-sm text-popover-foreground shadow-lg"
            role="menu"
          >
            {canEdit && onEdit && (
              <button
                type="button"
                className="block w-full px-3 py-1.5 text-left hover:bg-muted"
                onClick={() => {
                  setMenuPos(null);
                  onEdit();
                }}
              >
                Редактировать
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                className="block w-full px-3 py-1.5 text-left text-red-500 hover:bg-muted"
                onClick={() => {
                  setMenuPos(null);
                  onDelete();
                }}
              >
                Удалить
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
