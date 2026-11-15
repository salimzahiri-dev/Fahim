#!/bin/sh
# Encrypted backup of the Fahim database (backlog D2). Run nightly by crond, or by hand:
#   docker compose -f docker-compose.prod.yml --env-file /etc/fahim/fahim.env exec backup backup.sh
#
# 1. pg_dump (custom format) streamed into age, encrypted to BACKUP_AGE_RECIPIENT (a public key:
#    the server cannot decrypt its own backups; the private key stays with the owner).
# 2. The encrypted file is kept in /backups (the last BACKUP_KEEP_LOCAL, 7 by default).
# 3. It is copied to s3://$S3_BUCKET/fahim/ and the copy's size is checked.
# Without S3_BUCKET (local tests only), step 3 is skipped and says so.
set -eu
set -o pipefail

: "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT is required}"
dir=/backups
keep=${BACKUP_KEEP_LOCAL:-7}
name="fahim-$(date -u +%Y%m%dT%H%M%SZ).dump.age"
partial="$dir/$name.partial"

log() { echo "[backup] $(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

trap 'rm -f "$partial"' EXIT
pg_dump --format=custom --no-password | age --encrypt --recipient "$BACKUP_AGE_RECIPIENT" > "$partial"
mv "$partial" "$dir/$name"
size=$(wc -c < "$dir/$name" | tr -d ' ')
log "encrypted dump written: $name ($size bytes)"

if [ -n "${S3_BUCKET:-}" ]; then
  : "${S3_ENDPOINT:?S3_ENDPOINT is required with S3_BUCKET}"
  export AWS_DEFAULT_REGION="${S3_REGION:-auto}"
  aws s3 cp "$dir/$name" "s3://$S3_BUCKET/fahim/$name" --endpoint-url "$S3_ENDPOINT" --only-show-errors
  remote=$(aws s3api head-object --bucket "$S3_BUCKET" --key "fahim/$name" --endpoint-url "$S3_ENDPOINT" --query ContentLength --output text)
  if [ "$remote" != "$size" ]; then
    log "FAILED: remote copy is $remote bytes, local is $size"
    exit 1
  fi
  log "copied to s3://$S3_BUCKET/fahim/$name"
else
  log "WARNING: S3_BUCKET is not set, the backup stays on this server only"
fi

# Keep the most recent local copies only.
ls -1t "$dir"/fahim-*.dump.age 2>/dev/null | tail -n +"$((keep + 1))" | while read -r old; do rm -f "$old"; done
log "done"
