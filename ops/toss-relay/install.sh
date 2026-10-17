#!/usr/bin/env bash
# Dedicated Oracle Always Free Ubuntu VM: install/configure existing market-data
# relay WITHOUT reading Toss credentials, billing APIs, or GitHub secrets.
# Usage: sudo env TOSS_RELAY_DOMAIN=... TOSS_RESERVED_IP=... \
#     TOSS_RELAY_REPLACE_CADDY=1 bash ops/toss-relay/install.sh prepare
# Then edit /etc/toss-relay/env locally and repeat with 'activate'.
set -Eeuo pipefail
umask 077
mode="${1:-prepare}"
[[ "$mode" == prepare || "$mode" == activate ]] || { echo 'INVALID_MODE: prepare|activate' >&2; exit 2; }
[[ "$(id -u)" == 0 ]] || { echo 'ROOT_REQUIRED' >&2; exit 2; }
[[ -r /etc/os-release ]] || { echo 'UBUNTU_REQUIRED' >&2; exit 2; }
# shellcheck disable=SC1091
source /etc/os-release
[[ "${ID:-}" == ubuntu ]] || { echo 'UBUNTU_REQUIRED' >&2; exit 2; }
domain="${TOSS_RELAY_DOMAIN:-}"
expected="${TOSS_RESERVED_IP:-}"
[[ "$domain" =~ ^[a-z0-9]([a-z0-9.-]{1,251})[a-z0-9]$ && "$domain" == *.* && "$domain" != *..* ]] || { echo 'DOMAIN_INVALID' >&2; exit 2; }
[[ "$expected" =~ ^[0-9.]+$ ]] || { echo 'RESERVED_IP_INVALID' >&2; exit 2; }
for bin in node caddy curl getent systemctl python3; do
  command -v "$bin" >/dev/null || { echo "PREREQUISITE_MISSING_${bin}" >&2; exit 2; }
done
python3 - "$expected" <<'PY'
import ipaddress,sys
ip=ipaddress.ip_address(sys.argv[1])
if ip.version != 4 or not ip.is_global: raise SystemExit('RESERVED_IP_INVALID')
PY
major="$(node -p 'Number(process.versions.node.split(".")[0])')"
(( major >= 22 )) || { echo 'NODE_22_OR_NEWER_REQUIRED' >&2; exit 2; }
# DO NOT confuse an OCI reserved inbound address with the actual outbound IP
# whitelisted by Toss. Refuse setup if they differ.
egress="$(curl -4 -fsS --connect-timeout 7 --max-time 15 https://api.ipify.org)" || { echo 'OUTBOUND_IP_PROBE_FAILED' >&2; exit 3; }
[[ "$egress" == "$expected" ]] || { echo 'OUTBOUND_RESERVED_IP_MISMATCH' >&2; exit 3; }
getent ahostsv4 "$domain" | awk '{print $1}' | grep -Fxq "$expected" || {
  echo 'DNS_A_RECORD_NOT_MATCHING_RESERVED_IP' >&2; exit 3;
}
root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
src="$root_dir/scripts/toss-free-relay.mjs"
[[ -r "$src" ]] || { echo 'RELAY_SOURCE_MISSING' >&2; exit 2; }
if [[ "$mode" == activate ]]; then
  [[ -f /etc/toss-relay/env ]] || { echo 'PRIVATE_ENV_FILE_MISSING' >&2; exit 4; }
  [[ "$(stat -c '%a' /etc/toss-relay/env)" == 600 ]] || { echo 'PRIVATE_ENV_PERMISSIONS_INVALID' >&2; exit 4; }
  for key in TOSS_CLIENT_ID TOSS_CLIENT_SECRET TOSS_RELAY_SHARED_KEY; do
    grep -Eq "^${key}=[^[:space:]]+$" /etc/toss-relay/env || { echo "PRIVATE_ENV_${key}_MISSING" >&2; exit 4; }
  done
  grep -Eq "^TOSS_RELAY_SHARED_KEY=[A-Za-z0-9_+/=-]{32,512}$" /etc/toss-relay/env || { echo 'SHARED_KEY_INVALID' >&2; exit 4; }
  grep -Eq '^TOSS_CLIENT_(ID|SECRET)=REPLACE_ME$' /etc/toss-relay/env && { echo 'PRIVATE_ENV_PLACEHOLDER_PRESENT' >&2; exit 4; }
