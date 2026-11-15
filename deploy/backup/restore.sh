#!/bin/sh
# Restores a Fahim backup into a NEW database, never over an existing one (backlog D2).
#
#   restore.sh <backup> <target database>
#
#   <backup>  "latest" (newest object in s3://$S3_BUCKET/fahim/), an object name such as
#             fahim-20261116T013000Z.dump.age, or the path of a local .dump.age file.
#   <target>  name of the database to create, for example fahim_restore. It must not exist.
#
# The age private key is read from $BACKUP_AGE_IDENTITY_FILE (default /run/age-identity.txt),
# mounted read-only for this command only. docs/DEPLOY.md shows the full command and how
# to switch the application to the restored database.
set -eu
set -o pipefail

[ $# -eq 2 ] || { echo "usage: restore.sh <latest|object name|local file> <target database>" >&2; exit 2; }
source=$1
target=$2
identity=${BACKUP_AGE_IDENTITY_FILE:-/run/age-identity.txt}

log() { echo "[restore] $*"; }

case "$target" in
  *[!a-z0-9_]* | [!a-z_]* | "") echo "target database must match [a-z_][a-z0-9_]*" >&2; exit 2 ;;
esac
[ -r "$identity" ] || { echo "age private key not found at $identity (mount it read-only)" >&2; exit 2; }

if [ "$(psql -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$target'")" = "1" ]; then
  echo "database $target already exists: restore.sh never overwrites a database" >&2
  exit 1
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

if [ -f "$source" ]; then
  cp "$source" "$work/backup.age"
  log "using local file $source"
else
  : "${S3_BUCKET:?S3_BUCKET is required to fetch a backup}"
  : "${S3_ENDPOINT:?S3_ENDPOINT is required to fetch a backup}"
  export AWS_DEFAULT_REGION="${S3_REGION:-auto}"
  if [ "$source" = "latest" ]; then
    source=$(aws s3api list-objects-v2 --bucket "$S3_BUCKET" --prefix fahim/fahim- --endpoint-url "$S3_ENDPOINT" \
      --query 'Contents[].Key' --output text | tr '\t' '\n' | grep '\.dump\.age$' | sort | tail -n 1 | sed 's#^fahim/##')
    [ -n "$source" ] || { echo "no backup found in s3://$S3_BUCKET/fahim/" >&2; exit 1; }
  fi
  aws s3 cp "s3://$S3_BUCKET/fahim/$source" "$work/backup.age" --endpoint-url "$S3_ENDPOINT" --only-show-errors
  log "downloaded $source"
fi

age --decrypt --identity "$identity" --output "$work/fahim.dump" "$work/backup.age"
pg_restore --list "$work/fahim.dump" > /dev/null
log "decrypted and readable"

# Roles are not in a dump. On a new server the application role may not exist yet; the init
# service gives it its password at the next start.
psql -d postgres -v ON_ERROR_STOP=1 -q -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fahim_app') THEN CREATE ROLE fahim_app NOLOGIN; END IF; END \$\$;"
createdb "$target"
pg_restore --exit-on-error --dbname "$target" "$work/fahim.dump"
log "restored into $target:"
psql -d "$target" -c "SELECT (SELECT count(*) FROM organizations) AS organizations, (SELECT count(*) FROM users) AS users,
  (SELECT count(*) FROM sessions) AS sessions, (SELECT max(started_at) FROM sessions) AS last_session,
  (SELECT string_agg(name, ', ' ORDER BY name) FROM schema_migrations) AS migrations"
