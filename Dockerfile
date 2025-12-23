# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies for node-pty
RUN apk add --no-cache python3 py3-setuptools make g++ linux-headers

# Copy package files
COPY package*.json ./
COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/

# Install all dependencies including devDependencies
RUN npm install
RUN cd backend && npm install
RUN cd frontend && npm install

# Rebuild node-pty for the target platform
RUN cd backend && npm rebuild node-pty

# Copy source code
COPY . .

# Build frontend and backend  
RUN cd frontend && npx vite build
RUN cd backend && npx tsc

# Production stage
FROM node:20-alpine

WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache \
    bash \
    curl \
    git \
    github-cli \
    openssh-client \
    python3 \
    make \
    g++ \
    linux-headers

# Create non-root user for security
RUN addgroup -g 1001 -S bob && \
    adduser -S bob -u 1001 -G bob

# Copy built application (node_modules already has node-pty built for the same platform/arch)
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/backend/package*.json ./backend/
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/frontend/dist ./frontend/dist
COPY --from=builder /app/node_modules ./node_modules

# Copy agent install script
COPY scripts/install-agents.sh /usr/local/bin/install-agents
RUN chmod +x /usr/local/bin/install-agents

# ============================================
# Install AI Agents
# Uncomment the agents you want to include in the image
# ============================================

# Claude Code (Anthropic) - npm global install works as-is
RUN npm install -g @anthropic-ai/claude-code || echo "Claude Code installation skipped"

# Codex (OpenAI) - npm global install works as-is
RUN npm install -g @openai/codex || echo "Codex installation skipped"

# Gemini CLI (Google) - npm global install works as-is
RUN npm install -g @google/gemini-cli || echo "Gemini CLI installation skipped"

# OpenCode - Install and copy to system path
# The installer puts the binary in ~/.opencode/bin/
RUN curl -fsSL https://opencode.ai/install | bash && \
    cp "$HOME/.opencode/bin/opencode" /usr/local/bin/opencode 2>/dev/null && \
    chmod +x /usr/local/bin/opencode || \
    echo "OpenCode installation skipped"

# Kiro CLI - Install and copy to system path
# The installer puts the binary in ~/.local/bin/
RUN curl -fsSL https://cli.kiro.dev/install | bash && \
    cp /root/.local/bin/kiro-cli* /usr/local/bin/ 2>/dev/null && \
    chmod +x /usr/local/bin/kiro-cli* 2>/dev/null || \
    echo "Kiro CLI installation skipped"

# Cursor Agent (npm global - would work if uncommented)
# RUN npm install -g cursor-agent || echo "Cursor Agent installation skipped"

# Create data directories, config dirs, and ssh dir
RUN mkdir -p /data/bob /data/repos \
    /home/bob/.config/gh \
    /home/bob/.config/opencode \
    /home/bob/.local/share/opencode \
    /home/bob/.ssh \
    /home/bob/.claude \
    /home/bob/.gemini \
    /home/bob/.opencode \
    /home/bob/.kiro \
    /home/bob/.codex && \
    chmod 700 /home/bob/.ssh && \
    chown -R bob:bob /data /app /home/bob

# Create default OpenCode config with Claude Opus 4.5 from Anthropic
RUN echo '{"$schema":"https://opencode.ai/config.json","model":"anthropic/claude-opus-4-5","small_model":"anthropic/claude-haiku-4-5","autoupdate":false}' > /home/bob/.config/opencode/opencode.json && \
    chown bob:bob /home/bob/.config/opencode/opencode.json

# Environment variables
ENV NODE_ENV=production
ENV PORT=3001
ENV DOCKER_ENV=true
ENV BOB_DATA_DIR=/data/bob
ENV BOB_REPOS_DIR=/data/repos

# Expose port
EXPOSE 3001

# Switch to non-root user
USER bob

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3001/api/health || exit 1

# Start the application
CMD ["node", "backend/dist/server.js"]
