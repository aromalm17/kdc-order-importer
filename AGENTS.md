# KDC Order Importer instructions

Read `docs/CODEX_HANDOFF.md` before making changes. It is the durable context
from the previous full Codex conversation and records current product rules,
important files, deployment context, and unfinished user-owned work.

Always inspect `git status` before editing and preserve existing changes. For
behavior changes, run the relevant focused tests followed by `npm test`,
`npm run typecheck`, and `npm run build`.

Keep changes scoped to this app unless the user explicitly expands the task.
Update `docs/CODEX_HANDOFF.md` whenever a change makes its product rules or
unfinished-work notes stale.
