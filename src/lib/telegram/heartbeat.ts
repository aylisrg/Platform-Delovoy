/**
 * Heartbeat-файл бота для docker healthcheck.
 *
 * Контейнер bot — long-polling процесс без открытых портов, поэтому его
 * «здоровье» нельзя проверить HTTP-пробой. Вместо этого бот раз в минуту
 * завершает цикл heartbeat (getMe + запись файла); healthcheck в
 * docker-compose проверяет свежесть файла (find -mmin -3), autoheal
 * перезапускает контейнер, если цикл перестал завершаться (зависший процесс,
 * заблокированный event loop, застрявший пул соединений).
 *
 * Важно: файл пишется по завершении цикла НЕЗАВИСИМО от исхода getMe —
 * недоступность Telegram (сетевой блок) не лечится рестартом контейнера,
 * и превращать сетевой сбой в restart-loop нельзя. Ловим именно «завис».
 */

import { stat, writeFile } from "node:fs/promises";

export const DEFAULT_HEARTBEAT_FILE = "/tmp/bot-healthy";

export function getHeartbeatFile(): string {
  return process.env.BOT_HEARTBEAT_FILE?.trim() || DEFAULT_HEARTBEAT_FILE;
}

/** Записать отметку «жив». Никогда не бросает — heartbeat не должен ронять бота. */
export async function writeHeartbeat(file: string = getHeartbeatFile()): Promise<boolean> {
  try {
    await writeFile(file, new Date().toISOString(), "utf8");
    return true;
  } catch (err) {
    console.error("[Bot] heartbeat: не смог записать файл:", err);
    return false;
  }
}

/** Возраст последней отметки в мс; null — файла нет/недоступен. */
export async function heartbeatAgeMs(file: string = getHeartbeatFile()): Promise<number | null> {
  try {
    const s = await stat(file);
    return Date.now() - s.mtimeMs;
  } catch {
    return null;
  }
}
