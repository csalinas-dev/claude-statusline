#!/usr/bin/env node
// Records main-session activity for the status line.
//
// Wired to two hook events in settings.json:
//   UserPromptSubmit -> the main agent started working
//   Stop             -> the main agent finished its turn
//
// SubagentStop is deliberately NOT wired up: we only track the main worker,
// not the swarm's subagents. As extra insurance, any payload carrying an
// agent_id (i.e. fired inside a subagent context) is ignored.
//
// Writes one small JSON file per session. Never writes to stdout — for
// UserPromptSubmit, stdout would be injected into Claude's context.

import { mkdirSync, writeFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const STATE_DIR = join(homedir(), ".claude", "statusline-state");
const PRUNE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

// Delete state files from sessions long since finished.
function prune() {
  const cutoff = Date.now() - PRUNE_AFTER_MS;
  for (const entry of readdirSync(STATE_DIR)) {
    if (!entry.endsWith(".json")) continue;
    const path = join(STATE_DIR, entry);
    try {
      if (statSync(path).mtimeMs < cutoff) unlinkSync(path);
    } catch {
      // raced with another session; not our problem
    }
  }
}

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", () => {
  try {
    const data = JSON.parse(raw);
    const sessionId = data?.session_id;

    // No session to key on, or we're inside a subagent: do nothing.
    if (!sessionId || data?.agent_id) process.exit(0);

    const event = data?.hook_event_name;
    let state;
    if (event === "UserPromptSubmit") {
      state = { status: "running", since: Date.now() };
    } else if (event === "Stop") {
      state = { status: "idle", at: Date.now(), stop_reason: data?.stop_reason };
    } else {
      process.exit(0);
    }

    mkdirSync(STATE_DIR, { recursive: true });
    const safeId = String(sessionId).replace(/[^A-Za-z0-9_-]/g, "_");
    writeFileSync(join(STATE_DIR, `${safeId}.json`), JSON.stringify(state));

    if (event === "Stop") prune();
  } catch {
    // A hook failure must never interfere with the session.
  }
  process.exit(0);
});
