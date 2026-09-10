#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
COMMAND_DIR="${HOME}/bin"
COMMAND_PATH="${COMMAND_DIR}/imgrelay"

mkdir -p "${COMMAND_DIR}"

cat >"${COMMAND_PATH}" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
exec "${SCRIPT_DIR}/termux-imgrelay.sh" "\$@"
EOF

chmod +x "${COMMAND_PATH}" "${SCRIPT_DIR}/termux-imgrelay.sh"

case ":${PATH}:" in
  *":${COMMAND_DIR}:"*) ;;
  *)
    PROFILE="${HOME}/.profile"
    if ! grep -qs 'export PATH="$HOME/bin:$PATH"' "${PROFILE}" 2>/dev/null; then
      printf '\nexport PATH="$HOME/bin:$PATH"\n' >>"${PROFILE}"
    fi
    export PATH="${COMMAND_DIR}:${PATH}"
    ;;
esac

echo "Installed command: imgrelay"
echo "Restart Termux, or run: source ~/.profile"
echo "Then start the relay with: imgrelay"
