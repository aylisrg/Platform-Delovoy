import { describe, it, expect } from "vitest";
import {
  FUNNEL_KEYS,
  FUNNELS,
  STEP_KEYS,
  getFunnel,
  getStepDef,
  isClientRecordable,
  clientRecordableSteps,
} from "../funnels";

describe("FUNNELS catalog", () => {
  it("каждый FunnelDef.funnel совпадает со своим ключом в FUNNELS", () => {
    for (const key of FUNNEL_KEYS) {
      expect(FUNNELS[key].funnel).toBe(key);
    }
  });

  it("каждый шаг каждой воронки — валидный STEP_KEYS", () => {
    for (const key of FUNNEL_KEYS) {
      for (const step of FUNNELS[key].steps) {
        expect(STEP_KEYS).toContain(step.step);
      }
    }
  });

  it("шаги внутри воронки не повторяются", () => {
    for (const key of FUNNEL_KEYS) {
      const steps = FUNNELS[key].steps.map((s) => s.step);
      expect(new Set(steps).size).toBe(steps.length);
    }
  });

  it("первый шаг каждой воронки — view", () => {
    for (const key of FUNNEL_KEYS) {
      expect(FUNNELS[key].steps[0]?.step).toBe("view");
    }
  });

  it("серверные решающие шаги (submitted/paid) не clientRecordable", () => {
    for (const key of FUNNEL_KEYS) {
      for (const step of FUNNELS[key].steps) {
        if (step.step === "submitted" || step.step === "paid" || step.step === "view") {
          expect(step.clientRecordable).toBe(false);
        }
      }
    }
  });

  it("submitted/paid не дедуплицируются (dedupeWindowSec = 0) — вторая бронь это второе событие", () => {
    for (const key of FUNNEL_KEYS) {
      for (const step of FUNNELS[key].steps) {
        if (step.step === "submitted" || step.step === "paid") {
          expect(step.dedupeWindowSec).toBe(0);
        }
      }
    }
  });

  it("rental не содержит шаг paid — аренда это лид, не сделка (AC-1.4)", () => {
    expect(FUNNELS.rental.steps.some((s) => s.step === "paid")).toBe(false);
  });
});

describe("getFunnel / getStepDef", () => {
  it("возвращает FunnelDef для валидного ключа", () => {
    expect(getFunnel("gazebos")?.funnel).toBe("gazebos");
  });

  it("возвращает undefined для несуществующей воронки", () => {
    expect(getFunnel("not-a-funnel")).toBeUndefined();
  });

  it("возвращает StepDef для валидной пары funnel/step", () => {
    expect(getStepDef("cafe", "cart_item_added")?.label).toBe("Товар в корзине");
  });

  it("возвращает undefined для существующей воронки, но чужого шага", () => {
    expect(getStepDef("rental", "paid")).toBeUndefined();
  });

  it("возвращает undefined для несуществующей воронки", () => {
    expect(getStepDef("not-a-funnel", "view")).toBeUndefined();
  });
});

describe("isClientRecordable", () => {
  it("true для intent-шага своей воронки", () => {
    expect(isClientRecordable("gazebos", "slot_selected")).toBe(true);
  });

  it("false для решающего серверного шага", () => {
    expect(isClientRecordable("gazebos", "submitted")).toBe(false);
  });

  it("false для шага, которого у воронки вообще нет (нельзя подделать конверсию чужим шагом)", () => {
    expect(isClientRecordable("rental", "cart_item_added")).toBe(false);
  });
});

describe("clientRecordableSteps", () => {
  it("содержит все клиентские шаги по каталогу и не содержит серверные", () => {
    const steps = clientRecordableSteps();
    expect(steps).toEqual(
      expect.arrayContaining(["slot_selected", "cart_item_added", "form_started"])
    );
    expect(steps).not.toContain("view");
    expect(steps).not.toContain("submitted");
    expect(steps).not.toContain("paid");
  });
});
