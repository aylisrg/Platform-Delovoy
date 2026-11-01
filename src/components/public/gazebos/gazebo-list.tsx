import type { ReactNode } from "react";
import Link from "next/link";
import type { GazeboResource } from "@/modules/gazebos/types";
import { extractPriceList } from "@/modules/gazebos/pricing";
import { BookOnlineButton } from "./booking-cta";
import { GazeboGallery } from "./gazebo-gallery";
import { getGazeboAnchor, getGazeboGallery } from "./gazebo-photos";
import styles from "./gazebos.module.css";

type Props = {
  resources: GazeboResource[];
  bookingEnabled?: boolean;
  minBookingHours?: number;
  children?: ReactNode;
};

export function GazeboNumberLinks({ resources }: { resources: GazeboResource[] }) {
  return (
    <nav className={styles.numberLinks} aria-label="Выбрать беседку по номеру">
      <span className={styles.numberLabel}>Беседки</span>
      {resources.map((resource) => {
        const gallery = getGazeboGallery(resource.name);
        return (
          <Link key={resource.id} href={`#${getGazeboAnchor(resource)}`} className={styles.numberLink}
            aria-label={`Перейти к ${resource.name}`}>
            {gallery ? `№${gallery.number}` : resource.name}
          </Link>
        );
      })}
    </nav>
  );
}

export function GazeboList({ resources, bookingEnabled = false, minBookingHours = 4, children }: Props) {
  if (resources.length === 0) {
    return <><p className={styles.empty}>Барбекю Парк временно в отпуске. Вернёмся раньше, чем вы успеете раздуть угли.</p>{children}</>;
  }

  return (
    <div className={styles.grid}>
      {resources.map((resource, index) => {
        const gallery = getGazeboGallery(resource.name);
        const priceList = extractPriceList(resource.metadata, resource.pricePerHour === null ? null : Number(resource.pricePerHour));
        const rates = priceList ? [priceList.weekdayHour, priceList.weekendHour].filter((rate) => Number.isFinite(rate) && rate > 0) : [];
        const fromRate = rates.length ? Math.min(...rates) : null;
        const metadata = resource.metadata;
        const features = metadata && typeof metadata === "object" && "features" in metadata && Array.isArray(metadata.features)
          ? metadata.features.filter((feature: unknown): feature is string => typeof feature === "string") : [];
        const hasHeating = /с отоплением/iu.test(resource.description ?? "");
        // The standard description repeats the capacity/heating row. Keep any
        // custom description instead of silently dropping admin-written details.
        const standardDescription = resource.capacity != null && /^(?:Большая )?Беседка с отоплением, до \d+ человек[.]?$/iu.test(resource.description ?? "");

        return (
          <article key={resource.id} id={getGazeboAnchor(resource)} className={styles.card} aria-labelledby={`title-${resource.id}`}>
            {gallery && <GazeboGallery name={resource.name} gallery={gallery} priority={index === 0} />}
            <div className={styles.cardBody}>
              <h2 id={`title-${resource.id}`} className={styles.cardTitle}>{resource.name}</h2>
              <div className={styles.details}>
                {resource.capacity != null && <span>До {resource.capacity} человек</span>}
                {hasHeating && <span>С отоплением</span>}
              </div>
              {resource.description && !standardDescription && <p className={styles.description}>{resource.description}</p>}
              {features.length > 0 && <p className={styles.features}>{features.join(" · ")}</p>}
              <div className={styles.cardBottom}>
                <div>
                  {fromRate !== null ? (
                    <p className={styles.rate}>от {fromRate.toLocaleString("ru-RU")} ₽ <small>/ час</small></p>
                  ) : <p className={styles.minimum}>Стоимость уточняйте при бронировании</p>}
                  <p className={styles.minimum}>Минимум {minBookingHours} ч</p>
                </div>
                {bookingEnabled && (
                  <BookOnlineButton source="card" resourceId={resource.id} className={styles.cardButton}>
                    {gallery ? `Выбрать №${gallery.number}` : "Выбрать беседку"}
                  </BookOnlineButton>
                )}
              </div>
            </div>
          </article>
        );
      })}
      {children}
    </div>
  );
}
