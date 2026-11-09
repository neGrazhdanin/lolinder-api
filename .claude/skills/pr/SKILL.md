---
name: pr
description: Push the current branch and open a GitHub PR with an auto-generated summary and test plan.
argument-hint: [optional title or context for the PR]
disable-model-invocation: true
---
Open a GitHub pull request for the current branch.

Optional context from the user: $ARGUMENTS

Steps:
1. Check prerequisites: `gh auth status` (the `gh` CLI must be authenticated) and confirm there's a GitHub remote. If not, tell the user what's missing and stop.
2. Determine the current branch. If it's the default branch (main/master), do NOT open a PR from it — tell the user to create a feature branch first (offer to create one).
3. Review the full set of changes that will be in the PR: `git log <base>..HEAD` and `git diff <base>...HEAD`, where `<base>` is the default branch. This is the whole PR, not just the last commit.
4. Push the branch with `git push -u origin HEAD` if it isn't pushed yet.
5. Create the PR with `gh pr create`. Title: concise, Conventional-Commits-flavored. Body, in this structure:
   - **## Summary** — 1–3 bullets on what changed and why.
   - **## Test plan** — how it was/should be verified (commands run, cases covered).
   - End the body with `Closes #N`, where N is the issue number in the branch name (`<type>/<N>-<slug>`).
   Base the content only on the actual diff; don't invent.
6. Print the PR URL that `gh` returns.
