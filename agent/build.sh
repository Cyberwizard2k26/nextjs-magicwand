#!/usr/bin/env bash
# Cross-compiles the MagicWand agent for every supported platform into agent/dist/.
# Usage: bash agent/build.sh [version]
set -euo pipefail
cd "$(dirname "$0")"
VERSION="${1:-${AGENT_VERSION:-0.1.0}}"
OUT="dist"
mkdir -p "$OUT"
LDFLAGS="-s -w -X main.Version=${VERSION}"
targets=(
  "windows amd64 .exe"
  "windows arm64 .exe"
  "windows 386 .exe"
  "linux amd64 ''"
  "linux arm64 ''"
  "linux arm ''"
  "darwin amd64 ''"
  "darwin arm64 ''"
  "freebsd amd64 ''"
)
for t in "${targets[@]}"; do
  set -- $t
  GOOS=$1 GOARCH=$2 EXT=$(eval echo $3)
  name="magicwand-agent_${GOOS}_${GOARCH}${EXT}"
  echo "building $name"
  CGO_ENABLED=0 GOOS=$GOOS GOARCH=$GOARCH go build -trimpath -ldflags "$LDFLAGS" -o "$OUT/$name" ./cmd/magicwand-agent
done
( cd "$OUT" && sha256sum magicwand-agent_* > SHA256SUMS )
echo "done -> $OUT/"
