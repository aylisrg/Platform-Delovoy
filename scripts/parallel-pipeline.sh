#!/usr/bin/env bash
#
# parallel-pipeline.sh — Run multiple feature pipelines in parallel using git worktrees
#
# Usage:
#   ./scripts/parallel-pipeline.sh "Task 1" "Task 2" "Task 3"
#   ./scripts/parallel-pipeline.sh --max-parallel 2 "Task 1" "Task 2" "Task 3"
#   ./scripts/parallel-pipeline.sh --stages po,architect "Task 1" "Task 2"
#
# Each task gets its own git worktree and runs pipeline.sh independently.
# Results are collected and summarized at the end.

set -euo pipefail

# ── Config ──────────────────────────────────────────────────────────
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PIPELINE_SCRIPT="$ROOT_DIR/scripts/pipeline.sh"
TIMESTAMP=$(date +%Y-%m-%d)
MAX_PARALLEL="${PARALLEL_MAX:-3}"
WORKTREE_BASE="/tmp/delovoy-parallel-${TIMESTAMP}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# ── Defaults ────────────────────────────────────────────────────────
PIPELINE_ARGS=()
TASKS=()

# ── Parse args ──────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --max-parallel)
      MAX_PARALLEL="$2"
      shift 2
      ;;
    --stages|--from|--budget|--max-iterations)
      PIPELINE_ARGS+=("$1" "$2")
      shift 2
      ;;
    --dry-run|--no-pr)
      PIPELINE_ARGS+=("$1")
      shift
      ;;
    -h|--help)
      cat <<'HELPEOF'
Usage: ./scripts/parallel-pipeline.sh [options] "Task 1" "Task 2" ...

Runs multiple pipelines in parallel, each in its own git worktree.

Options:
  --max-parallel N    Max concurrent pipelines (default: 3)
  --stages STAGES     Passed to pipeline.sh
  --from STAGE        Passed to pipeline.sh
  --budget USD        Passed to pipeline.sh
  --max-iterations N  Passed to pipeline.sh
  --dry-run           Passed to pipeline.sh
  --no-pr             Passed to pipeline.sh
  -h, --help          Show this help

Environment variables:
  PARALLEL_MAX         Max concurrent pipelines (default: 3)
  PIPELINE_MODEL       Model override for pipeline.sh
  PIPELINE_BUDGET      Budget per stage for pipeline.sh
HELPEOF
      exit 0
      ;;
    *)
      TASKS+=("$1")
      shift
      ;;
  esac
done

