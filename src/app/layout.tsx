import type { Metadata, Viewport } from "next";
import { Manrope, Inter } from "next/font/google";
import Script from "next/script";
import { SessionProvider } from "@/components/providers/session-provider";
import { StagingBanner } from "@/components/StagingBanner";
import "./globals.css";

const YM_ID = 73068007;

const manrope = Manrope({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-manrope",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin", "cyrillic"],
  variable: "--font-inter",
  display: "swap",
});

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://delovoy-park.ru";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
};

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: "Деловой Парк — Бизнес-парк в Селятино",
    template: "%s | Деловой Парк",
  },
  description:
    "Бизнес-парк Деловой в Селятино, Московская область. Аренда офисов от 15 м², Барбекю Парк с мангалом, Плей Парк, кафе с доставкой в офис. 300+ отзывов ★★★★★.",
  keywords: [
    "бизнес-парк Селятино",
    "аренда офисов Селятино",
    "офисы Московская область",
    "аренда офиса Нарофоминск",
    "барбекю парк аренда беседки",
    "беседки с мангалом аренда Селятино",
    "Плей Парк PS5 аренда",
    "PlayStation 5 Селятино",
    "кафе Селятино доставка в офис",
    "Деловой Парк",
    "бизнес центр Нарофоминск",
    "снять офис Москва область запад",
    "бизнес-парк Московская область",
  ],
  authors: [{ name: "Деловой Парк", url: APP_URL }],
  creator: "Деловой Парк",
  publisher: "Деловой Парк",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  alternates: {
    canonical: APP_URL,
  },
  openGraph: {
    type: "website",
    locale: "ru_RU",
    url: APP_URL,
    siteName: "Деловой Парк",
    title: "Деловой Парк — Бизнес-парк в Селятино",
    description:
      "Аренда офисов, Барбекю Парк с мангалом, Плей Парк, кафе. Бизнес-парк в Селятино, Московская область.",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Деловой Парк — Бизнес-парк в Селятино",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Деловой Парк — Бизнес-парк в Селятино",
    description:
      "Аренда офисов, Барбекю Парк с мангалом, Плей Парк, кафе. Селятино, Московская область.",
    images: ["/og-image.png"],
  },
  category: "business",
  other: {
    // GEO tags for local SEO (Selyatino, Moscow Oblast)
    "geo.region": "RU-MOS",
    "geo.placename": "Селятино, Московская область",
    "geo.position": "55.5167;36.9667",
    ICBM: "55.5167, 36.9667",
    // Yandex Metrika additional hints
    "yandex-tableau-widget": `logo=https://delovoy-park.ru/favicon.ico, color=#09090b`,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ru"
      className={`h-full antialiased ${manrope.variable} ${inter.variable}`}
    >
      <body className="min-h-full flex flex-col">
        <StagingBanner />
        <SessionProvider>
          {children}
        </SessionProvider>

        {/* Яндекс.Метрика */}
        <Script id="ym-init" strategy="afterInteractive">
          {`
            (function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
            m[i].l=1*new Date();
            for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}
            k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})
            (window, document, "script", "https://mc.yandex.ru/metrika/tag.js", "ym");
            ym(${YM_ID}, "init", {
              clickmap: true,
              trackLinks: true,
              accurateTrackBounce: true,
              webvisor: true,
              ecommerce: "dataLayer"
            });
          `}
        </Script>
        <noscript>
          <div>
            <img
              src={`https://mc.yandex.ru/watch/${YM_ID}`}
              style={{ position: "absolute", left: "-9999px" }}
              alt=""
            />
          </div>
        </noscript>
      </body>
    </html>
  );
}
