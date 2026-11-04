# Stage 2 — benchmark the build station

Question: which OpenRouter model should the build station use? Answer it with
evidence from our own task, not with price lists.

```
 factory/bench.ts  (per model)
   git worktree from HEAD ─► delete factory/bench/ (agent never sees the hidden test)
   ─► pnpm install ─► PREFLIGHT: checks must be green before the agent runs
   ─► runLoop (factory/loop.ts): pi -p ─► typecheck + black-box ─► feed back (max 3)
   ─► copy hidden test in ─► score
 → runs/bench-<time>/summary.md, per model: diff.patch, iter-N.jsonl, row.json
```

Run: `pnpm bench factory/bench/rm <model> [model...]`

## The task

`factory/bench/rm/task.md`: add `todo rm <id>`, written as an approved plan
(behavior, errors, files to change).

`factory/bench/rm/acceptance.test.ts`: 8 hidden black-box cases. Validated
before use:

| Code under test          | Hidden score | Meaning                         |
|--------------------------|--------------|---------------------------------|
| `main` (no `rm`)         | 0/8          | every test fails without the feature |
| hand-written correct `rm`| 8/8          | every test can pass             |

The first version scored **1/8 on `main`**: "ids not reused" only checked
that the next id was 3, which is true even if `rm` does nothing. A test that
passes before the feature exists proves nothing (red/green).

## Run 1: broken harness (discarded)

`pnpm install --offline` failed in every worktree (a package was missing from
the local pnpm store) and `bench.ts` did not check the exit code. Every model
started with:

```
error TS2688: Cannot find type definition file for 'node'.
```

What the models did with a broken environment:

| Model               | Result | What it changed outside the plan |
|---------------------|--------|----------------------------------|
| glm-5.3-flash       | "green" | `tsconfig.json`, wrote `types/node.d.ts` |
| deepseek-v4.1-flash | red    | `pnpm-lock.yaml`, `tsconfig.json`, fake `@types/node` |
| gpt-oss-120b        | red    | invalid `node.d.ts`, 0/8 hidden  |

Lessons:
- A broken harness looks like bad agents.
- Agents make a red check green by bending the config if that is the
  shortest path. glm's "green" was a fake.
- The "outside plan" column (files changed that the plan did not list)
  exposed it.

Fix in `factory/bench.ts`: install with `--prefer-offline` and stop on
failure; **preflight** runs the checks on the untouched worktree and stops if
they are red. No agent ever starts in a broken environment.

## Run 2: results (2026-11-04, one run per model)

| Model                          | Checks | Hidden | Outside plan | Iter | Turns | Tokens in | Tokens out | $      | Seconds |
|--------------------------------|--------|--------|--------------|------|-------|-----------|------------|--------|---------|
| `z-ai/glm-5.3-flash`           | green  | 8/8    | -            | 1    | 5     | 18,189    | 1,769      | 0.0007 | 13      |
| `deepseek/deepseek-v4.1-flash` | green  | 8/8    | -            | 1    | 8     | 44,115    | 2,562      | 0.0011 | 17      |
| `openai/gpt-oss-120b`          | green  | 8/8    | -            | 2    | 20    | 94,564    | 3,700      | 0.0026 | 67      |

The estimate before the run was $0.01–0.05 per run. Real: $0.0007–0.0026.
The prompt-to-plan was precise, so the models needed few turns.

## Reading the diffs (checks do not see this)

Production code (`app/src/domain/todo.ts`, `app/src/cli.ts`): almost
identical in all three. `remove()` copies the style of `complete()`; `rm`
reuses `parseId`. A precise plan makes models converge (Osmani: the spec is
the leverage). All three updated `app/SPEC.md` table and errors.

The tests they wrote differ:

| Model    | Own tests                                         | Problem                                  |
|----------|---------------------------------------------------|------------------------------------------|
| glm      | `add a, rm 1, add b → added 2`; 5 error cases     | none found                               |
| deepseek | `add a, add b, rm 2, add c → added 3`; 7 error cases | reuse test passes even if `rm` does nothing (same mistake as our first hidden test) |
| gpt-oss  | 3 error cases                                     | left stray comments (`// existing done tests`) inside the error table; no `0`, `-1`, `1.5` cases |

Lesson: agent-written tests are weaker than the hidden test. Keep an oracle
the agent did not write.

## Decision

`z-ai/glm-5.3-flash` for the build station while exploring: cheapest,
fastest, 1 iteration, best own tests.

Limits of this evidence:
- n = 1 per model, one task. Results vary between runs.
- The task was small and the plan detailed. Harder or vaguer tasks may
  rank the models differently.
- Re-run the bench when the model, prompt, tools or pi version change. That
  is how the factory itself is maintained (step E).
