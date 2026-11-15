#!/bin/sh
# crond starts jobs with an empty environment: keep the variables the backup needs in a file
# readable by root only, sourced by the cron line.
set -eu
umask 077
: > /run/backup.env
for name in PGHOST PGUSER PGPASSWORD PGDATABASE TZ BACKUP_AGE_RECIPIENT S3_ENDPOINT S3_BUCKET S3_REGION AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY BACKUP_KEEP_LOCAL; do
  eval "value=\${$name-}"
  if [ -n "$value" ]; then
    # Single-quoted, with any single quote escaped, so no value is interpreted by the shell.
    printf "export %s='%s'\n" "$name" "$(printf '%s' "$value" | sed "s/'/'\\\\''/g")" >> /run/backup.env
  fi
done
exec "$@"
