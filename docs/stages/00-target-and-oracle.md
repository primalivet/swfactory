# Stage 0 — target product and outer oracle

Before any agent touches code, the factory needs two things:

1. something to build (`app/`)
2. a way to know, without reading the diff, that it still works (`tests/blackbox/`)

```
            intent                         oracle
  app/SPEC.md ──────► [ factory ] ──────► tests/blackbox/
  (what it should do)  (stages 1-7)       (does it still do it?)
```

## Why black-box first

Jacob (Syntax #1049): if you are heading toward a factory, the first thing to
build is a black-box suite, so it is safe to refactor and therefore safe to
build the factory. Osmani: a loop only earns autonomy when its check is cheap,
fast and hard to fake.

The black-box tests here:

- spawn the CLI as a user would; no imports from `app/`
- assert on stdout/stderr/exit code from `SPEC.md` only
- each test gets its own `TODO_FILE` in a temp dir (isolated, parallel-safe)

Because they never see internals, an agent cannot make them pass by bending
internals; it has to make the product behave. They are the "lights" that stay
on even in a dark factory.

## Layout chosen for later gates

```
app/src/
  domain/todo.ts       pure rules, no I/O       ◄── stage 4: arch test forbids
  infra/file-store.ts  JSON file persistence         domain → infra/node:fs
  cli.ts               composition + I/O edge
```

The product is deliberately incomplete (no `rm`, no `edit`, `done abc`
prints `no todo with id NaN`). Those become the first queue items.

## Run

```
nix develop        # or: direnv allow
pnpm install
pnpm typecheck
pnpm test:blackbox
pnpm todo add hello
```

## Gates available after stage 0

| Gate            | Cost  | Fakeable by agent?                  |
|-----------------|-------|-------------------------------------|
| `tsc --noEmit`  | ~1s   | hard (needs casts; ban them later)  |
| black-box tests | ~1s   | only by editing tests → protect them|

Open question carried to stage 2: the agent can edit `tests/blackbox/`.
The harness must treat that directory as read-only, or a gate must reject
diffs that touch it.
