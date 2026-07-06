#!/bin/bash
# =========================================================
# FINAL FRONT — Multiplayer-Server starten (alles gratis)
#   1. startet den Lockstep-Relay-Server (Port 8571)
#   2. öffnet einen Cloudflare-Quick-Tunnel (wss, kostenlos, ohne Account)
#   3. veröffentlicht die Adresse im GitHub-Gist, den die Webseite
#      abfragt — Spieler auf der GitHub-Page verbinden sich automatisch.
# Beenden: Ctrl+C (meldet den Server im Gist als offline)
# =========================================================
set -e
cd "$(dirname "$0")/../.."

GIST_ID="41b04695913f0fbc3145fe31cebf8a3d"
PORT="${PORT:-8571}"
LOG_DIR="${TMPDIR:-/tmp}/finalfront-mp"
mkdir -p "$LOG_DIR"

echo "▶ Starte Final-Front-Server (Port $PORT) …"
node server/mpserver.js > "$LOG_DIR/server.log" 2>&1 &
SERVER_PID=$!

echo "▶ Öffne Cloudflare-Tunnel (gratis, ohne Account) …"
cloudflared tunnel --url "http://localhost:$PORT" --no-autoupdate > "$LOG_DIR/tunnel.log" 2>&1 &
TUNNEL_PID=$!

cleanup() {
  echo ""
  echo "▶ Fahre herunter …"
  echo '{"url":"","status":"offline"}' > "$LOG_DIR/gist.json"
  gh gist edit "$GIST_ID" "$LOG_DIR/gist.json" -f finalfront-server.json >/dev/null 2>&1 || true
  kill "$SERVER_PID" "$TUNNEL_PID" 2>/dev/null || true
  echo "✔ Server offline gemeldet. Tschüss!"
}
trap cleanup EXIT INT TERM

# Tunnel-URL aus dem Log fischen (max. 30 s warten)
URL=""
for i in $(seq 1 30); do
  URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOG_DIR/tunnel.log" | head -1 || true)
  [ -n "$URL" ] && break
  sleep 1
done
if [ -z "$URL" ]; then
  echo "✖ Tunnel-URL nicht gefunden — siehe $LOG_DIR/tunnel.log"
  exit 1
fi
WSS="${URL/https:\/\//wss://}"

echo "{\"url\":\"$WSS\",\"status\":\"online\"}" > "$LOG_DIR/gist.json"
gh gist edit "$GIST_ID" "$LOG_DIR/gist.json" -f finalfront-server.json
echo ""
echo "✔ MULTIPLAYER ONLINE!"
echo "   Server:  http://localhost:$PORT"
echo "   Tunnel:  $WSS"
echo "   Spielen: https://konstitheprogrammer.github.io/finalfront/  →  🌐 MULTIPLAYER"
echo ""
echo "   (Fenster offen lassen — Ctrl+C beendet den Server)"
wait "$SERVER_PID"
