# This docker file is only used for development purposes.

FROM mcr.microsoft.com/devcontainers/javascript-node:18-bullseye

ARG BUN_INSTALL=/usr/local
ARG BUN_VERSION=bun-v1.0.12

RUN apt update && apt upgrade -y \
    && apt install -y lldb siege wrk curl \
    && apt clean \
    && curl -fsSL https://bun.sh/install > /usr/local/bin/install-bun \
    && chmod +x /usr/local/bin/install-bun \
    && /usr/local/bin/install-bun $BUN_VERSION debug-info \
    && corepack enable \
    && corepack prepare pnpm@latest --activate \
    && npm install -g npm@latest

ENV BUN_INSTALL=/usr/local

CMD echo container started && sleep infinity
