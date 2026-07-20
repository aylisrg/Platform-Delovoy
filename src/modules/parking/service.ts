import type { ParkingInfo, ParkingPricing } from "./types";

const MODULE_SLUG = "parking";

/**
 * Прайс платной охраняемой автостоянки для гостей барбекю-парка.
 * Источник — официальный прайс-лист (Приложение к договору аренды беседки).
 * Единый источник для страниц /gazebos и /parking (взаимосвязь контента).
 */
export function getParkingPricing(): ParkingPricing {
  return {
    nightWindow: "с 23:00 до 11:00",
    tariffs: [
      { vehicle: "Легковой автомобиль", nightPrice: 200, dayPrice: 200 },
      { vehicle: "Грузовой автомобиль", nightPrice: 400, dayPrice: 400 },
    ],
  };
}

/**
 * Returns parking information.
 * In a future phase this could be loaded from Module.config in the database.
 */
export function getParkingInfo(): ParkingInfo {
  return {
    totalSpots: 150,
    guestSpots: 30,
    tenantSpots: 120,
    operatingHours: "Круглосуточно",
    rules: [
      "Парковка для арендаторов бесплатная (по пропуску)",
      "Гостевая парковка — первые 2 часа бесплатно",
      "Максимальное время гостевой парковки — 12 часов",
      "Запрещена парковка на газонах и тротуарах",
      "Грузовой транспорт — только в зоне разгрузки",
    ],
    contacts: {
      phone: "+7 (495) 000-00-00",
    },
  };
}

export { MODULE_SLUG };
