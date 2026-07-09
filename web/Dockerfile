# web/Dockerfile — production image for the self-hosted single-Node-process
# deployment target (a dedicated PC; see PLAN-audience-voting.md "Owner
# decisions"). Simple two-stage build: `next build` then `next start`.
#
# NEXT_PUBLIC_* values are inlined at build time (Next.js env-var rules), so
# they must be passed as build args. FIREBASE_SERVICE_ACCOUNT is a server-only
# secret and must NOT be a build arg — pass it as a runtime `-e` / compose env
# var instead, so it never ends up baked into an image layer.

FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_WORLD_NAME
ARG NEXT_PUBLIC_BUTTONDOWN_USERNAME
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_WORLD_NAME=${NEXT_PUBLIC_WORLD_NAME}
ENV NEXT_PUBLIC_BUTTONDOWN_USERNAME=${NEXT_PUBLIC_BUTTONDOWN_USERNAME}

RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Provide FIREBASE_SERVICE_ACCOUNT at `docker run -e FIREBASE_SERVICE_ACCOUNT=...`
# time (or via a compose env_file) — never bake it into the image.
EXPOSE 3000
CMD ["npm", "run", "start"]
