# Hearth has no dependencies, so the image is just Node plus the source.
FROM node:22-alpine

WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public

# Run unprivileged, and make sure the calendar's home is writable whether it
# stays inside the image or gets a mounted volume.
RUN mkdir -p /app/data && chown -R node:node /app
USER node

ENV PORT=4321
ENV HEARTH_DATA=/app/data/calendar.json
VOLUME ["/app/data"]
EXPOSE 4321

HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget -qO- http://127.0.0.1:4321/api/health || exit 1

CMD ["node", "server/index.js"]
