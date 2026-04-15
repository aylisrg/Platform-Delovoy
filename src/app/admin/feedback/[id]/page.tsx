"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { AdminHeader } from "@/components/admin/header";
import Link from "next/link";

type FeedbackDetail = {
  id: string;
  type: "BUG" | "SUGGESTION";
  description: string;
  screenshotUrl: string | null;
  pageUrl: string;
  isUrgent: boolean;
  status: "NEW" | "IN_PROGRESS" | "RESOLVED" | "REJECTED";
  createdAt: string;
  updatedAt: string;
  user: { id: string; name: string | null; email: string | null };
  comments: Array<{
    id: string;
    text: string;
    authorName: string;
    createdAt: string;
  }>;
};

const STATUS_LABELS: Record<string, string> = {
  NEW: "Новое",
  IN_PROGRESS: "В работе",
  RESOLVED: "Выполнено",
  REJECTED: "Отклонено",
};

const STATUS_COLORS: Record<string, string> = {
  NEW: "bg-blue-100 text-blue-700 border-blue-200",
  IN_PROGRESS: "bg-yellow-100 text-yellow-700 border-yellow-200",
  RESOLVED: "bg-green-100 text-green-700 border-green-200",
  REJECTED: "bg-zinc-100 text-zinc-500 border-zinc-200",
};

const NEXT_STATUSES: Record<string, string[]> = {
  NEW: ["IN_PROGRESS", "REJECTED"],
  IN_PROGRESS: ["RESOLVED", "REJECTED"],
  RESOLVED: [],
  REJECTED: [],
};

export default function FeedbackDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [item, setItem] = useState<FeedbackDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [commentText, setCommentText] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);

  const fetchItem = useCallback(async () => {
    try {
      const res = await fetch(`/api/feedback/${id}`);
      const data = await res.json();
      if (data.success) setItem(data.data);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchItem();
  }, [fetchItem]);

  const handleStatusChange = async (newStatus: string) => {
    setChangingStatus(true);
    try {
      const res = await fetch(`/api/feedback/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (data.success) {
        setItem((prev) => prev ? { ...prev, status: newStatus as FeedbackDetail["status"] } : null);
      }
    } catch {
      // silent
    } finally {
      setChangingStatus(false);
    }
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim()) return;

    setSubmittingComment(true);
    try {
      const res = await fetch(`/api/feedback/${id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: commentText }),
      });
      const data = await res.json();
      if (data.success) {
        setItem((prev) =>
          prev ? { ...prev, comments: [...prev.comments, data.data] } : null
        );
        setCommentText("");
      }
    } catch {
      // silent
    } finally {
      setSubmittingComment(false);
    }
  };

  if (loading) {
    return (
      <>
        <AdminHeader title="Обращение" />
        <div className="flex items-center justify-center p-16">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
        </div>
      </>
    );
  }

  if (!item) {
    return (
      <>
        <AdminHeader title="Обращение" />
        <div className="p-8 text-center text-zinc-500">Обращение не найдено</div>
      </>
    );
  }

  const nextStatuses = NEXT_STATUSES[item.status] || [];

  return (
    <>
      <AdminHeader
        title="Обращение"
        actions={
          <Link
            href="/admin/feedback"
            className="text-sm text-zinc-500 hover:text-zinc-700"
          >
            &larr; К списку
          </Link>
        }
      />

      <div className="mx-auto max-w-3xl p-8 space-y-6">
        {/* Header */}
        <div className="rounded-xl border border-zinc-200 bg-white p-6 space-y-4">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <span className={`rounded px-2 py-0.5 text-xs font-medium ${
                item.type === "BUG" ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700"
              }`}>
                {item.type === "BUG" ? "Ошибка" : "Предложение"}
              </span>
              {item.isUrgent && (
                <span className="rounded bg-red-500 px-2 py-0.5 text-xs font-bold text-white">
                  СРОЧНО!
                </span>
              )}
              <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[item.status]}`}>
                {STATUS_LABELS[item.status]}
              </span>
            </div>
            <time className="text-sm text-zinc-400">
              {new Date(item.createdAt).toLocaleString("ru-RU")}
            </time>
          </div>

          {/* User info */}
          <div className="text-sm text-zinc-500">
            <strong className="text-zinc-700">{item.user.name || "Без имени"}</strong>
            {item.user.email && <span className="ml-2">{item.user.email}</span>}
            <span className="ml-3 text-zinc-400">Страница: {item.pageUrl}</span>
          </div>

          {/* Description */}
          <p className="whitespace-pre-wrap text-sm text-zinc-800 leading-relaxed">
            {item.description}
          </p>

          {/* Screenshot */}
          {item.screenshotUrl && (
            <div>
              <p className="mb-2 text-xs font-medium text-zinc-500">Скриншот:</p>
              <a href={item.screenshotUrl} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.screenshotUrl}
                  alt="Скриншот обращения"
                  className="max-h-80 rounded-lg border border-zinc-200 object-contain"
                />
              </a>
            </div>
          )}

          {/* Status actions */}
          {nextStatuses.length > 0 && (
            <div className="flex gap-2 pt-2 border-t border-zinc-100">
              {nextStatuses.map((status) => (
                <button
                  key={status}
                  onClick={() => handleStatusChange(status)}
                  disabled={changingStatus}
                  className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
                    status === "RESOLVED"
                      ? "bg-green-600 text-white hover:bg-green-700"
                      : status === "IN_PROGRESS"
                        ? "bg-yellow-500 text-white hover:bg-yellow-600"
                        : "bg-zinc-200 text-zinc-600 hover:bg-zinc-300"
                  }`}
                >
                  {STATUS_LABELS[status]}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Comments */}
        <div className="rounded-xl border border-zinc-200 bg-white p-6 space-y-4">
          <h3 className="text-sm font-semibold text-zinc-700">
            Комментарии ({item.comments.length})
          </h3>

          {item.comments.length === 0 && (
            <p className="text-sm text-zinc-400">Пока нет комментариев</p>
          )}

          {item.comments.map((comment) => (
            <div key={comment.id} className="rounded-lg bg-zinc-50 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-zinc-700">{comment.authorName}</span>
                <time className="text-xs text-zinc-400">
                  {new Date(comment.createdAt).toLocaleString("ru-RU")}
                </time>
              </div>
              <p className="whitespace-pre-wrap text-sm text-zinc-600">{comment.text}</p>
            </div>
          ))}

          {/* Add comment form */}
          <form onSubmit={handleAddComment} className="flex gap-2 pt-2 border-t border-zinc-100">
            <input
              type="text"
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="Ответ пользователю..."
              className="flex-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-blue-400 focus:outline-none"
              disabled={submittingComment}
            />
            <button
              type="submit"
              disabled={submittingComment || !commentText.trim()}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {submittingComment ? "..." : "Отправить"}
            </button>
          </form>
        </div>

        {/* Back */}
        <button
          onClick={() => router.push("/admin/feedback")}
          className="text-sm text-zinc-500 hover:text-zinc-700"
        >
          &larr; Вернуться к списку
        </button>
      </div>
    </>
  );
}
