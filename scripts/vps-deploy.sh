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
# Scope: this script owns ONLY the slovo-backend container and its own
# `slovo-backend` Docker network. All shared infrastructure — Docker, the
# `slovo` user/group, the buildx builder, Traefik, PostgreSQL / PgBouncer /
# MinIO and their Docker networks — is owned by the slovo-propovedi playbook.
# Missing infrastructure is a HARD ERROR here; it is never auto-provisioned.
# Run the playbook first:  just setup-all  (or: just setup-service <name>).
#
# Idempotent: safe to re-run. Handles both the first backend deploy and updates.
# =============================================================================

# --- Configuration (override via env) ---
# DEPLOY_TAG is informational only (shown in the banner and verify output).
DEPLOY_TAG="${DEPLOY_TAG:-unknown}"
BACKEND_API_HOSTNAME="${BACKEND_API_HOSTNAME:-api.slovo-propovedi.ru}"

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
MEMORY=1g
STOP_GRACE=30
TRAEFIK_SERVICE="${TRAEFIK_SERVICE:-slovo-traefik.service}"

# Shared infrastructure this deploy depends on but does NOT own (playbook-managed).
REQUIRED_SERVICES="slovo-postgres slovo-pgbouncer slovo-minio $TRAEFIK_SERVICE"
REQUIRED_NETWORKS="$TRAEFIK_NETWORK slovo-postgres slovo-minio"

# --- Banner ---
echo "==============================================================="
echo "  VPS deployment — $SERVICE"
echo "  Tag:          $DEPLOY_TAG"
echo "  API hostname: $BACKEND_API_HOSTNAME"
echo "==============================================================="

# --- Verify prerequisites (playbook-owned; never auto-provisioned) ---
# This script owns ONLY the slovo-backend container and the slovo-backend
# network (created in step 5). Everything checked below is provisioned by the
# slovo-propovedi playbook (`just setup-all`). Anything missing fails fast with
# a clear message instead of a half-provisioned box or a crash-looping service.
echo ">> Verifying prerequisites..."

fail_missing() {
  echo "ERROR: $1" >&2
  echo "       Shared infrastructure is owned by the slovo-propovedi playbook." >&2
  echo "       Provision it first:  just setup-all   (or: just setup-service <name>)" >&2
  exit 1
}

# Docker
command -v docker >/dev/null 2>&1 || fail_missing "Docker is not installed."
systemctl is-active --quiet docker || fail_missing "Docker service is not running."
echo "  Docker: OK"

# slovo user + group (playbook slovo-base role).
# uid/gid are system-assigned, so capture them dynamically like the playbook does.
getent group slovo >/dev/null 2>&1 || fail_missing "Group 'slovo' does not exist (playbook slovo-base role)."
id -u slovo >/dev/null 2>&1 || fail_missing "User 'slovo' does not exist (playbook slovo-base role)."
SLOVO_UID=$(id -u slovo)
SLOVO_GID=$(id -g slovo)
echo "  slovo user: OK (uid=$SLOVO_UID, gid=$SLOVO_GID)"

# buildx builder (playbook slovo-buildx role)
docker buildx inspect "$BUILDER" >/dev/null 2>&1 \
  || fail_missing "buildx builder '$BUILDER' does not exist (playbook slovo-buildx role)."
echo "  buildx builder: OK ($BUILDER)"

# Dependent systemd services — the backend cannot run without these, and Traefik
# fronts it. If Traefik runs under a different unit name, set TRAEFIK_SERVICE=<name>.
# shellcheck disable=SC2086 # word splitting of the space-separated list is intended
for svc in $REQUIRED_SERVICES; do
  systemctl is-active --quiet "$svc" 2>/dev/null \
    || fail_missing "Required service '$svc' is not running."
done
echo "  services: OK ($REQUIRED_SERVICES)"

# Shared Docker networks the backend attaches to at runtime (step 7). The
# slovo-backend network itself is this script's own and is created in step 5.
# shellcheck disable=SC2086 # word splitting of the space-separated list is intended
for net in $REQUIRED_NETWORKS; do
  docker network inspect "$net" >/dev/null 2>&1 \
    || fail_missing "Required Docker network '$net' does not exist."
done
echo "  networks: OK ($REQUIRED_NETWORKS)"

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

# --- 10. Post-deploy cleanup (non-fatal, best effort) ---
# Runs only after step 9 confirms the new service is active (systemctl
# is-active, not an app-level healthcheck). Bounds disk growth on the VPS
# across repeated releases: prunes dangling images only (no --all; the
# previous release's image becomes dangling once slovo-backend:latest is
# retagged and is removed) and caps the buildx builder cache.
# Both prunes are strictly non-fatal — with `set -e` in effect, a cleanup
# failure must never fail a successful deployment, so errors are logged as
# warnings and the deploy continues.
echo ">> Pruning dangling Docker images..."
if ! docker image prune --force; then
  echo "WARN: docker image prune failed — skipping dangling image cleanup" >&2
fi

echo ">> Pruning buildx builder cache ($BUILDER, keep 4GB)..."
if ! docker buildx prune --builder "$BUILDER" --keep-storage 4GB --force; then
  echo "WARN: docker buildx prune failed — skipping builder cache cleanup" >&2
fi

# --- 11. Cleanup ---
rm -f /tmp/vps-deploy.sh
echo ">> Done."
