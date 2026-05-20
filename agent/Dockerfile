FROM node:20-bookworm-slim

# git is required by Claude Code for repo operations
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

CMD ["npx", "tsx", "index.ts"]
