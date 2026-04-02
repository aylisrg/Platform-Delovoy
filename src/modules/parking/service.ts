import type { ParkingInfo } from "./types";

const MODULE_SLUG = "parking";

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
