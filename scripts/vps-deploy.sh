#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# VPS Deployment Script — slovo-backend (NestJS API)
# =============================================================================
# Runs ON the VPS as root. Triggered by the Forgejo release workflow via SSH.
# Replaces the former Ansible role `roles/custom/slovo-backend/`.
#
# Usage:   DEPLOY_TAG=abc1234 bash vps-deploy.sh
#
# Idempotent: safe to re-run. Handles both first deploy and updates.
# Only provisions missing infrastructure — it never clobbers what the
# slovo-propovedi playbook already manages (Docker, slovo user, buildx
# builder, traefik network, slovo-traefik.service).
# =============================================================================

# --- Configuration (override via env) ---
# DEPLOY_TAG is informational only (shown in the banner and verify output).
DEPLOY_TAG="${DEPLOY_TAG:-unknown}"
BACKEND_API_HOSTNAME="${BACKEND_API_HOSTNAME:-api.slovo-propovedi.ru}"
# ACME_EMAIL is required only when this script has to auto-provision Traefik.
ACME_EMAIL="${ACME_EMAIL:-}"

SERVICE=slovo-backend
IMAGE=slovo-backend:latest
CONTAINER=slovo-backend
NETWORK=slovo-backend
BASE_PATH=/slovo/backend
SRC_DIR=/slovo/backend/container-src
ENV_FILE="$BASE_PATH/env"
LABELS_FILE="$BASE_PATH/labels"
INTERNAL_PORT=3000
TRAEFIK_NETWORK=traefik
BUILDER=slovo-constrained
BUILDX_MEMORY="${BUILDX_MEMORY:-1g}"
BUILDX_CPU_QUOTA="${BUILDX_CPU_QUOTA:-80000}"
MEMORY=384m
STOP_GRACE=30
TRAEFIK_SERVICE="${TRAEFIK_SERVICE:-slovo-traefik.service}"
TRAEFIK_IMAGE="${TRAEFIK_IMAGE:-traefik:v3.4}"
TRAEFIK_BASE_PATH="${TRAEFIK_BASE_PATH:-/slovo/traefik}"

# --- Banner ---
echo "==============================================================="
echo "  VPS deployment — $SERVICE"
echo "  Tag:          $DEPLOY_TAG"
echo "  API hostname: $BACKEND_API_HOSTNAME"
echo "==============================================================="

# --- Ensure prerequisites (provision ONLY what is missing) ---
echo ">> Ensuring prerequisites..."

# Dependent infrastructure — the backend cannot run without these services.
# Fail fast with a clear message instead of crash-looping at start.
for svc in slovo-postgres slovo-pgbouncer slovo-minio; do
  if ! systemctl is-active --quiet "$svc"; then
    echo "ERROR: Required service $svc is not running. Start it before deploying the backend." >&2
    exit 1
  fi
done
echo "  dependent services: OK (slovo-postgres, slovo-pgbouncer, slovo-minio)"

# Docker — auto-install if missing
if ! command -v docker >/dev/null 2>&1; then
  echo "  Docker: missing -> installing..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
  echo "  Docker: installed"
else
  echo "  Docker: OK"
fi

# slovo user + group — create if missing (matches playbook slovo-base role).
# uid/gid are system-assigned, so capture them dynamically like the playbook does.
if ! getent group slovo >/dev/null 2>&1; then
  echo "  slovo group: missing -> creating..."
  groupadd --system slovo
fi
if ! id -u slovo >/dev/null 2>&1; then
  echo "  slovo user: missing -> creating..."
  useradd --system --no-create-home --shell /sbin/nologin --home /slovo --gid slovo slovo
fi
SLOVO_UID=$(id -u slovo)
SLOVO_GID=$(id -g slovo)
echo "  slovo user: OK (uid=$SLOVO_UID, gid=$SLOVO_GID)"

