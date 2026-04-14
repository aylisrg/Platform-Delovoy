#!/bin/bash
# Проверка SQL-миграций на деструктивные операции
# Используется в CI pipeline перед prisma migrate deploy
set -euo pipefail

FORBIDDEN_PATTERNS="DROP TABLE|DROP COLUMN|TRUNCATE|ALTER TABLE .* DROP"
EXIT_CODE=0
CHECKED=0
WARNINGS=0

echo "🔍 Проверяем миграции на деструктивные операции..."

for file in prisma/migrations/*/migration.sql; do
  [ -f "$file" ] || continue
  CHECKED=$((CHECKED + 1))

  if grep -iE "$FORBIDDEN_PATTERNS" "$file" > /dev/null 2>&1; then
    echo ""
    echo "⚠️  ДЕСТРУКТИВНАЯ ОПЕРАЦИЯ в $file:"
    grep -inE "$FORBIDDEN_PATTERNS" "$file" | while read -r line; do
      echo "   $line"
    done
    WARNINGS=$((WARNINGS + 1))
    EXIT_CODE=1
  fi
done

echo ""
echo "Проверено файлов: $CHECKED"
echo "Предупреждений: $WARNINGS"

if [ $EXIT_CODE -eq 0 ]; then
  echo "✅ Все миграции безопасны"
else
  echo ""
  echo "❌ Найдены деструктивные операции!"
  echo "   Если это намеренно, создайте PR с пометкой 'DESTRUCTIVE MIGRATION' для ревью."
fi

exit $EXIT_CODE
