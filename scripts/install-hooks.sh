#!/bin/bash
# install-hooks.sh — Install Agents Chat hook into ~/.claude/settings.json
# Safe to run multiple times: skips if already installed.

set -euo pipefail

SETTINGS="$HOME/.claude/settings.json"
HOOKS_DIR="$HOME/.claude/hooks"
HOOK_SCRIPT="pixel-chat.sh"
HOOK_CMD="$HOOKS_DIR/$HOOK_SCRIPT"

# --- Pre-checks ---
if ! command -v jq &>/dev/null; then
  echo "Error: jq is required. Install with: brew install jq (macOS) or apt install jq (Linux)"
  exit 1
fi

# --- 1. Copy hook script ---
mkdir -p "$HOOKS_DIR"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cp "$SCRIPT_DIR/pixel-chat-hook.sh" "$HOOK_CMD"
chmod +x "$HOOK_CMD"

# --- 2. Check if already installed ---
if [ -f "$SETTINGS" ] && grep -q "pixel-chat.sh" "$SETTINGS" 2>/dev/null; then
  echo "[Agents Chat] Chat hook already installed, updated script only."
  exit 0
fi

# --- 3. Merge hook into settings.json ---
HOOK_ENTRY='{"hooks":[{"type":"command","command":"'"$HOOK_CMD"'","timeout":3}]}'

if [ ! -f "$SETTINGS" ]; then
  # No settings file at all — create one
  mkdir -p "$(dirname "$SETTINGS")"
  jq -n --argjson entry "$HOOK_ENTRY" '{hooks:{SessionStart:[$entry]}}' > "$SETTINGS"
elif jq -e '.hooks.SessionStart' "$SETTINGS" >/dev/null 2>&1; then
  # SessionStart array exists — append
  jq --argjson entry "$HOOK_ENTRY" '.hooks.SessionStart += [$entry]' "$SETTINGS" > "$SETTINGS.tmp"
  mv "$SETTINGS.tmp" "$SETTINGS"
elif jq -e '.hooks' "$SETTINGS" >/dev/null 2>&1; then
  # hooks object exists but no SessionStart
  jq --argjson entry "$HOOK_ENTRY" '.hooks.SessionStart = [$entry]' "$SETTINGS" > "$SETTINGS.tmp"
  mv "$SETTINGS.tmp" "$SETTINGS"
else
  # No hooks key at all
  jq --argjson entry "$HOOK_ENTRY" '. + {hooks:{SessionStart:[$entry]}}' "$SETTINGS" > "$SETTINGS.tmp"
  mv "$SETTINGS.tmp" "$SETTINGS"
fi

echo "[Agents Chat] Chat hook installed into $SETTINGS"
