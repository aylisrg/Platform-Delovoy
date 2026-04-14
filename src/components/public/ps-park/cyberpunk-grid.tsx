"use client";

import { useEffect, useRef } from "react";

/**
 * Animated cyberpunk grid background.
 * Renders on a <canvas> for performance — no DOM nodes per cell.
 *
 * Effects:
 * - Base grid lines with subtle pulse
 * - Horizontal scan-line sweeping down
 * - Random cell "flickers" (neon glow bursts)
 * - Perspective warp toward bottom for depth
 */
export function CyberpunkGrid({ className = "" }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId: number;
    let w: number;
    let h: number;

    const CELL = 48;
    const SCAN_SPEED = 0.4; // px per frame
    const FLICKER_COUNT = 6;

    // Flicker state
    interface Flicker {
      x: number;
      y: number;
      life: number;
      maxLife: number;
      hue: number;
    }
    let flickers: Flicker[] = [];
    let scanY = 0;

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas!.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas!.width = w * dpr;
      canvas!.height = h * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function spawnFlicker() {
      const cols = Math.floor(w / CELL);
      const rows = Math.floor(h / CELL);
      flickers.push({
        x: Math.floor(Math.random() * cols) * CELL,
        y: Math.floor(Math.random() * rows) * CELL,
        life: 0,
        maxLife: 30 + Math.random() * 40,
        hue: Math.random() > 0.5 ? 270 : 220, // violet or blue
      });
    }

    function draw(time: number) {
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);

      const pulse = 0.03 + 0.015 * Math.sin(time * 0.001);

      // ─── Base grid lines ───
      ctx.lineWidth = 0.5;
      // Vertical lines
      for (let x = 0; x <= w; x += CELL) {
        const distFromCenter = Math.abs(x - w / 2) / (w / 2);
        const alpha = pulse * (1 - distFromCenter * 0.4);
        ctx.strokeStyle = `rgba(139, 92, 246, ${alpha})`;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      // Horizontal lines
      for (let y = 0; y <= h; y += CELL) {
        const distFromTop = y / h;
        const alpha = pulse * (0.6 + distFromTop * 0.6);
        ctx.strokeStyle = `rgba(139, 92, 246, ${alpha})`;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // ─── Scan line ───
      scanY = (scanY + SCAN_SPEED) % h;
      const scanGrad = ctx.createLinearGradient(0, scanY - 60, 0, scanY + 20);
      scanGrad.addColorStop(0, "rgba(139, 92, 246, 0)");
      scanGrad.addColorStop(0.4, "rgba(139, 92, 246, 0.06)");
      scanGrad.addColorStop(0.7, "rgba(139, 92, 246, 0.12)");
      scanGrad.addColorStop(1, "rgba(139, 92, 246, 0)");
      ctx.fillStyle = scanGrad;
      ctx.fillRect(0, scanY - 60, w, 80);

      // Bright scan line
      ctx.strokeStyle = "rgba(167, 139, 250, 0.15)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, scanY);
      ctx.lineTo(w, scanY);
      ctx.stroke();

      // ─── Cell flickers ───
      if (flickers.length < FLICKER_COUNT && Math.random() < 0.04) {
        spawnFlicker();
      }

      flickers = flickers.filter((f) => {
        f.life++;
        if (f.life > f.maxLife) return false;

        const progress = f.life / f.maxLife;
        const alpha = progress < 0.3 ? progress / 0.3 : 1 - (progress - 0.3) / 0.7;
        const glow = alpha * 0.12;

        // Outer glow
        ctx!.shadowColor = `hsla(${f.hue}, 80%, 60%, ${glow})`;
        ctx!.shadowBlur = 20;
        ctx!.fillStyle = `hsla(${f.hue}, 80%, 60%, ${glow * 0.5})`;
        ctx!.fillRect(f.x + 2, f.y + 2, CELL - 4, CELL - 4);

        // Border
        ctx!.shadowBlur = 0;
        ctx!.strokeStyle = `hsla(${f.hue}, 80%, 65%, ${alpha * 0.25})`;
        ctx!.lineWidth = 0.5;
        ctx!.strokeRect(f.x + 1, f.y + 1, CELL - 2, CELL - 2);

        return true;
      });

      // ─── Intersection dots ───
      const dotPulse = 0.3 + 0.15 * Math.sin(time * 0.002);
      ctx.fillStyle = `rgba(139, 92, 246, ${dotPulse * 0.15})`;
      for (let x = 0; x <= w; x += CELL) {
        for (let y = 0; y <= h; y += CELL) {
          // Only some intersections
          if ((x + y) % (CELL * 3) === 0) {
            ctx.beginPath();
            ctx.arc(x, y, 1.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      animationId = requestAnimationFrame(draw);
    }

    resize();
    window.addEventListener("resize", resize);
    animationId = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animationId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={`pointer-events-none ${className}`}
      style={{ width: "100%", height: "100%" }}
    />
  );
}
