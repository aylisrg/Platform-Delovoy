#!/bin/sh
# Блокирующие smoke-тесты живого деплоя: главная страница, страница PS Park,
# health PS Park API. Общий скрипт для обоих путей деплоя — вызывается из
# deploy-bluegreen.sh (до остановки старого слота, чтобы можно было
# откатиться) и из legacy-ветки deploy.yml (до объявления деплоя здоровым,
# чтобы сработал существующий rollback на CURRENT_IMAGE). Notifications
# health сюда намеренно не входит — она остаётся отдельной warn-only
# проверкой в deploy.yml ("Post-deploy status & notifications check"),
# на успех/провал деплоя не влияет (issue #570).
set -u

BASE_URL="${SMOKE_BASE_URL:-https://delovoy-park.ru}"
FAILED=0

if curl -sf -o /dev/null -w "%{http_code}" --max-time 10 "$BASE_URL/" | grep -q "200"; then
  echo "smoke-tests: ✅ Main page: 200 OK"
else
  echo "smoke-tests: ❌ Main page: FAILED"
  FAILED=$((FAILED + 1))
fi

if curl -sf -o /dev/null -w "%{http_code}" --max-time 10 "$BASE_URL/ps-park" | grep -q "200"; then
  echo "smoke-tests: ✅ PS Park page: 200 OK"
else
  echo "smoke-tests: ❌ PS Park page: FAILED"
  FAILED=$((FAILED + 1))
fi

if curl -sf --max-time 10 "$BASE_URL/api/ps-park/health" | grep -q "status"; then
  echo "smoke-tests: ✅ PS Park API health: OK"
else
  echo "smoke-tests: ❌ PS Park API health: FAILED"
  FAILED=$((FAILED + 1))
fi

if [ "$FAILED" -gt 0 ]; then
  echo "smoke-tests: $FAILED check(s) failed"
  exit 1
fi
echo "smoke-tests: all checks passed"
