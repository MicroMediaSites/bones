FROM oven/bun:1.2-slim

WORKDIR /app
COPY index.ts package.json ./

# Railway mounts a volume here; without one this is an ephemeral container dir.
ENV DATA_DIR=/data
EXPOSE 8787

CMD ["bun", "run", "index.ts"]
