"use client";

import { useEffect } from "react";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    console.error("[Global Error]", error);
  }, [error]);

  return (
    <html lang="ru">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          background: "#000",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "sans-serif",
          textAlign: "center",
          padding: "24px",
        }}
      >
        <p style={{ color: "#ef4444", letterSpacing: "0.2em", fontSize: "14px", textTransform: "uppercase", marginBottom: "16px" }}>
          Критическая ошибка
        </p>
        <h1 style={{ color: "#fff", fontSize: "clamp(2rem, 5vw, 4rem)", fontWeight: 700, margin: "0 0 24px" }}>
          Приложение недоступно
        </h1>
        <p style={{ color: "#a1a1aa", fontSize: "18px", maxWidth: "420px", marginBottom: "40px" }}>
          Произошла критическая ошибка. Пожалуйста, обновите страницу.
        </p>
        <button
          onClick={reset}
          style={{
            background: "#0099ff",
            color: "#fff",
            border: "none",
            padding: "12px 32px",
            borderRadius: "999px",
            fontSize: "16px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Перезагрузить
        </button>
      </body>
    </html>
  );
}
