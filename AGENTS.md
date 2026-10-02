<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Production server & deployment (local-only pointer)

Production deployment and server-access details (SSH host/port/key, server
layout, deploy and rollback procedure) live in **`DEPLOY.local.md`** at the
repository root. That file is a **local-only secret**: it is gitignored
(`*.local.md`) and blocked by a local pre-commit hook. Never commit, push,
copy into tracked files, or print its contents. Read it when a deployment or
server task is requested; general (safe) procedure is also documented in
`docs/OPERATIONS.md` and `docs/MOBILE-DEPLOY.md`, which are committed.
