FROM node:22-alpine

WORKDIR /app

# install deps first (cached layer)
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# app source
COPY server.js ./
COPY drive.js ./
COPY github-backup.js ./
COPY mega-backup.js ./
COPY kali.js ./
COPY public ./public

# persistent data volumes
VOLUME ["/app/data", "/app/uploads"]

ENV PORT=3000
ENV NODE_ENV=production

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]
