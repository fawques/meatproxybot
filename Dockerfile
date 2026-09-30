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
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# The node image ships an unprivileged "node" user (uid 1000).
USER node
# Socket Mode only needs outbound connections, so no port is exposed.
# Configuration comes from the environment, e.g. docker run --env-file .env.
CMD ["node", "dist/index.js"]