# buildx builder — create if missing (matches playbook slovo-buildx role)
if ! docker buildx inspect "$BUILDER" >/dev/null 2>&1; then
  echo "  buildx builder '$BUILDER': missing -> creating..."
  docker buildx create \
    --name "$BUILDER" \
    --driver docker-container \
    --driver-opt memory="$BUILDX_MEMORY" \
    --driver-opt cpu-quota="$BUILDX_CPU_QUOTA" \
    --bootstrap
fi
echo "  buildx builder: OK ($BUILDER)"

# traefik Docker network — create if missing
if ! docker network inspect "$TRAEFIK_NETWORK" >/dev/null 2>&1; then
  echo "  traefik network: missing -> creating..."
  docker network create "$TRAEFIK_NETWORK"
fi
echo "  traefik network: OK ($TRAEFIK_NETWORK)"

# Additional Docker networks — create if missing. At runtime the backend joins
# these networks to reach Traefik, PostgreSQL/PgBouncer and MinIO.
for net in slovo-backend slovo-postgres slovo-minio; do
  if ! docker network inspect "$net" >/dev/null 2>&1; then
    echo "  Docker network '$net': missing -> creating..."
    docker network create "$net"
  fi
  echo "  Docker network: OK ($net)"
done

# Traefik service — auto-provision ONLY if missing (playbook already runs it)
if ! systemctl is-active --quiet "$TRAEFIK_SERVICE" 2>/dev/null; then
  echo "  Traefik ($TRAEFIK_SERVICE): missing -> provisioning..."

  # ACME email is required for Let's Encrypt certificate registration
  if [ -z "$ACME_EMAIL" ]; then
    echo "ERROR: Traefik is not running and ACME_EMAIL is not set."
    echo ""
    echo "       To auto-provision Traefik, provide your Let's Encrypt email:"
    echo "         ACME_EMAIL=you@example.com bash /tmp/vps-deploy.sh"
    echo ""
    echo "       In the Forgejo workflow, add ACME_EMAIL as a repo secret."
    echo ""
    echo "       If Traefik is already running under a different service name,"
    echo "       set TRAEFIK_SERVICE=<name> and re-run this deploy."
    exit 1
  fi

  # Create Traefik directories
  mkdir -p "$TRAEFIK_BASE_PATH/config" "$TRAEFIK_BASE_PATH/acme"

  # Write Traefik static configuration
  cat > "$TRAEFIK_BASE_PATH/config/traefik.yml" <<TRAEFIK_YML
entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint:
          to: web-secure
          scheme: https
  web-secure:
    address: ":443"

certificatesResolvers:
  default:
    acme:
      email: $ACME_EMAIL
      storage: /etc/traefik/acme/acme.json
      httpChallenge:
        entryPoint: web

providers:
  docker:
    endpoint: unix:///var/run/docker.sock
    exposedByDefault: false
    network: traefik

log:
  level: INFO
TRAEFIK_YML

  # ACME storage file (Traefik requires 600 permissions)
  touch "$TRAEFIK_BASE_PATH/acme/acme.json"
  chmod 600 "$TRAEFIK_BASE_PATH/acme/acme.json"

  # Pull Traefik image
  echo "  Pulling $TRAEFIK_IMAGE..."
  docker pull "$TRAEFIK_IMAGE"

  # Write Traefik systemd service
  cat > "/etc/systemd/system/$TRAEFIK_SERVICE" <<TRAEFIK_SVC
[Unit]
Description=slovo-traefik
Requires=docker.service
After=docker.service
DefaultDependencies=no

[Service]
Type=simple
Environment="HOME=/root"
ExecStartPre=-/usr/bin/env sh -c '/usr/bin/env docker stop -t 30 slovo-traefik 2>/dev/null || true'
ExecStartPre=-/usr/bin/env sh -c '/usr/bin/env docker rm slovo-traefik 2>/dev/null || true'
ExecStartPre=/usr/bin/env docker create \\
    --rm \\
    --name=slovo-traefik \\
    --log-driver=none \\
    --publish=80:80 \\
    --publish=443:443 \\
    --mount type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock \\
    --mount type=bind,src=$TRAEFIK_BASE_PATH/config,dst=/etc/traefik \\
    --mount type=bind,src=$TRAEFIK_BASE_PATH/acme,dst=/etc/traefik/acme \\
    --network=traefik \\
    --label traefik.enable=false \\
    $TRAEFIK_IMAGE
