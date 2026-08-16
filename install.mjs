#!/usr/bin/env node
// Wires the status line into this machine's Claude Code settings.
//
//   node ~/.claude/install.mjs
//
// settings.json is deliberately NOT tracked in git: it carries machine- and
// org-specific configuration (permissions, autoMode environment, unrelated
// hooks) that must not be cloned between machines. Instead this script merges
// in just the keys the status line needs, leaving everything else untouched.
//
// Safe to run repeatedly.

import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CLAUDE_DIR = join(homedir(), ".claude");
const SETTINGS_PATH = join(CLAUDE_DIR, "settings.json");
const BACKUP_PATH = join(CLAUDE_DIR, "settings.json.pre-statusline.bak");

const STATUS_LINE = {
  type: "command",
  command: 'node "$HOME/.claude/statusline.mjs"',
  padding: 0,
  // Keeps the rate-limit reset countdown ticking while the session is idle,
  // e.g. when the main agent is parked waiting on background subagents.
  refreshInterval: 60,
};

const ACTIVITY_HOOK = 'node "$HOME/.claude/session-activity.mjs"';
// Stop fires for the main agent only; SubagentStop is a separate event and is
// intentionally left unwired so subagents don't move the "last finished" time.
const HOOK_EVENTS = ["UserPromptSubmit", "Stop"];

function loadSettings() {
  if (!existsSync(SETTINGS_PATH)) return {};
  const raw = readFileSync(SETTINGS_PATH, "utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error(`Refusing to run: ${SETTINGS_PATH} is not valid JSON.`);
    console.error(`  ${err.message}`);
    console.error("Fix or move it, then re-run.");
    process.exit(1);
  }
}

// Append our hook to an event unless an identical command is already wired.
function ensureHook(settings, event, command) {
  settings.hooks ??= {};
  settings.hooks[event] ??= [];
  const groups = settings.hooks[event];

  const alreadyWired = groups.some((g) =>
    (g?.hooks ?? []).some((h) => h?.command === command)
  );
  if (alreadyWired) return false;

  // Reuse an existing match-all group rather than stacking redundant ones.
  let group = groups.find((g) => g && !g.matcher);
  if (!group) {
    group = { hooks: [] };
    groups.push(group);
  }
  group.hooks ??= [];
  group.hooks.push({ type: "command", command });
  return true;
}

const settings = loadSettings();
const before = JSON.stringify(settings);
const changes = [];

if (JSON.stringify(settings.statusLine) !== JSON.stringify(STATUS_LINE)) {
  changes.push(settings.statusLine ? "updated statusLine" : "added statusLine");
  settings.statusLine = STATUS_LINE;
}

for (const event of HOOK_EVENTS) {
  if (ensureHook(settings, event, ACTIVITY_HOOK)) changes.push(`wired ${event} hook`);
}

if (JSON.stringify(settings) === before) {
  console.log("Already installed — no changes needed.");
  process.exit(0);
}

if (existsSync(SETTINGS_PATH)) {
  copyFileSync(SETTINGS_PATH, BACKUP_PATH);
  console.log(`Backed up existing settings to ${BACKUP_PATH}`);
}

writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
for (const change of changes) console.log(`  ${change}`);
console.log("\nDone. Start a new Claude Code session to see the status line.");
