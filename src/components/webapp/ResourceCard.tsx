"use client";

import Link from "next/link";
import Image from "next/image";
import type { WebAppIconName } from "@/lib/webapp/icon-names";
import { useTelegram } from "./TelegramProvider";
import { Badge, Card, Icon } from "./ui";

interface ResourceCardProps {
  id: string;
  name: string;
  description?: string | null;
  capacity?: number | null;
  pricePerHour?: string | number | null;
  imageUrl?: string | null;
  href: string;
  /** Иконка ресурса вместо эмодзи-заглушки (AC-7.3). */
  icon?: WebAppIconName;
}

/**
 * Карточка ресурса (беседка, зона Плей Парка): фото — если есть, иначе
 * иконка-плашка. Все цвета — токены темы Telegram, градиентов нет (AC-7.2).
 */
export function ResourceCard({
  name,
  description,
  capacity,
  pricePerHour,
  imageUrl,
  href,
  icon = "calendar",
}: ResourceCardProps) {
  const { haptic } = useTelegram();

  const price = pricePerHour ? Number(pricePerHour) : null;

  return (
    <Link href={href} onClick={() => haptic.impact("light")} className="block">
      <Card>
        {imageUrl && (
          <div className="relative aspect-[16/9]">
            <Image
              src={imageUrl}
              alt={name}
              fill
              sizes="(max-width: 640px) 100vw, 50vw"
              className="object-cover"
              unoptimized
            />
          </div>
        )}

        <div className="flex items-start gap-3 p-4">
          {!imageUrl && (
            <span
              className="flex items-center justify-center w-11 h-11 rounded-xl shrink-0"
              style={{
                background: "var(--tg-secondary-bg)",
                color: "var(--tg-accent)",
              }}
            >
              <Icon name={icon} size={22} />
            </span>
          )}

          <div className="flex-1 min-w-0">
            <h3 className="text-[17px] font-semibold leading-tight">{name}</h3>
            {description && (
              <p
                className="mt-1 text-[14px] leading-snug"
                style={{ color: "var(--tg-subtitle)" }}
              >
                {description}
              </p>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              {price !== null && (
                <Badge tone="accent">
                  {price.toLocaleString("ru-RU")} ₽/час
                </Badge>
              )}
              {capacity ? (
                <span
                  className="inline-flex items-center gap-1 text-[13px]"
                  style={{ color: "var(--tg-hint)" }}
                >
                  <Icon name="users" size={14} />
                  до {capacity} чел.
                </span>
              ) : null}
            </div>
          </div>

          <span
            className="shrink-0 self-center"
            style={{ color: "var(--tg-hint)" }}
          >
            <Icon name="chevron-right" size={18} />
          </span>
        </div>
      </Card>
    </Link>
  );
}
