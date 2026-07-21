export type ParkingInfo = {
  totalSpots: number;
  guestSpots: number;
  tenantSpots: number;
  operatingHours: string;
  rules: string[];
  contacts: {
    phone?: string;
    email?: string;
  };
};

/** Тариф платной охраняемой автостоянки (прайс-лист аренды беседок). */
export type ParkingTariff = {
  /** Тип транспорта, напр. "Легковой автомобиль". */
  vehicle: string;
  /** Стоимость за ночь, ₽. */
  nightPrice: number;
  /** Стоимость за сутки при дальнейшем хранении, ₽. */
  dayPrice: number;
};

/** Прайс платной охраняемой автостоянки для гостей барбекю-парка. */
export type ParkingPricing = {
  /** Часы ночного тарифа, напр. "с 23:00 до 11:00". */
  nightWindow: string;
  tariffs: ParkingTariff[];
};

/** Преимущество / шаг для страницы автостоянки. */
export type GuardedParkingItem = {
  title: string;
  description: string;
};

/**
 * Контент отдельной услуги «Автостоянка» (самостоятельная страница).
 * Услуга доступна всем, не только гостям барбекю-парка.
 */
export type GuardedParkingInfo = {
  /** Короткий подзаголовок под H1. */
  tagline: string;
  /** Режим работы, напр. "Круглосуточно, 7 дней в неделю". */
  hours: string;
  /** Адрес площадки. */
  address: string;
  /** Преимущества (иконки-карточки). */
  features: GuardedParkingItem[];
  /** Шаги «как это работает». */
  steps: GuardedParkingItem[];
};
