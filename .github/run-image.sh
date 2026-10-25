#!/usr/bin/env bash
set -euo pipefail
envs=$(mktemp "$RUNNER_TEMP/env.XXXXXX")
trap 'rm -f "$envs"' EXIT
while IFS='=' read -r name value; do
  if [[ "$name" == INPUT_* ]]; then
    printf 'INPUT_%s=%s\n' "$(tr _ - <<< "${name#INPUT_}")" "$value"
  else
    printf '%s=%s\n' "$name" "$value"
  fi
done < <(env | grep -E '^(INPUT|GITHUB|RUNNER)_[A-Z0-9_]+=' | grep -v '^GITHUB_TOKEN=') > "$envs"
docker run --rm --env-file "$envs" -v "$GITHUB_WORKSPACE:$GITHUB_WORKSPACE" -v "$RUNNER_TEMP:$RUNNER_TEMP" -w "$GITHUB_WORKSPACE" "$IMAGE_REF"
