#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# VPS Deployment Script — slovo-backend (NestJS API)
# =============================================================================
# Runs ON the VPS as root. Triggered by the Forgejo release workflow via SSH.
# Replaces the former Ansible role `roles/custom/slovo-backend/`.
#
# Usage:   DEPLOY_TAG=v1.2.3 IMAGE_REF=git.lightnode.ru/slovo_propovedi/slovo-propovedi-backend \
#          BACKEND_API_HOSTNAME=api.example.com \
#          INTERNAL_PORT=3000 TRAEFIK_NETWORK=traefik \
#          POSTGRES_NETWORK=slovo-postgres MINIO_NETWORK=slovo-minio \
#          TRAEFIK_SERVICE=slovo-traefik.service BUILDX_BUILDER=slovo-constrained \
#          bash vps-deploy.sh
#
# The release workflow builds the image with the shared `slovo-constrained`
# buildx builder ON this host and pushes it to the Forgejo container registry;
# this script only pulls the published tag. No source tree is shipped to the
# VPS. The registry is public (public org), so the pull is anonymous.
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
# DEPLOY_TAG is the release tag (e.g. v1.2.3): the registry image tag to pull.
DEPLOY_TAG="${DEPLOY_TAG:?ERROR: DEPLOY_TAG is required (release tag, passed by the release workflow)}"

# Full registry image ref (no tag) — passed by the release workflow. Required,
# no default: a renamed registry/org must fail loudly instead of pulling or
# creating a container from a stale local image.
IMAGE_REF="${IMAGE_REF:?ERROR: IMAGE_REF is required (full registry image ref, passed by the release workflow)}"
IMAGE="$IMAGE_REF:$DEPLOY_TAG"

# Required env — no defaults. The release workflow passes these from Forgejo
# org variables; a missing value is a hard error (fail fast before any change).
for required in BACKEND_API_HOSTNAME INTERNAL_PORT TRAEFIK_NETWORK \
                POSTGRES_NETWORK MINIO_NETWORK TRAEFIK_SERVICE; do
  if [ -z "${!required:-}" ]; then
    echo "ERROR: ${required} is not set — required env variable (passed by the release workflow)." >&2
    exit 1
  fi
done
# Variables are validated above; from here on they are trusted (parse-don't-validate).
# shellcheck disable=SC2269 # self-assignments document the required-variable contract

SERVICE=slovo-backend
CONTAINER=slovo-backend
NETWORK=slovo-backend
BASE_PATH=/slovo/backend
ENV_FILE="$BASE_PATH/env"
LABELS_FILE="$BASE_PATH/labels"
# buildx builder name — playbook-owned, passed from the Forgejo org variable.
# No longer used to build here, but the post-deploy cleanup caps its cache
# (the CI release build runs through it on this host).
BUILDER="${BUILDX_BUILDER:?ERROR: BUILDX_BUILDER is required (Forgejo org variable)}"
MEMORY=1g
STOP_GRACE=30

# Shared infrastructure this deploy depends on but does NOT own (playbook-managed).
REQUIRED_SERVICES="slovo-postgres slovo-pgbouncer slovo-minio $TRAEFIK_SERVICE"
REQUIRED_NETWORKS="$TRAEFIK_NETWORK $POSTGRES_NETWORK $MINIO_NETWORK"

# --- Banner ---
echo "==============================================================="
echo "  VPS deployment — $SERVICE"
echo "  Tag:          $DEPLOY_TAG"
echo "  API hostname: $BACKEND_API_HOSTNAME"
echo "==============================================================="

# --- Verify prerequisites (playbook-owned; never auto-provisioned) ---
# This script owns ONLY the slovo-backend container and the slovo-backend
# network (created in step 4). Everything checked below is provisioned by the
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

# buildx builder (playbook slovo-buildx role). The CI release build runs
# through it on this host; the post-deploy cleanup caps its cache.
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

# Shared Docker networks the backend attaches to at runtime (step 6). The
# slovo-backend network itself is this script's own and is created in step 4.
# shellcheck disable=SC2086 # word splitting of the space-separated list is intended
for net in $REQUIRED_NETWORKS; do
  docker network inspect "$net" >/dev/null 2>&1 \
    || fail_missing "Required Docker network '$net' does not exist."
done
echo "  networks: OK ($REQUIRED_NETWORKS)"

# --- 1. Create paths ---
echo ">> Ensuring paths exist..."
mkdir -p "$BASE_PATH"
chown slovo:slovo "$BASE_PATH"
chmod 0750 "$BASE_PATH"

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

# --- 3. Write Traefik labels (reproduces playbook labels.j2) ---
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

# --- 4. Create Docker network (if missing) ---
echo ">> Ensuring Docker network '$NETWORK'..."
docker network inspect "$NETWORK" >/dev/null 2>&1 \
  || docker network create "$NETWORK"

# --- 5. Pull the release image from the registry ---
# The image was built and pushed by the release workflow through the shared
# `slovo-constrained` builder. The org is public, so the pull is anonymous —
# no registry credentials are stored on the VPS. The version tag stays in the
# registry, keeping old releases redeployable for rollback.
echo ">> Pulling image $IMAGE..."
if ! docker pull "$IMAGE"; then
  echo "ERROR: docker pull failed for $IMAGE (built and pushed by the release workflow?)"
  exit 1
fi

# --- 6. Write systemd unit (reproduces playbook slovo-backend.service.j2) ---
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
ExecStartPre=-/usr/bin/env sh -c '/usr/bin/env docker network connect $POSTGRES_NETWORK $CONTAINER 2>/dev/null || true'
ExecStartPre=-/usr/bin/env sh -c '/usr/bin/env docker network connect $MINIO_NETWORK $CONTAINER 2>/dev/null || true'
ExecStart=/usr/bin/env docker start --attach $CONTAINER
ExecStop=-/usr/bin/env sh -c '/usr/bin/env docker stop -t $STOP_GRACE $CONTAINER 2>/dev/null || true'
ExecStop=-/usr/bin/env sh -c '/usr/bin/env docker rm $CONTAINER 2>/dev/null || true'
Restart=always
RestartSec=30
SyslogIdentifier=slovo-backend

[Install]
WantedBy=multi-user.target
EOF

# --- 7. Reload, enable and restart ---
echo ">> Reloading systemd and restarting service..."
systemctl daemon-reload
systemctl enable slovo-backend.service >/dev/null 2>&1 || true
systemctl restart slovo-backend.service

# --- 8. Verify ---
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

# --- 9. Post-deploy cleanup (non-fatal, best effort) ---
# Runs only after step 8 confirms the new service is active (systemctl
# is-active, not an app-level healthcheck). Bounds disk growth on the VPS
# across repeated releases: prunes dangling images only (no --all). Old
# release tags (v1.2.2, ...) stay on disk and in the registry on purpose —
# they are the rollback path; the registry side is bounded by the org
# cleanup rule. The buildx prune caps the cache of the shared builder that
# the CI release build runs through on this host.
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

# --- 10. Cleanup ---
rm -f /tmp/vps-deploy.sh
echo ">> Done."
