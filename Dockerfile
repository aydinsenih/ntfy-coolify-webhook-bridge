FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY index.js ./
COPY src/ ./src/

EXPOSE 3000

CMD ["node", "index.js"]
