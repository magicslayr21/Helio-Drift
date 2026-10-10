FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=8787 LEADERBOARD_DB=/data/leaderboard.sqlite
WORKDIR /app
COPY server/ ./server/
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8787
VOLUME ["/data"]
CMD ["node", "server/index.mjs"]
