/**
 * Привязывает KeyGoals (ключевые цели) к 3 кампаниям Яндекс.Директ.
 * Это даёт Яндексу сигнал "эта конверсия = успех", что улучшает ранжирование
 * ставок и позже позволит переключиться на стратегию "Оптимизация конверсий".
 *
 * Запуск: node --env-file=.env --import tsx/esm scripts/link-direct-keygoals.ts
 */

const DIRECT_API = "https://api.direct.yandex.com/json/v5";
const token = process.env.YANDEX_OAUTH_TOKEN!;
const login = process.env.YANDEX_DIRECT_CLIENT_LOGIN || "ilya-sergeenko";

async function req<T = unknown>(service: string, method: string, params: object): Promise<T> {
  const res = await fetch(`${DIRECT_API}/${service}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
      "Accept-Language": "ru",
      "Client-Login": login,
    },
    body: JSON.stringify({ method, params }),
  });
  const data = await res.json() as { result?: T; error?: { error_string: string; error_detail: string } };
  if (data.error) throw new Error(`${service}.${method}: ${data.error.error_string} — ${data.error.error_detail}`);
  return data.result as T;
}

// Рубли → микры (формат Яндекса)
const rub = (amount: number) => amount * 1_000_000;

// ═══ Маппинг кампания → KeyGoal ═══
// Ценность — это "условная стоимость одной конверсии" для Яндекса.
// Оценки на основе бизнес-логики: LTV клиента × вероятность конверсии.
const CAMPAIGN_KEYGOALS = [
  {
    campaignId: 709135109,
    campaignName: "Деловой — Барбекю Парк (Поиск)",
    goalId: 546518889,
    goalName: "gazebo_booking_success",
    value: 500, // ~1500р/час × 1-2 часа × маржа
  },
  {
    campaignId: 709135118,
    campaignName: "Деловой — Плей Парк (Поиск)",
    goalId: 546518891,
    goalName: "pspark_booking_success",
    value: 300, // 800-1200р/час × маржа
  },
  {
    campaignId: 709085563,
    campaignName: "Деловой Парк - Аренда офисов",
    goalId: 546518894,
    goalName: "office_inquiry_success",
    value: 5000, // B2B — высокий LTV, одна конверсия ценнее
  },
];

async function main() {
  console.log("\n  Привязка ключевых целей к кампаниям Директа\n");

  for (const { campaignId, campaignName, goalId, goalName, value } of CAMPAIGN_KEYGOALS) {
    console.log(`━━━  ${campaignName}`);
    console.log(`     Цель: ${goalName} (id=${goalId}), ценность: ${value} руб`);

    const result = await req<{ UpdateResults: Array<{ Id?: number; Errors?: Array<{ Message: string; Details?: string }>; Warnings?: Array<{ Message: string }> }> }>(
      "campaigns", "update",
      {
        Campaigns: [{
          Id: campaignId,
          TextCampaign: {
            PriorityGoals: {
              Items: [{
                GoalId: goalId,
                Value: rub(value),
              }],
            },
          },
        }],
      }
    );

    const r = result.UpdateResults[0];
    if (r.Id) {
      console.log(`     ✓ Привязано`);
    } else {
      console.error(`     ✗ ${r.Errors?.[0]?.Message} — ${r.Errors?.[0]?.Details}`);
    }

    if (r.Warnings?.length) {
      for (const w of r.Warnings) console.log(`     ⚠ ${w.Message}`);
    }
    console.log();
  }

  console.log("✅ Готово! Ключевые цели привязаны.");
  console.log("   Проверь: https://direct.yandex.ru → Кампания → Стратегия → Ключевая цель\n");
}

main().catch((e) => {
  console.error(`\n❌ ${(e as Error).message}\n`);
  process.exit(1);
});
