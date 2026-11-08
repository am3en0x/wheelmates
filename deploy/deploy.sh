#!/usr/bin/env bash
# Deploys the server to the host: rsync server/, install production deps, restart the service.
# Usage: deploy/deploy.sh ubuntu@HOST   (first time: create the user, /opt/wheelmates, /var/lib/wheelmates, install the unit)
set -euo pipefail
host="${1:?usage: deploy.sh user@host}"
here="$(cd "$(dirname "$0")/.." && pwd)"
want="$(cat "$here/.nvmrc")"
have="$(ssh "$host" 'node --version' | sed 's/^v//')"
[ "${have%%.*}" = "${want%%.*}" ] || { echo "host runs Node $have, this repo wants $want"; exit 1; }
rsync -az --delete --exclude node_modules --exclude '*.sqlite*' "$here/server/" "$host:/opt/wheelmates/server/"
ssh "$host" 'cd /opt/wheelmates/server && npm ci --omit=dev && sudo systemctl restart wheelmates && sleep 1 && curl -fsS http://127.0.0.1:8790/healthz'
echo deployed
