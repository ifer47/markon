#!/usr/bin/env bash
#
# Build an MSIX package from the Tauri release output.
# Usage: bash scripts/build-msix.sh
#
# Requires: Windows SDK (makeappx.exe) on PATH or in standard install location.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RELEASE_DIR="$ROOT/src-tauri/target/release"
EXE="$RELEASE_DIR/markeron.exe"

VERSION=$(cd "$ROOT" && node -p "require('./package.json').version")
MSIX_VERSION="${VERSION}.0"
echo "==> Building MSIX for MarkerOn v${VERSION} (MSIX ${MSIX_VERSION})"

if [[ ! -f "$EXE" ]]; then
  echo "ERROR: $EXE not found. Run 'npm run build' first."
  exit 1
fi

MAKEAPPX=""
if command -v makeappx.exe &>/dev/null; then
  MAKEAPPX="makeappx.exe"
else
  SDK_BIN=$(ls -d "C:/Program Files (x86)/Windows Kits/10/bin/"*/x64 2>/dev/null | sort -V | tail -1)
  if [[ -n "$SDK_BIN" && -f "$SDK_BIN/makeappx.exe" ]]; then
    MAKEAPPX="$SDK_BIN/makeappx.exe"
  fi
fi

if [[ -z "$MAKEAPPX" ]]; then
  echo "ERROR: makeappx.exe not found. Install the Windows 10/11 SDK."
  exit 1
fi
echo "==> Using: $MAKEAPPX"

STAGING="$RELEASE_DIR/msix-staging"
rm -rf "$STAGING"
mkdir -p "$STAGING/Assets"

cp "$EXE" "$STAGING/"
cp "$ROOT/appxmanifest.xml" "$STAGING/AppxManifest.xml"

# Inject version into AppxManifest.xml (MSIX requires 4-part: Major.Minor.Patch.0)
sed -i "s/Version=\"[0-9.]*\"/Version=\"${MSIX_VERSION}\"/" "$STAGING/AppxManifest.xml"

cp "$ROOT"/assets/StoreLogo.png \
   "$ROOT"/assets/Square150x150Logo.png \
   "$ROOT"/assets/Square44x44Logo.png \
   "$STAGING/Assets/"

OUTDIR="$RELEASE_DIR/bundle/msix"
mkdir -p "$OUTDIR"
OUTPUT="$OUTDIR/MarkerOn_${VERSION}_x64.msix"
rm -f "$OUTPUT"

WIN_STAGING=$(cygpath -w "$STAGING")
WIN_OUTPUT=$(cygpath -w "$OUTPUT")

# MSYS_NO_PATHCONV prevents Git Bash from mangling /d and /p into drive paths
MSYS_NO_PATHCONV=1 "$MAKEAPPX" pack /d "$WIN_STAGING" /p "$WIN_OUTPUT" /o

rm -rf "$STAGING"

echo "==> MSIX package created: $OUTPUT"
