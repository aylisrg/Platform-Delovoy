import { describe, it, expect } from "vitest";
import {
  bookingHourRange,
  clampToWorkingHours,
  hoursToHHMM,
  planDrop,
  pxDeltaToHours,
  resizeBookingEnd,
  shiftBooking,
  snapHours,
} from "../timeline-drag";

describe("timeline-drag (issue #741, ADR 2026-08-23 §5)", () => {
  it("pxDeltaToHours: доля ширины дорожки × длина рабочего дня", () => {
    expect(pxDeltaToHours(90, 900, 8, 23)).toBeCloseTo(1.5);
    expect(pxDeltaToHours(-60, 900, 8, 23)).toBeCloseTo(-1);
    expect(pxDeltaToHours(100, 0, 8, 23)).toBe(0);
    expect(pxDeltaToHours(100, 900, 23, 8)).toBe(0);
  });

  it("snapHours: шаг 30 минут по умолчанию, произвольный шаг по параметру", () => {
    expect(snapHours(1.2)).toBe(1);
    expect(snapHours(1.3)).toBe(1.5);
    expect(snapHours(-0.74)).toBe(-0.5);
    expect(snapHours(0.2)).toBe(0);
    expect(snapHours(1.4, 60)).toBe(1);
    expect(snapHours(0.2, 15)).toBe(0.25);
  });

  it("shiftBooking сохраняет длительность", () => {
    expect(shiftBooking({ startHour: 10, endHour: 14 }, 1.5)).toEqual({ startHour: 11.5, endHour: 15.5 });
    expect(shiftBooking({ startHour: 10, endHour: 14 }, -2)).toEqual({ startHour: 8, endHour: 12 });
  });

  it("resizeBookingEnd меняет только конец и не даёт схлопнуть бронь короче шага", () => {
    expect(resizeBookingEnd({ startHour: 10, endHour: 14 }, 1)).toEqual({ startHour: 10, endHour: 15 });
    expect(resizeBookingEnd({ startHour: 10, endHour: 14 }, -10)).toEqual({ startHour: 10, endHour: 10.5 });
  });

  it("clampToWorkingHours вписывает диапазон в день, сохраняя длительность", () => {
    expect(clampToWorkingHours({ startHour: 6, endHour: 10 }, 8, 23)).toEqual({ startHour: 8, endHour: 12 });
    expect(clampToWorkingHours({ startHour: 21, endHour: 25 }, 8, 23)).toEqual({ startHour: 19, endHour: 23 });
    expect(clampToWorkingHours({ startHour: 10, endHour: 14 }, 8, 23)).toEqual({ startHour: 10, endHour: 14 });
    // длиннее дня — обрезаем по закрытию
    expect(clampToWorkingHours({ startHour: 5, endHour: 30 }, 8, 23)).toEqual({ startHour: 8, endHour: 23 });
  });

  it("hoursToHHMM форматирует дробные часы в HH:mm", () => {
    expect(hoursToHHMM(8)).toBe("08:00");
    expect(hoursToHHMM(13.5)).toBe("13:30");
    expect(hoursToHHMM(22.75)).toBe("22:45");
  });

  it("bookingHourRange берёт часы по МСК из ISO", () => {
    expect(bookingHourRange("2030-06-17T07:00:00.000Z", "2030-06-17T11:30:00.000Z")).toEqual({
      startHour: 10,
      endHour: 14.5,
    });
  });

  it("planDrop: нулевое смещение и тот же ресурс → null (запрос не уходит, гостю ничего не шлём)", () => {
    const range = { startHour: 10, endHour: 14 };
    expect(
      planDrop({ original: range, next: range, originalResourceId: "r-1", targetResourceId: "r-1", date: "2030-06-17" })
    ).toBeNull();
  });

  it("planDrop: смена ресурса без смены времени — это перенос", () => {
    const range = { startHour: 10, endHour: 14 };
    expect(
      planDrop({ original: range, next: range, originalResourceId: "r-1", targetResourceId: "r-2", date: "2030-06-17" })
    ).toEqual({ resourceId: "r-2", date: "2030-06-17", startTime: "10:00", endTime: "14:00" });
  });

  it("planDrop: сдвиг по времени — тело PATCH как у формы редактирования (без status)", () => {
    const plan = planDrop({
      original: { startHour: 10, endHour: 14 },
      next: { startHour: 11.5, endHour: 15.5 },
      originalResourceId: "r-1",
      targetResourceId: "r-1",
      date: "2030-06-17",
    });
    expect(plan).toEqual({ resourceId: "r-1", date: "2030-06-17", startTime: "11:30", endTime: "15:30" });
    expect(plan).not.toHaveProperty("status");
  });
});
