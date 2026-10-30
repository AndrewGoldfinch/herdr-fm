#!/usr/bin/env bash
# capture-fixtures.sh - run FirstMate's Bearings collector against synthetic homes
# and write sanitized fm-bearings.v1 fixtures plus a timing manifest.
#
# Usage: bash scripts/capture-fixtures.sh <firstmate-checkout> [out-dir]
#
# Every home, HOME and TMPDIR live in a fresh temporary lab directory. The collector
# runs with a clean environment and a fake bin directory first on PATH: tmux answers
# for the synthetic endpoints, and gh, gh-axi, curl and ssh only record that they were
# called and fail, so nothing leaves the machine. FM_CREW_STATE_NO_FORGE=1 is set, as
# the panel does by default. The lab is deleted on exit.
#
# Output (default tests/fixtures/captured/): <scenario>.json for each scenario, with
# lab paths rewritten so the home reads /home/captain/firstmate, and manifest.json
# with the FirstMate revision, exit codes, timings, byte counts and recorded network
# attempts. Scale scenarios are timed but not kept as fixtures.
set -u

FM=${1:?usage: capture-fixtures.sh <firstmate-checkout> [out-dir]}
OUT=${2:-tests/fixtures/captured}
FM=$(cd "$FM" && pwd) || exit 2
COLLECTOR="$FM/bin/fm-bearings-snapshot.sh"
[ -f "$COLLECTOR" ] || { echo "capture-fixtures: $COLLECTOR not found" >&2; exit 2; }
command -v jq >/dev/null 2>&1 || { echo "capture-fixtures: jq not found" >&2; exit 2; }
REVISION=$(git -C "$FM" rev-parse HEAD 2>/dev/null || echo unknown)
NOW=2026-10-30T12:00:00Z

LAB=$(mktemp -d "${TMPDIR:-/tmp}/fm-fixture-lab.XXXXXX") || exit 1
trap 'rm -rf -- "$LAB"' EXIT
mkdir -p "$LAB/fakebin" "$LAB/home" "$LAB/tmp" "$OUT"

