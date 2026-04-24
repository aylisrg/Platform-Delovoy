import { describe, it, expect } from "vitest";
import {
  reduce,
  initialState,
  type IssueFlowState,
} from "../tg-flow";
import { matchOffice, type OfficeRecord } from "../office-matcher";

const offices: OfficeRecord[] = [
  { id: "o-301", number: "301", building: 1, floor: 3 },
  { id: "o-302", number: "302", building: 1, floor: 3 },
  { id: "o-303", number: "303", building: 1, floor: 3 },
  { id: "o-a12", number: "A-12", building: 2, floor: 1 },
];

const categories = [
  { id: "c-plumb", slug: "plumbing", name: "Сантехника" },
  { id: "c-elec", slug: "electric", name: "Электрика" },
];

const deps = { offices, categories, matchOffice };

describe("reduce — identified user path", () => {
  it("confirms identity and goes to description", () => {
    const s0 = initialState();
    const r1 = reduce(
      s0,
      {
        kind: "start",
        identified: {
          userId: "u1",
          tenantId: "t1",
          officeId: "o-301",
          display: "Иван (ООО Ромашка, 301)",
        },
      },
      deps
    );
    expect(r1.state.step).toBe("confirm_identity");
    expect(r1.outcome.type).toBe("prompt");

    const r2 = reduce(r1.state, { kind: "confirm_identity", confirmed: true }, deps);
    expect(r2.state.step).toBe("ask_description");
  });

  it("branches to ask_name if user says 'это не я'", () => {
    const s0 = initialState();
    const r1 = reduce(
      s0,
      {
        kind: "start",
        identified: { userId: "u1", tenantId: null, officeId: null, display: "X" },
      },
      deps
    );
    const r2 = reduce(r1.state, { kind: "confirm_identity", confirmed: false }, deps);
    expect(r2.state.step).toBe("ask_name");
    expect(r2.state.identifiedUserId).toBeNull();
  });
});

describe("reduce — anonymous path with office matching", () => {
  function walkToOffice(startState: IssueFlowState = initialState()) {
    const r1 = reduce(startState, { kind: "start" }, deps);
    const r2 = reduce(r1.state, { kind: "text", value: "Иван / ООО Ромашка" }, deps);
    return r2.state;
  }

  it("asks name, then office when unidentified", () => {
    const s0 = initialState();
    const r1 = reduce(s0, { kind: "start" }, deps);
    expect(r1.state.step).toBe("ask_name");
    const r2 = reduce(r1.state, { kind: "text", value: "Иван" }, deps);
    expect(r2.state.step).toBe("ask_office");
    expect(r2.state.collectedName).toBe("Иван");
  });

  it("accepts exact office match and moves to description", () => {
    const s = walkToOffice();
    const r = reduce(s, { kind: "text", value: "Офис 301" }, deps);
    expect(r.state.step).toBe("ask_description");
    expect(r.state.collectedOfficeId).toBe("o-301");
  });

  it("returns candidates on fuzzy input", () => {
    const s = walkToOffice();
    const r = reduce(s, { kind: "text", value: "305" }, deps);
    expect(r.outcome.type).toBe("office_fuzzy");
    if (r.outcome.type === "office_fuzzy") {
      expect(r.outcome.candidates.length).toBeGreaterThan(0);
    }
    expect(r.state.step).toBe("choose_office_candidate");
  });

  it("accepts candidate choice", () => {
    const s = walkToOffice();
    const r = reduce(s, { kind: "text", value: "305" }, deps);
    const r2 = reduce(r.state, { kind: "pick_office", officeId: "o-302" }, deps);
    expect(r2.state.collectedOfficeId).toBe("o-302");
    expect(r2.state.step).toBe("ask_description");
  });

  it("retry returns to ask_office", () => {
    const s = walkToOffice();
    const r = reduce(s, { kind: "text", value: "305" }, deps);
    const r2 = reduce(r.state, { kind: "pick_office", officeId: null }, deps);
    expect(r2.state.step).toBe("ask_office");
  });

  it("after MAX_OFFICE_ATTEMPTS unmatched inputs — proceeds without office", () => {
    let s = walkToOffice();
    for (let i = 0; i < 2; i++) {
      s = reduce(s, { kind: "text", value: "zzzz" }, deps).state;
      expect(s.step).toBe("ask_office");
    }
    const r = reduce(s, { kind: "text", value: "zzzz" }, deps);
    expect(r.state.step).toBe("ask_description");
    expect(r.state.collectedOfficeId).toBeNull();
  });

  it("rejects too-short description", () => {
    let s = walkToOffice();
    s = reduce(s, { kind: "text", value: "301" }, deps).state;
    const r = reduce(s, { kind: "text", value: "ай" }, deps);
    expect(r.outcome.type).toBe("error");
    expect(s.step).toBe("ask_description");
  });

  it("full happy path ends in submit", () => {
    let s = walkToOffice();
    s = reduce(s, { kind: "text", value: "301" }, deps).state;
    s = reduce(s, { kind: "text", value: "Не работает кондиционер, очень жарко" }, deps).state;
    expect(s.step).toBe("ask_category");
    s = reduce(s, { kind: "pick_category", categoryId: "c-elec" }, deps).state;
    expect(s.step).toBe("ask_priority");
    s = reduce(s, { kind: "pick_priority", priority: "HIGH" }, deps).state;
    expect(s.step).toBe("confirm");
    const r = reduce(s, { kind: "confirm_submit" }, deps);
    expect(r.outcome.type).toBe("submit");
    if (r.outcome.type === "submit") {
      expect(r.outcome.state.description).toContain("кондиционер");
      expect(r.outcome.state.categoryId).toBe("c-elec");
      expect(r.outcome.state.priority).toBe("HIGH");
      expect(r.outcome.state.collectedOfficeId).toBe("o-301");
    }
  });

  it("cancel resets state", () => {
    const s = walkToOffice();
    const r = reduce(s, { kind: "cancel" }, deps);
    expect(r.outcome.type).toBe("cancelled");
    expect(r.state.step).toBe("start");
  });
});
