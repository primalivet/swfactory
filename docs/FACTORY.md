# The factory

What this repo is: a small, light software factory that builds `app/` (the
`todo` CLI) from GitHub issues. Built as a walking skeleton: the whole
pipeline exists first with humans in every station, then stations are
automated one by one.

```
 human / agent / monitor
        │  issue (template: problem, behavior, acceptance criteria)
        ▼
 QUEUE    GitHub Issues; state = factory:* label
        ▼
 TRIAGE   stations.yml (approver adds new): agent → triaged | blocked (question)
        ▼
 PLAN     same run: agent plan as issue comment ──► [HUMAN approves] → planned
        ▼
 BUILD    branch + change + PR "Closes #N" → review
        ▼
 GATES    ci.yml required checks: checks (typecheck, architecture, black-box),
          protected-paths (trust roots need `intent-change`)
        ▼
 REVIEW   [HUMAN merges]  (branch protection: PR + green checks)
          merge closes issue ──► done.yml: strip factory:*; completed → factory:done
        ▼
 DEPLOY   release.yml: green main → GitHub Release todo.tar.gz
        ▼
 MONITOR  monitor.yml (daily): black-box suite vs latest release
          failure → issue factory:new + source:monitor ──► QUEUE
```

## Where things live

| Factory part   | File                                   |
|----------------|----------------------------------------|
| intent         | `app/SPEC.md`, issue template          |
| queue + states | `factory/github.ts` (labels), `factory/lifecycle.ts` (moves, GitHub writes) |
| GitHub setup   | `factory/github.ts`                    |
| oracle         | `tests/blackbox/`                      |
| gates          | `.github/workflows/ci.yml`, `.github/workflows/gates.yml`, `factory/gates/` |
| review gate    | branch protection (`factory/github.ts`) |
| deploy         | `.github/workflows/release.yml`        |
| terminal state | `.github/workflows/done.yml` → `factory/lifecycle.ts close` |
| monitor        | `.github/workflows/monitor.yml`        |
| triage + plan station | `.github/workflows/stations.yml` (job `triage-plan`), `factory/triage-plan.ts` |
| build station  | `.github/workflows/stations.yml` (job `build`), `factory/build-task.ts`, `factory/loop.ts` |
| code owners    | `.github/CODEOWNERS`                   |

## Who does each station

| Station | A: skeleton | B   | C   | D   | E   |
|---------|-------------|-----|-----|-----|-----|
| triage  | human       | human | agent | agent | agent |
| plan    | human       | human | agent + human approve | same | same |
| build   | human       | agent (pi + OpenRouter in Actions) | agent | agent | agent |
| gates   | CI          | CI  | CI  | + arch rules, adversarial review | same |
| review  | human       | human | human | human / auto-merge low risk | same |
| deploy  | auto        | auto | auto | auto | auto |
| monitor | auto        | auto | auto | auto | + factory evals |

Step E is also *maintaining* the factory: every escaped defect is answered by
changing a gate, prompt, or rule, not just the code.

## GitHub setup

Desired GitHub state is declared at the top of `factory/github.ts`.

```
 factory/github.ts   LABELS, PROTECTION, SECRETS, BOTS
        │
        ├── setup  ──► create/update labels, branch protection (idempotent)
        └── assert ──► compare GitHub with the declared state; exit 1 on drift,
                       print a fix per problem
```

