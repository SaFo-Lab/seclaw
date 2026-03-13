#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

RUNS="${1:-1}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-120}"

if [[ ! "$RUNS" =~ ^[0-9]+$ ]] || [[ "$RUNS" -lt 1 ]]; then
  echo "Usage: $0 [runs]"
  echo "Example: $0 10"
  exit 1
fi

if [[ "${BUILD_FIRST:-1}" == "1" ]]; then
  echo "[measure] building project..."
  npm run build >/dev/null
fi

if [[ ! -f "dist/index.js" ]]; then
  echo "[measure] dist/index.js not found. Run npm run build first."
  exit 1
fi

echo "[measure] measuring startup time for seclaw gateway"
echo "[measure] runs=$RUNS timeout=${TIMEOUT_SECONDS}s"

declare -a PROCESS_MS=()
declare -a GATEWAY_MS=()

cleanup_pid() {
  local pid="$1"
  local was_alive=0
  if kill -0 "$pid" >/dev/null 2>&1; then
    was_alive=1
    kill -TERM "$pid" >/dev/null 2>&1 || true
    for _ in {1..30}; do
      if ! kill -0 "$pid" >/dev/null 2>&1; then
        break
      fi
      sleep 0.1
    done
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill -KILL "$pid" >/dev/null 2>&1 || true
    fi
  fi

  if [[ "$was_alive" -eq 1 ]]; then
    wait "$pid" >/dev/null 2>&1 || true
  fi
}

parse_metric() {
  local line="$1"
  local key="$2"
  echo "$line" | sed -nE "s/.*${key}=([0-9]+(\.[0-9]+)?).*/\1/p"
}

for ((i = 1; i <= RUNS; i++)); do
  echo "[measure] run $i/$RUNS"

  log_file="$(mktemp -t seclaw_startup.XXXXXX.log)"

  # Use dist entry directly to avoid any old global binary name conflicts.
  SECLAW_STARTUP_METRICS=1 node dist/index.js gateway --startup-metrics >"$log_file" 2>&1 &
  pid=$!

  ready_line=""
  start_ts="$(date +%s)"

  while true; do
    if grep -qE "\[startup\] (result=ready|phase=agent_ready)" "$log_file"; then
      ready_line="$(grep -E "\[startup\] (result=ready|phase=agent_ready)" "$log_file" | tail -n 1)"
      break
    fi

    if ! kill -0 "$pid" >/dev/null 2>&1; then
      echo "[measure] run $i failed: process exited before ready"
      echo "[measure] --- log tail ---"
      tail -n 80 "$log_file" || true
      rm -f "$log_file"
      exit 1
    fi

    now_ts="$(date +%s)"
    if (( now_ts - start_ts >= TIMEOUT_SECONDS )); then
      echo "[measure] run $i timeout after ${TIMEOUT_SECONDS}s"
      echo "[measure] --- log tail ---"
      tail -n 80 "$log_file" || true
      cleanup_pid "$pid"
      rm -f "$log_file"
      exit 1
    fi

    sleep 0.2
  done

  process_ms="$(parse_metric "$ready_line" "process_ms")"
  gateway_ms="$(parse_metric "$ready_line" "gateway_ms")"

  if [[ -z "$process_ms" || -z "$gateway_ms" ]]; then
    echo "[measure] run $i parse failed"
    echo "line: $ready_line"
    cleanup_pid "$pid"
    rm -f "$log_file"
    exit 1
  fi

  PROCESS_MS+=("$process_ms")
  GATEWAY_MS+=("$gateway_ms")

  echo "[measure] run $i ready: process_ms=$process_ms gateway_ms=$gateway_ms"

  cleanup_pid "$pid"
  rm -f "$log_file"

done

summarize() {
  local label="$1"
  shift
  local values=("$@")

  local count="${#values[@]}"
  local sorted
  sorted="$(printf "%s\n" "${values[@]}" | sort -n)"

  local min max avg p50 p95
  min="$(printf "%s\n" "$sorted" | head -n 1)"
  max="$(printf "%s\n" "$sorted" | tail -n 1)"
  avg="$(printf "%s\n" "${values[@]}" | awk '{s+=$1} END{if(NR>0) printf "%.1f", s/NR; else print "0"}')"

  local idx50=$(( (count + 1) / 2 ))
  local idx95=$(( (count * 95 + 99) / 100 ))
  if (( idx95 < 1 )); then idx95=1; fi
  if (( idx95 > count )); then idx95=$count; fi

  p50="$(printf "%s\n" "$sorted" | sed -n "${idx50}p")"
  p95="$(printf "%s\n" "$sorted" | sed -n "${idx95}p")"

  echo "[measure] $label: avg=${avg}ms p50=${p50}ms p95=${p95}ms min=${min}ms max=${max}ms n=${count}"
}

echo "[measure] --- summary ---"
summarize "process_ms(start->agent_ready)" "${PROCESS_MS[@]}"
summarize "gateway_ms(gateway_action->agent_ready)" "${GATEWAY_MS[@]}"
