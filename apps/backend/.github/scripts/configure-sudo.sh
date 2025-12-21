#!/bin/bash
# Script to configure sudo without password for deploy user
# Run this ONCE on the server as root

set -e

USER="${1:-deploy}"

echo "Configuring sudo without password for user: $USER"

# Check if user exists
if ! id "$USER" &>/dev/null; then
    echo "Error: User $USER does not exist"
    exit 1
fi

# Create sudoers file
echo "$USER ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/$USER
chmod 0440 /etc/sudoers.d/$USER

echo "Sudo configured successfully for $USER"
echo "You can now use sudo without password"


