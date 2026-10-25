#!/usr/bin/env bash
set -euo pipefail
args=()
while IFS= read -r name; do args+=(-e "$name"); done < <(env | grep -oE '^(INPUT_[A-Z0-9_-]+|GITHUB_[A-Z_]+|RUNNER_[A-Z_]+)=' | tr -d =)
exec docker run --rm "${args[@]}" -v "$GITHUB_WORKSPACE:$GITHUB_WORKSPACE" -v "$RUNNER_TEMP:$RUNNER_TEMP" -w "$GITHUB_WORKSPACE" "$IMAGE_REF"
