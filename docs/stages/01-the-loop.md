# Stage 1 — the bare loop

The atom of a factory: one agent, one task, repeat until a check says done.

```
        ┌──────────────────────────────────────────┐
 task ─►│ claude -p ─► edits ─► checks ─► green? ──┼─► stop
        │     ▲                            │ red   │
        │     └──── failure output ◄───────┘       │
        └──────────────────────────────────────────┘
          factory/loop.ts   (max N iterations, log per iteration in runs/)
```

## What it does

- `pnpm loop "<task>" [max]`
- iteration 1 sends the task; later iterations `--resume` the same session
  with the failing check output (context accumulates — on purpose, see below)
- the **loop** runs the checks, not the agent: `typecheck`, `test:blackbox`
- `--permission-mode acceptEdits`: agent can edit files, but Bash calls are
  not pre-approved in `-p` mode, so it cannot run anything
- `--max-budget-usd 1` per call
- writes `runs/<timestamp>/iter-N.json`: prompt, agent result, check, diff stat

## Observed run

Task: `Add a 'todo rm <id>' command that removes an item.` (run in a throwaway
copy of the repo)

```
iter 1: turns=18 cost=$0.297 checks=green
```

Green in one iteration. What it actually did:

| Change                         | Verdict                                         |
|--------------------------------|-------------------------------------------------|
| `domain/todo.ts` `remove()`    | fine, mirrors `complete()`                      |
| `cli.ts` `rm` case             | fine, but copies the `Number(args[0])` NaN bug  |
| `app/SPEC.md` new row          | **agent changed the intent**                    |
| `tests/blackbox/` new tests    | **agent changed the oracle**                    |
| final message                  | "haven't run the typecheck or tests"            |

`todo rm x` → `error: no todo with id NaN`. Checks green.

## Lessons (each one becomes a later stage)

1. **Green ≠ done.** The checks did not cover `rm` before the run. The only
   thing proving `rm` works are tests the agent wrote for itself. The loop's
   stop condition is only as good as an oracle the agent cannot touch.
   → stage 2: harness makes `SPEC.md` and `tests/blackbox/` read-only.
2. **The agent edited the spec.** In a factory, intent comes from outside the
   loop (the queue). An agent that rewrites the spec to match its code is
   grading its own homework. → stage 2/4: diff gate rejects changes to intent
   and oracle paths.
3. **It copied a latent bug.** Agents amplify the patterns already in the
   codebase (Osmani: "agents amplify the properties of the system"). → stage 4:
   architecture/conformance review against written rules.
4. **It could not verify itself**, and said so. Good honesty, but the loop
   should give it a sanctioned way to run checks. → stage 2: tool allowlist.
5. **Free-form path.** 18 turns, chosen by the agent. Nothing says "reproduce,
   plan, implement, verify". → stage 3: graph / state machine.
6. **Context accumulates** across iterations via `--resume`. Fine for 1-3
   iterations; Dex Horthy's rule of thumb is agents hold for 3-10 steps and
   lose the thread past ~20. → stage 3: fresh context per node.
7. **Runs in the working tree.** Two loops at once would collide.
   → stage 2: one git worktree per run.
