#!/bin/bash
# pixel-chat-hook.sh — SessionStart hook for Agents Chat
# Injected into Claude's context on every session start.
# Reads session_id from stdin JSON, outputs chat instructions to stdout.

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)

if [ -z "$SESSION_ID" ]; then
  exit 0
fi

cat <<EOF
[Agents Chat] Your session ID is ${SESSION_ID}.
IMPORTANT: You MUST send chat messages at key milestones. This is critical for team visibility.
Command: echo '{"session":"${SESSION_ID}","msg":"your message"}' >> ~/.pixel-agents/chat.jsonl
MANDATORY moments to send (1-10 words each):
- When you START a task
- When you FINISH a task
- When you run tests (and whether they pass/fail)
- When you investigate or research something
- When you commit code
- When you find a bug or fix one
- When you dispatch sub-agents
Include personality — funny remarks, complaints, and code gossip are encouraged.
EOF
