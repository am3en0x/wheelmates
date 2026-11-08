#!/usr/bin/env bash
# Ships the code to the host and restarts the game: server/ and public/ go over ssh as a tar stream and are synced on the
# host with rsync --delete (so no rsync is needed on the PC), then production deps are installed with the host's private
# Node, the service restarts and health is checked. First time: run bootstrap.sh on the host.
# Usage: deploy/deploy.sh ubuntu@HOST
set -euo pipefail
host="${1:?usage: deploy.sh user@host}"
here="$(cd "$(dirname "$0")/.." && pwd)"
want="$(cat "$here/.nvmrc")"
have="$(ssh "$host" '/opt/wheelmates/node/bin/node --version 2>/dev/null' | sed 's/^v//')"
[ "${have%%.*}" = "${want%%.*}" ] || { echo "host's private Node is '$have', this repo wants $want: run bootstrap.sh"; exit 1; }
ship() { # ship DIR TARGET
  tar -C "$here/$1" --exclude node_modules --exclude '*.sqlite*' -czf - . |
    ssh "$host" "set -e; t=\$(mktemp -d); tar -xzf - -C \"\$t\"; sudo rsync -a --delete \"\$t/\" $2/; rm -rf \"\$t\""
}
ship server /opt/wheelmates/server
ship public /opt/wheelmates/web
ssh "$host" 'set -e; cd /opt/wheelmates/server && sudo env PATH=/opt/wheelmates/node/bin:$PATH npm ci --omit=dev --no-audit --no-fund && sudo chown -R wheelmates:wheelmates /opt/wheelmates/server /opt/wheelmates/web && sudo systemctl restart wheelmates && sleep 2 && curl -fsS http://127.0.0.1:8790/healthz'
echo
echo deployed
