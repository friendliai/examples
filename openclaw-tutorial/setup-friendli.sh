#!/usr/bin/env bash
# setup-friendli-openclaw.sh
# Safe patch/merge installer for OpenClaw config (FriendliAI GLM-5).
#
# Examples:
#   curl -fsSL https://<HOST>/setup-friendli-openclaw.sh | bash -s -- --friendli-token "..."
#   ./setup-friendli-openclaw.sh --friendli-token "..."
#
# Optional:
#   --set-default         Set agents.defaults.model.primary to friendliai/zai-org/GLM-5 (only if you want)
#   --config-file <path>  Default: ~/.openclaw/openclaw.json
#   --workspace <path>    Default: ~/.openclaw/workspace
#   --version <ver>       Default: 2026.3.1
#
# Behavior:
# - If config exists: patch only relevant keys, preserve everything else.
# - If config missing: create minimal config + defaults.
# - Requires jq. If missing, exits safely (no overwrite).

set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  setup-friendli-openclaw.sh --friendli-token <TOKEN> [--set-default] [--config-file <PATH>] [--workspace <PATH>] [--version <VER>]

Required:
  --friendli-token <TOKEN>     FriendliAI Serverless API key

Optional:
  --set-default                Set agents.defaults.model.primary to friendliai/zai-org/GLM-5
  --config-file <PATH>         Default: ~/.openclaw/openclaw.json
  --workspace <PATH>           Default: ~/.openclaw/workspace
  --version <VER>              Default: 2026.3.1

Notes:
- This script patches config safely. It does NOT overwrite your entire openclaw.json.
- jq is required for safe JSON patching.
USAGE
}

FRIENDLI_TOKEN=""
SET_DEFAULT="false"
VERSION="2026.3.1"

CONFIG_FILE="${HOME}/.openclaw/openclaw.json"
WORKSPACE_DEFAULT="${HOME}/.openclaw/workspace"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --friendli-token) FRIENDLI_TOKEN="${2:-}"; shift 2;;
    --set-default) SET_DEFAULT="true"; shift 1;;
    --config-file) CONFIG_FILE="${2:-}"; shift 2;;
    --workspace) WORKSPACE_DEFAULT="${2:-}"; shift 2;;
    --version) VERSION="${2:-}"; shift 2;;
    -h|--help) usage; exit 0;;
    *) echo "Unknown arg: $1" >&2; usage; exit 1;;
  esac
done

if [[ -z "$FRIENDLI_TOKEN" ]]; then
  echo "Error: --friendli-token is required" >&2
  usage >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq is required for safe patching, but it's not installed." >&2
  echo "" >&2
  echo "Install jq:" >&2
  echo "  macOS (Homebrew):  brew install jq" >&2
  echo "  Ubuntu/Debian:     sudo apt-get update && sudo apt-get install -y jq" >&2
  echo "  Fedora:            sudo dnf install -y jq" >&2
  echo "" >&2
  echo "Refusing to overwrite config without jq for safety." >&2
  exit 1
fi

CONFIG_DIR="$(dirname "$CONFIG_FILE")"
mkdir -p "$CONFIG_DIR"

NOW_ISO_UTC="$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")"

# Generate a gateway token if needed (40-64 hex chars)
gen_token() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 24
  else
    # Fallback: not cryptographically strong but better than nothing
    date +%s%N | shasum | awk '{print $1}'
  fi
}

# Load existing config or {}
if [[ -f "$CONFIG_FILE" ]]; then
  EXISTING_JSON="$(cat "$CONFIG_FILE")"
else
  EXISTING_JSON="{}"
fi

