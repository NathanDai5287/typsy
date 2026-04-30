> If you are an AI agent, read `.devin/knowledge.md` and `.devin/PARALLEL_PROTOCOL.md` before doing anything. Follow the worktree protocol even if you are not a Devin instance — the rules apply to all agents (Claude Code included).

## Agent protocol

1. **Always work in a git worktree.** Run `bash scripts/devin-spawn.sh <slug>` yourself to create one, then do all work from that path. Never edit files in the main checkout.
2. **Run all commands yourself.** Do not ask the user to run shell commands — use the Bash tool to run them directly.
3. Follow the startup sequence in `.devin/PARALLEL_PROTOCOL.md` (check locks, claim scope, confirm branch) before touching any files.
4. **PRs auto-merge.** Once CI is green, GitHub merges the PR and deletes the branch automatically. Do not run `gh pr merge` yourself.
