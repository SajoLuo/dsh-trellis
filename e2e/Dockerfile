FROM node:24.12.0-bookworm-slim@sha256:7326fb2dbdce998edd72140946851be64ef4a643e8715e138ca467e8e9d92c99
RUN apt-get update && apt-get install -y --no-install-recommends git python3 build-essential ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install --global pnpm@10.33.0
WORKDIR /work
COPY --chown=node:node package.json /work/package.json
COPY --chown=node:node e2e/package.json e2e/pnpm-lock.yaml e2e/run.mjs e2e/model.mjs e2e/fixture.py /work/e2e/
USER node
RUN pnpm --dir e2e install --frozen-lockfile
CMD ["pnpm", "run", "test:e2e", "--published"]
