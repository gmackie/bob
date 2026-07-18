#!/usr/bin/env bash
set -euo pipefail
umask 077

export HOME=/home/bob
export HERMES_HOME=/home/bob/.hermes
export PATH=/home/bob/.hermes/hermes-agent/venv/bin:/home/bob/.local/bin:/usr/local/bin:/usr/bin:/bin

local_dir=/home/bob/hermes-backups
remote=hermes-backup@hetzner-master:/srv/backups/hermes/hetzner-bob/
identity=/home/bob/.ssh/hermes_backup_ed25519
known_hosts=/home/bob/.ssh/hermes_backup_known_hosts
ssh_opts="-i $identity -o BatchMode=yes -o UserKnownHostsFile=$known_hosts -o StrictHostKeyChecking=yes"

mkdir -p "$local_dir"
chmod 700 "$local_dir"
archive="$local_dir/hermes-$(date -u +%Y%m%dT%H%M%SZ).zip"

/home/bob/.local/bin/hermes backup --output "$archive"
chmod 600 "$archive"

rsync -az --partial -e "ssh $ssh_opts" "$archive" "$remote"
find "$local_dir" -type f -name 'hermes-*.zip' -mtime +7 -delete
ssh $ssh_opts hermes-backup@hetzner-master 'find /srv/backups/hermes/hetzner-bob -type f -name "hermes-*.zip" -mtime +30 -delete'
