# syntax=docker/dockerfile:1

# Build stage: install every dependency and compile TypeScript to dist/.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# Runtime stage: production dependencies and the compiled output only.
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV NODE_OPTIONS=--max-old-space-size=128
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# Create /data directory for persistent storage (installations, backups)
RUN mkdir -p /data && chown node:node /data
# The node image ships an unprivileged "node" user (uid 1000).
USER node
# HTTP receiver listens on PORT (default 3000). Configuration comes from the
# environment, e.g. docker run --env-file .env.
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://localhost:' + (process.env.PORT || 3000) + '/healthz').catch(() => process.exit(1))"
CMD ["node", "dist/index.js"]
