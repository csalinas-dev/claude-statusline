# Claude Code status line

A one-row status line, pinned below the input box, that survives scrolling in
fullscreen mode:

```
csalinas-dev-site · 5h 24% 1h12m · 7d 41% 2d7h                       12:57:36 AM
```

Left, flush:

- **Repo name** — from the git `origin` remote, falling back to the current
  directory's name outside a repo.
- **Rate limit burn** — 5-hour and 7-day subscription quota used, each followed
  by the time until that window resets. Green under 50%, yellow 50–80%, red at
  80%+. Pro/Max only, and only after the first API response of a session.

Right, flush:

- **When the main agent last finished its turn**, in local time — or
  `Running...` while it's working.

Every segment disappears cleanly when its data isn't available, so the worst
case is just the repo name.

## This repo lives inside `~/.claude`

The repo root *is* `~/.claude`, so the tracked files are the ones Claude Code
actually loads — edits and commits can't drift apart.

That directory also holds `.credentials.json`, `history.jsonl`, `projects/`
(full session transcripts), and `sessions/`. **`.gitignore` therefore ignores
everything by default and re-allows only the five status line files.** Keep it
that way: the allowlist is the only thing standing between a stray
`git add -A` and publishing your transcripts.

`settings.json` is intentionally **not** tracked — it carries machine- and
org-specific configuration that shouldn't be cloned between machines.
`install.mjs` merges in just the keys the status line needs.

## Install on a new machine

`~/.claude` already exists on any machine that has run Claude Code, so fetch
into it rather than cloning over it:

```bash
cd ~/.claude
git init
git remote add origin git@github.com:csalinas-dev/claude-statusline.git
git fetch origin
git checkout -b main origin/main
node install.mjs
```

Then start a new session — the status line doesn't apply to already-running
ones.

`install.mjs` is idempotent. It backs up `settings.json` to
`settings.json.pre-statusline.bak` before its first change, adds the
`statusLine` block, and wires the two hooks without disturbing hooks you
already have.

## How the activity segment works

Nothing in the status line payload reports whether a turn is running, so two
hooks record it:

| Hook | Effect |
| --- | --- |
| `UserPromptSubmit` | marks the session running |
| `Stop` | records the local finish time |

`Stop` fires for the **main agent only** — subagents fire `SubagentStop`, which
is deliberately left unwired, so background agents never move the timestamp.
As a second guard, `session-activity.mjs` ignores any payload carrying an
`agent_id`.

State is one small JSON file per session under `~/.claude/statusline-state/`,
pruned after 7 days. The hooks write nothing to stdout — for
`UserPromptSubmit`, stdout would be injected into Claude's context.

**Known limitation:** the `Stop` hook does not fire when you interrupt with
Esc, so after an interrupt the line keeps reading `Running...` until you submit
your next prompt. It self-corrects at that point.

## Tuning

Constants at the top of `statusline.mjs`:

| Constant | Purpose |
| --- | --- |
| `WARN_AT` / `ALERT_AT` | rate-limit percentages that turn the number yellow / red |
| `RIGHT_MARGIN` | columns held back from the right edge. Claude Code truncates the row with its own `...` if you fill the full width — at a 1-column margin that ate the `AM` suffix. Raise it if the row clips. |

Right-justification reads the `COLUMNS` environment variable, which Claude Code
sets before running the script (requires v2.1.153+; `tput cols` does not work,
since output is captured rather than attached to the terminal). On a terminal
too narrow to fit both halves, it falls back to a two-space separator.

## Files

| File | Role |
| --- | --- |
| `statusline.mjs` | renders the row |
| `session-activity.mjs` | hook target; records main-agent start/finish |
| `install.mjs` | merges the required keys into `settings.json` |
| `.gitignore` | deny-all allowlist — see the warning above |