if [[ ${#TASKS[@]} -eq 0 ]]; then
  echo -e "${RED}Error: at least one task required${NC}"
  echo "Usage: ./scripts/parallel-pipeline.sh \"Task 1\" \"Task 2\""
  exit 1
fi

# ── Setup ───────────────────────────────────────────────────────────
mkdir -p "$WORKTREE_BASE"

echo -e "${CYAN}"
cat <<'BANNER'
╔══════════════════════════════════════════════════════════════╗
║       Platform Delovoy — Parallel Agent Pipeline             ║
║                                                              ║
║   Multiple features in parallel via git worktrees            ║
╚══════════════════════════════════════════════════════════════╝
BANNER
echo -e "${NC}"

echo -e "${BLUE}Tasks: ${#TASKS[@]}${NC}"
echo -e "${BLUE}Max parallel: ${MAX_PARALLEL}${NC}"
echo -e "${BLUE}Pipeline args: ${PIPELINE_ARGS[*]:-none}${NC}"
echo ""

# Get current branch
CURRENT_BRANCH=$(git -C "$ROOT_DIR" branch --show-current)
echo -e "${BLUE}Base branch: ${CURRENT_BRANCH}${NC}"
echo ""

# ── Status tracking ─────────────────────────────────────────────────
declare -A TASK_STATUS
declare -A TASK_PIDS
declare -A TASK_WORKTREES
declare -A TASK_BRANCHES
declare -A TASK_LOGS

# ── Run a single task in a worktree ─────────────────────────────────
run_task_in_worktree() {
  local index="$1"
  local task="$2"

  # Generate branch name
  local task_slug
  task_slug=$(echo "$task" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-zа-яё0-9]/-/g' | sed 's/--*/-/g' | cut -c1-40)
  local branch="feature/${TIMESTAMP}-${task_slug}"
  local worktree_dir="${WORKTREE_BASE}/${index}-${task_slug}"
  local log_file="${WORKTREE_BASE}/${index}-${task_slug}.log"

  TASK_BRANCHES[$index]="$branch"
  TASK_WORKTREES[$index]="$worktree_dir"
  TASK_LOGS[$index]="$log_file"

  echo -e "${BLUE}[Task $index] Creating worktree: ${worktree_dir}${NC}"

  # Create worktree with new branch
  git -C "$ROOT_DIR" worktree add "$worktree_dir" -b "$branch" "$CURRENT_BRANCH" 2>/dev/null || {
    # Branch might already exist
    git -C "$ROOT_DIR" worktree add "$worktree_dir" "$CURRENT_BRANCH" 2>/dev/null
  }

  # Copy pipeline script and agents (they may not be in the worktree if uncommitted)
  cp -r "$ROOT_DIR/scripts" "$worktree_dir/scripts/" 2>/dev/null || true
  cp -r "$ROOT_DIR/agents" "$worktree_dir/agents/" 2>/dev/null || true

  echo -e "${GREEN}[Task $index] Starting pipeline: \"${task}\"${NC}"

  # Run pipeline in worktree
  (
    cd "$worktree_dir"
    bash ./scripts/pipeline.sh "${PIPELINE_ARGS[@]}" "$task" 2>&1
  ) > "$log_file" 2>&1

  return $?
}

# ── Parallel execution with semaphore ───────────────────────────────
RUNNING=0
COMPLETED=0
FAILED=0
TOTAL=${#TASKS[@]}

for i in "${!TASKS[@]}"; do
  task="${TASKS[$i]}"

  # Wait if at max parallel
  while [[ $RUNNING -ge $MAX_PARALLEL ]]; do
    # Wait for any child to finish
    for pid_idx in "${!TASK_PIDS[@]}"; do
      pid="${TASK_PIDS[$pid_idx]}"
      if ! kill -0 "$pid" 2>/dev/null; then
        # Process finished
        wait "$pid" 2>/dev/null
        exit_code=$?
        RUNNING=$((RUNNING - 1))

        if [[ $exit_code -eq 0 ]]; then
          TASK_STATUS[$pid_idx]="success"
          COMPLETED=$((COMPLETED + 1))
          echo -e "${GREEN}[Task $pid_idx] COMPLETED ✅${NC}"
        else
          TASK_STATUS[$pid_idx]="failed"
          FAILED=$((FAILED + 1))
          echo -e "${RED}[Task $pid_idx] FAILED ❌ (see ${TASK_LOGS[$pid_idx]})${NC}"
        fi
        unset "TASK_PIDS[$pid_idx]"
      fi
    done
    sleep 2
  done

  # Start task in background
  run_task_in_worktree "$i" "$task" &
  TASK_PIDS[$i]=$!
  TASK_STATUS[$i]="running"
  RUNNING=$((RUNNING + 1))

  echo -e "${CYAN}[Task $i] PID: ${TASK_PIDS[$i]} | Branch: ${TASK_BRANCHES[$i]:-pending}${NC}"
done

# Wait for remaining tasks
for pid_idx in "${!TASK_PIDS[@]}"; do
  pid="${TASK_PIDS[$pid_idx]}"
  wait "$pid" 2>/dev/null
  exit_code=$?

  if [[ $exit_code -eq 0 ]]; then
    TASK_STATUS[$pid_idx]="success"
    COMPLETED=$((COMPLETED + 1))
    echo -e "${GREEN}[Task $pid_idx] COMPLETED ✅${NC}"
  else
    TASK_STATUS[$pid_idx]="failed"
    FAILED=$((FAILED + 1))
    echo -e "${RED}[Task $pid_idx] FAILED ❌${NC}"
  fi
done

# ── Summary ─────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  Parallel Pipeline Summary${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

for i in "${!TASKS[@]}"; do
  task="${TASKS[$i]}"
  status="${TASK_STATUS[$i]:-unknown}"
  branch="${TASK_BRANCHES[$i]:-unknown}"
  log="${TASK_LOGS[$i]:-unknown}"

  if [[ "$status" == "success" ]]; then
    echo -e "  ${GREEN}✅ Task $i: ${task}${NC}"
  else
    echo -e "  ${RED}❌ Task $i: ${task}${NC}"
  fi
  echo -e "     Branch: ${branch}"
  echo -e "     Log: ${log}"
  echo ""
done

echo -e "  Total: ${TOTAL} | Completed: ${COMPLETED} | Failed: ${FAILED}"
echo ""

# ── Cleanup worktrees ───────────────────────────────────────────────
echo -e "${BLUE}Cleaning up worktrees...${NC}"
for i in "${!TASK_WORKTREES[@]}"; do
  worktree="${TASK_WORKTREES[$i]}"
  if [[ -d "$worktree" ]]; then
    git -C "$ROOT_DIR" worktree remove "$worktree" --force 2>/dev/null || true
  fi
done

if [[ $FAILED -gt 0 ]]; then
  echo -e "${RED}Some tasks failed — check logs above${NC}"
  exit 1
else
  echo -e "${GREEN}All tasks completed successfully!${NC}"
  exit 0
fi
