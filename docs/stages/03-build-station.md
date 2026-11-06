# Stage 3 — first run of the build station

Step B in practice: a human writes the issue and plan, the agent builds in
Actions, the human reviews. One issue, end to end.

```
 08:35  human: issue #8 (template sections), factory:new → factory:triaged
        human: **Plan** comment (4 files, id-reuse test must fail if rm does nothing)
 08:41  human: factory:triaged → factory:planned
        build.yml ─► factory:building ─► task from issue + plan ─► preflight green
        loop.ts: glm-5.3-flash, 1 iteration, 7 turns, checks green   (42 s)
        App token ─► push issue-8 ─► PR #9 by swfactory-build[bot] ─► factory:review
 08:42  ci.yml on the bot PR: checks green, protected-paths red (no intent-change)
 08:47  human: + intent-change ─► protected-paths green
        human: approve (allowed: bot is the author) ─► merge ─► release green
        hidden test (factory/bench/rm, 8 cases) on main: 8/8
 09:11  human: remove factory:review from the closed issue by hand
```

## Run numbers

| Metric           | Value                                 |
|------------------|---------------------------------------|
| model            | `z-ai/glm-5.3-flash`, pi 1.4.0        |
| iterations/turns | 1 / 7                                 |
| tokens           | 7,208 in, 26,957 cache read, 2,643 out |
| cost             | $0.0032 (bench: $0.0007)              |
| build job        | 1 m 28 s (agent 42 s)                 |
| files changed    | the 4 the plan named, nothing else    |
| hidden test      | 8/8                                   |

Cost is about 4.6× the bench run for the same task. The task text differs (issue +
plan instead of `task.md`). n = 1; do not read more into it.

## What worked

- **Bot PRs trigger workflows.** `ci.yml` ran on PR #9. Opened with the
  Actions `GITHUB_TOKEN`, it would not have (the reason for the GitHub App).
- **Protected paths caught the bot.** The plan changes `app/SPEC.md` and
  `tests/blackbox/`; the gate stayed red until a human added `intent-change`.
- **Review by the owner works on bot PRs.** Approval counted, because the
  author is `swfactory-build[bot]`.
- **The plan was followed.** Same production code as the bench runs.
  `remove()` mirrors `complete()`, `rm` reuses `parseId`. The id-reuse test
  is the strong version the plan asked for:

  ```
  add a ─► rm 1 ─► add b ─► "added 2"     fails if rm does nothing
  ```

  The deepseek bench run wrote the weak version (`rm 2` after two adds).
  Naming the failure mode in the plan was enough here.

## What went wrong

| Finding | Effect | Answer |
|---------|--------|--------|
| First `factory:planned` (issue #5) came 36 s before `build.yml` merged | no run; `issues` events run workflows from `main` | a workflow is live only after merge (backlog 8) |
| `factory/bench/` was in the agent's checkout | agent could read the hidden test and `task.md`. Log: it did not | `build.yml` deletes it before the loop, restores it before the commit (PR #10) |
| first plan comment named the hidden test's path | pointed the agent at the oracle | removed before the build started. Plans must not name the oracle |
| agent had no way to run checks | tried an empty `edit` on `package.json`, then "verified by review" | none yet. Same as stage 1 lesson 4 |
| issue #8 closed with `factory:review` | queue shows a finished item as in review | removed by hand; backlog 2 still open |
| owner PRs (#7, #10) cannot be approved | required review blocks them | merge with `gh pr merge --admin` (`enforce_admins: false`) |

## Checking the run

The `runs-issue-N` artifact holds pi's JSON events. List the files the agent
touched:

```
gh run download <run-id> -n runs-issue-N -D <dir>
grep -ho '"name":"\(read\|edit\|write\)","arguments":{[^}]*"path":"[^"]*"' <dir>/*/iter-*.jsonl | sort | uniq -c
```

Run 42189451976: reads and edits only in `app/`, `tests/blackbox/`,
`package.json` (empty edit). No `factory/bench/`.

## Lessons

1. **The hidden test is only hidden if the harness hides it.** The bench
   did this; the build station did not. Every place that runs an agent needs
   the same isolation. Duplicated isolation logic drifts.
2. **The plan is part of the agent's input.** It reaches the agent verbatim,
   so it must not name the oracle. The planner (a human now, an agent at
   step C) needs this rule.
3. **A precise plan beats a model choice.** The plan named the weak-test
   trap; the agent avoided it.
4. **Owner PRs and bot PRs follow different review paths.** Bot PR: owner
   approves. Owner PR: admin bypass, so no second pair of eyes. Factory
   changes (the trust root) are the owner PRs.
