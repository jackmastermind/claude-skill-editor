#!/bin/bash

set -e

PRODUCT_DIR="/opt/${productFilename}"
EXECUTABLE="${executable}"

if type update-alternatives >/dev/null 2>&1; then
  # Remove previous link if it doesn't use update-alternatives
  if [ -L "/usr/bin/$EXECUTABLE" ] && [ -e "/usr/bin/$EXECUTABLE" ] && [ "$(readlink "/usr/bin/$EXECUTABLE")" != "/etc/alternatives/$EXECUTABLE" ]; then
    rm -f "/usr/bin/$EXECUTABLE"
  fi
  update-alternatives --install "/usr/bin/$EXECUTABLE" "$EXECUTABLE" "$PRODUCT_DIR/$EXECUTABLE" 100 || ln -sf "$PRODUCT_DIR/$EXECUTABLE" "/usr/bin/$EXECUTABLE"
else
  ln -sf "$PRODUCT_DIR/$EXECUTABLE" "/usr/bin/$EXECUTABLE"
fi

# SUID chrome-sandbox for Electron 5+
chmod 4755 "$PRODUCT_DIR/chrome-sandbox" || true

if hash update-mime-database 2>/dev/null; then
  update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
  update-desktop-database /usr/share/applications || true
fi
