#!/bin/bash
# disk-usage-report.sh — Диагностика использования дискового пространства
# Помогает найти что занимает место на диске

set -euo pipefail

YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m'

echo -e "${YELLOW}📊 Disk Usage Report${NC}"
echo ""

echo "=== Root filesystem ==="
df -h / | tail -1

echo ""
echo "=== Docker system usage ==="
docker system df

echo ""
echo "=== Top Docker images by size ==="
docker images --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}" | head -20

echo ""
echo "=== Top Docker volumes by size ==="
du -sh /var/lib/docker/volumes/*/ 2>/dev/null | sort -rh | head -10 || echo "No volumes found"

echo ""
echo "=== Docker containers using most space ==="
docker ps -a --format "table {{.ID}}\t{{.Names}}\t{{.Size}}" | head -20

echo ""
echo "=== Dangling images (can be removed) ==="
docker images -f "dangling=true" --format "table {{.ID}}\t{{.Size}}"

echo ""
echo "=== Dangling volumes (can be removed) ==="
docker volume ls -f "dangling=true" --format "table {{.Name}}"

echo ""
echo -e "${GREEN}💡 To free space: run ${YELLOW}./scripts/docker-cleanup.sh${NC}"
