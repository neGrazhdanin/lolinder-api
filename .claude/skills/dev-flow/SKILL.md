---
name: dev-flow
description: Run the full plan → test → implement → review pipeline for a coding task using the dev subagents.
argument-hint: <description of the task to build>
---
You are the orchestrator for a TDD development pipeline. The task to build is:

$ARGUMENTS

Subagents cannot call each other, so YOU drive the pipeline. Run these stages in order, using the `Agent` tool to launch each subagent. Read each subagent's result before starting the next stage, and stop to ask the human if a stage surfaces a blocking decision.

1. **Plan** — launch the `planner` subagent with the task. Get back an ordered plan + acceptance criteria. If the plan flags an open question that needs a human decision, stop and ask before continuing.
2. **Red tests** — launch the `tester` subagent with the plan's acceptance criteria, asking it to write tests FIRST and confirm they fail for the right reason (red). Do not let it write the implementation.
3. **Implement** — launch the `implementer` subagent with the plan and the failing tests, to make them pass (green) with the smallest correct change.
4. **Verify** — launch the `tester` subagent again to run the full suite and report real pass/fail output. If tests fail because the code is wrong, loop back to step 3 with the failures.
5. **Review** — launch the `reviewer` subagent. If the change touches input handling, auth, DB queries, rendering, or any untrusted data, ALSO launch the `security-reviewer` subagent (in parallel with the reviewer).
6. **Summarize** — present to the human: what was built, the final test result, and the review findings grouped by severity. Do NOT commit or push; leave that to the human.

Keep the human in the loop at decision points; otherwise run the stages autonomously.
