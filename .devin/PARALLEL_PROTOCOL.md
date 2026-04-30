# Parallel Devin Protocol

You are one of several Devin instances working on this repo simultaneously, each in its own git worktree under `../worktrees/<slug>/`. Follow this protocol exactly. It exists to prevent two instances from clobbering each other's work.

## Startup sequence (do these IN ORDER, before anything else)
1. Read `.devin/knowledge.md` for project context. Do not re-explore the repo to learn its structure — the knowledge file is the source of truth. If something looks wrong or stale, flag it; don't silently work around it.
2. **Verify your working directory.** Run `pwd`. It MUST be a path under `../worktrees/<slug>/` matching your slug. Working in the main checkout (the directory containing `.git/` as a real directory rather than as a `gitdir:` pointer) is FORBIDDEN, even when no other instance is running — `git switch` there will clobber any sibling worktree's checkout. If you are in the main checkout, STOP. Ask the human to run `scripts/devin-spawn.sh <slug>` and start a fresh Devin session in the printed worktree path. Do not try to "fix" it from here.
3. Run `scripts/devin-locks.sh list` to see what other instances are currently working on.
4. Compare the user's requested task against active claims. If your task plausibly touches the SAME files or directories as an active claim, STOP. Do not start work. Tell the user: "Task `<active-slug>` is currently working on `<paths>`, which overlaps with what you're asking me to do. Options: (a) wait for it to finish, (b) narrow my scope to non-overlapping files, (c) cancel the other task." Wait for the user's decision.
5. If clear, claim your scope BEFORE editing anything: `scripts/devin-locks.sh claim <slug> "<one-line description>" "<comma-separated paths/globs you expect to touch>"`. The lock script will refuse the claim if another slug is already claimed from this same working directory — that's a hard signal you skipped step 2. Do NOT bypass it.
6. Confirm you are on a `devin/<slug>` branch. If not, stop and ask.

## During the task
- Stay inside your claimed scope. If you discover you need to edit a file outside your claim, run `scripts/devin-locks.sh list` again — if no one else has it, run `claim` again to extend your scope; if someone does, STOP and report.
- You are one of several Devin instances working on this repo in parallel. Other instances are running RIGHT NOW in sibling git worktrees under `../worktrees/`. Assume their work exists even if you can't see it.
- Never work directly on `main`. Never check out or modify `main`.
- Never run `git push --force`, `git rebase main`, or anything that rewrites shared history. Use `git merge origin/main` to pull updates in.
- High-traffic shared files (package.json, lockfiles, shared types files, top-level config, migrations, README) are extra-dangerous — even if your claim covers them, pause and confirm with the human before editing.
- Touch the minimum number of files needed. Do NOT do drive-by refactors, formatting passes, or import reorganizations outside your task.
- After completing each change, post a one-sentence reminder of what just changed (e.g. "Added is_active flag to user_layout_progress and wired the toggle into LayoutsPage") and then ask the user: "Want me to commit and push this?" Do not run `git commit` or `git push` until the user says yes. When approved, do all three of the following back-to-back: (1) commit with `[<slug>]` prefix, (2) push to `origin/devin/<slug>`, (3) `scripts/devin-locks.sh release <slug>` to free your claim — **run release from the same cwd you ran claim from (your worktree)**, otherwise it writes to a different lock file than the one your claim is in and silently no-ops with `(no claim for '<slug>')`. The lock represents "work in flight in this worktree" — once your changes are on the remote, the lock is no longer needed. `release` is idempotent, so subsequent CI-fix pushes don't need to re-claim.
- If tests fail on `main` (not caused by you), STOP and report — do not "fix" unrelated breakage.
- `.github/workflows/ci.yml` runs automatically on every PR push (`pnpm install --frozen-lockfile + pnpm build + pnpm test`) and an `enqueue` job calls `gh pr merge --auto --merge --delete-branch` so the PR auto-merges as soon as CI is green (or auto-enqueues if a merge queue is configured, which then re-runs CI on `main + previously-queued PRs + this PR`). **Do not run `gh pr merge` yourself** — it's automatic.

## Shutdown sequence (do these IN ORDER when the task is complete)
1. Run the verification sequence from `.devin/knowledge.md`.
2. If you learned something future instances should know (new gotcha, missing convention, wrong path), append a note to `.devin/knowledge.md` as part of your PR.
3. **Before opening the PR, print a plain-English summary of every file changed and what changed in it. Wait for the user to reply "yes" (or equivalent approval) before proceeding.** Do not open the PR until you have explicit confirmation.
4. Push the branch and open a regular PR (NOT draft) against `main` titled `[<slug>] <one-line summary>`. From here everything is automatic:
   - **CI** runs build + test on the head commit.
   - The `enqueue` job in CI calls `gh pr merge --auto --merge --delete-branch`, so GitHub merges the PR (or runs it through the merge queue if configured) as soon as required checks pass and the branch is deleted.
   - If a merge queue is configured, it re-runs CI on `main + previously-queued PRs + this PR` and merges only if the combined state is green.
   - If CI is red on the PR head, fix and push again.
   - If the merge queue's combined-state CI fails (semantic conflict with a sibling PR), GitHub kicks the PR out and notifies. Rebase against `main`, push, and the cycle restarts.
   - Do NOT run `gh pr merge` or mark anything yourself. The human gate was your "yes" at commit/push time.
5. Your lock should already be released (it gets released in the commit/push step above). Run `scripts/devin-locks.sh list` to confirm — if your slug is still listed (e.g. you abandoned the task without ever pushing), run `scripts/devin-locks.sh release <slug>`. Release is idempotent.

## If you crash or get interrupted
The user can run `scripts/devin-locks.sh force-unlock <slug>` to clean up a single stale claim. Locks auto-expire after 8 hours, but don't rely on that. If the lock file is in a bad state across the board (e.g. several crashed sessions, weird artifacts) and the user has confirmed no Devin instances are running, they can run `scripts/devin-locks.sh reset` to wipe every claim at once. Never run `reset` while another instance is mid-task.
