import { describe, it, expect } from "vitest";
import {
  describeWorkingHours,
  fixDriftedWorkingHours,
  OFFER_CLOSE_HOUR,
  OFFER_OPEN_HOUR,
} from "../gazebo-working-hours";

describe("fixDriftedWorkingHours", () => {
  it("чинит известное расхождение 08–23 на часы из оферты", () => {
    const result = fixDriftedWorkingHours({ openHour: 8, closeHour: 23 });

    expect(result).toMatchObject({
      openHour: OFFER_OPEN_HOUR,
      closeHour: OFFER_CLOSE_HOUR,
    });
  });

  it("сохраняет соседние ключи конфига", () => {
    const result = fixDriftedWorkingHours({
      openHour: 8,
      closeHour: 23,
      minBookingHours: 4,
      telegramChannelId: "-100500",
      telephony: { enabled: true, publicPhone: "+74996774888" },
    });

    expect(result).toMatchObject({
      minBookingHours: 4,
      telegramChannelId: "-100500",
      telephony: { enabled: true, publicPhone: "+74996774888" },
    });
  });

  // Скрипт живёт в шаге деплоя и гоняется на каждой выкатке: он обязан
  // молчать на всём, кроме одного известного расхождения, иначе будет
  // откатывать осознанные правки из админки.
  it("не трогает уже исправленный конфиг — идемпотентность", () => {
    expect(fixDriftedWorkingHours({ openHour: 11, closeHour: 22 })).toBeNull();
  });

  it("не трогает другие осознанно выставленные часы", () => {
    expect(fixDriftedWorkingHours({ openHour: 10, closeHour: 21 })).toBeNull();
  });

  it("не трогает конфиг без часов — там действуют дефолты из кода", () => {
    expect(fixDriftedWorkingHours({ minBookingHours: 4 })).toBeNull();
    expect(fixDriftedWorkingHours({})).toBeNull();
    expect(fixDriftedWorkingHours(null)).toBeNull();
  });

  it("не срабатывает, когда совпала только одна граница", () => {
    expect(fixDriftedWorkingHours({ openHour: 8, closeHour: 22 })).toBeNull();
    expect(fixDriftedWorkingHours({ openHour: 11, closeHour: 23 })).toBeNull();
  });

  it("не мутирует переданный конфиг", () => {
    const config = { openHour: 8, closeHour: 23 };
    fixDriftedWorkingHours(config);

    expect(config).toEqual({ openHour: 8, closeHour: 23 });
  });
});

describe("describeWorkingHours", () => {
  it("печатает окно с ведущими нулями", () => {
    expect(describeWorkingHours({ openHour: 8, closeHour: 23 })).toBe("08:00–23:00");
    expect(describeWorkingHours({ openHour: 11, closeHour: 22 })).toBe("11:00–22:00");
  });

  it("объясняет отсутствие часов, а не печатает NaN", () => {
    expect(describeWorkingHours({})).toContain("не задано");
    expect(describeWorkingHours(null)).toContain("не задано");
  });
});
