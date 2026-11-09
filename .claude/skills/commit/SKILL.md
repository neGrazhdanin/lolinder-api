---
name: commit
description: Stage changes if needed and write a clean Conventional Commits message from the diff. Does not push.
argument-hint: [optional hint about what the change is]
disable-model-invocation: true
---
Create a git commit for the current change.

Optional intent from the user: $ARGUMENTS

Steps:
1. Run `git status` and `git diff` (and `git diff --staged`) to see what changed. If nothing is staged, stage the relevant files with `git add` — stage only files that belong to this logical change, not unrelated edits. If there are clearly several unrelated changes, tell the user and ask whether to split into multiple commits.
2. Write the message in Conventional Commits style: `type(scope): summary` where type ∈ feat|fix|refactor|perf|test|docs|chore|build|ci. Keep the summary ≤ 72 chars, imperative mood. Add a short body only if the *why* isn't obvious from the summary. Infer scope from the touched area; omit if unclear.
   - Always write the commit message in English — subject AND body — regardless of the language of the conversation, the code comments, or the user's instructions.
3. Never invent a change that isn't in the diff. The message must describe what actually changed.
4. Commit with `git commit`. Do NOT `git push` and do NOT add any `Co-Authored-By` trailer unless the user asks.
5. Show the resulting `git log -1 --stat`.