| Part                      | setup creates it? | assert checks it?           |
|---------------------------|-------------------|-----------------------------|
| labels                    | yes               | yes; also unknown `factory:*` |
| branch protection on main | yes               | yes                         |
| secrets                   | no (values)       | names only                  |
| GitHub App exists         | no                | yes (bot user)              |
| App permissions, install  | no                | no: user tokens cannot read them; checked by hand |
| CODEOWNERS syntax         | no (file in repo) | yes (GitHub's error API)    |

Run `node factory/github.ts assert` after `setup` and after any change in repo
or App settings.

## Trust roots

A trust root is a file that decides how agent work is judged, or what runs
with which rights. If an agent can change it, it can change the rules for
its own work. Example: a PR sets `"test:blackbox": "echo ok"` in
`package.json`; the loop and CI go green with zero tests.

| Group                | Paths                                                  |
|----------------------|--------------------------------------------------------|
| what is checked      | `app/SPEC.md`, `tests/blackbox/`                       |
| who checks           | `.github/`, `factory/` (incl. `factory/bench/`)        |
| what the checks run  | `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `flake.nix`, `flake.lock` |
| what runs on a dev machine | `.envrc` (direnv)                                |

One list: `.github/CODEOWNERS`. Two enforcers read it:

```
 .github/CODEOWNERS ──► GitHub: code owner must approve
        │
        └─(main)─► factory/gates/protected-paths.ts: PR needs intent-change, added by an approver
```

The gate (`.github/workflows/gates.yml`) runs on `pull_request_target`: the
workflow, the script and the list all come from `main`, and PR code is never
checked out. The PR's files (incl. the old name of a renamed file) come from
the API. A PR cannot change its own gate or shrink the list for itself.
`intent-change` counts only if the last change to the label was "labeled" by
an approver (`APPROVERS` in `gates.yml`), so bot tokens cannot add it. The
result is the commit status `protected-paths` on the PR head; a check run from
`pull_request_target` attaches to `main` and would not count.

Left open: a PR can add a workflow that posts a passing `protected-paths`
status. Code-owner review of `.github/` is the guard against that. Only `/file` and `/dir/` patterns are supported; others fail the gate.
Cost: dependency bumps and tsconfig changes also need `intent-change`.

## Architecture rules (`factory/gates/architecture.ts`)

Each layer imports only what its rule allows. Checked in CI (`checks` job)
and in the agent loop (`CHECKS` in `factory/loop.ts`), so the agent sees a
violation and can fix it before the PR.

| Layer             | May import                  | Why                                   |
|-------------------|-----------------------------|---------------------------------------|
| `app/src/domain/` | `app/src/domain/`           | pure rules: no I/O, no infra, no CLI  |
| `app/src/infra/`  | `app/src/domain/`, `node:*` | persists domain types; does not know the CLI |
| `tests/blackbox/` | `node:*`                    | spawn the CLI; never import app code  |
| `app/src/cli.ts`  | anything                    | composition + I/O edge                |

Imports are found with TypeScript's `preProcessFile` (import, export-from,
`import()`, `require`). Not covered: globals (`process`, `fetch`,
`console`) in domain code.

## Agent identity (GitHub App)

Agents never use a human's token. Each automated station acts as a GitHub
App: a separate identity (`<name>[bot]`) under the owner's account, with no
extra GitHub account.

```
 human (primalivet)                 agent job (Actions runner)
 token only on own machine          secrets: BUILD_BOT_APP_ID, BUILD_BOT_PRIVATE_KEY
 approves PRs, adds labels               │ mint token at job start
                                         ▼
                                    1-hour token: this repo only, App's permissions
                                         ▼
                                    push branch, open PR → author swfactory-build[bot]
```

Why: GitHub forbids approving your own PR. With a bot author, a required
code-owner review by the human becomes possible (backlog item 1, option B).

Why not the alternatives:

| Option                         | Problem                                            |
|--------------------------------|----------------------------------------------------|
| Actions `GITHUB_TOKEN`         | PRs it opens do not trigger workflows: no gates    |
| fine-grained token of a human  | still the human; no separation                     |
| second GitHub account          | extra account to own and secure                    |

### `swfactory-build` settings (login `swfactory-build[bot]`)

| Field                              | Value                                   |
|------------------------------------|-----------------------------------------|
| Homepage URL                       | `https://github.com/primalivet/swfactory` |
| Callback URL, OAuth, Device Flow   | empty / off (the App never acts as a user) |
| Setup URL                          | empty                                   |
| Webhook → Active                   | off (Actions triggers the work)         |
| Contents                           | Read and write (push branch)            |
| Pull requests                      | Read and write (open PR)                |
| Issues                             | Read-only (read plan comment)           |
| Metadata                           | Read-only (mandatory)                   |
| Workflows                          | **No access**                           |
| all other permissions              | No access                               |
| Events                             | none                                    |
| Installable on                     | only this account; installed on `swfactory` only |

- **Workflows: No access.** GitHub rejects any push from the App that touches
  `.github/workflows/`. The bot cannot edit the gates' workflow files. It can
  still edit `factory/gates/*.ts`; CODEOWNERS must cover that.
- **Issues: Read-only.** Issue labels (`factory:*`) are moved by the
  workflow's own `GITHUB_TOKEN`, not by the bot.
- Unconfirmed: `Pull requests: write` may let the bot label its own PR
  (incl. `intent-change`). Do not rely on the label alone (backlog item 1, option C).

### `swfactory-triage-plan` (login `swfactory-triage-plan[bot]`)

Same settings as `swfactory-build`, except permissions: Issues **Read and
write** (comment, move labels), Metadata Read-only, all other No access.
`APPS` in `factory/github.ts` declares both Apps; `assert` prints what to
verify by hand.

Labels set by an App token start workflows (unlike `GITHUB_TOKEN`). The bot
cannot start a build with `factory:planned`: the build job requires an approver.
Both stations live in one workflow, `stations.yml`, so each label change
starts one run; jobs whose label does not match are skipped.

### Credentials

| Credential      | Used? | Where                                     |
|-----------------|-------|-------------------------------------------|
| App ID          | yes   | repo secrets `BUILD_BOT_APP_ID`, `TRIAGE_PLAN_BOT_APP_ID` |
| private key     | yes   | repo secrets `BUILD_BOT_PRIVATE_KEY`, `TRIAGE_PLAN_BOT_PRIVATE_KEY` (full `.pem` content) |
| client secret   | no    | OAuth only; GitHub requires one to exist; never stored |
| OpenRouter key  | yes   | repo secret `OPENROUTER_API_KEY`           |

The private key is generated under Credentials → **Key pairs**, not "Client
secrets". Delete the downloaded `.pem` once stored. Rotate: generate a new
key, update the secret, delete the old key on the App page.

## Build station (`.github/workflows/stations.yml`, job `build`)

Starts when an approver labels an issue `factory:planned`. Label moves, the
secret scan and the PR are `factory/lifecycle.ts` subcommands.

```
 sender in APPROVERS? ── no ──► fail → factory:blocked
   ▼ yes
 GITHUB_TOKEN: planned → building
 factory/build-task.ts: issue body (only if an approver wrote it) + approved plan:
   latest **Plan** comment by an approver or swfactory-triage-plan[bot],
   last edited before an approver added factory:planned
 pnpm install, pi (pinned) ─► preflight checks
 delete factory/bench/ (hidden tests; restored before the commit)
 factory/loop.ts: pi + MODEL, tools read/edit/write, max 3 iterations ── red ──► factory:blocked
 secret scan: diff must not contain OPENROUTER_API_KEY
 upload runs/ as artifact
 App token minted ─► commit as swfactory-build[bot] ─► push issue-N ─► PR "Closes #N"
 GITHUB_TOKEN: building → review
```

Safety choices:

| Choice | Against |
|--------|---------|
| only approvers can start a build | anyone labelling on a public repo |
| only approver-written text reaches the agent | prompt injection via issue body or comments |
| `GH_TOKEN` only in the steps that need it | agent reading the token from its environment |
| App token minted after the agent finished | agent using the bot's push rights |
| secret scan of the diff | agent writing `OPENROUTER_API_KEY` into a file, then into a public PR |
| App has no `Workflows` permission | agent editing `.github/workflows/` (GitHub rejects the push) |
| CODEOWNERS + 1 required approval | bot changes to trust roots merging without the owner |

Not covered yet: the agent can still read `OPENROUTER_API_KEY` from its
environment and use it, up to the key's OpenRouter credit limit ($15 per
week, set on the key in OpenRouter).

