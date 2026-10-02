FROM node:24-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv poppler-utils tesseract-ocr tesseract-ocr-eng && rm -rf /var/lib/apt/lists/*
COPY python/requirements.txt /tmp/parser-requirements.txt
RUN python3 -m venv /opt/parser && /opt/parser/bin/pip install --no-cache-dir -r /tmp/parser-requirements.txt
ENV PARSER_PYTHON=/opt/parser/bin/python3
ENV PYTHONDONTWRITEBYTECODE=1
COPY --chown=node:node package.json ./
# No lockfile is fabricated: registry access was unavailable during delivery.
# Release gate: generate/review package-lock.json, then replace this with npm ci.
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY --chown=node:node src ./src
COPY --chown=node:node python ./python
COPY --chown=node:node public ./public
COPY --chown=node:node docs/openapi.json ./docs/openapi.json
COPY --chown=node:node docs/university/openapi.json ./docs/university/openapi.json
COPY --chown=node:node docs/operations/openapi.json ./docs/operations/openapi.json
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node migrations ./migrations
USER node
EXPOSE 8080
CMD ["node","src/main.mjs"]
