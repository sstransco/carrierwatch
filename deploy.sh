#!/usr/bin/env bash
set -euo pipefail

# CarrierWatch Deploy Script
# Usage: ./deploy.sh <server-ip> [user]
#
# Prerequisites:
#   - SSH access to server
#   - Docker + Docker Compose installed on server
#   - .env.production file configured

SERVER="${1:?Usage: ./deploy.sh <server-ip> [user]}"
USER="${2:-root}"
REMOTE="$USER@$SERVER"
APP_DIR="/opt/carrierwatch"

echo "=== CarrierWatch Deploy to $REMOTE ==="

# Step 1: Ensure server has Docker
echo "--- Checking Docker on server ---"
ssh "$REMOTE" "docker --version && docker compose version" || {
  echo "Installing Docker on server..."
  ssh "$REMOTE" "curl -fsSL https://get.docker.com | sh"
}

# Step 2: Create app directory on server
echo "--- Syncing code ---"
ssh "$REMOTE" "mkdir -p $APP_DIR"

# Step 3: Rsync project files (exclude data, node_modules, local volumes)
rsync -avz --progress \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude 'data/' \
  --exclude 'postgres_data' \
  --exclude '__pycache__' \
  --exclude '.env' \
  --exclude 'venv' \
  ./ "$REMOTE:$APP_DIR/"

# Step 4: Copy production env file
echo "--- Setting up environment ---"
if [ -f .env.production ]; then
  scp .env.production "$REMOTE:$APP_DIR/.env"
  echo "Copied .env.production → .env on server"
else
  echo "WARNING: No .env.production found locally."
  echo "Create one from .env.production.example and re-run, or configure .env on the server manually."
fi

# Step 5: Build and start
echo "--- Building and starting services ---"
ssh "$REMOTE" "cd $APP_DIR && docker compose -f docker-compose.prod.yml build && docker compose -f docker-compose.prod.yml up -d"

# Step 6: Wait for postgres healthy, then check
echo "--- Waiting for services ---"
sleep 10
ssh "$REMOTE" "cd $APP_DIR && docker compose -f docker-compose.prod.yml ps"

echo ""
echo "=== Deploy complete ==="
echo "Site should be available at http://$SERVER"
echo ""
echo "Next steps:"
echo "  1. Point carrier.watch DNS to $SERVER"
echo "  2. Import database: ./deploy-db.sh $SERVER"
echo "  3. Verify: curl http://$SERVER/api/stats"
