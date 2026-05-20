#!/bin/bash
# One-shot script to set up the Claude Code agent workspace on VPS.
# Run once as root (or with sudo) after the initial deploy:
#   sudo bash /opt/delovoy-park/scripts/setup-agent-workspace.sh
set -euo pipefail

WORKSPACE=/opt/claude-agent-workspace
REPO_URL=https://github.com/aylisrg/Platform-Delovoy.git
DEPLOY_USER=deploy

echo "=== Setting up Claude Code agent workspace ==="

if [ -d "$WORKSPACE/.git" ]; then
  echo "Workspace already exists at $WORKSPACE — pulling latest..."
  git -C "$WORKSPACE" pull --ff-only
else
  echo "Cloning repo into $WORKSPACE..."
  git clone "$REPO_URL" "$WORKSPACE"
fi

chown -R "$DEPLOY_USER:$DEPLOY_USER" "$WORKSPACE"
echo "Ownership set to $DEPLOY_USER"

# Configure git identity for agent commits
git -C "$WORKSPACE" config user.name  "Claude Code Agent"
git -C "$WORKSPACE" config user.email "agent@delovoy-park.ru"

echo ""
echo "=== Done ==="
echo ""
echo "Next steps:"
echo "  1. docker compose exec agent claude login"
echo "     (follow the OAuth URL that appears)"
echo "  2. docker compose restart agent"
echo ""
echo "To verify the agent is authenticated:"
echo "  docker compose exec agent claude --print 'git status' --no-interactive"
