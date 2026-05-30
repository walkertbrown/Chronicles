FROM node:22-alpine

WORKDIR /app

# Copy shared types first
COPY shared/ ./shared/

# Copy simulation package files and install dependencies
COPY simulation/package*.json ./simulation/
RUN cd simulation && npm ci --production=false

# Copy simulation source
COPY simulation/ ./simulation/

# Build TypeScript
RUN cd simulation && npm run build

# Remove dev dependencies after build
RUN cd simulation && npm prune --production

WORKDIR /app/simulation

EXPOSE 3001

CMD ["node", "dist/simulation/index.js"]