## Triage + plan station (`.github/workflows/stations.yml`, job `triage-plan`)

Starts when an approver labels an issue `factory:new` (opening it from the
template as an approver does that). Comments and label moves are
`factory/lifecycle.ts post-triage` and `fail`.

```
 sender in APPROVERS? ── no ──► skip (issue waits for an approver)
   ▼ yes
 delete factory/bench/ (hidden tests)
 factory/triage-plan.ts fetch (GITHUB_TOKEN): issue + approvers' comments ─► issue.json
 triage agent: pi, tools read/grep/find/ls ─► JSON {decision, reason, question}
   ├─ blocked ─► bot: **Question** comment, new → blocked
   └─ triaged ─► plan agent (same tools) ─► Markdown, checked: has a "Changes" line, no oracle path
                 bot: **Plan** comment, new → triaged
 failure ─► new → blocked + comment with run link
 [HUMAN reads plan, adds factory:planned] ──► build station
```

Safety choices:

| Choice | Against |
|--------|---------|
| only approvers start it | spend and untrusted issue text from anyone |
| read-only tools, no shell | agent changing files or using tokens |
| agent never has a GitHub token; `fetch` runs before, App token after | agent acting on GitHub |
| issue text wrapped as data; only approvers' comments included | prompt injection via issue or comments |
| `factory/bench/` deleted; plan rejected if it names it | plan pointing the build agent at the oracle |
| build uses only a plan edited before approval | plan changed after the human read it |

