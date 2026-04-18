import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Деловой Парк — Бизнес-парк в Селятино";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "linear-gradient(135deg, #09090b 0%, #18181b 60%, #1c1917 100%)",
          padding: "72px 80px",
          fontFamily: "sans-serif",
        }}
      >
        {/* Top accent line */}
        <div
          style={{
            width: 64,
            height: 4,
            background: "#0099ff",
            borderRadius: 2,
          }}
        />

        {/* Main content */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div
            style={{
              fontSize: 72,
              fontWeight: 800,
              color: "#ffffff",
              lineHeight: 1.05,
              letterSpacing: "-2px",
            }}
          >
            Деловой Парк
          </div>
          <div
            style={{
              fontSize: 28,
              color: "#a1a1aa",
              fontWeight: 400,
              lineHeight: 1.4,
            }}
          >
            Бизнес-парк в Селятино, Московская область
          </div>

          {/* Services pills */}
          <div style={{ display: "flex", gap: 16, marginTop: 8, flexWrap: "wrap" }}>
            {["Аренда офисов", "Барбекю Парк", "Плей Парк", "Кафе"].map((s) => (
              <div
                key={s}
                style={{
                  background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: 100,
                  padding: "8px 20px",
                  fontSize: 20,
                  color: "#e4e4e7",
                  fontWeight: 500,
                }}
              >
                {s}
              </div>
            ))}
          </div>
        </div>

        {/* Bottom: domain + rating */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ fontSize: 22, color: "#52525b", fontWeight: 500 }}>
            delovoy-park.ru
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "rgba(255,255,255,0.06)",
              borderRadius: 100,
              padding: "8px 20px",
            }}
          >
            <div style={{ fontSize: 20, color: "#fbbf24" }}>★★★★★</div>
            <div style={{ fontSize: 18, color: "#a1a1aa" }}>300+ отзывов</div>
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
