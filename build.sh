#!/usr/bin/env bash
# Shiver build script.
#   ./build.sh            install deps (if needed) and start the server on http://localhost:8781
#   ./build.sh test       syntax-check everything and run the end-to-end smoke test
#   ./build.sh dev        start with auto-restart on server changes
#   ./build.sh desktop    run the desktop app (Electron) against a local server
#   ./build.sh package [mac|win|linux]   build desktop installers into desktop/dist (default: this OS)
#   ./build.sh cf-dev     run the Cloudflare version locally (wrangler dev)
#   ./build.sh deploy     deploy to Cloudflare Workers
#   ./build.sh sync-pixeter   refresh the bundled Pixeter core from ../PixeterWeb
set -euo pipefail
cd "$(dirname "$0")"
[ -d node_modules ] || npm install

case "${1:-start}" in
  start) node server/index.js ;;
  dev) node --watch-path=server server/index.js ;;
  test)
    echo "Syntax check"
    find server runtime/engine web/js tools -name '*.js' -o -name '*.mjs' | while read -r f; do node --check "$f"; done
    echo "  ok all files parse"
    node tools/smoke.mjs
    ;;
  desktop)
    (cd desktop && [ -d node_modules ] || npm install)
    (cd desktop && npx electron .)
    ;;
  package)
    rm -rf desktop/bundle && mkdir -p desktop/bundle/node_modules
    cp -R server web runtime templates package.json desktop/bundle/
    for m in ws three monaco-editor; do cp -R "node_modules/$m" desktop/bundle/node_modules/; done
    target="${2:-}"
    flag=""; [ -n "$target" ] && flag="--$target"
    (cd desktop && npm install && CSC_IDENTITY_AUTO_DISCOVERY="${CSC_IDENTITY_AUTO_DISCOVERY:-false}" npx electron-builder $flag)
    echo "Installers are in desktop/dist"
    ;;
  cf-dev) node tools/build-cf.mjs && npx wrangler dev --port "${PORT:-8790}" ;;
  deploy) node tools/build-cf.mjs && npx wrangler deploy ;;
  sync-pixeter)
    { echo "// Copied from PixeterWeb/public/js/core.js (Pixeter by Virat Reddy Kaukuntla) so Shiver can import .pixeter files."; echo "// Refresh with: ./build.sh sync-pixeter"; cat ../PixeterWeb/public/js/core.js; } > web/js/vendor/pixeter-core.js
    echo "Pixeter core updated" ;;
  *) echo "usage: ./build.sh [start|dev|test|desktop|package|cf-dev|deploy|sync-pixeter]"; exit 1 ;;
esac
