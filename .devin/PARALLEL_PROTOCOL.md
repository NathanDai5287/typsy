# Parallel Devin Protocol

You are one of several Devin instances working on this repo simultaneously, each in its own git worktree under `../worktrees/<slug>/`. Follow this protocol exactly. It exists to prevent two instances from clobbering each other's work.

## Startup sequence (do these IN ORDER, before anything else)
1. Read `.devin/knowledge.md` for project context. Do not re-explore the repo to learn its structure — the knowledge file is the source of truth. If something looks wrong or stale, flag it; don't silently work around it.
2. Run `scripts/devin-locks.sh list` to see what other instances are currently working on.
3. Compare the user's requested task against active claims. If your task plausibly touches the SAME files or directories as an active claim, STOP. Do not start work. Tell the user: "Task `<active-slug>` is currently working on `<paths>`, which overlaps with what you're asking me to do. Options: (a) wait for it to finish, (b) narrow my scope to non-overlapping files, (c) cancel the other task." Wait for the user's decision.
4. If clear, claim your scope BEFORE editing anything: `scripts/devin-locks.sh claim <slug> "<one-line description>" "<comma-separated paths/globs you expect to touch>"`. If claim fails due to a race with another instance starting at the same moment, re-read step 3.
5. Confirm you are on a `devin/<slug>` branch. If not, stop and ask.

## During the task
- Stay inside your claimed scope. If you discover you need to edit a file outside your claim, run `scripts/devin-locks.sh list` again — if no one else has it, run `claim` again to extend your scope; if someone does, STOP and report.
- You are one of several Devin instances working on this repo in parallel. Other instances are running RIGHT NOW in sibling git worktrees under `../worktrees/`. Assume their work exists even if you can't see it.
- Never work directly on `main`. Never check out or modify `main`.
- Never run `git push --force`, `git rebase main`, or anything that rewrites shared history. Use `git merge origin/main` to pull updates in.
- High-traffic shared files (package.json, lockfiles, shared types files, top-level config, migrations, README) are extra-dangerous — even if your claim covers them, pause and confirm with the human before editing.
- Touch the minimum number of files needed. Do NOT do drive-by refactors, formatting passes, or import reorganizations outside your task.
- After completing each change, post a one-sentence reminder of what just changed (e.g. "Added is_active flag to user_layout_progress and wired the toggle into LayoutsPage") and then ask the user: "Want me to commit and push this?" Do not run `git commit` or `git push` until the user says yes. When approved, prefix every commit message with `[<slug>]` and push to `origin/devin/<slug>`.
- If tests fail on `main` (not caused by you), STOP and report — do not "fix" unrelated breakage.

## Shutdown sequence (do these IN ORDER when the task is complete)
1. Run the verification sequence from `.devin/knowledge.md`.
2. If you learned something future instances should know (new gotcha, missing convention, wrong path), append a note to `.devin/knowledge.md` as part of your PR.
3. Push the branch and open a DRAFT PR against `main` titled `[<slug>] <one-line summary>`. Do NOT mark ready for review and do NOT merge — the human integrator handles all merges serially.
4. Run `scripts/devin-locks.sh release <slug>` to free your claim. This is REQUIRED — do not skip it even if the task failed or was cancelled. If you are abandoning the task without a PR, still release the lock.

## If you crash or get interrupted
The user can run `scripts/devin-locks.sh force-unlock <slug>` to clean up. Locks auto-expire after 8 hours, but don't rely on that.
