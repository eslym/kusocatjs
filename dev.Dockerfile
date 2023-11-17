# This docker file is only used for development purposes.

FROM mcr.microsoft.com/devcontainers/javascript-node:18-bullseye

ARG BUN_INSTALL=/usr/local

RUN apt update && apt upgrade -y \
    && apt clean \
    && curl -fsSL https://bun.sh/install > /root/install-bun.sh \
    && chmod +x /root/install-bun \
    && /root/install-bun \
    && corepack enable \
    && corepack prepare pnpm@latest --activate \
    && npm install -g npm@latest

ENV BUN_INSTALL=/usr/local

CMD echo container started && sleep infinity
