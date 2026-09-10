#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
RELAY_JS="${SCRIPT_DIR}/openai-image-local-relay.cjs"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed in Termux."
  echo "Run: pkg install nodejs"
  exit 1
fi

if [ ! -f "${RELAY_JS}" ]; then
  echo "Relay file not found: ${RELAY_JS}"
  exit 1
fi

echo "Starting GPT image relay..."
echo "Local relay URL: http://127.0.0.1:${OPENAI_IMAGE_RELAY_PORT:-8787}"
echo "Keep this Termux session open while generating images."
exec node "${RELAY_JS}"