ExecStart=/usr/bin/env docker start --attach slovo-traefik
ExecStop=-/usr/bin/env sh -c '/usr/bin/env docker stop -t 30 slovo-traefik 2>/dev/null || true'
Restart=always
RestartSec=5
SyslogIdentifier=slovo-traefik

[Install]
WantedBy=multi-user.target
TRAEFIK_SVC

  systemctl daemon-reload
  systemctl enable --now "$TRAEFIK_SERVICE"

  # Wait for Traefik to become active
  echo "  Waiting for Traefik to start..."
  # shellcheck disable=SC2034 # i is only used to bound the retry loop
  for i in $(seq 1 15); do
    if systemctl is-active --quiet "$TRAEFIK_SERVICE" 2>/dev/null; then
      break
    fi
    sleep 2
  done

  if ! systemctl is-active --quiet "$TRAEFIK_SERVICE" 2>/dev/null; then
    echo "ERROR: Traefik failed to start."
    systemctl status "$TRAEFIK_SERVICE" --no-pager -l || true
    exit 1
  fi
  echo "  Traefik: provisioned ($TRAEFIK_SERVICE active)"
else
  echo "  Traefik: OK ($TRAEFIK_SERVICE active)"
fi

# --- 1. Create paths ---
echo ">> Ensuring paths exist..."
mkdir -p "$BASE_PATH" "$SRC_DIR"
chown slovo:slovo "$BASE_PATH" "$SRC_DIR"
chmod 0750 "$BASE_PATH" "$SRC_DIR"

# --- 2. Verify env file (written by the release workflow) ---
# Secrets are generated on the CI runner and streamed to $ENV_FILE over SSH
# (stdin pipe), so this script never receives them. Ownership/permissions
# are already correct — just verify the file exists and is non-empty.
ENV_FILE="/slovo/backend/env"
if [ ! -s "$ENV_FILE" ]; then
    echo "ERROR: Env file $ENV_FILE does not exist or is empty." >&2
    echo "       The release workflow must write it before calling this script." >&2
    exit 1
fi
echo ">> Env file: OK ($ENV_FILE)"

# --- 3. Verify source code ---
# Source code is transferred by the Forgejo workflow (tar+ssh) before this
# script runs. The Dockerfile lives at the repository root, which is the
# build context root after the flatten.
echo ">> Verifying source code at $SRC_DIR..."
if [ ! -f "$SRC_DIR/Dockerfile" ]; then
  echo "ERROR: No source code found at $SRC_DIR."
  echo "       The workflow should transfer the code before running this script."
  exit 1
fi
chown -R slovo:slovo "$SRC_DIR"

# --- 4. Write Traefik labels (reproduces playbook labels.j2) ---
# Single API router (slovo-backend-api) pointing at the service on port
# 3000. The backticks in the Host() rule are Traefik syntax — they must be
# preserved literally.
echo ">> Writing Traefik labels..."
{
  printf 'traefik.enable=true\n'
  printf 'traefik.docker.network=%s\n' "$TRAEFIK_NETWORK"
  printf 'traefik.http.services.slovo-backend.loadbalancer.server.port=%s\n' "$INTERNAL_PORT"
  # shellcheck disable=SC2016 # backticks are literal Traefik Host() syntax
  printf 'traefik.http.routers.slovo-backend-api.rule=Host(`%s`)\n' "$BACKEND_API_HOSTNAME"
  printf 'traefik.http.routers.slovo-backend-api.service=slovo-backend\n'
  printf 'traefik.http.routers.slovo-backend-api.entrypoints=web-secure\n'
  printf 'traefik.http.routers.slovo-backend-api.tls=true\n'
  printf 'traefik.http.routers.slovo-backend-api.tls.certResolver=default\n'
  printf 'traefik.http.routers.slovo-backend-api.middlewares=slovo-rate-limit@file\n'
} > "$LABELS_FILE"
chmod 0640 "$LABELS_FILE"
chown slovo:slovo "$LABELS_FILE"

