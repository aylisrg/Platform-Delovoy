import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { GazeboList, GazeboNumberLinks } from "@/components/public/gazebos/gazebo-list";
import { BookingFlow } from "@/components/public/gazebos/booking-flow";
import { StickyBookingCta } from "@/components/public/gazebos/booking-cta";
import { Navbar } from "@landing/components/navbar";
import type { GazeboResource } from "@/modules/gazebos/types";
import { resources } from "./data";
import styles from "@/components/public/gazebos/gazebos.module.css";
import "@/app/globals.css";
import "./fixture.css";

const bookingEnabled = !new URLSearchParams(location.search).has("disabled");
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div className={styles.page}>
      <Navbar collapseAt="xl" action={{ href: bookingEnabled ? "#booking" : "#gazebo-help", label: bookingEnabled ? "Забронировать" : "Помочь с выбором" }} />
      <main>
        <div className={`${styles.container} ${styles.intro}`}>
          <p role="status">ТЕСТОВЫЙ СТЕНД — без настоящих фото и данных</p>
          <h1 className={styles.title}>Барбекю Парк</h1>
          <p className={styles.tagline}>Своя беседка. Своя компания.</p>
          <p className={styles.introText}>Проверка компонентов. Эта страница не является релизом.</p>
        </div>
        <section className={`${styles.container} ${styles.selection}`}>
          <div className={styles.selectionBar}>
            <GazeboNumberLinks resources={resources as unknown as GazeboResource[]} />
            <p className={styles.hours}>Минимум 4 ч</p>
          </div>
          <GazeboList resources={resources as unknown as GazeboResource[]} bookingEnabled={bookingEnabled}>
            <aside className={styles.help} id="gazebo-help"><h2>Нужна помощь с выбором?</h2><p>Тестовые данные, без отправки сообщений.</p></aside>
          </GazeboList>
        </section>
        <section id="booking" className={styles.bookingSection}>
          <div className={styles.container}><div className={styles.bookingInner}>
            {bookingEnabled ? <BookingFlow /> : <p>Онлайн-бронирование временно недоступно</p>}
          </div></div>
        </section>
      </main>
      <footer style={{ padding: "80px 24px 120px" }}>Тестовый стенд — не для публикации</footer>
      {bookingEnabled && <StickyBookingCta />}
    </div>
  </StrictMode>,
);
