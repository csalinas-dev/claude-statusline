#!/usr/bin/env node
// Claude Code status line, one row:
//
//   <repo>  5h 24% 1h12m  7d 41% 2d7h              3:42:07 PM
//   |___________ left, flush _________|            |__ right __|
//
// Left  : repo name (or directory name) + subscription rate-limit burn.
// Right : when the MAIN agent last finished its turn, or "Running...".
//
// The right segment is fed by ~/.claude/session-activity.mjs, wired to the
// UserPromptSubmit and Stop hooks. Subagents are excluded by design.
//
// Rate limit fields are Pro/Max only and appear after the first API response,
// so every segment degrades gracefully when absent.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";

// Usage thresholds for the percentage color.
const WARN_AT = 50;
const ALERT_AT = 80;

const STATE_DIR = join(homedir(), ".claude", "statusline-state");

// Columns held back from the right edge. Claude Code truncates the row with
// its own "..." if we fill the full width, which ate the "AM" suffix at a
// 1-column margin. This also leaves a little room for the notification badges
// that render on the right of the status line row.
const RIGHT_MARGIN = 4;

// Printable width, ignoring ANSI escapes.
const visibleWidth = (s) => s.replace(/\x1b\[[0-9;]*m/g, "").length;

// The repo name when there's a git origin remote, otherwise the name of the
// directory we're sitting in.
function projectLabel(data, cwd) {
  const repo = data?.workspace?.repo?.name;
  if (repo) return repo;
  const segments = cwd.split(/[\\/]+/).filter(Boolean);
  return segments.length ? segments[segments.length - 1] : cwd;
}

function colorFor(pct) {
  if (pct >= ALERT_AT) return RED;
  if (pct >= WARN_AT) return YELLOW;
  return GREEN;
}

// resets_at is a unix timestamp in seconds.
function countdown(resetsAt) {
  if (typeof resetsAt !== "number") return null;
  const seconds = resetsAt - Math.floor(Date.now() / 1000);
  if (seconds <= 0) return null;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours >= 24) return `${Math.floor(hours / 24)}d${hours % 24}h`;
  return hours > 0 ? `${hours}h${minutes}m` : `${minutes}m`;
}

function limitSegment(label, window) {
  const pct = window?.used_percentage;
  if (typeof pct !== "number") return null;
  const rounded = Math.round(pct);
  const left = countdown(window.resets_at);
  const tail = left ? `${DIM} ${left}${RESET}` : "";
  return `${DIM}${label}${RESET} ${colorFor(rounded)}${rounded}%${RESET}${tail}`;
}

// "Running..." while the main agent works, otherwise the local clock time it
// last finished. Absent until the first turn of the session completes.
function activitySegment(sessionId) {
  if (!sessionId) return null;
  const safeId = String(sessionId).replace(/[^A-Za-z0-9_-]/g, "_");
  let state;
  try {
    state = JSON.parse(readFileSync(join(STATE_DIR, `${safeId}.json`), "utf8"));
  } catch {
    return null; // no turn recorded yet
  }

  if (state?.status === "running") return `${DIM}Running...${RESET}`;
  if (state?.status === "idle" && typeof state.at === "number") {
    // hour12 is forced so the AM/PM suffix is always present, rather than
    // depending on how the system locale resolves.
    const time = new Date(state.at).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
    return `${DIM}${time}${RESET}`;
  }
  return null;
}

// Pad between left and right so the right segment lands flush against the
// terminal edge. Falls back to a plain separator on a too-narrow terminal.
function justify(left, right) {
  if (!right) return left;
  const columns = Number.parseInt(process.env.COLUMNS ?? "", 10);
  if (Number.isFinite(columns)) {
    const gap = columns - RIGHT_MARGIN - visibleWidth(left) - visibleWidth(right);
    if (gap >= 1) return left + " ".repeat(gap) + right;
  }
  return `${left}${DIM}  ${RESET}${right}`;
}

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", () => {
  let data = {};
  try {
    data = JSON.parse(raw);
  } catch {
    // fall through to cwd
  }

  const cwd = data?.workspace?.current_dir || data?.cwd || process.cwd();
  const parts = [`${DIM}${projectLabel(data, cwd)}${RESET}`];

  const limits = data?.rate_limits;
  const fiveHour = limitSegment("5h", limits?.five_hour);
  const sevenDay = limitSegment("7d", limits?.seven_day);
  if (fiveHour) parts.push(fiveHour);
  if (sevenDay) parts.push(sevenDay);

  const left = parts.join(`${DIM} · ${RESET}`);
  process.stdout.write(justify(left, activitySegment(data?.session_id)));
});
