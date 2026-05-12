"use client";

import { useState, useEffect } from "react";

const STORAGE_KEY = "vk_community_banner_dismissed";

interface Props {
  communityId: string;
}

/**
 * One-time banner prompting VK ID users to open the community dialog.
 * VK's messages.send API returns error 901 if the user hasn't started
 * a conversation with the community — this nudge activates that channel.
 *
 * Dismissed state is stored in localStorage so it shows only once.
 */
export function VkCommunityBanner({ communityId }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      const dismissed = localStorage.getItem(STORAGE_KEY);
      if (!dismissed) setVisible(true);
    } catch {
      // localStorage unavailable (SSR guard) — skip banner
    }
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // ignore
    }
    setVisible(false);
  }

  if (!visible) return null;

  const deepLink = `https://vk.com/im?sel=-${communityId}`;

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded-2xl border border-zinc-700 bg-zinc-900 p-4 shadow-lg">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#0077FF]">
          <VkIcon />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-white">Подпишитесь на уведомления</p>
          <p className="mt-1 text-xs text-zinc-400">
            Откройте наше сообщество ВКонтакте, чтобы мы могли присылать вам уведомления о бронировании.
          </p>
          <div className="mt-3 flex gap-2">
            <a
              href={deepLink}
              target="_blank"
              rel="noopener noreferrer"
              onClick={dismiss}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0077FF] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#0066DD] transition-colors"
            >
              Открыть VK
            </a>
            <button
              onClick={dismiss}
              className="rounded-lg px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Не сейчас
            </button>
          </div>
        </div>
        <button
          onClick={dismiss}
          aria-label="Закрыть"
          className="shrink-0 text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function VkIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M12.6 16.5H11.3C11.3 16.5 8 16.6 5.1 13.6C2 10.4 2.2 7.5 2.2 7.5H5.5C5.5 7.5 5.6 9.7 7.5 11.7C7.9 12.1 8.3 12.4 8.6 12.7V7.5H11.7V11.9C12.2 11.7 12.8 11.1 13.3 10C13.8 9 13.9 7.5 13.9 7.5H17C17 7.5 16.9 9.4 15.9 11C15.5 11.7 14.9 12.4 14.2 12.9L17.8 16.5H14.3L12.1 14.2L12.6 16.5Z"
        fill="white"
      />
    </svg>
  );
}