fi

if id tossrelay >/dev/null 2>&1; then
  [[ "$(id -u tossrelay)" != 0 ]] || { echo 'SERVICE_USER_INVALID' >&2; exit 2; }
else
  useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin tossrelay
fi
install -d -o root -g root -m 0755 /opt/toss-relay
install -d -o root -g root -m 0700 /etc/toss-relay
install -o root -g root -m 0644 "$src" /opt/toss-relay/relay.mjs
if [[ ! -e /etc/toss-relay/env ]]; then
  install -o root -g root -m 0600 /dev/null /etc/toss-relay/env
  printf 'TOSS_CLIENT_ID=REPLACE_ME\nTOSS_CLIENT_SECRET=REPLACE_ME\nTOSS_RELAY_SHARED_KEY=REPLACE_ME\n' > /etc/toss-relay/env
fi

cat > /etc/systemd/system/toss-relay.service <<'UNIT'
[Unit]
Description=Toss read-only market-data relay
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=tossrelay
Group=tossrelay
WorkingDirectory=/opt/toss-relay
EnvironmentFile=/etc/toss-relay/env
Environment=PORT=18761
ExecStart=/usr/bin/node /opt/toss-relay/relay.mjs
Restart=on-failure
RestartSec=5s
TimeoutStartSec=30s
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
LockPersonality=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
CapabilityBoundingSet=
AmbientCapabilities=
UMask=0077

[Install]
WantedBy=multi-user.target
UNIT
[[ "$(command -v node)" == /usr/bin/node ]] || { echo 'NODE_PATH_NOT_USR_BIN' >&2; exit 2; }

# Caddy config is intentionally fail-closed for shared servers. The VM must be
# dedicated; only explicit confirmation permits replacing its default Caddyfile.
if [[ -f /etc/caddy/Caddyfile ]] && ! grep -q '^# managed-by: portfolio-toss-relay-v1$' /etc/caddy/Caddyfile; then
  [[ "${TOSS_RELAY_REPLACE_CADDY:-}" == 1 ]] || { echo 'EXISTING_CADDY_CONFIG_REFUSED' >&2; exit 4; }
fi
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
cat > "$tmp" <<EOF
# managed-by: portfolio-toss-relay-v1
$domain {
  # Public endpoint only exposes an authenticated, market-data-only proxy.
  @fetch path /v1/fetch
  handle @fetch {
    reverse_proxy 127.0.0.1:18761
  }
  handle {
    respond "Not Found" 404
  }
}
EOF
caddy validate --adapter caddyfile --config "$tmp" >/dev/null
install -o root -g root -m 0644 "$tmp" /etc/caddy/Caddyfile
systemctl daemon-reload
if [[ "$mode" == prepare ]]; then
  printf '%s\n' 'RELAY_PREPARED_NO_SECRETS_IN_GIT' \
    'NEXT: sudoedit /etc/toss-relay/env (replace three placeholders; shared key: openssl rand -hex 32)' \
    'THEN: rerun installer with activate (do not post credentials in ChatGPT)'
  exit 0
fi
# Only activation with previously created, root-private credentials starts
# the protected relay and the public HTTPS endpoint.
systemctl enable --now toss-relay
systemctl restart toss-relay
systemctl enable --now caddy
systemctl reload caddy
curl -fsS --max-time 10 http://127.0.0.1:18761/healthz >/dev/null || { echo 'LOCAL_RELAY_HEALTH_FAILED' >&2; exit 5; }
# Caddy manages TLS automatically, DNS and OCI 80/443 ingress must be ready.
status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 25 -X POST -H 'content-type: application/json' --data '{}' "https://$domain/v1/fetch")" || { echo 'HTTPS_OR_CERT_NOT_READY' >&2; exit 5; }
[[ "$status" == 401 ]] || { echo 'HTTPS_AUTH_GATE_FAILED' >&2; exit 5; }
echo 'RELAY_ACTIVATED_HTTPS_AUTH_PROTECTED'
echo 'NEXT: register the verified outbound reserved IP in Toss WTS and run the market-data-only 005930 live smoke check'