# --- fake tools -------------------------------------------------------------
cat > "$LAB/fakebin/tmux" <<'SH'
#!/usr/bin/env bash
# Endpoints whose window name contains "dead-" are absent; all others exist.
case "${1:-}" in
  display-message) case "$*" in *dead-*) exit 1 ;; *) printf '%%1\n' ;; esac ;;
  list-windows) sed -n 's/^window=[^:]*://p' "${FM_HOME:?}"/state/*.meta 2>/dev/null | grep -v 'dead-' || true ;;
  capture-pane) printf 'all quiet\n> \n' ;;
esac
exit 0
SH
for tool in gh gh-axi curl ssh; do
  printf '#!/usr/bin/env bash\necho "%s $*" >> "${NET_LOG:?}"\nexit 1\n' "$tool" > "$LAB/fakebin/$tool"
done
printf '#!/usr/bin/env bash\nexit 0\n' > "$LAB/fakebin/no-mistakes"
chmod +x "$LAB/fakebin/"*

# --- synthetic homes --------------------------------------------------------
new_home() {  # <scenario> -> prints home path
  local home="$LAB/$1/captain/firstmate"
  mkdir -p "$home/data" "$home/state" "$home/config" "$home/projects"
  printf '%s\n' "$home"
}

meta() {  # <file> <key=value>...
  local file=$1
  shift
  printf '%s\n' "$@" > "$file"
}

task() {  # <home> <id> <kind> <status-line> [extra meta...]
  local home=$1 id=$2 kind=$3 status=$4
  shift 4
  mkdir -p "$home/projects/$id"
  meta "$home/state/$id.meta" "window=firstmate:fm-$id" "worktree=$home/projects/$id" \
    "project=demo" "harness=claude" "kind=$kind" "mode=$([ "$kind" = scout ] && echo scout || echo no-mistakes)" "$@"
  printf '%s\n' "$status" > "$home/state/$id.status"
}

scenario_empty() {
  new_home empty >/dev/null
}

scenario_normal() {
  local h
  h=$(new_home normal)
  cat > "$h/data/backlog.md" <<'EOF'
## In flight
- [ ] fix-login - Fix login redirect loop (repo: demo) (kind: ship) (since 2026-10-29)
- [ ] scout-cache - Survey cache eviction data/scout-cache/report.md (repo: demo) (kind: scout) (since 2026-10-29)
- [ ] dead-task - Task whose terminal is gone (repo: demo) (kind: ship) (since 2026-10-28)

## Queued
- [ ] add-metrics - Add request metrics blocked-by: fix-login (repo: demo) (kind: ship)

## Done
- [x] bump-deps - Bump dependencies https://github.com/acme/demo/pull/41 (repo: demo) (kind: ship) (merged 2026-10-28)
EOF
  task "$h" fix-login ship "working: running tests" "pr=https://github.com/acme/demo/pull/42"
  task "$h" scout-cache scout "done: report ready"
  mkdir -p "$h/data/scout-cache"
  printf '# Scout report\n' > "$h/data/scout-cache/report.md"
  task "$h" dead-task ship "working: halfway"
}

scenario_holds() {
  local h
  h=$(new_home holds)
  cat > "$h/data/backlog.md" <<'EOF'
## In flight
- [ ] ask-api - Migrate API client (repo: demo) (kind: ship) (since 2026-10-29)

## Queued
- [ ] pick-db - Choose session store (repo: demo) (kind: captain) (hold: captain choice pending) (hold-kind: captain) (since 2026-10-29)
- [ ] vendor-contract - Sign vendor contract (repo: demo) (kind: captain) (hold: waiting on vendor) (hold-kind: captain) (hold-until: 2026-11-15) (since 2026-10-20)
- [ ] schema-change - Approve schema change blocked-by: ask-api (repo: demo) (kind: captain) (hold: needs schema) (hold-kind: captain) (since 2026-10-28)
- [ ] pricing - Pricing call (repo: demo) (kind: captain) (hold: pricing call) (hold-kind: captain) (since 2026-09-01)

## Done
EOF
  task "$h" ask-api ship "needs-decision [key=api-version]: which API version should the client target?"
}

scenario_away() {
  local h
  h=$(new_home away)
  : > "$h/state/.afk"
}

scenario_scale() {  # <n>
  local h n=$1 i id rows=""
  h=$(new_home "scale-$n")
  for i in $(seq 1 "$n"); do
    id=$(printf 'task-%03d' "$i")
    rows+="- [ ] $id - Synthetic task $i (repo: demo) (kind: ship) (since 2026-10-29)"$'\n'
    task "$h" "$id" ship "working: step $i"
  done
  printf '## In flight\n%s\n## Queued\n\n## Done\n' "$rows" > "$h/data/backlog.md"
}

# --- run ----------------------------------------------------------------------
now_ms() {
  local ns
  ns=$(date +%s%N 2>/dev/null)
  case "$ns" in *N|'') echo $(( $(date +%s) * 1000 )) ;; *) echo $(( ns / 1000000 )) ;; esac
}

results="$LAB/results.jsonl"
: > "$results"

run() {  # <scenario> <keep:1|0>
  local name=$1 keep=$2 dir="$LAB/$1" home="$LAB/$1/captain/firstmate" out err rc t0 t1 net
  out="$dir/out.json"
  err="$dir/err.txt"
  : > "$dir/net.log"
  t0=$(now_ms)
  env -i PATH="$LAB/fakebin:/usr/local/bin:/usr/bin:/bin" HOME="$LAB/home" TMPDIR="$LAB/tmp" \
    FM_HOME="$home" FM_BEARINGS_NOW="$NOW" FM_CREW_STATE_NO_FORGE=1 NET_LOG="$dir/net.log" \
    bash "$COLLECTOR" --json --fields paths,endpoints > "$out" 2> "$err"
  rc=$?
  t1=$(now_ms)
  net=$(wc -l < "$dir/net.log" | tr -d ' ')
  if [ "$keep" = 1 ] && [ "$rc" -eq 0 ]; then
    local text
    text=$(<"$out")
    text=${text//"$LAB/$name"/\/home}
    text=${text//"$LAB"/\/lab}
    printf '%s\n' "$text" | jq . > "$OUT/$name.json"
  fi
  jq -nc --arg name "$name" --argjson rc "$rc" --argjson ms "$((t1 - t0))" \
    --argjson bytes "$(wc -c < "$out" | tr -d ' ')" --argjson net "$net" \
    --arg stderr "$(head -n 1 "$err" | sed "s#$LAB#/lab#g" | cut -c1-200)" --argjson kept "$keep" \
    '{scenario:$name,exit:$rc,elapsed_ms:$ms,bytes:$bytes,network_attempts:$net,stderr_first_line:$stderr,kept:($kept == 1 and $rc == 0)}' >> "$results"
  printf '%-10s exit=%s %6sms %7s bytes net=%s\n' "$name" "$rc" "$((t1 - t0))" "$(wc -c < "$out" | tr -d ' ')" "$net" >&2
}

scenario_empty;  run empty 1
scenario_normal; run normal 1
scenario_holds;  run holds 1
scenario_away;   run away 1
scenario_scale 25; run scale-25 0
scenario_scale 50; run scale-50 0

jq -s --arg rev "$REVISION" --arg now "$NOW" \
  '{firstmate_revision:$rev, collector:"bin/fm-bearings-snapshot.sh --json --fields paths,endpoints", bearings_now:$now, forge_reads:false, runs:.}' \
  "$results" > "$OUT/manifest.json"
echo "capture-fixtures: wrote $OUT (FirstMate $REVISION)" >&2
