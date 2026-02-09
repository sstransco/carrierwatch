#!/usr/bin/env bash
set -euo pipefail

# CarrierWatch Database Migration Script
# Dumps local DB and restores to production server
#
# Usage: ./deploy-db.sh <server-ip> [user]

SERVER="${1:?Usage: ./deploy-db.sh <server-ip> [user]}"
USER="${2:-root}"
REMOTE="$USER@$SERVER"
DUMP_FILE="carrierwatch_dump.sql.gz"

echo "=== CarrierWatch Database Migration ==="

# Step 1: Dump local database
echo "--- Dumping local database (this may take a few minutes) ---"
docker exec carrierwatch-postgres-1 \
  pg_dump -U carrierwatch -d carrierwatch \
  --no-owner --no-acl \
  | gzip > "$DUMP_FILE"

DUMP_SIZE=$(ls -lh "$DUMP_FILE" | awk '{print $5}')
echo "Dump created: $DUMP_FILE ($DUMP_SIZE)"

# Step 2: Upload to server
echo "--- Uploading dump to server ---"
scp "$DUMP_FILE" "$REMOTE:/tmp/$DUMP_FILE"

# Step 3: Restore on server
echo "--- Restoring database on server ---"
ssh "$REMOTE" "
  cd /opt/carrierwatch
  # Get the postgres container name
  PG_CONTAINER=\$(docker compose -f docker-compose.prod.yml ps -q postgres)

  # Copy dump into container
  docker cp /tmp/$DUMP_FILE \$PG_CONTAINER:/tmp/$DUMP_FILE

  # Drop and recreate
  docker exec \$PG_CONTAINER bash -c '
    gunzip -c /tmp/$DUMP_FILE | psql -U carrierwatch -d carrierwatch
  '

  # Cleanup
  rm /tmp/$DUMP_FILE
  docker exec \$PG_CONTAINER rm /tmp/$DUMP_FILE
"

# Step 4: Verify
echo "--- Verifying ---"
ssh "$REMOTE" "
  cd /opt/carrierwatch
  PG_CONTAINER=\$(docker compose -f docker-compose.prod.yml ps -q postgres)
  docker exec \$PG_CONTAINER psql -U carrierwatch -d carrierwatch -c '
    SELECT
      (SELECT COUNT(*) FROM carriers) as carriers,
      (SELECT COUNT(*) FROM address_clusters) as clusters,
      (SELECT COUNT(*) FROM inspections) as inspections;
  '
"

# Cleanup local dump
rm "$DUMP_FILE"

echo ""
echo "=== Database migration complete ==="
echo "Verify: curl http://$SERVER/api/stats"
