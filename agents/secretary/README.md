# The Secretary — Working Directory

This is the scratch space for The Secretary agent.

## What goes here
- Retry state between poll cycles
- Temporary receipt staging
- Agent-specific configuration overrides (if any)

## Agent definition
See `.claude/agents/secretary.md` for the full agent spec.

## Primary outputs
- Drains `data/notifications/queue.json`
- Appends to `data/notifications/sent.jsonl`
- Appends to `data/notifications/dead-letter.jsonl`
- Appends to `data/logs/secretary.log`
- Updates `data/squad-state.json` (agent status)

## Gateway
All dispatch goes through `src/services/gateway.ts` — local only, no network.
