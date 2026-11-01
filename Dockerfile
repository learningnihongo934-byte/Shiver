FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server server
COPY web web
COPY runtime runtime
COPY templates templates
ENV PORT=8781 SHIVER_DATA=/data
VOLUME /data
EXPOSE 8781
CMD ["node", "server/index.js"]
