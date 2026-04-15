import { describe, it, expect } from "vitest";
import {
  createFeedbackSchema,
  feedbackFilterSchema,
  updateFeedbackStatusSchema,
  createCommentSchema,
} from "@/modules/feedback/validation";

describe("createFeedbackSchema", () => {
  it("accepts valid BUG feedback", () => {
    const result = createFeedbackSchema.safeParse({
      type: "BUG",
      description: "Кнопка не работает на странице бронирования",
      pageUrl: "/gazebos",
      isUrgent: false,
    });
    expect(result.success).toBe(true);
  });

  it("accepts valid SUGGESTION feedback", () => {
    const result = createFeedbackSchema.safeParse({
      type: "SUGGESTION",
      description: "Было бы здорово добавить фильтр по дате",
      pageUrl: "/ps-park",
      isUrgent: false,
    });
    expect(result.success).toBe(true);
  });

  it("accepts urgent feedback", () => {
    const result = createFeedbackSchema.safeParse({
      type: "BUG",
      description: "Сайт не загружается, белый экран",
      pageUrl: "/",
      isUrgent: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isUrgent).toBe(true);
    }
  });

  it("coerces string 'true' to boolean for isUrgent", () => {
    const result = createFeedbackSchema.safeParse({
      type: "BUG",
      description: "Какая-то ошибка на странице",
      pageUrl: "/cafe",
      isUrgent: "true",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isUrgent).toBe(true);
    }
  });

  it("defaults isUrgent to false when not provided", () => {
    const result = createFeedbackSchema.safeParse({
      type: "BUG",
      description: "Небольшая ошибка в меню",
      pageUrl: "/cafe",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isUrgent).toBe(false);
    }
  });

  it("rejects invalid type", () => {
    const result = createFeedbackSchema.safeParse({
      type: "QUESTION",
      description: "Как забронировать?",
      pageUrl: "/gazebos",
    });
    expect(result.success).toBe(false);
  });

  it("rejects description shorter than 10 characters", () => {
    const result = createFeedbackSchema.safeParse({
      type: "BUG",
      description: "Короткий",
      pageUrl: "/",
    });
    expect(result.success).toBe(false);
  });

  it("accepts description of exactly 10 characters", () => {
    const result = createFeedbackSchema.safeParse({
      type: "BUG",
      description: "1234567890",
      pageUrl: "/",
    });
    expect(result.success).toBe(true);
  });

  it("rejects description longer than 2000 characters", () => {
    const result = createFeedbackSchema.safeParse({
      type: "BUG",
      description: "x".repeat(2001),
      pageUrl: "/",
    });
    expect(result.success).toBe(false);
  });

  it("accepts description of exactly 2000 characters", () => {
    const result = createFeedbackSchema.safeParse({
      type: "BUG",
      description: "x".repeat(2000),
      pageUrl: "/",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty pageUrl", () => {
    const result = createFeedbackSchema.safeParse({
      type: "BUG",
      description: "Ошибка на странице",
      pageUrl: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing type", () => {
    const result = createFeedbackSchema.safeParse({
      description: "Ошибка без типа",
      pageUrl: "/",
    });
    expect(result.success).toBe(false);
  });
});

describe("feedbackFilterSchema", () => {
  it("accepts empty filter (all defaults)", () => {
    const result = feedbackFilterSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.perPage).toBe(20);
    }
  });

  it("accepts valid filters", () => {
    const result = feedbackFilterSchema.safeParse({
      page: "2",
      perPage: "10",
      status: "NEW",
      type: "BUG",
      isUrgent: "true",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(2);
      expect(result.data.perPage).toBe(10);
      expect(result.data.status).toBe("NEW");
      expect(result.data.type).toBe("BUG");
      expect(result.data.isUrgent).toBe(true);
    }
  });

  it("rejects perPage over 50", () => {
    const result = feedbackFilterSchema.safeParse({ perPage: "100" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid status", () => {
    const result = feedbackFilterSchema.safeParse({ status: "DELETED" });
    expect(result.success).toBe(false);
  });
});

describe("updateFeedbackStatusSchema", () => {
  it("accepts valid status", () => {
    expect(updateFeedbackStatusSchema.safeParse({ status: "IN_PROGRESS" }).success).toBe(true);
    expect(updateFeedbackStatusSchema.safeParse({ status: "RESOLVED" }).success).toBe(true);
    expect(updateFeedbackStatusSchema.safeParse({ status: "REJECTED" }).success).toBe(true);
    expect(updateFeedbackStatusSchema.safeParse({ status: "NEW" }).success).toBe(true);
  });

  it("rejects invalid status", () => {
    expect(updateFeedbackStatusSchema.safeParse({ status: "DONE" }).success).toBe(false);
  });

  it("rejects missing status", () => {
    expect(updateFeedbackStatusSchema.safeParse({}).success).toBe(false);
  });
});

describe("createCommentSchema", () => {
  it("accepts valid comment", () => {
    const result = createCommentSchema.safeParse({ text: "Исправим в ближайшем обновлении" });
    expect(result.success).toBe(true);
  });

  it("rejects empty comment", () => {
    const result = createCommentSchema.safeParse({ text: "" });
    expect(result.success).toBe(false);
  });

  it("rejects comment longer than 5000 characters", () => {
    const result = createCommentSchema.safeParse({ text: "x".repeat(5001) });
    expect(result.success).toBe(false);
  });

  it("accepts comment of exactly 5000 characters", () => {
    const result = createCommentSchema.safeParse({ text: "x".repeat(5000) });
    expect(result.success).toBe(true);
  });
});
