#!/bin/bash
# Installs dependencies so Claude Code on the web can run `npm test`,
# `npm run lint` and `npm run knip`. Local sessions already have them.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# `npm install` rather than `npm ci`: it keeps an existing node_modules,
# so a resumed container starts quickly.
npm install --no-audit --no-fund
