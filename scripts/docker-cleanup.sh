#!/bin/bash
# docker-cleanup.sh — Регулярная очистка Docker системы для экономии дискового пространства
# Должен запускаться перед каждым build или в cron (например, каждый день в 2 ночи)

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}🧹 Docker cleanup started...${NC}"

# Get disk usage before
BEFORE=$(df / | tail -1 | awk '{print $5}' | sed 's/%//')

# Remove unused images, containers, networks, and build cache
echo "Removing unused images and containers..."
docker image prune -af --filter "until=72h" 2>/dev/null || true
docker container prune -f 2>/dev/null || true
docker network prune -f 2>/dev/null || true

# Clean builder cache (most aggressive — frees up space)
echo "Cleaning builder cache..."
docker builder prune -af 2>/dev/null || true

# Remove dangling volumes (orphaned from removed containers)
echo "Removing dangling volumes..."
docker volume prune -f 2>/dev/null || true

# Get disk usage after
AFTER=$(df / | tail -1 | awk '{print $5}' | sed 's/%//')
FREED=$(( BEFORE - AFTER ))

if [[ $FREED -gt 0 ]]; then
  echo -e "${GREEN}✅ Cleanup complete. Freed: ~${FREED}% of disk space${NC}"
else
  echo -e "${YELLOW}⚠️  No significant space freed (already clean)${NC}"
fi

echo "Disk usage after cleanup: ${AFTER}%"
