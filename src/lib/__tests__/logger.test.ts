import { describe, it, expect, vi, beforeEach } from "vitest";

const createMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    systemEvent: {
      create: (...args: unknown[]) => createMock(...args),
    },
  },
}));

const redisState = { available: true };
const redisSetMock = vi.fn();
vi.mock("@/lib/redis", () => ({
  redis: { set: (...args: unknown[]) => redisSetMock(...args) },
  get redisAvailable() {
    return redisState.available;
  },
}));

const sendAlertMock = vi.fn();
vi.mock("@/lib/notifications", () => ({
  sendAlert: (...args: unknown[]) => sendAlertMock(...args),
}));

import { log } from "../logger";

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  createMock.mockResolvedValue(undefined);
  redisSetMock.mockResolvedValue("OK");
  sendAlertMock.mockResolvedValue(true);
  redisState.available = true;
});

describe("log.critical", () => {
  it("сохраняет CRITICAL SystemEvent в БД", async () => {
    await log.critical("payments", "webhook подписи не совпали");

    expect(createMock).toHaveBeenCalledOnce();
    expect(createMock.mock.calls[0][0]).toMatchObject({
      data: { level: "CRITICAL", source: "payments", message: "webhook подписи не совпали" },
    });
  });

  it("шлёт Telegram-алерт через sendAlert()", async () => {
    await log.critical("payments", "webhook подписи не совпали");
    await vi.waitFor(() => expect(sendAlertMock).toHaveBeenCalledOnce());

    expect(sendAlertMock).toHaveBeenCalledWith(
      "CRITICAL",
      "payments",
      "webhook подписи не совпали"
    );
  });

  it("эскейпит HTML в source/message перед отправкой (sendAlert шлёт parse_mode:HTML без своего эскейпинга)", async () => {
    // Реальный путь: src/modules/feedback/service.ts подставляет имя
    // пользователя (из Telegram first_name, ничем не санитизировано) прямо
    // в message — непроэкранированный HTML сломал бы разметку сообщения
    // или дал бы кликабельную ссылку в админ-чате.
    await log.critical(
      "feedback",
      'Срочное обращение от <a href="http://evil.example">СРОЧНО</a> & <script>alert(1)</script>'
    );
    await vi.waitFor(() => expect(sendAlertMock).toHaveBeenCalledOnce());

    const [, , sentMessage] = sendAlertMock.mock.calls[0];
    expect(sentMessage).toBe(
      'Срочное обращение от &lt;a href="http://evil.example"&gt;СРОЧНО&lt;/a&gt; &amp; &lt;script&gt;alert(1)&lt;/script&gt;'
    );
    expect(sentMessage).not.toContain("<a href=");
    expect(sentMessage).not.toContain("<script>");
  });

  it("не блокирует запись в БД ожиданием отправки алерта (fire-and-forget)", async () => {
    let resolveAlert!: () => void;
    sendAlertMock.mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolveAlert = () => resolve(true);
      })
    );

    await log.critical("payments", "медленный алерт");

    // log.critical() уже вернулся, хотя sendAlert() ещё не разрешился.
    expect(createMock).toHaveBeenCalledOnce();
    resolveAlert();
  });

  it("троттлит повторный алерт того же source в течение 300с (SET NX)", async () => {
    redisSetMock.mockResolvedValueOnce("OK").mockResolvedValueOnce(null);

    await log.critical("payments", "первый инцидент");
    await log.critical("payments", "второй инцидент, то же source");
    await vi.waitFor(() => expect(redisSetMock).toHaveBeenCalledTimes(2));

    expect(redisSetMock).toHaveBeenNthCalledWith(
      1,
      "critical-alert:payments",
      "1",
      "EX",
      300,
      "NX"
    );
    // Второй вызов НЕ прошёл NX-гейт → sendAlert вызван только один раз.
    expect(sendAlertMock).toHaveBeenCalledOnce();
    // Обе записи в БД всё равно случились — троттлится только алерт, не лог.
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("разные source не троттлят друг друга", async () => {
    await log.critical("payments", "инцидент A");
    await log.critical("telephony", "инцидент B");
    await vi.waitFor(() => expect(sendAlertMock).toHaveBeenCalledTimes(2));

    expect(redisSetMock).toHaveBeenNthCalledWith(1, "critical-alert:payments", "1", "EX", 300, "NX");
    expect(redisSetMock).toHaveBeenNthCalledWith(2, "critical-alert:telephony", "1", "EX", 300, "NX");
  });

  it("Redis недоступен → шлёт алерт без троттлинга (fail-open)", async () => {
    redisState.available = false;

    await log.critical("payments", "инцидент без Redis");
    await vi.waitFor(() => expect(sendAlertMock).toHaveBeenCalledOnce());

    expect(redisSetMock).not.toHaveBeenCalled();
    expect(sendAlertMock).toHaveBeenCalledWith("CRITICAL", "payments", "инцидент без Redis");
  });

  it("ошибка sendAlert() не пробрасывается вызывающему коду", async () => {
    sendAlertMock.mockRejectedValue(new Error("Telegram API недоступен"));

    await expect(log.critical("payments", "инцидент")).resolves.toBeUndefined();
    await vi.waitFor(() => expect(sendAlertMock).toHaveBeenCalledOnce());
  });

  it("ошибка Redis не пробрасывается и не блокирует алерт (fail-open)", async () => {
    redisSetMock.mockRejectedValue(new Error("ECONNRESET"));

    await log.critical("payments", "инцидент");
    await vi.waitFor(() => expect(sendAlertMock).toHaveBeenCalledOnce());

    expect(sendAlertMock).toHaveBeenCalledWith("CRITICAL", "payments", "инцидент");
  });

  it("owner-decisions + TELEGRAM_OWNER_CHAT_ID задан: шлёт в личку владельца, не в админ-группу", async () => {
    vi.stubEnv("TELEGRAM_OWNER_CHAT_ID", "694696");

    await log.critical("owner-decisions", "Контур решений владельца молчит 9999 мин");
    await vi.waitFor(() => expect(sendAlertMock).toHaveBeenCalledOnce());

    expect(sendAlertMock).toHaveBeenCalledWith(
      "CRITICAL",
      "owner-decisions",
      "Контур решений владельца молчит 9999 мин",
      "694696"
    );
  });

  it("owner-decisions + TELEGRAM_OWNER_CHAT_ID не задан: падает обратно в админ-группу (не теряет алерт)", async () => {
    await log.critical("owner-decisions", "Контур решений владельца молчит 9999 мин");
    await vi.waitFor(() => expect(sendAlertMock).toHaveBeenCalledOnce());

    // Тот же 3-аргументный вызов, что и для остальных source — sendAlert()
    // сам упадёт обратно на TELEGRAM_ADMIN_CHAT_ID.
    expect(sendAlertMock).toHaveBeenCalledWith(
      "CRITICAL",
      "owner-decisions",
      "Контур решений владельца молчит 9999 мин"
    );
  });

  it("другие source не задевает TELEGRAM_OWNER_CHAT_ID — всё равно уходит в админ-группу", async () => {
    vi.stubEnv("TELEGRAM_OWNER_CHAT_ID", "694696");

    await log.critical("payments", "webhook подписи не совпали");
    await vi.waitFor(() => expect(sendAlertMock).toHaveBeenCalledOnce());

    expect(sendAlertMock).toHaveBeenCalledWith("CRITICAL", "payments", "webhook подписи не совпали");
  });
});

describe("log.info / log.warn / log.error", () => {
  it("не шлют Telegram-алерт (только CRITICAL алертит)", async () => {
    await log.info("cafe", "заказ создан");
    await log.warn("cafe", "низкий остаток на складе");
    await log.error("cafe", "оплата отклонена");

    expect(sendAlertMock).not.toHaveBeenCalled();
    expect(createMock).toHaveBeenCalledTimes(3);
  });
});
