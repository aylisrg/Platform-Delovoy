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
