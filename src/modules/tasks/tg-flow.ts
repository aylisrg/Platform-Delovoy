// Pure state-reducer for the Telegram /issue flow.
// All side-effects (Redis, DB, bot messages) live in the handler that drives
// this reducer — so the decision logic stays trivially unit-testable.
//
// State is serialized to Redis as JSON under key tasks:issue:<chatId>. TTL 30 min
// to avoid abandoned flows piling up.

import type { OfficeRecord, OfficeMatchResult } from "./office-matcher";

export type IssueFlowStep =
  | "start"                  // initial (no state yet) — bot will set to ask_description / confirm_identity
  | "confirm_identity"       // showed "you are X from Y office Z — yes/no"
  | "ask_name"               // collecting contact/company name
  | "ask_office"             // collecting office number
  | "choose_office_candidate" // showed fuzzy candidates
  | "ask_description"
  | "ask_category"
  | "ask_priority"
  | "confirm";

export type IssueFlowState = {
  step: IssueFlowStep;
  officeAttempts: number;
  identifiedUserId?: string | null;
  identifiedTenantId?: string | null;
  identifiedOfficeId?: string | null;
  identifiedDisplay?: string;
  collectedName?: string;
  collectedOfficeId?: string | null;
  collectedOfficeDisplay?: string;
  description?: string;
  categoryId?: string | null;
  priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
};

export const MAX_OFFICE_ATTEMPTS = 3;

