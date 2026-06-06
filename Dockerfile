FROM node:20-alpine

WORKDIR /app

# Install dependencies dulu (layer cache-friendly)
COPY package*.json ./
RUN npm install --omit=dev

# Copy source
COPY server.cjs ./
COPY dashboard.cjs ./
COPY SOUL.md ./
COPY memories/ ./memories/

# Health check — disesuaikan dengan v10.0 API Response
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:9089/v1/models || exit 1

EXPOSE 9089

CMD ["node", "server.cjs"]