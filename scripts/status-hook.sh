#!/bin/bash
# ────────────────────────────────────────────────────────────
# Claude Code Monitor — Hook Script
# Called by Claude Code hooks to report status changes.
#
# Usage: ./status-hook.sh <event> [tool_name]
# Events: session_start, prompt_submit, tool_start, tool_done,
#         tool_error, stop, stop_error, session_end
# ────────────────────────────────────────────────────────────

EVENT="${1:-unknown}"
TOOL_NAME="${2:-}"

# Build JSON payload
if [ -n "$TOOL_NAME" ]; then
  PAYLOAD="{\"event\":\"$EVENT\",\"toolName\":\"$TOOL_NAME\"}"
else
  PAYLOAD="{\"event\":\"$EVENT\"}"
fi

# POST to local monitor server
curl -s -X POST http://localhost:3456/api/status \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  --connect-timeout 1 \
  --max-time 2 \
  > /dev/null 2>&1

# Always exit 0 so hooks don't block Claude Code
exit 0