# Prepare the FriendliAI provider + model patch
PATCH_JSON="$(cat <<EOF
{
  "wizard": {
    "lastRunAt": "${NOW_ISO_UTC}",
    "lastRunVersion": "${VERSION}",
    "lastRunCommand": "onboard",
    "lastRunMode": "local"
  },
  "models": {
    "mode": "merge",
    "providers": {
      "friendliai": {
        "baseUrl": "https://api.friendli.ai/serverless/v1",
        "apiKey": "${FRIENDLI_TOKEN}",
        "api": "openai-completions",
        "models": [
          {
            "id": "zai-org/GLM-5",
            "name": "zai-org/GLM-5 (Custom Provider)",
            "reasoning": true,
            "input": ["text"],
            "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
            "contextWindow": 203000,
            "maxTokens": 4096
          }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "models": {
        "friendliai/zai-org/GLM-5": { "alias": "glm" }
      },
      "workspace": "${WORKSPACE_DEFAULT}",
      "contextPruning": { "mode": "cache-ttl", "ttl": "1h" },
      "compaction": { "mode": "safeguard" },
      "heartbeat": { "every": "30m" },
      "maxConcurrent": 4,
      "subagents": { "maxConcurrent": 8 }
    }
  },
  "messages": { "ackReactionScope": "group-mentions" },
  "commands": { "native": "auto", "nativeSkills": "auto", "restart": true, "ownerDisplay": "raw" },
  "session": { "dmScope": "per-channel-peer" },
  "gateway": {
    "port": 18789,
    "mode": "local",
    "bind": "loopback",
    "auth": { "mode": "token" },
    "tailscale": { "mode": "off", "resetOnExit": false },
    "nodes": {
      "denyCommands": [
        "camera.snap",
        "camera.clip",
        "screen.record",
        "calendar.add",
        "contacts.add",
        "reminders.add"
      ]
    }
  },
  "meta": {
    "lastTouchedVersion": "${VERSION}",
    "lastTouchedAt": "${NOW_ISO_UTC}"
  }
}
EOF
)"

# Backup before writing
if [[ -f "$CONFIG_FILE" ]]; then
  TS="$(date -u +"%Y%m%d%H%M%S" 2>/dev/null || date +%s)"
  BACKUP="${CONFIG_FILE}.${TS}.bak"
  cp "$CONFIG_FILE" "$BACKUP"
  echo "Backed up existing config: $BACKUP"
fi

# Apply patch:
# - Deep merge objects (patch wins)
# - BUT do not override existing agents.defaults.model.primary unless --set-default
# - Ensure gateway.auth.token exists: generate only if missing
# - Merge denyCommands uniquely (avoid duplicates)
MERGED="$(
  jq -s --arg now "$NOW_ISO_UTC" --arg ver "$VERSION" --arg setDefault "$SET_DEFAULT" '
    def deep_merge(a; b):
      if (a|type)=="object" and (b|type)=="object" then
        reduce ((a|keys_unsorted) + (b|keys_unsorted) | unique[]) as $k
          ({}; .[$k] = deep_merge(a[$k]; b[$k]))
      elif (b == null) then a
      else b end;

    # merge arrays by union (unique) for denyCommands only
    def uniq_union(a; b):
      ((a // []) + (b // [])) | unique;

    .[0] as $old
    | .[1] as $patch
    | (deep_merge($old; $patch)) as $m

    # Preserve existing primary unless explicitly requested
    | if ($setDefault == "true") then
        $m | .agents.defaults.model.primary = "friendliai/zai-org/GLM-5"
      else
        if ($old.agents.defaults.model.primary? != null) then
          $m | .agents.defaults.model.primary = $old.agents.defaults.model.primary
        else
          $m
        end
      end

    # If old had agents.defaults.model and patch did not add it (patch adds models/alias but not model),
    # keep existing .agents.defaults.model object unless setDefault requested.
    | if ($setDefault != "true" and $old.agents.defaults.model? != null and (.agents.defaults.model? == null)) then
        .agents.defaults.model = $old.agents.defaults.model
      else . end
    
    | if ($old.agents.defaults.workspace? != null) then
        .agents.defaults.workspace = $old.agents.defaults.workspace
      else . end

    # Keep existing gateway/auth token if present; otherwise create placeholder "___GENERATE___"
    | if (.gateway.auth.mode? == "token") then
        if (.gateway.auth.token? == null or (.gateway.auth.token|tostring|length) == 0) then
          .gateway.auth.token = "___GENERATE___"
        else .
        end
      else . end

    # Merge denyCommands uniquely
    | .gateway.nodes.denyCommands = uniq_union($old.gateway.nodes.denyCommands; $patch.gateway.nodes.denyCommands)

  ' <(printf '%s\n' "$EXISTING_JSON") <(printf '%s\n' "$PATCH_JSON")
)"

# If token placeholder exists, replace with generated token (done in bash, not jq)
if echo "$MERGED" | jq -e '.gateway.auth.token == "___GENERATE___"' >/dev/null 2>&1; then
  NEW_TOKEN="$(gen_token)"
  MERGED="$(printf '%s\n' "$MERGED" | jq --arg t "$NEW_TOKEN" '.gateway.auth.token = $t')"
fi

# Write pretty JSON
printf '%s\n' "$MERGED" | jq '.' > "$CONFIG_FILE"

# Mask output
if [[ ${#FRIENDLI_TOKEN} -gt 12 ]]; then
  MASKED="${FRIENDLI_TOKEN:0:8}...${FRIENDLI_TOKEN: -4}"
else
  MASKED="${FRIENDLI_TOKEN:0:4}..."
fi

echo "✅ Patched OpenClaw config:"
echo "  File: $CONFIG_FILE"
echo "  Friendli token: $MASKED"
echo "  Provider: friendliai (GLM-5)"
if [[ "$SET_DEFAULT" == "true" ]]; then
  echo "  Default model: friendliai/zai-org/GLM-5 (set by --set-default)"
else
  echo "  Default model: unchanged (use --set-default to set GLM-5)"
fi
