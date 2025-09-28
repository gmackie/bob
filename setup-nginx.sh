#!/bin/bash

set -e

DOMAIN=""
NAME=""
EMAIL=""

print_usage() {
    echo "Usage: $0 --domain <domain> --name <site-name> --email <email>"
    echo ""
    echo "Options:"
    echo "  --domain    Domain name for the site (e.g., example.com)"
    echo "  --name      Name identifier for the site configuration"
    echo "  --email     Email address for SSL certificate notifications"
    echo ""
    echo "Example:"
    echo "  $0 --domain example.com --name mysite --email admin@example.com"
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
        --help|-h)
            print_usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            print_usage
            exit 1
            ;;
    esac
done

if [ -z "$DOMAIN" ] || [ -z "$NAME" ] || [ -z "$EMAIL" ]; then
    echo "Error: All parameters (--domain, --name, --email) are required"
    print_usage
    exit 1
fi

echo "================================================"
echo "Nginx Setup Script with SSL Certificate Manager"
echo "================================================"
echo "Domain: $DOMAIN"
echo "Name: $NAME"
echo "Email: $EMAIL"
echo ""

if [ "$EUID" -ne 0 ]; then 
    echo "Error: This script must be run as root (use sudo)"
    exit 1
fi

echo "Step 1: Updating system packages..."
apt-get update -y

echo "Step 2: Installing Nginx..."
apt-get install -y nginx

echo "Step 3: Installing Certbot and Nginx plugin..."
apt-get install -y certbot python3-certbot-nginx

echo "Step 4: Starting and enabling Nginx..."
systemctl start nginx
systemctl enable nginx

echo "Step 5: Configuring firewall (if ufw is active)..."
if command -v ufw &> /dev/null && ufw status | grep -q "Status: active"; then
    ufw allow 'Nginx Full'
    ufw allow 'OpenSSH'
    echo "Firewall rules updated"
else
    echo "UFW not active or not installed, skipping firewall configuration"
fi

echo "Step 6: Creating Nginx site configuration..."
NGINX_CONF="/etc/nginx/sites-available/${NAME}"

cat > "$NGINX_CONF" << EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN} www.${DOMAIN};

    root /var/www/${NAME};
    index index.html index.htm index.nginx-debian.html;

    location / {
        try_files \$uri \$uri/ =404;
    }

    location ~ /\.ht {
        deny all;
    }

    access_log /var/log/nginx/${NAME}_access.log;
    error_log /var/log/nginx/${NAME}_error.log;
}
EOF

echo "Step 7: Creating web root directory..."
mkdir -p "/var/www/${NAME}"
chown -R www-data:www-data "/var/www/${NAME}"

cat > "/var/www/${NAME}/index.html" << EOF
<!DOCTYPE html>
<html>
<head>
    <title>Welcome to ${DOMAIN}</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 40px;
            background-color: #f0f0f0;
        }
        .container {
            background-color: white;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            max-width: 600px;
            margin: 0 auto;
        }
        h1 { color: #333; }
        p { color: #666; line-height: 1.6; }
        .status { 
            background-color: #4CAF50; 
            color: white; 
            padding: 10px; 
            border-radius: 5px; 
            display: inline-block;
            margin-top: 20px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Welcome to ${DOMAIN}</h1>
        <p>Your Nginx server is successfully installed and configured!</p>
        <p>This is the default page for the site <strong>${NAME}</strong>.</p>
        <div class="status">✓ Server is running</div>
    </div>
</body>
</html>
EOF

echo "Step 8: Enabling the site..."
ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/

echo "Step 9: Testing Nginx configuration..."
nginx -t

echo "Step 10: Reloading Nginx..."
systemctl reload nginx

echo "Step 11: Obtaining SSL certificate with Certbot..."
echo ""
echo "Running Certbot to obtain and install SSL certificate..."
echo "This will configure HTTPS for your domain automatically."
echo ""

certbot --nginx \
    --non-interactive \
    --agree-tos \
    --email "$EMAIL" \
    --domains "$DOMAIN,www.$DOMAIN" \
    --redirect

echo "Step 12: Setting up automatic certificate renewal..."
CRON_JOB="0 3 * * * /usr/bin/certbot renew --quiet --post-hook 'systemctl reload nginx'"
(crontab -l 2>/dev/null | grep -v certbot; echo "$CRON_JOB") | crontab -

echo "Step 13: Testing automatic renewal..."
certbot renew --dry-run

echo ""
echo "================================================"
echo "✅ Nginx Setup Complete!"
echo "================================================"
echo ""
echo "Your site is now available at:"
echo "  - https://${DOMAIN}"
echo "  - https://www.${DOMAIN}"
echo ""
echo "Configuration details:"
echo "  - Nginx config: ${NGINX_CONF}"
echo "  - Web root: /var/www/${NAME}"
echo "  - Access log: /var/log/nginx/${NAME}_access.log"
echo "  - Error log: /var/log/nginx/${NAME}_error.log"
echo ""
echo "SSL Certificate:"
echo "  - Auto-renewal is configured via cron"
echo "  - Certificate will renew automatically before expiration"
echo "  - Email notifications will be sent to: ${EMAIL}"
echo ""
echo "Next steps:"
echo "  1. Upload your website files to: /var/www/${NAME}"
echo "  2. Test HTTPS by visiting: https://${DOMAIN}"
echo "  3. Monitor logs in: /var/log/nginx/"
echo ""
echo "Useful commands:"
echo "  - Check Nginx status: systemctl status nginx"
echo "  - Reload Nginx: systemctl reload nginx"
echo "  - Test config: nginx -t"
echo "  - View certificate: certbot certificates"
echo "  - Force renew: certbot renew --force-renewal"
echo ""