# --- 5. Create Docker network (if missing) ---
echo ">> Ensuring Docker network '$NETWORK'..."
docker network inspect "$NETWORK" >/dev/null 2>&1 \
  || docker network create "$NETWORK"

# --- 6. Build Docker image ---
echo ">> Building Docker image (this may take a minute)..."
if ! docker buildx build \
  --builder="$BUILDER" \
  --load \
  --tag="$IMAGE" \
  "$SRC_DIR"; then
  echo "ERROR: Docker image build failed for $IMAGE from $SRC_DIR"
  exit 1
fi

# --- 7. Write systemd unit (reproduces playbook slovo-backend.service.j2) ---
# The container joins 4 networks: the primary (--network) plus traefik,
# slovo-postgres and slovo-minio via ExecStartPre network connects.
# Runs read-only with a small writable tmpfs at /tmp and a 384m memory cap
# (the Node heap is capped via NODE_OPTIONS in the env file).
echo ">> Writing systemd unit..."
cat > /etc/systemd/system/slovo-backend.service <<EOF
[Unit]
Description=Slovo Backend (slovo-backend)
Requires=docker.service slovo-postgres.service slovo-pgbouncer.service slovo-minio.service
After=docker.service slovo-postgres.service slovo-pgbouncer.service slovo-minio.service
Wants=$TRAEFIK_SERVICE
DefaultDependencies=no

[Service]
Type=simple
Environment="HOME=/root"
ExecStartPre=-/usr/bin/env sh -c '/usr/bin/env docker rm -f $CONTAINER 2>/dev/null || true'
ExecStartPre=/usr/bin/env docker create \\
    --rm \\
    --name=$CONTAINER \\
    --log-driver=none \\
    --user=$SLOVO_UID:$SLOVO_GID \\
    --cap-drop=ALL \\
    --read-only \\
    --network=$NETWORK \\
    --env-file=$ENV_FILE \\
    --label-file=$LABELS_FILE \\
    --tmpfs=/tmp:rw,noexec,nosuid,size=64m \\
    --memory=$MEMORY \\
    $IMAGE
ExecStartPre=-/usr/bin/env sh -c '/usr/bin/env docker network connect $TRAEFIK_NETWORK $CONTAINER 2>/dev/null || true'
ExecStartPre=-/usr/bin/env sh -c '/usr/bin/env docker network connect slovo-postgres $CONTAINER 2>/dev/null || true'
ExecStartPre=-/usr/bin/env sh -c '/usr/bin/env docker network connect slovo-minio $CONTAINER 2>/dev/null || true'
ExecStart=/usr/bin/env docker start --attach $CONTAINER
ExecStop=-/usr/bin/env sh -c '/usr/bin/env docker stop -t $STOP_GRACE $CONTAINER 2>/dev/null || true'
ExecStop=-/usr/bin/env sh -c '/usr/bin/env docker rm $CONTAINER 2>/dev/null || true'
Restart=always
RestartSec=30
SyslogIdentifier=slovo-backend

[Install]
WantedBy=multi-user.target
EOF

# --- 8. Reload, enable and restart ---
echo ">> Reloading systemd and restarting service..."
systemctl daemon-reload
systemctl enable slovo-backend.service >/dev/null 2>&1 || true
systemctl restart slovo-backend.service

# --- 9. Verify ---
sleep 2
if systemctl is-active --quiet slovo-backend.service; then
  echo "[OK] slovo-backend.service is running"
  echo "[OK] Deployment of $DEPLOY_TAG complete"
  echo "     API:  https://$BACKEND_API_HOSTNAME"
else
  echo "ERROR: slovo-backend.service failed to start"
  systemctl status slovo-backend.service --no-pager -l || true
  exit 1
fi

# --- 10. Cleanup ---
rm -f /tmp/vps-deploy.sh
echo ">> Done."
