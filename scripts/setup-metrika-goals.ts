/**
 * Создаёт цели в Яндекс.Метрике через Management API.
 * Запуск: npm run setup:metrika
 *
 * Перед запуском добавь в .env:
 *   YANDEX_METRIKA_TOKEN=ваш_oauth_токен
 */

const COUNTER_ID = process.env.YANDEX_METRIKA_COUNTER_ID || "73068007";
const API_BASE = `https://api-metrika.yandex.net/management/v1/counter/${COUNTER_ID}`;

const token = process.env.YANDEX_OAUTH_TOKEN;
if (!token) {
  console.error("❌  Не задан YANDEX_OAUTH_TOKEN в .env");
  process.exit(1);
}

const GOALS = [
  // Беседки
  { name: "Беседка — отправка бронирования",   identifier: "gazebo_booking_submit"  },
  { name: "Беседка — бронирование успешно",     identifier: "gazebo_booking_success" },
  // PS Park
  { name: "PS Park — отправка бронирования",    identifier: "pspark_booking_submit"  },
  { name: "PS Park — бронирование успешно",     identifier: "pspark_booking_success" },
  // Офисы
  { name: "Офис — отправка заявки",             identifier: "office_inquiry_submit"  },
  { name: "Офис — заявка принята",              identifier: "office_inquiry_success" },
];

async function getExistingGoals(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/goals`, {
    headers: { Authorization: `OAuth ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ошибка получения целей: ${res.status} ${text}`);
  }
  const data = await res.json() as { goals: Array<{ conditions: Array<{ url: string }> }> };
  return data.goals.flatMap((g) => g.conditions.map((c) => c.url));
}

async function createGoal(name: string, identifier: string): Promise<void> {
  const res = await fetch(`${API_BASE}/goals`, {
    method: "POST",
    headers: {
      Authorization: `OAuth ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      goal: {
        name,
        type: "action",
        is_retargeting: 0,
        conditions: [{ type: "exact", url: identifier }],
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ошибка создания цели "${name}": ${res.status} ${text}`);
  }
}

async function main() {
  console.log(`\n🎯  Настройка целей Яндекс.Метрики (счётчик ${COUNTER_ID})\n`);

  let existingIdentifiers: string[];
  try {
    existingIdentifiers = await getExistingGoals();
    console.log(`📋  Уже существует целей: ${existingIdentifiers.length}`);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  let created = 0;
  let skipped = 0;

  for (const { name, identifier } of GOALS) {
    if (existingIdentifiers.includes(identifier)) {
      console.log(`⏭️   Пропускаем (уже есть): ${identifier}`);
      skipped++;
      continue;
    }

    try {
      await createGoal(name, identifier);
      console.log(`✅  Создана цель: ${identifier} — "${name}"`);
      created++;
    } catch (err) {
      console.error(`❌  ${(err as Error).message}`);
    }
  }

  console.log(`\n✨  Готово! Создано: ${created}, пропущено: ${skipped}\n`);
}

main();
