#!/bin/sh
set -eu

detour_env_file="${DETOUR_BACKEND_ENV_FILE:-.env.backend.local}"
if [ -f "$detour_env_file" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$detour_env_file"
  set +a
fi

# The hook watcher is off because on macOS it restarts the server forever
# without anybody touching a file. PocketBase reads every pb_hooks file at boot;
# fsnotify watches those files by descriptor and reports access-time changes as
# changes, so the boot reads are themselves the event that triggers the next
# restart. Roughly one restart every five seconds, on an idle server.
#
# The cost is that editing a hook no longer reloads it: stop this and start it
# again. Frontend edits still reload through Vite.
exec ./pocketbase serve \
  --dir ./pb_data \
  --hooksDir ./pb_hooks \
  --migrationsDir ./pb_migrations \
  --http 127.0.0.1:8090 \
  --hooksWatch=false
