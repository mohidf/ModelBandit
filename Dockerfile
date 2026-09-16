# One image for the whole app: the Express backend serves the built React
# frontend from the same origin, so the session cookie needs no cross-site
# setup. Build context is the repo root.
#
#   docker build -t modelbandit .
#   docker run -p 3000:3000 --env-file backend/.env modelbandit

FROM node:22-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
# Empty VITE_API_URL means "same origin as the page".
ENV VITE_API_URL=
RUN npm run build

FROM node:22-alpine AS backend
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --no-audit --no-fund
COPY backend/ ./
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=backend  /app/backend/dist          ./backend/dist
COPY --from=backend  /app/backend/node_modules  ./backend/node_modules
COPY --from=backend  /app/backend/package.json  ./backend/package.json
COPY --from=backend  /app/backend/drizzle       ./backend/drizzle
COPY --from=backend  /app/backend/drizzle.config.ts ./backend/drizzle.config.ts
COPY --from=frontend /app/frontend/dist         ./frontend/dist
WORKDIR /app/backend
EXPOSE 3000
CMD ["node", "dist/index.js"]
