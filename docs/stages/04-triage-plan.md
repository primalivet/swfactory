# Stage 4 — triage + plan station (step C)

Step C in practice: the agent triages and plans, a human approves the plan,
the build station builds. Two issues: one clear, one vague.

```
 #16 todo edit (clear)
 12:10  human: factory:new
 12:11  bot: **Plan** comment, new → triaged                   (64 s)
 12:17  human: factory:planned
 12:18  build: PR #18 by swfactory-build[bot], 1 iteration, checks green
 12:19  protected-paths red → human: intent-change → green → approve → merge
 12:27  closed → done.yml: factory:done

 #17 "make todo list easier to read" (vague)
 12:28  human: factory:new
 12:28  bot: **Question** comment, new → blocked              (38 s)
 12:33  human: closed → done.yml: factory:done
```

## Run numbers (`z-ai/glm-5.3-flash`, pi 1.4.0)

| Run          | Turns | Tokens in | Cache read | Tokens out | $      |
|--------------|-------|-----------|------------|------------|--------|
| #16 triage   | 3     | 5,014     | 1,728      | 308        | 0.0010 |
| #16 plan     | 7     | 15,816    | 5,376      | 1,538      | 0.0033 |
| #16 build    | 11    | –         | –          | –          | 0.0070 |
| #17 triage   | 2     | 3,318     | 320        | 200        | 0.0006 |

One feature from issue to merged PR: about $0.011 of model cost.

## What worked

- **Triage was right both times.** #17's question was concrete: `app/SPEC.md`
  fixes the `list` line format, so "easier to read" contradicts it until
  someone says what the lines should be.
- **Separate identity.** Comments and label moves show as
  `swfactory-triage-plan[bot]`; the build as `swfactory-build[bot]`.
- **No oracle access.** Agents read only `app/`, `tests/blackbox/`,
  `.github/CODEOWNERS`. `factory/bench/` was deleted before both stations.
- **The plan went beyond the issue.** It named traps and added tests for
  them: edit by id after `rm`, done state kept. The build followed it in
  exactly the 4 files it named.
- **All 6 acceptance criteria hold on `main`** (run by hand; there is no
  hidden test for `edit`).
- **A plan edited after approval is refused.** Tested on #16 after close:

  ```
  approval (factory:planned)     12:17:29Z
  plan comment updated_at        12:11:18Z  ≤ approval → build-task accepts
  owner edits one character      later      > approval → build-task fails:
    "no **Plan** comment edited before approval at 2026-11-06T12:17:29Z"
  ```

## Findings

| Finding | Effect | Issue |
|---------|--------|-------|
| `build.yml` removes only `factory:planned` | #16 had `triaged` + `building`/`review` at once | #19 |
| #17 closed with the default reason | `factory:done` on an issue nothing was built for | #20 |
| plan-agent test "failed edit leaves file unchanged" runs on an empty list | it can never fail | #21 |
| every label the bot sets starts `triage-plan` and `build`, both skipped | noise in the Actions list | #22 |
| the plan contains the full code | the plan agent does most of the build; the human reviews the code twice | open |
| #19, #20, #22 change workflows or docs | the factory cannot build them: triage blocks non-product work, the build bot cannot push workflows | backlog 10 |

## Lessons

1. **The approval binds to text, not to a label.** A label says "approved"
   but not *what*. Comparing `updated_at` with the label time makes the
   approval refer to the plan the human read.
2. **Agent tests still need an outside check.** Same as stage 2: the plan
   agent named the "saves before validating" trap, and the test for it
   cannot fail. Without a hidden test, only reading the diff caught it.
3. **The factory builds the product, not itself.** Most findings from
   running the factory are factory changes, and they have no route through
   it yet. That route is step E.
4. **How detailed a plan should be depends on change size.** For a small
   feature, a plan with code is cheap to review. Revisit when changes grow.
