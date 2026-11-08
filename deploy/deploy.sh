#!/usr/bin/env bash
# Ships the code to the host and restarts the game: rsync server/ and web/, install production deps with the host's
# private Node, restart the service, check health. First time: run bootstrap.sh on the host.
# Usage: deploy/deploy.sh ubuntu@HOST
set -euo pipefail
host="${1:?usage: deploy.sh user@host}"
here="$(cd "$(dirname "$0")/.." && pwd)"
want="$(cat "$here/.nvmrc")"
have="$(ssh "$host" '/opt/wheelmates/node/bin/node --version 2>/dev/null' | sed 's/^v//')"
[ "${have%%.*}" = "${want%%.*}" ] || { echo "host's private Node is '$have', this repo wants $want: run bootstrap.sh"; exit 1; }
rsync -az --delete --exclude node_modules --exclude '*.sqlite*' --rsync-path='sudo rsync' "$here/server/" "$host:/opt/wheelmates/server/"
rsync -az --delete --rsync-path='sudo rsync' "$here/web/" "$host:/opt/wheelmates/web/"
ssh "$host" 'set -e; cd /opt/wheelmates/server && sudo env PATH=/opt/wheelmates/node/bin:$PATH npm ci --omit=dev --no-audit --no-fund && sudo chown -R wheelmates:wheelmates /opt/wheelmates/server /opt/wheelmates/web && sudo systemctl restart wheelmates && sleep 2 && curl -fsS http://127.0.0.1:8790/healthz'
echo
echo deployed
