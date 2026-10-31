export const resources = [1, 2, 3, 4, 5].map((number) => ({
  id: `fixture-r${number}`, name: `Беседка №${number}`,
  description: "Беседка с отоплением, до 12 человек", capacity: 12 + number,
  pricePerHour: 900 + number * 100, isActive: true,
  metadata: { priceList: { weekdayHour: 1000 + number * 100, weekdayDay: 10000, weekendHour: 1500, weekendDay: 12000 } },
}));
export const availability = {
  success: true, data: { minBookingHours: 4, resources: resources.map((resource) => ({
    resource, date: "2030-06-15", pricing: null,
    slots: Array.from({ length: 8 }, (_, index) => ({ startTime: `${11 + index}:00`, endTime: `${12 + index}:00`, isAvailable: true })),
  })) },
};
