#!/usr/bin/env bash
# Run this after `docker compose up --build` (or after starting backend+frontend
# manually) to confirm the whole stack is actually wired together correctly.
# It does not prove any individual portal scraper works against the live
# portal -- it proves the API, DB, and orchestrator are talking to each other.
set -euo pipefail

API="${API_BASE:-http://127.0.0.1:4000}"
WEB="${WEB_BASE:-http://localhost:3000}"

echo "1) Backend health..."
curl -sf "$API/health" | tee /tmp/health.json
echo

echo "2) Portal registry (expect 22 portals)..."
curl -sf "$API/api/portals" | python3 -c "import json,sys; d=json.load(sys.stdin); print('portals:', d['count'])"

echo "3) Triggering an incremental scrape of CPPP (the pilot portal)..."
curl -sf -X POST "$API/api/scrape/portal/cppp" -H "Content-Type: application/json" -d '{"mode":"incremental"}' | tee /tmp/scrape.json
echo

echo "4) Recent scrape runs..."
curl -sf "$API/api/scrape/runs?portal=cppp" | python3 -m json.tool | head -30

echo "5) Search endpoint (empty query, just checks it responds)..."
curl -sf "$API/api/tenders/search?limit=5" | python3 -c "import json,sys; d=json.load(sys.stdin); print('totalMatching:', d['totalMatching'])"

echo "6) Frontend responds..."
curl -sf -o /dev/null -w "frontend HTTP %{http_code}\n" "$WEB"

echo
echo "All checks passed. Open $WEB in your browser to see the UI."
