#!/bin/bash
set -euo pipefail

# =========================================
# Bidoro Droplet Provisioning Script
# Expected: Run as non-root user with sudo
# or directly as root on a fresh Ubuntu droplet
# =========================================

# Capture all output to a log file
exec > >(tee /var/log/bidoro-setup.log) 2>&1
echo "Setup started at $(date)"

# =========================================
# Verify OS
# =========================================
if [[ -f /etc/os-release ]]; then
    source /etc/os-release
    if [[ "$ID" != "ubuntu" ]]; then
        echo "ERROR: This script requires Ubuntu. Detected: $ID"
        exit 1
    fi
    echo "OS verified: Ubuntu $VERSION_ID"
else
    echo "ERROR: Cannot determine OS. /etc/os-release not found."
    exit 1
fi

# =========================================
# Configure swap (prevents OOM on small droplets)
# =========================================
echo "========================================"
echo "Configuring swap memory"
echo "========================================"
if [[ ! -f /swapfile ]]; then
    sudo fallocate -l 1G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
    echo "Swap configured: 1G"
else
    echo "Swap file already exists, skipping."
fi

# =========================================
# Update server
# =========================================
echo "========================================"
echo "Updating server"
echo "========================================"
sudo apt update
sudo DEBIAN_FRONTEND=noninteractive apt upgrade -y \
    -o Dpkg::Options::="--force-confdef" \
    -o Dpkg::Options::="--force-confold"

# =========================================
# Install required packages
# =========================================
echo "========================================"
echo "Installing required packages"
echo "========================================"
sudo DEBIAN_FRONTEND=noninteractive apt install -y \
    -o Dpkg::Options::="--force-confdef" \
    -o Dpkg::Options::="--force-confold" \
    nginx \
    ufw \
    curl \
    git \
    ca-certificates \
    gnupg \
    lsb-release \
    certbot \
    python3-certbot-nginx

# =========================================
# Install Docker (via signed apt repo, not curl|sh)
# =========================================
echo "========================================"
echo "Installing Docker"
echo "========================================"
if ! command -v docker &>/dev/null; then
    sudo install -m 0755 -d /etc/apt/keyrings

    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
        sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg

    sudo chmod a+r /etc/apt/keyrings/docker.gpg

    echo \
        "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
        https://download.docker.com/linux/ubuntu \
        $(lsb_release -cs) stable" | \
        sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

    sudo apt update
    sudo DEBIAN_FRONTEND=noninteractive apt install -y \
    -o Dpkg::Options::="--force-confdef" \
    -o Dpkg::Options::="--force-confold" \
    docker-ce \
    docker-ce-cli \
    containerd.io \
    docker-buildx-plugin \
    docker-compose-plugin

    echo "Docker installed."
else
    echo "Docker already installed, skipping."
fi

# =========================================
# Add current user to docker group
# =========================================
echo "========================================"
echo "Adding current user to docker group"
echo "========================================"
if [[ "$USER" != "root" ]]; then
    sudo usermod -aG docker "$USER"
    echo "User $USER added to docker group. Re-login required for this to take effect."
else
    echo "Running as root — docker group change not needed."
fi

# =========================================
# Enable and start Docker
# =========================================
echo "========================================"
echo "Enabling Docker"
echo "========================================"
sudo systemctl enable docker
sudo systemctl start docker

# =========================================
# Create application directories
# =========================================
echo "========================================"
echo "Creating application directories"
echo "========================================"
sudo mkdir -p /etc/bidoro
sudo mkdir -p /opt/bidoro

# =========================================
# Create environment file template
# =========================================
echo "========================================"
echo "Creating environment file template"
echo "========================================"
if [[ ! -f /etc/bidoro/.env ]]; then
    sudo tee /etc/bidoro/.env > /dev/null <<EOF
NODE_ENV=production
PORT=3003
EOF
    # Readable by root and docker group so containerised app can mount it
    sudo chown root:docker /etc/bidoro/.env
    sudo chmod 640 /etc/bidoro/.env
    echo "Environment file created at /etc/bidoro/.env"
else
    echo "/etc/bidoro/.env already exists, skipping to avoid overwriting secrets."
fi

# =========================================
# Configure UFW Firewall
# =========================================
echo "========================================"
echo "Configuring UFW Firewall"
echo "========================================"

# Allow SSH by both profile name and port number as a safety fallback
sudo ufw allow OpenSSH
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Verify SSH rule exists before enabling — prevents lockouts
if sudo ufw show added | grep -qiE "(OpenSSH|22/tcp)"; then
    echo "SSH rule confirmed. Enabling UFW..."
    sudo ufw --force enable
    sudo ufw status verbose
else
    echo "ERROR: SSH rule not found in UFW. Aborting firewall enable to prevent lockout."
    exit 1
fi

# =========================================
# Create Nginx site
# =========================================
echo "========================================"
echo "Creating Nginx site"
echo "========================================"
sudo tee /etc/nginx/sites-available/bidoro > /dev/null <<'EOF'
server {
    listen 80;
    server_name api.bidoro.africa;

    # Return a friendly maintenance page if the app isn't up yet
    error_page 502 503 504 /50x.html;
    location = /50x.html {
        root /usr/share/nginx/html;
        internal;
    }

    location / {
        proxy_pass http://127.0.0.1:3003;
        proxy_http_version 1.1;

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        "upgrade";

        proxy_connect_timeout 60s;
        proxy_send_timeout    60s;
        proxy_read_timeout    60s;

        proxy_intercept_errors on;
    }
}
EOF

sudo ln -sf \
    /etc/nginx/sites-available/bidoro \
    /etc/nginx/sites-enabled/bidoro

sudo rm -f /etc/nginx/sites-enabled/default

# =========================================
# Test and start Nginx
# =========================================
echo "========================================"
echo "Testing Nginx configuration"
echo "========================================"
sudo nginx -t
sudo systemctl enable nginx
sudo systemctl restart nginx

# =========================================
# Final summary
# =========================================
echo ""
echo "========================================"
echo "Setup Complete — $(date)"
echo "========================================"
echo ""
echo "Log saved to: /var/log/bidoro-setup.log"
echo ""
echo "NEXT STEPS:"
echo "1. Fill in secrets:       sudo nano /etc/bidoro/.env"
echo "2. Point DNS:             api.bidoro.africa → this droplet's IP"
echo "3. Issue SSL cert:        sudo certbot --nginx -d api.bidoro.africa"
echo "4. Deploy your app:       copy docker-compose.yml to /opt/bidoro"
echo "                          and run: docker compose up -d"
echo "5. Re-login (or newgrp):  for docker group to take effect if non-root"
echo ""
echo "GitHub Actions secrets to add:"
echo "   DROPLET_HOST    — droplet IP or hostname"
echo "   DROPLET_USER    — SSH user"
echo "   DROPLET_SSH_KEY — private SSH key"
echo "   APP_URL         — https://api.bidoro.africa"
echo "   GHCR_PAT        — GitHub Container Registry token"
echo ""