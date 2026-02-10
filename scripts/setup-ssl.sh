#!/bin/bash
# Setup Cloudflare Origin Certificate for carrier.watch
# Run this on the production server (64.23.142.235)

set -e

SSL_DIR="/opt/carrierwatch/ssl"
mkdir -p "$SSL_DIR"

echo "=== Cloudflare Origin Certificate Setup ==="
echo ""
echo "1. Go to Cloudflare Dashboard → carrier.watch → SSL/TLS → Origin Server"
echo "2. Click 'Create Certificate'"
echo "3. Keep defaults (RSA 2048, 15 years, *.carrier.watch and carrier.watch)"
echo "4. Click 'Create'"
echo "5. Copy the Origin Certificate (PEM) below:"
echo ""

# Origin Certificate
echo "Paste the ORIGIN CERTIFICATE (starts with -----BEGIN CERTIFICATE-----)"
echo "Press Ctrl+D when done:"
cat > "$SSL_DIR/origin.pem"

echo ""
echo "Now paste the PRIVATE KEY (starts with -----BEGIN PRIVATE KEY-----)"
echo "Press Ctrl+D when done:"
cat > "$SSL_DIR/origin-key.pem"

# Set permissions
chmod 600 "$SSL_DIR/origin-key.pem"
chmod 644 "$SSL_DIR/origin.pem"

echo ""
echo "Certificates saved to $SSL_DIR/"
echo "Now update Cloudflare SSL mode to 'Full (Strict)'"
echo "Then restart nginx: cd /opt/carrierwatch && docker compose -f docker-compose.prod.yml restart nginx"
echo ""
echo "Done!"
