import type { ParkingInfo, ParkingPricing, GuardedParkingInfo } from "./types";

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

/**
 * Контент отдельной услуги «Автостоянка». Отдельная страница /avtostoyanka —
 * услугой могут воспользоваться любые водители, не только гости барбекю-парка.
 * Прайс берётся из getParkingPricing() (единый источник).
 */
export function getGuardedParkingInfo(): GuardedParkingInfo {
  return {
    tagline: "Оставьте автомобиль под охраной — на ночь, на сутки или дольше",
    hours: "Круглосуточно, 7 дней в неделю",
    address: "Селятино, Московская область — бизнес-парк «Деловой»",
    features: [
      {
        title: "Охрана 24/7",
        description: "Территория под постоянным контролем охраны, въезд по шлагбауму.",
      },
      {
        title: "Видеонаблюдение",
        description: "Камеры по всему периметру, запись хранится круглосуточно.",
      },
      {
        title: "Любой транспорт",
        description: "Места для легковых и грузовых автомобилей.",
      },
      {
        title: "Освещение",
        description: "Площадка освещается ночью — авто на виду в любое время.",
      },
      {
        title: "Ночь или сутки",
        description: "Оставляйте на ночь либо на длительное хранение по суточному тарифу.",
      },
      {
        title: "Удобный въезд",
        description: "30 км от Москвы по Киевскому шоссе, заезд прямо с трассы.",
      },
    ],
    steps: [
      {
        title: "Приезжайте",
        description: "Заезжайте на территорию бизнес-парка «Деловой» в Селятино.",
      },
      {
        title: "Оставляйте авто",
        description: "Охрана подскажет свободное место для вашего транспорта.",
      },
      {
        title: "Оплатите тариф",
        description: "Ночь или сутки — по прайсу, наличными или онлайн.",
      },
      {
        title: "Забирайте в любое время",
        description: "Площадка работает круглосуточно — забрать авто можно когда удобно.",
      },
    ],
  };
}

export { MODULE_SLUG };
