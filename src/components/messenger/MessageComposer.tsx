"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type SentMessage = {
  id: string;
  body: string;
  senderUserId: string;
  senderName: string | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  clientId: string | null;
};

type Props = {
  chatId: string;
  onMessageSent: (msg: SentMessage) => void;
  disabled?: boolean;
  editingMessage?: { id: string; body: string } | null;
  onCancelEdit?: () => void;
};

type CreateResponse =
  | { success: true; data: { message: SentMessage } }
  | { success: false; error: { code: string; message: string } };

type EditResponse =
  | { success: true; data: { message: SentMessage } }
  | { success: false; error: { code: string; message: string } };

const TYPING_THROTTLE_MS = 3000;
const MAX_ROWS = 5;
const LINE_HEIGHT_PX = 20;

function generateClientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `c-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function MessageComposer(props: Props): ReactNode {
  const { chatId, onMessageSent, disabled, editingMessage, onCancelEdit } = props;
  const [body, setBody] = useState<string>("");
  const [sending, setSending] = useState<boolean>(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lastTypingAtRef = useRef<number>(0);

  useEffect(() => {
    if (editingMessage) {
      setBody(editingMessage.body);
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          autosize(textareaRef.current);
        }
      });
    }
  }, [editingMessage]);

  const autosize = (el: HTMLTextAreaElement): void => {
    el.style.height = "auto";
    const maxHeight = LINE_HEIGHT_PX * MAX_ROWS + 16;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  };

  const sendTyping = (): void => {
    const now = Date.now();
    if (now - lastTypingAtRef.current < TYPING_THROTTLE_MS) return;
    lastTypingAtRef.current = now;
    void fetch(`/api/messenger/chats/${chatId}/typing`, {
      method: "POST",
      credentials: "include",
    }).catch(() => {
      // swallow typing errors
    });
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    setBody(e.target.value);
    autosize(e.target);
    if (e.target.value.length > 0) sendTyping();
  };

  const enqueueOffline = async (text: string, clientId: string): Promise<void> => {
    try {
      const mod = (await import("@/lib/webapp/chat-outbox")) as typeof import("@/lib/webapp/chat-outbox");
      await mod.enqueueMessage(chatId, text);
    } catch {
      // outbox not available — drop silently
    }
    onMessageSent({
      id: `local-${clientId}`,
      body: text,
      senderUserId: "self",
      senderName: null,
      createdAt: new Date().toISOString(),
      editedAt: null,
      deletedAt: null,
      clientId,
    });
  };

  const submitEdit = async (text: string): Promise<void> => {
    if (!editingMessage) return;
    setSending(true);
    try {
      const res = await fetch(`/api/messenger/chats/${chatId}/messages/${editingMessage.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ body: text }),
      });
      const json = (await res.json()) as EditResponse;
      if (json.success) {
        onMessageSent(json.data.message);
        setBody("");
        if (textareaRef.current) {
          textareaRef.current.style.height = "auto";
        }
        if (onCancelEdit) onCancelEdit();
      }
    } catch {
      // network error — leave body intact
    } finally {
      setSending(false);
    }
  };

  const submitNew = async (text: string): Promise<void> => {
    const clientId = generateClientId();
    const now = new Date().toISOString();

    onMessageSent({
      id: `temp-${clientId}`,
      body: text,
      senderUserId: "self",
      senderName: null,
      createdAt: now,
      editedAt: null,
      deletedAt: null,
      clientId,
    });

    setBody("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      await enqueueOffline(text, clientId);
      return;
    }

    setSending(true);
    try {
      const res = await fetch(`/api/messenger/chats/${chatId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": clientId,
        },
        credentials: "include",
        body: JSON.stringify({ body: text, clientId }),
      });
      const json = (await res.json()) as CreateResponse;
      if (json.success) {
        onMessageSent(json.data.message);
      } else {
        await enqueueOffline(text, clientId);
      }
    } catch {
      await enqueueOffline(text, clientId);
    } finally {
      setSending(false);
    }
  };

  const handleSend = (): void => {
    const text = body.trim();
    if (!text || sending || disabled) return;
    if (editingMessage) {
      void submitEdit(text);
    } else {
      void submitNew(text);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const canSend = body.trim().length > 0 && !sending && !disabled;

  return (
    <div className="border-t border-border bg-background p-2">
      {editingMessage && (
        <div className="mb-1 flex items-center justify-between rounded bg-muted px-2 py-1 text-xs">
          <span className="truncate text-muted-foreground">
            Редактирование: {editingMessage.body}
          </span>
          <button
            type="button"
            className="ml-2 text-muted-foreground hover:text-foreground"
            onClick={() => {
              setBody("");
              if (textareaRef.current) textareaRef.current.style.height = "auto";
              if (onCancelEdit) onCancelEdit();
            }}
          >
            Отмена
          </button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={body}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          rows={1}
          placeholder="Сообщение"
          className="flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!canSend}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-40"
        >
          {editingMessage ? "Сохранить" : "Отправить"}
        </button>
      </div>
    </div>
  );
}
