import type { Metadata, Viewport } from "next";
import { Manrope, Inter } from "next/font/google";
import { SessionProvider } from "@/components/providers/session-provider";
import "./globals.css";

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
    "барбекю парк аренда",
    "Плей Парк",
    "кафе Селятино",
    "Деловой Парк",
    "бизнес центр Нарофоминск",
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
  verification: {
    yandex: "yandex-verification-placeholder",
    google: "google-verification-placeholder",
  },
  category: "business",
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
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
