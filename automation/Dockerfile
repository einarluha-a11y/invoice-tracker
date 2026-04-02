FROM node:22-bullseye-slim

RUN apt-get update && apt-get install -y graphicsmagick ghostscript && rm -rf /var/lib/apt/lists/*
RUN npm install -g pm2

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

# Start both API server (HTTP) and IMAP daemon (email polling) via PM2
CMD ["pm2-runtime", "start", "ecosystem.config.cjs"]