Blocked loop: an approver answers the question in a comment, then re-adds
`factory:new`. The author's own answer reaches the agent only if the author
is an approver.

## Runbook: manual stations (step A)

Do these by hand. Each one is a spec for the agent that later replaces you.

1. **Triage** an issue labelled `factory:new`:
   - acceptance criteria are black-box and testable? in scope of `SPEC.md`?
   - yes → swap label to `factory:triaged`
   - no → comment a question, label `factory:blocked`
2. **Plan**: comment on the issue: files to touch, SPEC/test changes needed
   (yes → PR will need `intent-change`), risks. Label `factory:planned`.
3. **Build**: `git switch -c issue-N`, implement, open PR with `Closes #N`,
   label issue `factory:review`.
4. **Gates** run automatically. Red → fix on the branch.
5. **Review**: read the diff against the plan, merge.
6. **Deploy** happens on merge. Check the Releases page.
7. **Monitor**: Actions → monitor → Run workflow to try it on demand.
8. **Close without building** (blocked and abandoned, duplicate, won't do):
   close as not planned, so `done.yml` does not add `factory:done`.
   `factory:done` means built.
   ```
   gh issue close N --reason "not planned"
   ```

## Review backlog

Gaps found while running the factory. Revisit after the full set of examples.

1. **Gates can rewrite themselves.** Solved with A + B + C (see Trust roots):
   the gate runs from `main` via `pull_request_target` (A), `.github/CODEOWNERS`
   needs code-owner review (B), `intent-change` counts only from an approver (C).
   Left open: a PR can add a workflow that posts a passing `protected-paths`
   status (guard: code-owner review), the label stays valid after later pushes,
   and `enforce_admins` is off. D (a review agent for trust-root changes) is
   part of step D2.
2. **No terminal state.** Solved: `done.yml` strips `factory:*` when an issue
   closes and adds `factory:done` if it closed as completed. Issues closed
   before it (#1, #3, #5) keep their old labels.
3. **PR author = human token.** Solved for bot PRs: `swfactory-build[bot]`
   opens them, the owner approves. Owner PRs (factory changes) still merge
   via admin bypass, with no review.
4. **`intent-change` on every behavior change.** Any fix that adds a black-box
   test needs it, so it risks becoming a rubber stamp. Distinguish "adds
   oracle cases from approved acceptance criteria" from "changes existing
   spec/oracle".
5. **Monitor re-runs CI's suite.** It catches packaging/artifact drift only,
   not real-world signals. Fine for a CLI; a service would need runtime probes.
6. **Release on every green push to main**, including docs-only changes.
7. **Trust roots were incomplete.** Solved: `.envrc`, `package.json`,
   `pnpm-lock.yaml`, `tsconfig.json`, `flake.nix`, `flake.lock` added; one
   list in `.github/CODEOWNERS` (see Trust roots).
8. **Build station first run was missed.** Issue #5 got `factory:planned`
   36 s before PR #6 merged `build.yml`. `issues` events run the workflow
   from `main`, so nothing ran. A workflow is only live after merge.
9. **No glossary.** One concept goes by several names: trust root, protected
   path, intent/oracle paths, `intent-change` files. Define the factory's
   terms once (station, gate, oracle, hidden test, trust root, plan,
   approver, …) and use only those names in docs, code and labels.
10. **No route for factory changes.** Findings from running the factory are
    mostly changes to workflows, gates or docs (#19, #20, #22). Triage blocks
    them (not product behavior), and the build bot cannot push
    `.github/workflows/`. Today they are built by hand. Step E needs a route
    for them, with the owner as reviewer.
11. **Plan detail vs change size.** The plan agent writes the full code for
    small features, so the human reviews the code twice. Revisit when
    changes grow.

## Stage notes

- `docs/stages/00-target-and-oracle.md`: product + black-box oracle
- `docs/stages/01-the-loop.md`: bare loop prototype and what it got wrong
- `docs/stages/02-benchmark.md`: model benchmark with a hidden test
- `docs/stages/03-build-station.md`: first end-to-end run of the build station
- `docs/stages/04-triage-plan.md`: triage + plan station on a clear and a vague issue
