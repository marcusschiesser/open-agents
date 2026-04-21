#!/bin/sh
set -eu

DAYTONA_API_URL="${DAYTONA_API_URL:-http://daytona-api:3000/api}"
DAYTONA_DB_HOST="${DAYTONA_DB_HOST:-daytona-db}"
DAYTONA_DB_PORT="${DAYTONA_DB_PORT:-5432}"
DAYTONA_DB_NAME="${DAYTONA_DB_NAME:-daytona}"
DAYTONA_DB_USER="${DAYTONA_DB_USER:-user}"
DAYTONA_DB_PASSWORD="${DAYTONA_DB_PASSWORD:-pass}"
DAYTONA_BOOTSTRAP_ADMIN_USER_ID="${DAYTONA_BOOTSTRAP_ADMIN_USER_ID:-daytona-admin}"
DAYTONA_BOOTSTRAP_API_KEY_NAME="${DAYTONA_BOOTSTRAP_API_KEY_NAME:-open-harness-local-dev}"
DAYTONA_BOOTSTRAP_API_KEY_VALUE="${DAYTONA_BOOTSTRAP_API_KEY_VALUE:-daytona-local-open-harness-key}"
DAYTONA_BOOTSTRAP_RETRIES="${DAYTONA_BOOTSTRAP_RETRIES:-60}"
DAYTONA_BOOTSTRAP_SLEEP_SECONDS="${DAYTONA_BOOTSTRAP_SLEEP_SECONDS:-2}"
DAYTONA_DEFAULT_REGION_ID="${DAYTONA_DEFAULT_REGION_ID:-us}"
DAYTONA_DEFAULT_TOTAL_CPU_QUOTA="${DAYTONA_DEFAULT_TOTAL_CPU_QUOTA:-10000}"
DAYTONA_DEFAULT_TOTAL_MEMORY_QUOTA="${DAYTONA_DEFAULT_TOTAL_MEMORY_QUOTA:-10000}"
DAYTONA_DEFAULT_TOTAL_DISK_QUOTA="${DAYTONA_DEFAULT_TOTAL_DISK_QUOTA:-100000}"
DAYTONA_DEFAULT_MAX_CPU_PER_SANDBOX="${DAYTONA_DEFAULT_MAX_CPU_PER_SANDBOX:-100}"
DAYTONA_DEFAULT_MAX_MEMORY_PER_SANDBOX="${DAYTONA_DEFAULT_MAX_MEMORY_PER_SANDBOX:-100}"
DAYTONA_DEFAULT_MAX_DISK_PER_SANDBOX="${DAYTONA_DEFAULT_MAX_DISK_PER_SANDBOX:-1000}"
DAYTONA_DEFAULT_MAX_DISK_PER_NON_EPHEMERAL_SANDBOX="${DAYTONA_DEFAULT_MAX_DISK_PER_NON_EPHEMERAL_SANDBOX:-1000}"
DAYTONA_DEFAULT_SNAPSHOT_QUOTA="${DAYTONA_DEFAULT_SNAPSHOT_QUOTA:-1000}"
DAYTONA_DEFAULT_MAX_SNAPSHOT_SIZE="${DAYTONA_DEFAULT_MAX_SNAPSHOT_SIZE:-1000}"
DAYTONA_DEFAULT_VOLUME_QUOTA="${DAYTONA_DEFAULT_VOLUME_QUOTA:-10000}"

wait_for_url() {
  url="$1"
  name="$2"
  i=0
  while [ "$i" -lt "$DAYTONA_BOOTSTRAP_RETRIES" ]; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    i=$((i + 1))
    sleep "$DAYTONA_BOOTSTRAP_SLEEP_SECONDS"
  done

  echo "Timed out waiting for $name at $url" >&2
  return 1
}

wait_for_db() {
  i=0
  while [ "$i" -lt "$DAYTONA_BOOTSTRAP_RETRIES" ]; do
    if PGPASSWORD="$DAYTONA_DB_PASSWORD" pg_isready \
      -h "$DAYTONA_DB_HOST" \
      -p "$DAYTONA_DB_PORT" \
      -U "$DAYTONA_DB_USER" \
      -d "$DAYTONA_DB_NAME" >/dev/null 2>&1; then
      return 0
    fi
    i=$((i + 1))
    sleep "$DAYTONA_BOOTSTRAP_SLEEP_SECONDS"
  done

  echo "Timed out waiting for Daytona DB at ${DAYTONA_DB_HOST}:${DAYTONA_DB_PORT}/${DAYTONA_DB_NAME}" >&2
  return 1
}

psql_query() {
  PGPASSWORD="$DAYTONA_DB_PASSWORD" psql \
    -h "$DAYTONA_DB_HOST" \
    -p "$DAYTONA_DB_PORT" \
    -U "$DAYTONA_DB_USER" \
    -d "$DAYTONA_DB_NAME" \
    -tA \
    -c "$1"
}

wait_for_db

