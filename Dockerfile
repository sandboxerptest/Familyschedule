# Hearth has no dependencies, so the image is just Node plus the source.
FROM node:22-alpine

WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public

ENV PORT=4321
ENV HEARTH_DATA=/app/data/calendar.json
VOLUME ["/app/data"]
EXPOSE 4321

HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget -qO- http://127.0.0.1:4321/api/health || exit 1

CMD ["node", "server/index.js"]
