#!/usr/bin/env bash
# One-time setup on the host (Ubuntu), run as a sudoer: a private Node 22 under /opt/wheelmates/node (the system node
# is left alone), Caddy from its official apt repository, the wheelmates user and directories, the systemd unit and
# the Caddyfile. Idempotent: safe to run again. Usage: sudo bash bootstrap.sh wheelmates.app
set -euo pipefail
domain="${1:?usage: bootstrap.sh DOMAIN}"
node_ver="22.17.0"
here="$(cd "$(dirname "$0")" && pwd)"

id -u wheelmates >/dev/null 2>&1 || useradd --system --home /opt/wheelmates --shell /usr/sbin/nologin wheelmates
mkdir -p /opt/wheelmates/server /opt/wheelmates/web /var/lib/wheelmates
chown -R wheelmates:wheelmates /var/lib/wheelmates

# swap for the small plan: npm ci on 1 GB without swap can get killed
if [ ! -f /swapfile ]; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# a private Node, pinned
if [ ! -x /opt/wheelmates/node/bin/node ] || [ "$(/opt/wheelmates/node/bin/node --version)" != "v$node_ver" ]; then
  tmp="$(mktemp -d)"
  curl -fsSL "https://nodejs.org/dist/v$node_ver/node-v$node_ver-linux-x64.tar.xz" -o "$tmp/node.tar.xz"
  rm -rf /opt/wheelmates/node
  mkdir -p /opt/wheelmates/node
  tar -xJf "$tmp/node.tar.xz" -C /opt/wheelmates/node --strip-components=1
  rm -rf "$tmp"
fi
/opt/wheelmates/node/bin/node --version

# Caddy
if ! command -v caddy >/dev/null; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi

# the service and the sites
sed "s/SITE_HOST/$domain/g" "$here/wheelmates.service" > /etc/systemd/system/wheelmates.service
sed "s/SITE_HOST/$domain/g" "$here/Caddyfile" > /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable wheelmates >/dev/null
systemctl reload caddy || systemctl restart caddy
echo "bootstrap done for $domain; deploy the code with deploy.sh, then: systemctl start wheelmates"
