FROM node:22-bullseye-slim

RUN apt-get update && apt-get install -y graphicsmagick ghostscript && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

CMD ["node", "index.js"]