type ReducerInput =
  | { kind: "start"; identified?: {
      userId: string;
      tenantId: string | null;
      officeId: string | null;
      display: string;
    } }
  | { kind: "confirm_identity"; confirmed: boolean }
  | { kind: "text"; value: string }
  | { kind: "pick_office"; officeId: string | null /* null = retry */ }
  | { kind: "pick_category"; categoryId: string | null /* null = skip */ }
  | { kind: "pick_priority"; priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT" | null /* null = skip */ }
  | { kind: "confirm_submit" }
  | { kind: "cancel" };

export type ReducerOutcome =
  | { type: "prompt"; message: string; keyboard?: Array<Array<{ label: string; data: string }>> }
  | { type: "office_fuzzy"; message: string; candidates: OfficeRecord[] }
  | { type: "submit"; state: IssueFlowState }
  | { type: "cancelled" }
  | { type: "error"; message: string };

export function initialState(): IssueFlowState {
  return {
    step: "start",
    officeAttempts: 0,
  };
}

/**
 * Deterministic reducer: (state, input, deps) → (nextState, outcome).
 * Deps let the test supply office lists/categories without DB.
 */
export function reduce(
  state: IssueFlowState,
  input: ReducerInput,
  deps: {
    offices: OfficeRecord[];
    matchOffice: (q: string, offices: OfficeRecord[]) => OfficeMatchResult;
    categories: Array<{ id: string; name: string; slug: string }>;
  }
): { state: IssueFlowState; outcome: ReducerOutcome } {
  if (input.kind === "cancel") {
    return { state: initialState(), outcome: { type: "cancelled" } };
  }

  switch (state.step) {
    case "start": {
      if (input.kind !== "start") {
        return { state, outcome: { type: "error", message: "Нажмите /issue чтобы начать." } };
      }
      if (input.identified) {
        return {
          state: {
            ...state,
            step: "confirm_identity",
            identifiedUserId: input.identified.userId,
            identifiedTenantId: input.identified.tenantId,
            identifiedOfficeId: input.identified.officeId,
            identifiedDisplay: input.identified.display,
          },
          outcome: {
            type: "prompt",
            message: `Это вы: ${input.identified.display}?`,
            keyboard: [[
              { label: "Да, всё верно", data: "confirm_identity:yes" },
              { label: "Нет", data: "confirm_identity:no" },
            ]],
          },
        };
      }
      return {
        state: { ...state, step: "ask_name" },
        outcome: {
          type: "prompt",
          message: "Представьтесь, пожалуйста — ФИО и/или компания:",
        },
      };
    }

    case "confirm_identity": {
      if (input.kind !== "confirm_identity") {
        return { state, outcome: { type: "error", message: "Выберите Да/Нет кнопкой." } };
      }
      if (input.confirmed) {
        return {
          state: { ...state, step: "ask_description" },
          outcome: {
            type: "prompt",
            message: "Опишите, что сломалось или нужно исправить:",
          },
        };
      }
      return {
        state: {
          ...state,
          step: "ask_name",
          identifiedUserId: null,
          identifiedTenantId: null,
          identifiedOfficeId: null,
          identifiedDisplay: undefined,
        },
        outcome: {
          type: "prompt",
          message: "Хорошо, расскажем заново. Представьтесь — ФИО и/или компания:",
        },
      };
    }

    case "ask_name": {
      if (input.kind !== "text") {
        return { state, outcome: { type: "error", message: "Отправьте текстом ваше имя/компанию." } };
      }
      const value = input.value.trim();
      if (value.length < 2) {
        return { state, outcome: { type: "error", message: "Имя слишком короткое — повторите." } };
      }
      return {
        state: { ...state, collectedName: value, step: "ask_office" },
        outcome: {
          type: "prompt",
          message:
            "Из какого вы офиса? Можно в любом формате: 301, «оф.А-12», «кабинет 512» и т.д.",
        },
      };
    }

    case "ask_office":
    case "choose_office_candidate": {
      if (input.kind === "pick_office") {
        if (input.officeId) {
          const chosen = deps.offices.find((o) => o.id === input.officeId);
          return {
            state: {
              ...state,
              collectedOfficeId: input.officeId,
              collectedOfficeDisplay: chosen?.number ?? "",
              step: "ask_description",
              officeAttempts: 0,
            },
            outcome: {
              type: "prompt",
              message: "Опишите, что сломалось или нужно исправить:",
            },
          };
        }
        // retry: go back to ask_office
        return {
          state: { ...state, step: "ask_office" },
          outcome: {
            type: "prompt",
            message: "Хорошо, введите номер офиса ещё раз:",
          },
        };
      }
      if (input.kind !== "text") {
        return { state, outcome: { type: "error", message: "Отправьте номер офиса текстом." } };
      }
      const attempts = state.officeAttempts + 1;
      const result = deps.matchOffice(input.value, deps.offices);
      if (result.exact) {
        return {
          state: {
            ...state,
            collectedOfficeId: result.exact.id,
            collectedOfficeDisplay: result.exact.number,
            step: "ask_description",
            officeAttempts: 0,
          },
          outcome: {
            type: "prompt",
            message: "Опишите, что сломалось или нужно исправить:",
          },
        };
      }
      if (result.candidates.length > 0) {
        return {
          state: { ...state, step: "choose_office_candidate", officeAttempts: attempts },
          outcome: {
            type: "office_fuzzy",
            message: "Не нашёл точного совпадения. Возможно, один из этих?",
            candidates: result.candidates,
          },
        };
      }
      // No candidates
      if (attempts >= MAX_OFFICE_ATTEMPTS) {
        // Give up, but let them proceed without office (will be created with officeId=null)
        return {
          state: {
            ...state,
            collectedOfficeId: null,
            collectedOfficeDisplay: input.value.trim(),
            step: "ask_description",
            officeAttempts: 0,
          },
          outcome: {
            type: "prompt",
            message:
              "Не нашёл такой офис в базе, но не страшно — мы разберёмся. Опишите проблему:",
          },
        };
      }
      return {
        state: { ...state, step: "ask_office", officeAttempts: attempts },
        outcome: {
          type: "prompt",
          message: `Не нашёл такой офис. Попробуйте ещё раз (попытка ${attempts} из ${MAX_OFFICE_ATTEMPTS}):`,
        },
      };
    }

    case "ask_description": {
      if (input.kind !== "text") {
        return { state, outcome: { type: "error", message: "Опишите проблему текстом." } };
      }
      const v = input.value.trim();
      if (v.length < 5) {
        return { state, outcome: { type: "error", message: "Слишком короткое описание — напишите хотя бы пару предложений." } };
      }
      const keyboard: Array<Array<{ label: string; data: string }>> = [];
      // 2 categories per row
      for (let i = 0; i < deps.categories.length; i += 2) {
        const row: Array<{ label: string; data: string }> = [];
        row.push({ label: deps.categories[i].name, data: `cat:${deps.categories[i].id}` });
        if (deps.categories[i + 1]) {
          row.push({
            label: deps.categories[i + 1].name,
            data: `cat:${deps.categories[i + 1].id}`,
          });
        }
        keyboard.push(row);
      }
      keyboard.push([{ label: "Пропустить", data: "cat:skip" }]);
      return {
        state: { ...state, description: v, step: "ask_category" },
        outcome: {
          type: "prompt",
          message: "Какая это категория?",
          keyboard,
        },
      };
    }

    case "ask_category": {
      if (input.kind !== "pick_category") {
        return { state, outcome: { type: "error", message: "Выберите категорию кнопкой." } };
      }
      return {
        state: { ...state, categoryId: input.categoryId, step: "ask_priority" },
        outcome: {
          type: "prompt",
          message: "Насколько это срочно?",
          keyboard: [
            [
              { label: "Не срочно", data: "prio:LOW" },
              { label: "Обычно", data: "prio:MEDIUM" },
            ],
            [
              { label: "Срочно", data: "prio:HIGH" },
              { label: "Очень срочно", data: "prio:URGENT" },
            ],
            [{ label: "Пропустить", data: "prio:skip" }],
          ],
        },
      };
    }

    case "ask_priority": {
      if (input.kind !== "pick_priority") {
        return { state, outcome: { type: "error", message: "Выберите приоритет кнопкой." } };
      }
      const priority = input.priority ?? "MEDIUM";
      return {
        state: { ...state, priority, step: "confirm" },
        outcome: {
          type: "prompt",
          message: `Всё верно?\n\nОфис: ${state.collectedOfficeDisplay || state.identifiedDisplay || "не указан"}\nОписание: ${state.description}`,
          keyboard: [[
            { label: "Отправить", data: "submit" },
            { label: "Отмена", data: "cancel" },
          ]],
        },
      };
    }

    case "confirm": {
      if (input.kind === "confirm_submit") {
        return { state: initialState(), outcome: { type: "submit", state } };
      }
      return { state, outcome: { type: "error", message: "Выберите Отправить или Отмена." } };
    }

    default:
      return { state, outcome: { type: "error", message: "Неизвестный шаг." } };
  }
}
