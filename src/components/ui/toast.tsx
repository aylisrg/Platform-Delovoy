"use client";

import { motion, AnimatePresence } from "framer-motion";
import { slideInFromTop } from "@/lib/animations";
import { useEffect } from "react";

export interface ToastProps {
  message: string;
  type: "success" | "error";
  isVisible: boolean;
  onClose: () => void;
  autoHideDuration?: number;
}

export function Toast({
  message,
  type,
  isVisible,
  onClose,
  autoHideDuration = 4000,
}: ToastProps) {
  useEffect(() => {
    if (isVisible && autoHideDuration > 0) {
      const timer = setTimeout(() => {
        onClose();
      }, autoHideDuration);

      return () => clearTimeout(timer);
    }
  }, [isVisible, autoHideDuration, onClose]);

  const bgColor = type === "success" ? "bg-green-500" : "bg-red-500";
  const icon = type === "success" ? "✓" : "✕";

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          className="fixed top-4 right-4 z-[9999] pointer-events-auto"
          variants={slideInFromTop}
          initial="initial"
          animate="animate"
          exit="exit"
        >
          <div
            className={`${bgColor} text-white px-6 py-4 rounded-xl shadow-2xl flex items-center gap-3 min-w-[280px]`}
          >
            <div className="flex-shrink-0 w-6 h-6 bg-white/20 rounded-full flex items-center justify-center font-bold">
              {icon}
            </div>
            <p className="font-[family-name:var(--font-inter)] font-medium text-sm flex-1">
              {message}
            </p>
            <button
              onClick={onClose}
              className="flex-shrink-0 text-white/70 hover:text-white transition-colors"
              aria-label="Закрыть"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
