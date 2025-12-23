#!/bin/bash
# VPS Setup Script for Bob at claude.gmac.io
# Run this script on a fresh Ubuntu 22.04+ VPS

set -e

DOMAIN="claude.gmac.io"
EMAIL="${1:-admin@gmac.io}"

echo "=============================================="
echo "Bob VPS Setup Script"
echo "Domain: $DOMAIN"
echo "Email: $EMAIL"
echo "=============================================="

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "Please run as root (sudo)"
    exit 1
fi

echo ""
echo "Step 1: Update system..."
apt-get update -y
apt-get upgrade -y

echo ""
echo "Step 2: Install dependencies..."
apt-get install -y \
    apt-transport-https \
    ca-certificates \
    curl \
    gnupg \
    lsb-release \
    git \
    nginx \
    certbot \
    python3-certbot-nginx

echo ""
echo "Step 3: Install Docker..."
# Add Docker's official GPG key
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

# Add the repository to Apt sources
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Start and enable Docker
systemctl start docker
systemctl enable docker

echo ""
echo "Step 4: Create bob user..."
if ! id -u bob &>/dev/null; then
    useradd -m -s /bin/bash -G docker bob
    echo "Created user 'bob'"
else
    usermod -aG docker bob
    echo "User 'bob' already exists, added to docker group"
fi

echo ""
echo "Step 5: Create directories..."
mkdir -p /opt/bob
mkdir -p /var/www/certbot
chown -R bob:bob /opt/bob

echo ""
echo "Step 6: Configure Nginx..."
# Create initial nginx config (without SSL first)
cat > /etc/nginx/sites-available/bob << 'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name claude.gmac.io;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}
EOF

# Enable the site
ln -sf /etc/nginx/sites-available/bob /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Test and reload nginx
nginx -t
systemctl reload nginx

echo ""
echo "Step 7: Obtain SSL certificate..."
certbot certonly --webroot \
    -w /var/www/certbot \
    -d "$DOMAIN" \
    --email "$EMAIL" \
    --agree-tos \
    --non-interactive

echo ""
echo "Step 8: Configure Nginx with SSL..."
cat > /etc/nginx/sites-available/bob << 'EOF'
# Upstream for Bob backend
upstream bob_backend {
    server 127.0.0.1:3001;
    keepalive 32;
}

# HTTP server - redirect to HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name claude.gmac.io;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

# HTTPS server
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name claude.gmac.io;

    ssl_certificate /etc/letsencrypt/live/claude.gmac.io/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/claude.gmac.io/privkey.pem;

    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:50m;
    ssl_session_tickets off;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;

    add_header Strict-Transport-Security "max-age=63072000" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;

    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml application/json application/javascript application/rss+xml application/atom+xml image/svg+xml;

    client_max_body_size 100M;

    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Connection "";

    # API and WebSocket
    location /api/ {
        proxy_pass http://bob_backend;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_connect_timeout 60s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
    }

    # Frontend
    location / {
        proxy_pass http://bob_backend;
    }

    # Health check
    location /health {
        proxy_pass http://bob_backend/api/health;
        access_log off;
    }

    access_log /var/log/nginx/bob_access.log;
    error_log /var/log/nginx/bob_error.log;
}
EOF

nginx -t
systemctl reload nginx

echo ""
echo "Step 9: Setup certificate auto-renewal..."
cat > /etc/cron.d/certbot-bob << EOF
0 3 * * * root certbot renew --quiet --post-hook "systemctl reload nginx"
EOF

echo ""
echo "Step 10: Configure firewall..."
if command -v ufw &> /dev/null; then
    ufw allow 'Nginx Full'
    ufw allow 'OpenSSH'
    ufw --force enable
fi

echo ""
echo "=============================================="
echo "VPS Setup Complete!"
echo "=============================================="
echo ""
echo "Next steps:"
echo "1. Clone the bob repository to /opt/bob:"
echo "   cd /opt/bob && git clone <repo-url> ."
echo ""
echo "2. Create .env file from .env.example:"
echo "   cp .env.example .env"
echo "   # Edit .env with your settings"
echo ""
echo "3. Build and start the application:"
echo "   docker compose build"
echo "   docker compose up -d"
echo ""
echo "4. Check the logs:"
echo "   docker compose logs -f"
echo ""
echo "Your site will be available at: https://$DOMAIN"
echo ""
