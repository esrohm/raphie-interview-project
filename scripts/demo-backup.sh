#!/usr/bin/env bash
# Runs the demo steps for real and saves everything to demo-backup.txt.
# Doubles as a pre-demo smoke test: if the key or the helper endpoint has
# stopped working, you find out here instead of in front of people.
#
#   bash scripts/demo-backup.sh
set -uo pipefail

cd "$(dirname "$0")/.."
out=demo-backup.txt
: >"$out"
failed=0

riverline="A sportsbook operator with high withdrawal volume, KYC questions, promo eligibility disputes, and periodic support spikes on big game days"
apexpay="A payments provider for iGaming operators that supports card, ACH, and crypto on-ramps, and handles a high volume of payout status and fraud review tickets from operators and end users"

step() {
  local title=$1
  shift
  printf '\n\n==================== %s ====================\n$ %s\n\n' "$title" "$*" >>"$out"
  echo "running: $title"
  if ! "$@" >>"$out" 2>&1; then
    echo "  ^ exited non-zero, check $out"
    failed=1
  fi
}

answers() {
  printf 'Jane Doe\nRiverline Sportsbook\n%s\ndirect\n' "$riverline" | npm start -s
}

step "1. interactive run, brief example #1 (answers piped in)" answers
step "2. same company, warm tone" \
  npm start -s -- --name "Jane Doe" --company "Riverline Sportsbook" --description "$riverline" --tone warm
step "3. vague company, low confidence path" \
  npm start -s -- --name "Sam Ortiz" --company "Lumen Labs" --description "A small company based in Malta" --tone direct
step "4. the prompt input the model gets" \
  npm start -s -- --show-prompt --name "Jane Doe" --company "ApexPay Gaming" --description "$apexpay" --tone warm
step "5. raw helper response" \
  env DEBUG=1 npm start -s -- --name "Alex Gould" --company "Big Bet Sports" \
  --description "A sportsbook operator with high withdrawal volume and frequent KYC tickets" --tone direct
step "6. eval across all segments" npm run -s eval -- --show
step "7. full check (same as CI)" npm run -s check

if [ "$failed" -eq 0 ]; then
  echo "all steps passed, transcript in $out"
else
  echo "some steps failed, see $out"
fi
exit "$failed"
