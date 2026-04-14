#!/bin/bash
# Запуск локальной dev-среды: Docker (PostgreSQL + Redis) + Next.js dev server
# Использование: npm run dev:full  или  ./scripts/dev-start.sh

set -e

echo "==> Запуск PostgreSQL и Redis..."
docker compose -f docker-compose.dev.yml up -d

echo "==> Ожидание готовности PostgreSQL..."
until docker exec delovoy-postgres pg_isready -U delovoy -d delovoy_park > /dev/null 2>&1; do
  sleep 1
done
echo "    PostgreSQL готов"

echo "==> Ожидание готовности Redis..."
until docker exec delovoy-redis redis-cli ping > /dev/null 2>&1; do
  sleep 1
done
echo "    Redis готов"

echo "==> Применение миграций Prisma..."
npx prisma migrate deploy 2>/dev/null || npx prisma db push --skip-generate 2>/dev/null || true

echo "==> Генерация Prisma Client..."
npx prisma generate

echo ""
echo "============================================"
echo "  Открой в браузере: http://localhost:3000"
echo "  Hot reload включён — сохраняй файл и"
echo "  изменения появятся автоматически"
echo "============================================"
echo ""

echo "==> Запуск Next.js dev server..."
exec npm run dev
