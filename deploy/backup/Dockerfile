# Backup service (backlog D2): pg_dump of the same major version as the database,
# encrypted with age to a public key, copied to S3-compatible storage.
# Packages: age (encryption), aws-cli (S3 API, works with any S3-compatible endpoint).
FROM postgres:17-alpine
RUN apk add --no-cache age aws-cli
COPY backup.sh restore.sh entrypoint.sh /usr/local/bin/
RUN chmod 0755 /usr/local/bin/backup.sh /usr/local/bin/restore.sh /usr/local/bin/entrypoint.sh
# 02:30 every night, local time (TZ=Africa/Casablanca in docker-compose.prod.yml).
RUN echo '30 2 * * * . /run/backup.env && /usr/local/bin/backup.sh > /proc/1/fd/1 2>&1' > /etc/crontabs/root
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["crond", "-f", "-l", "8"]
