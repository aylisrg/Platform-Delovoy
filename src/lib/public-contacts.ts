/** Публичные контакты направлений: страницы, ссылки для звонков и уведомления. */
export const PUBLIC_CONTACTS = {
  rental: {
    label: "Аренда офисов",
    phone: "+74996477142",
    displayPhone: "+7 (499) 647-71-42",
  },
  gazebos: {
    label: "Аренда беседок",
    phone: "+79269008120",
    displayPhone: "+7 (926) 900-81-20",
  },
  "ps-park": {
    label: "Аренда консолей в Плей Парке",
    phone: "+79852444624",
    displayPhone: "+7 (985) 244-46-24",
  },
  cafe: {
    label: "Кафе",
    phone: "+79152698507",
    displayPhone: "+7 (915) 269-85-07",
  },
} as const;

export function getPublicContact(moduleSlug: string) {
  return Object.hasOwn(PUBLIC_CONTACTS, moduleSlug)
    ? PUBLIC_CONTACTS[moduleSlug as keyof typeof PUBLIC_CONTACTS]
    : PUBLIC_CONTACTS.rental;
}