organization_id="$(
  psql_query "select id from organization where \"createdBy\" = '${DAYTONA_BOOTSTRAP_ADMIN_USER_ID}' order by personal desc, \"createdAt\" asc limit 1;"
)"

if [ -z "$organization_id" ]; then
  echo "Failed to resolve Daytona organization id for ${DAYTONA_BOOTSTRAP_ADMIN_USER_ID}" >&2
  exit 1
fi

psql_query "
update organization
set
  max_cpu_per_sandbox = ${DAYTONA_DEFAULT_MAX_CPU_PER_SANDBOX},
  max_memory_per_sandbox = ${DAYTONA_DEFAULT_MAX_MEMORY_PER_SANDBOX},
  max_disk_per_sandbox = ${DAYTONA_DEFAULT_MAX_DISK_PER_SANDBOX},
  snapshot_quota = ${DAYTONA_DEFAULT_SNAPSHOT_QUOTA},
  max_snapshot_size = ${DAYTONA_DEFAULT_MAX_SNAPSHOT_SIZE},
  volume_quota = ${DAYTONA_DEFAULT_VOLUME_QUOTA},
  \"defaultRegionId\" = '${DAYTONA_DEFAULT_REGION_ID}',
  \"updatedAt\" = now()
where id = '${organization_id}';
" >/dev/null

psql_query "
insert into region_quota (
  \"organizationId\",
  \"regionId\",
  total_cpu_quota,
  total_memory_quota,
  total_disk_quota,
  \"createdAt\",
  \"updatedAt\",
  max_cpu_per_sandbox,
  max_memory_per_sandbox,
  max_disk_per_sandbox,
  max_disk_per_non_ephemeral_sandbox
)
values (
  '${organization_id}',
  '${DAYTONA_DEFAULT_REGION_ID}',
  ${DAYTONA_DEFAULT_TOTAL_CPU_QUOTA},
  ${DAYTONA_DEFAULT_TOTAL_MEMORY_QUOTA},
  ${DAYTONA_DEFAULT_TOTAL_DISK_QUOTA},
  now(),
  now(),
  ${DAYTONA_DEFAULT_MAX_CPU_PER_SANDBOX},
  ${DAYTONA_DEFAULT_MAX_MEMORY_PER_SANDBOX},
  ${DAYTONA_DEFAULT_MAX_DISK_PER_SANDBOX},
  ${DAYTONA_DEFAULT_MAX_DISK_PER_NON_EPHEMERAL_SANDBOX}
)
on conflict (\"organizationId\", \"regionId\") do update
set
  total_cpu_quota = excluded.total_cpu_quota,
  total_memory_quota = excluded.total_memory_quota,
  total_disk_quota = excluded.total_disk_quota,
  \"updatedAt\" = excluded.\"updatedAt\",
  max_cpu_per_sandbox = excluded.max_cpu_per_sandbox,
  max_memory_per_sandbox = excluded.max_memory_per_sandbox,
  max_disk_per_sandbox = excluded.max_disk_per_sandbox,
  max_disk_per_non_ephemeral_sandbox = excluded.max_disk_per_non_ephemeral_sandbox;
" >/dev/null

api_key="$DAYTONA_BOOTSTRAP_API_KEY_VALUE"
api_key_hash="$(printf '%s' "$api_key" | sha256sum | awk '{print $1}')"
api_key_prefix="$(printf '%s' "$api_key" | cut -c1-3)"
api_key_suffix="$(printf '%s' "$api_key" | rev | cut -c1-3 | rev)"
api_key_name_sql="$(printf "%s" "$DAYTONA_BOOTSTRAP_API_KEY_NAME" | sed "s/'/''/g")"

psql_query "
insert into api_key (
  \"userId\",
  name,
  \"createdAt\",
  \"organizationId\",
  permissions,
  \"keyHash\",
  \"keyPrefix\",
  \"keySuffix\",
  \"expiresAt\"
)
values (
  '${DAYTONA_BOOTSTRAP_ADMIN_USER_ID}',
  '${api_key_name_sql}',
  now(),
  '${organization_id}',
  ARRAY[
    'write:sandboxes',
    'delete:sandboxes',
    'write:snapshots',
    'delete:snapshots',
    'read:volumes',
    'write:volumes',
    'delete:volumes',
    'read:runners',
    'write:runners'
  ]::api_key_permissions_enum[],
  '${api_key_hash}',
  '${api_key_prefix}',
  '${api_key_suffix}',
  null
)
on conflict (\"userId\", name, \"organizationId\") do update
set
  permissions = excluded.permissions,
  \"keyHash\" = excluded.\"keyHash\",
  \"keyPrefix\" = excluded.\"keyPrefix\",
  \"keySuffix\" = excluded.\"keySuffix\",
  \"expiresAt\" = excluded.\"expiresAt\";
" >/dev/null

if [ -z "$api_key" ]; then
  echo "Failed to create Daytona API key" >&2
  exit 1
fi

wait_for_url "$DAYTONA_API_URL/health" "Daytona API"

printf '%s\n' "$api_key"
