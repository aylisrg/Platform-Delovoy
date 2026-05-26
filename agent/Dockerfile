FROM node:20-bookworm-slim

# git is required by Claude Code for repo operations
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI globally (as root, then drop privileges)
RUN npm install -g @anthropic-ai/claude-code

# node:20 image already has a 'node' user (uid=1000)
# Claude Code refuses --dangerously-skip-permissions when running as root
RUN mkdir -p /home/node/.claude /workspace \
    && chown -R node:node /home/node/.claude /workspace

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY --chown=node:node . .

USER node

CMD ["npx", "tsx", "index.ts"]
