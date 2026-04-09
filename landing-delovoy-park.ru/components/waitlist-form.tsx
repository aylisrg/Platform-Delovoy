"use client";

import { useState } from "react";

export function WaitlistForm() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");

    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone }),
      });

      if (res.ok) {
        setStatus("success");
        setName("");
        setPhone("");
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <div className="text-center py-8">
        <div className="text-[#0099ff] text-3xl mb-3">✓</div>
        <p className="text-white font-[family-name:var(--font-manrope)] font-medium text-lg">
          Заявка принята
        </p>
        <p className="text-[#a6a6a6] text-sm font-[family-name:var(--font-inter)] mt-2">
          Мы свяжемся с вами, как только появится свободный офис
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <input
        type="text"
        placeholder="Ваше имя"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        minLength={2}
        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 text-sm font-[family-name:var(--font-inter)] focus:outline-none focus:border-[#0099ff] transition-colors"
      />
      <input
        type="tel"
        placeholder="Телефон"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        required
        minLength={7}
        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 text-sm font-[family-name:var(--font-inter)] focus:outline-none focus:border-[#0099ff] transition-colors"
      />
      <button
        type="submit"
        disabled={status === "loading"}
        className="w-full bg-white text-black font-medium text-sm py-3 rounded-full hover:bg-white/90 transition-all disabled:opacity-50 font-[family-name:var(--font-inter)]"
      >
        {status === "loading" ? "Отправка..." : "Записаться в лист ожидания"}
      </button>
      {status === "error" && (
        <p className="text-red-400 text-xs text-center font-[family-name:var(--font-inter)]">
          Что-то пошло не так. Попробуйте ещё раз или напишите нам в Telegram.
        </p>
      )}
    </form>
  );
}
