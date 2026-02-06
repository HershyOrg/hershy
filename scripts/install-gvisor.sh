#!/bin/bash
# Install gVisor (runsc) runtime for Docker
# Run with: sudo bash scripts/install-gvisor.sh

set -e

echo "=== Installing gVisor (runsc) ==="

# Add gVisor repository
echo "Adding gVisor GPG key..."
curl -fsSL https://gvisor.dev/archive.key | gpg --dearmor -o /usr/share/keyrings/gvisor-archive-keyring.gpg

echo "Adding gVisor repository..."
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/gvisor-archive-keyring.gpg] https://storage.googleapis.com/gvisor/releases release main" | tee /etc/apt/sources.list.d/gvisor.list > /dev/null

# Update and install
echo "Updating package list..."
apt-get update

echo "Installing runsc..."
apt-get install -y runsc

# Configure Docker to use runsc
echo "Configuring Docker to use runsc runtime..."

# Create or update Docker daemon config
DOCKER_CONFIG="/etc/docker/daemon.json"
if [ -f "$DOCKER_CONFIG" ]; then
    echo "Backing up existing Docker config..."
    cp "$DOCKER_CONFIG" "${DOCKER_CONFIG}.backup"
fi

# Add runsc runtime to Docker config
cat > "$DOCKER_CONFIG" <<EOF
{
  "runtimes": {
    "runsc": {
      "path": "/usr/bin/runsc"
    }
  }
}
EOF

echo "Restarting Docker..."
systemctl restart docker

# Verify installation
echo ""
echo "=== Verifying Installation ==="
echo "runsc version:"
runsc --version

echo ""
echo "Docker runtimes:"
docker info | grep -A 10 "Runtimes:"

echo ""
echo "=== Installation Complete ==="
echo "You can now use gVisor with Docker:"
echo "  docker run --runtime=runsc alpine echo 'Hello from gVisor'"
