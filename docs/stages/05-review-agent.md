# Stage 5 — review agent, measured on old PRs (step D2)

Goal of D2: a second agent finds what the human reviewer would otherwise have
to find. Before it runs on new PRs, it runs on merged PRs where we know the
answer.

```
 node factory/review.ts <pr> <model> <run-dir> [task-file]
   task: factory/build-task.ts for the issue the PR closes (same text the build agent got)
   git worktree at the PR head, factory/bench/ deleted
   pi, tools read/grep/find/ls ─► JSON {verdict, findings[{severity, file, problem, example}]}
   verdict "fail" ⇔ any finding is "high"
```

## Test set

| PR  | Change            | Known                                                  | Want |
|-----|-------------------|--------------------------------------------------------|------|
| #18 | `todo edit`       | "failed edit leaves the file unchanged" runs on an empty list (fixed later by #21) | fail |
| #27 | test fix for #18  | nothing                                                | pass |
| #9  | `todo rm`         | nothing                                                | pass |

#16's plan comment was edited after approval (the test of that rule), so
`build-task.ts` refuses it. The #18 run used a task file rebuilt from the
original comment (GitHub keeps edit history); the only edit was one period.

## Results (`z-ai/glm-5.3-flash`, pi 1.4.0, 3 runs per PR)

| PR  | Verdicts           | Turns | $ per run      |
|-----|--------------------|-------|----------------|
| #18 | fail, fail, fail   | 1–3   | 0.0004–0.0012  |
| #27 | pass, pass, pass   | 2     | 0.0002         |
| #9  | pass, fail, pass   | 1–3   | 0.0001–0.0016  |

#18 findings, all real; each run found at least one:

- "failed edit leaves the file unchanged" on an empty list (the known one);
- "edit without text" error test on an empty list: a CLI that saves the empty
  text before it validates passes the whole suite;
- "edit targets the item by id, others untouched" runs `rm 1` first, so only
  one item is left and no other item is checked.

The second and third were not known. #21 fixed the first two by accident: its
tests run on a list with one item.

#9 run 2 finding: "a `remove` that does nothing on a one-item list passes the
whole suite". True, and the plan asked for tests that fail if `rm` does
nothing, but no one would write that bug. Count it as noise.

## What changed while measuring

| Problem | Fix in the prompt or parser |
|---|---|
| Run 1: #18's known defect found, rated "low", verdict pass | "high" now includes "a test that cannot catch the bug it was written for" and "a criterion with no test" |
| #9: "test X passes with a no-op `rm`", but test Y catches it | the wrong implementation must pass every test in `tests/blackbox/`; check the others before reporting |
| 2 of 9 replies had text around the JSON | parse from the first `{` to the last `}` |

## Limits

- 3 PRs, 9 runs: enough to see it work, not a hit rate.
- Read-only tools: it cannot run a wrong implementation against the suite. A
  claim like "passes every test" is the model's reading, not a result.
  Next step: the reviewer writes the wrong implementation as a patch, the
  factory applies it and runs the suite; only a patch that stays green
  is a confirmed finding.
- Not wired into CI yet; see the open questions in the PR.
