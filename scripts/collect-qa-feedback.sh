#!/usr/bin/env bash
#
# collect-qa-feedback.sh — Extract common bug patterns from QA reports
#
# Usage:
#   ./scripts/collect-qa-feedback.sh                    # analyze all QA reports
#   ./scripts/collect-qa-feedback.sh docs/qa-reports/2026-04-14-feature-qa-report.md  # analyze specific report
#
# Collects recurring bug patterns from QA reports and saves them to
# .claude/feedback/qa-patterns.md so the Developer agent learns from past mistakes.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
QA_DIR="$ROOT_DIR/docs/qa-reports"
FEEDBACK_DIR="$ROOT_DIR/.claude/feedback"
PATTERNS_FILE="$FEEDBACK_DIR/qa-patterns.md"

mkdir -p "$FEEDBACK_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}Collecting QA feedback patterns...${NC}"

# Initialize patterns file if it doesn't exist
if [[ ! -f "$PATTERNS_FILE" ]]; then
  cat > "$PATTERNS_FILE" <<'EOF'
# QA Bug Patterns — Self-Improving Pipeline

> Этот файл автоматически обновляется после каждого QA-прогона.
> Developer agent читает его перед написанием кода, чтобы не повторять ошибки.
> Обновляется скриптом: `./scripts/collect-qa-feedback.sh`

---

## Частые ошибки

### TypeScript / Качество кода
<!-- Паттерны ошибок TypeScript добавляются автоматически -->

### API / Валидация
<!-- Паттерны ошибок API добавляются автоматически -->

### Тесты
<!-- Паттерны ошибок тестов добавляются автоматически -->

### RBAC / Безопасность
<!-- Паттерны ошибок безопасности добавляются автоматически -->

### Scope Creep
<!-- Случаи scope creep добавляются автоматически -->

---

## Статистика

| Дата | Отчёт | Кол-во багов | Категории |
|------|-------|-------------|-----------|
EOF
  echo -e "${GREEN}Created patterns file: ${PATTERNS_FILE}${NC}"
fi

# Determine which files to analyze
if [[ $# -gt 0 ]]; then
  FILES=("$@")
else
  FILES=()
  while IFS= read -r -d '' file; do
    FILES+=("$file")
  done < <(find "$QA_DIR" -name "*-qa-report.md" -print0 2>/dev/null | sort -z)
fi

if [[ ${#FILES[@]} -eq 0 ]]; then
  echo -e "${RED}No QA reports found in ${QA_DIR}${NC}"
  exit 0
fi

echo -e "Analyzing ${#FILES[@]} QA report(s)..."

# Count bug patterns across reports
declare -A CATEGORY_COUNTS
TOTAL_BUGS=0
TOTAL_REPORTS=${#FILES[@]}

for file in "${FILES[@]}"; do
  if [[ ! -f "$file" ]]; then
    echo -e "${RED}File not found: ${file}${NC}"
    continue
  fi

  filename=$(basename "$file")
  echo -e "  Analyzing: ${filename}"

  # Count FAIL occurrences
  fail_count=$(grep -ci "FAIL\|BUG\|баг\|ошибка\|проблема" "$file" 2>/dev/null || echo "0")
  TOTAL_BUGS=$((TOTAL_BUGS + fail_count))

  # Categorize bugs
  if grep -qi "any\|typescript\|тип\|strict" "$file" 2>/dev/null; then
    CATEGORY_COUNTS["typescript"]=$(( ${CATEGORY_COUNTS["typescript"]:-0} + 1 ))
  fi
  if grep -qi "api\|валидац\|zod\|apiResponse\|apiError\|endpoint" "$file" 2>/dev/null; then
    CATEGORY_COUNTS["api"]=$(( ${CATEGORY_COUNTS["api"]:-0} + 1 ))
  fi
  if grep -qi "тест\|test\|vitest\|mock\|coverage" "$file" 2>/dev/null; then
    CATEGORY_COUNTS["tests"]=$(( ${CATEGORY_COUNTS["tests"]:-0} + 1 ))
  fi
  if grep -qi "RBAC\|роль\|role\|permission\|доступ\|auth\|403\|безопасн" "$file" 2>/dev/null; then
    CATEGORY_COUNTS["rbac"]=$(( ${CATEGORY_COUNTS["rbac"]:-0} + 1 ))
  fi
  if grep -qi "scope.*creep\|лишн\|не.*описан\|вне.*скоуп\|не.*требова" "$file" 2>/dev/null; then
    CATEGORY_COUNTS["scope_creep"]=$(( ${CATEGORY_COUNTS["scope_creep"]:-0} + 1 ))
  fi

  # Add to statistics table
  date_part=$(echo "$filename" | grep -o '^[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}' || echo "unknown")
  categories=""
  for cat in "${!CATEGORY_COUNTS[@]}"; do
    if [[ ${CATEGORY_COUNTS[$cat]} -gt 0 ]]; then
      categories+="${cat}, "
    fi
  done
  categories="${categories%, }"

  # Check if this report is already in the stats
  if ! grep -q "$filename" "$PATTERNS_FILE" 2>/dev/null; then
    echo "| ${date_part} | ${filename} | ${fail_count} | ${categories:-none} |" >> "$PATTERNS_FILE"
  fi
done

# Summary
echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  QA Feedback Summary${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  Reports analyzed: ${TOTAL_REPORTS}"
echo -e "  Total bug mentions: ${TOTAL_BUGS}"
echo ""
echo -e "  Categories:"
for cat in "${!CATEGORY_COUNTS[@]}"; do
  echo -e "    ${cat}: ${CATEGORY_COUNTS[$cat]} reports"
done
echo ""
echo -e "${GREEN}Patterns saved to: ${PATTERNS_FILE}${NC}"
echo -e "${GREEN}Developer agent will read this file in future pipeline runs.${NC}"
