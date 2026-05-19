import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Деловой Парк",
    short_name: "Деловой",
    description:
      "Бизнес-парк в Селятино: аренда офисов, Барбекю Парк, Плей Парк, кафе.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#09090b",
    orientation: "portrait-primary",
    lang: "ru",
    categories: ["business", "lifestyle"],
    icons: [
      {
        src: "/favicon.ico",
        sizes: "any",
        type: "image/x-icon",
      },
      {
        src: "/icons/webapp-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/webapp-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/webapp-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/webapp-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
    shortcuts: [
      {
        name: "Барбекю Парк",
        short_name: "Беседки",
        description: "Онлайн-бронирование беседок с мангалом",
        url: "/gazebos",
      },
      {
        name: "Плей Парк",
        short_name: "PS5",
        description: "Аренда PlayStation 5 по часам",
        url: "/ps-park",
      },
      {
        name: "Кафе",
        short_name: "Кафе",
        description: "Меню и заказ с доставкой в офис",
        url: "/cafe",
      },
      {
        name: "Мессенджер",
        short_name: "Чаты",
        description: "Внутренние чаты и поддержка",
        url: "/webapp/messenger",
        icons: [{ src: "/icons/webapp-192.png", sizes: "192x192" }],
      },
    ],
  };
}
