#!/usr/bin/env bash
# Состояние прод-деплоя в git-тегах (issue #1074, #578):
#   refs/tags/deployed/current  — последний успешно задеплоенный SHA
#   refs/tags/deployed/previous — предыдущий (цель авто-отката error-budget)
#
# Работает только с GITHUB_TOKEN: чтение — contents: read, запись —
# contents: write (force-update lightweight-тега через Git refs API).
# Отдельный PAT (DEPLOY_STATE_TOKEN) и repo variables больше не нужны.
#
#   scripts/deploy-state.sh get current|previous   # печатает 40-hex SHA или пусто
#   scripts/deploy-state.sh record <sha>           # current -> previous, sha -> current
#
# Нужны env: GITHUB_REPOSITORY (owner/repo), GH_TOKEN (для gh).
# get: никогда не падает (fail-open: пусто = "неизвестно").
# record: падает громко, если теги не удалось обновить.
set -euo pipefail

REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY не задан}"
TAG_PREFIX="deployed"

is_sha() { [[ "${1:-}" =~ ^[0-9a-f]{40}$ ]]; }

get_tag() {
  local name="$1" out type sha
  out=$(gh api "repos/${REPO}/git/ref/tags/${TAG_PREFIX}/${name}" \
    --jq '.object.type + " " + .object.sha' 2>/dev/null) || { echo ""; return 0; }
  type="${out%% *}"
  sha="${out#* }"
  # Только lightweight-тег на коммит: аннотированный/битый = "неизвестно".
  if [ "$type" = "commit" ] && is_sha "$sha"; then echo "$sha"; else echo ""; fi
}

set_tag() {
  local name="$1" sha="$2"
  # Тег уже есть -> force-update; нет (404) -> создать.
  if gh api -X PATCH "repos/${REPO}/git/refs/tags/${TAG_PREFIX}/${name}" \
    -f sha="$sha" -F force=true >/dev/null 2>&1; then
    return 0
  fi
  gh api -X POST "repos/${REPO}/git/refs" \
    -f ref="refs/tags/${TAG_PREFIX}/${name}" -f sha="$sha" >/dev/null
}

cmd="${1:-}"
case "$cmd" in
  get)
    case "${2:-}" in
      current|previous) get_tag "$2" ;;
      *) echo "usage: $0 get current|previous" >&2; exit 2 ;;
    esac
    ;;
  record)
    new="${2:-}"
    if ! is_sha "$new"; then
      echo "::error::record: ожидался полный SHA (40 hex), получено '${new}'" >&2
      exit 2
    fi
    old=$(get_tag current)
    if [ -z "$old" ]; then
      # Одноразовая миграция со старой схемы (repo variable, #578): чтобы
      # первый деплой после перехода не потерял цель отката. Только чтение.
      legacy=$(gh api "repos/${REPO}/actions/variables/DEPLOYED_SHA_CURRENT" --jq .value 2>/dev/null || echo "")
      if is_sha "$legacy"; then old="$legacy"; fi
    fi
    if [ -n "$old" ] && [ "$old" != "$new" ]; then
      set_tag previous "$old"
    fi
    set_tag current "$new"
    now=$(get_tag current)
    if [ "$now" != "$new" ]; then
      echo "::error::${TAG_PREFIX}/current=${now:-<пусто>}, ожидалось ${new}" >&2
      exit 1
    fi
    echo "${TAG_PREFIX}/current=${new} (previous: ${old:-<нет>})"
    ;;
  *)
    echo "usage: $0 get current|previous | record <sha>" >&2
    exit 2
    ;;
esac
