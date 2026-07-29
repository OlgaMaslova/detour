#!/bin/sh
set -eu

detour_env_file="${DETOUR_BACKEND_ENV_FILE:-.env.backend.local}"
if [ -f "$detour_env_file" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$detour_env_file"
  set +a
fi

exec ./pocketbase serve \
  --dir ./pb_data \
  --hooksDir ./pb_hooks \
  --migrationsDir ./pb_migrations \
  --http 127.0.0.1:8090
