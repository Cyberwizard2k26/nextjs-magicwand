# MagicWand RMM — Next.js platform + Phantom C2 engine (python builder included).
FROM public.ecr.aws/docker/library/node:24-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && pip3 install --break-system-packages pycdlib

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/app/data \
    PAYLOAD_DIR=/app/payloads \
    BUILD_DIR=/app/data/builds \
    DB_PATH=/app/data/c2.db \
    PYTHON_BIN=python3

RUN mkdir -p /app/data/builds

EXPOSE 3000

CMD ["npm", "run", "start"]
