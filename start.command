#!/bin/bash
# GAM Integrator launcher — double-click to start the app and open it in your browser.
# Keep this window open while you use the app; press Ctrl+C (or close the window) to stop it.

set -e
cd "$(dirname "$0")"

APP_URL="http://127.0.0.1:5199"

echo "==============================================="
echo "  GAM Integrator"
echo "==============================================="

# 1. Make sure Node.js is available (also check common install locations,
#    since double-clicked .command files get a minimal PATH).
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js was not found. Install it from https://nodejs.org and run this again."
  read -n 1 -s -r -p "Press any key to close…"
  exit 1
fi
echo "• Node $(node --version)"

# 2. Install dependencies on first run.
if [ ! -d node_modules ]; then
  echo "• First run — installing dependencies (this takes a minute)…"
  npm install
  npm run postinstall
fi

# 3. Build the app if it hasn't been built yet, or if the source changed since.
if [ ! -d client/dist ] || [ -n "$(find client/src server/src -newer client/dist -print -quit 2>/dev/null)" ]; then
  echo "• Building the app…"
  npm run build
fi

# 4. Stop any previous instance so we always launch fresh.
OLD_PIDS=$(lsof -ti tcp:5199 2>/dev/null || true)
if [ -n "$OLD_PIDS" ]; then
  echo "• Stopping previous instance (pid $OLD_PIDS)…"
  kill $OLD_PIDS 2>/dev/null || true
  for i in 1 2 3 4 5; do
    lsof -ti tcp:5199 >/dev/null 2>&1 || break
    sleep 1
  done
  # still holding the port? force it
  lsof -ti tcp:5199 2>/dev/null | xargs kill -9 2>/dev/null || true
fi

# 5. Start the server, open the browser once it's up.
echo "• Starting server at $APP_URL …"
(
  for i in $(seq 1 30); do
    sleep 1
    if curl -s -o /dev/null --max-time 2 "$APP_URL/api/setup/status"; then
      open "$APP_URL"
      exit 0
    fi
  done
  echo "⚠️  The server didn't come up within 30s — check the log output above."
) &

echo
echo "  App: $APP_URL  (opening in your browser…)"
echo "  Stop: press Ctrl+C or close this window."
echo "-----------------------------------------------"
npm start
