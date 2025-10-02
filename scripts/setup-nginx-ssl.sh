#!/bin/bash

set -e

DOMAIN=""
NAME=""
EMAIL=""
FRONTEND_PORT=5173
NGINX_CONF_DIR="/etc/nginx/sites-available"
NGINX_ENABLED_DIR="/etc/nginx/sites-enabled"

print_usage() {
    echo "Usage: $0 --domain <domain> --name <app-name> --email <email>"
    echo ""
    echo "Options:"
    echo "  --domain    Domain name for the SSL certificate (e.g., bob.example.com)"
    echo "  --name      Application name (used for nginx site config)"
    echo "  --email     Email address for Let's Encrypt notifications"
    echo ""
    echo "Example:"
    echo "  $0 --domain bob.example.com --name bob --email admin@example.com"
    exit 1
}

while [[ $# -gt 0 ]]; do
    case $1 in
        --domain)
            DOMAIN="$2"
            shift 2
            ;;
        --name)
            NAME="$2"
            shift 2
            ;;
        --email)
            EMAIL="$2"
            shift 2
            ;;
        *)
            print_usage
            ;;
    esac
done

if [[ -z "$DOMAIN" || -z "$NAME" || -z "$EMAIL" ]]; then
    echo "Error: Missing required arguments"
    print_usage
fi

echo "========================================="
echo "SSL/TLS Setup for Bob Frontend"
echo "========================================="
echo "Domain: $DOMAIN"
echo "App Name: $NAME"
echo "Email: $EMAIL"
echo "========================================="
echo ""

if [ "$EUID" -ne 0 ]; then
    echo "Error: This script must be run as root"
    exit 1
fi

install_nginx() {
    echo "Installing nginx..."
    if command -v nginx &> /dev/null; then
        echo "nginx is already installed"
    else
        apt-get update
        apt-get install -y nginx
        systemctl enable nginx
    fi
}

setup_certbot() {
    echo "Setting up certbot for Let's Encrypt..."
    
    if ! command -v certbot &> /dev/null; then
        apt-get update
        apt-get install -y certbot python3-certbot-nginx
    fi
    
    echo "Obtaining SSL certificate..."
    certbot certonly --nginx \
        --non-interactive \
        --agree-tos \
        --email "$EMAIL" \
        --domains "$DOMAIN" \
        --redirect \
        --keep-until-expiring
    
    echo "Setting up auto-renewal..."
    systemctl enable certbot.timer
    systemctl start certbot.timer
    
    echo "Testing renewal..."
    certbot renew --dry-run
}

create_nginx_config() {
    echo "Creating nginx configuration..."
    
    cat > "$NGINX_CONF_DIR/$NAME" << EOF
upstream ${NAME}_backend {
    server localhost:3001;
}

upstream ${NAME}_frontend {
    server localhost:${FRONTEND_PORT};
}

server {
    listen 80;
    server_name ${DOMAIN};
    
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    
    location / {
        return 301 https://\$server_name\$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name ${DOMAIN};

    ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384';
    ssl_prefer_server_ciphers off;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:10m;
    ssl_session_tickets off;
    ssl_stapling on;
    ssl_stapling_verify on;
    
    add_header Strict-Transport-Security "max-age=63072000" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    client_max_body_size 100M;
    
    location / {
        proxy_pass http://${NAME}_frontend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 86400;
    }
    
    location /api {
        proxy_pass http://${NAME}_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 86400;
    }
    
    location /socket.io/ {
        proxy_pass http://${NAME}_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

    echo "Enabling site configuration..."
    ln -sf "$NGINX_CONF_DIR/$NAME" "$NGINX_ENABLED_DIR/$NAME"
    
    echo "Testing nginx configuration..."
    nginx -t
    
    echo "Reloading nginx..."
    systemctl reload nginx
}

create_systemd_service() {
    echo "Creating systemd service for Bob..."
    
    cat > "/etc/systemd/system/${NAME}.service" << EOF
[Unit]
Description=Bob Development Tool
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/dev/bob
ExecStart=/usr/bin/npm run dev
Restart=always
RestartSec=10
StandardOutput=append:/var/log/${NAME}.log
StandardError=append:/var/log/${NAME}.error.log
Environment="NODE_ENV=production"

[Install]
WantedBy=multi-user.target
EOF
    
    echo "Enabling and starting Bob service..."
    systemctl daemon-reload
    systemctl enable ${NAME}.service
    systemctl restart ${NAME}.service
    
    echo "Service status:"
    systemctl status ${NAME}.service --no-pager
}

print_success() {
    echo ""
    echo "========================================="
    echo "Setup Complete!"
    echo "========================================="
    echo ""
    echo "Your Bob instance is now accessible at:"
    echo "  https://${DOMAIN}"
    echo ""
    echo "SSL Certificate:"
    echo "  Location: /etc/letsencrypt/live/${DOMAIN}/"
    echo "  Auto-renewal: Enabled via certbot.timer"
    echo ""
    echo "Nginx configuration:"
    echo "  Config file: ${NGINX_CONF_DIR}/${NAME}"
    echo "  To reload: systemctl reload nginx"
    echo ""
    echo "Service management:"
    echo "  Start:   systemctl start ${NAME}"
    echo "  Stop:    systemctl stop ${NAME}"
    echo "  Restart: systemctl restart ${NAME}"
    echo "  Status:  systemctl status ${NAME}"
    echo "  Logs:    journalctl -u ${NAME} -f"
    echo ""
    echo "========================================="
}

main() {
    install_nginx
    setup_certbot
    create_nginx_config
    create_systemd_service
    print_success
}

main