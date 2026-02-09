FROM oven/bun:1.2.20

WORKDIR /app

COPY package.json ./
RUN bun install --no-save

COPY . .
RUN bun run build

ENV NODE_ENV=production
EXPOSE 3002

CMD ["bun", "dist/index.js"]
