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
 TRIAGE   new → triaged | blocked (question on issue)
        ▼
 PLAN     plan as issue comment ──► [HUMAN approves] → planned
        ▼
 BUILD    branch + change + PR "Closes #N" → review
        ▼
 GATES    ci.yml required checks: checks (typecheck, black-box),
          protected-paths (spec/tests/factory need `intent-change`)
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
| queue + states | `factory/github.ts` (labels)           |
| GitHub setup   | `factory/github.ts`                    |
| oracle         | `tests/blackbox/`                      |
| gates          | `.github/workflows/ci.yml`, `factory/gates/` |
| review gate    | branch protection (`factory/github.ts`) |
| deploy         | `.github/workflows/release.yml`        |
| terminal state | `.github/workflows/done.yml`           |
| monitor        | `.github/workflows/monitor.yml`        |
| build station  | `.github/workflows/build.yml`, `factory/build-task.ts`, `factory/loop.ts` |
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

### Credentials

| Credential      | Used? | Where                                     |
|-----------------|-------|-------------------------------------------|
| App ID          | yes   | repo secret `BUILD_BOT_APP_ID`                 |
| private key     | yes   | repo secret `BUILD_BOT_PRIVATE_KEY` (full `.pem` content) |
| client secret   | no    | OAuth only; GitHub requires one to exist; never stored |
| OpenRouter key  | yes   | repo secret `OPENROUTER_API_KEY`           |

The private key is generated under Credentials → **Key pairs**, not "Client
secrets". Delete the downloaded `.pem` once stored. Rotate: generate a new
key, update the secret, delete the old key on the App page.

## Build station (`.github/workflows/build.yml`)

Starts when an approver labels an issue `factory:planned`.

```
 sender in APPROVERS? ── no ──► fail → factory:blocked
   ▼ yes
 GITHUB_TOKEN: planned → building
 factory/build-task.ts: issue body (only if an approver wrote it) + latest **Plan** comment by an approver
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
| CODEOWNERS + 1 required approval | bot changes to spec, tests, gates or factory merging without the owner |

Not covered yet: the agent can still read `OPENROUTER_API_KEY` from its
environment and use it, up to the key's OpenRouter credit limit ($15 per
week, set on the key in OpenRouter).

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

## Review backlog

Gaps found while running the factory. Revisit after the full set of examples.

1. **Gates can rewrite themselves.** `pull_request` runs `ci.yml` and
   `factory/gates/protected-paths.ts` from the PR's own merge commit, so a PR
   can empty `PROTECTED`, edit the workflow, or add any passing job named
   `protected-paths`. Also: anyone with write access (incl. an agent token)
   can add `intent-change`; `enforce_admins` is off. Options:
   - A. run the gate via `pull_request_target`: script from `main`, PR diff as data only
   - B. CODEOWNERS + required code-owner review for `.github/`, `factory/`,
     `app/SPEC.md`, `tests/blackbox/` (trust root = repo settings)
   - C. gate checks *who* added `intent-change` against an allowlist
   - D. separate review job when trust-root files change (swamp: `claude-review-integrity`)
   Leaning A + C, then B once agents have their own identity.
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
7. **`.envrc` is not a protected path.** direnv runs it on the developer's
   machine. A bot PR that changes it runs code there after checkout. Add it
   to `PROTECTED` in `factory/gates/protected-paths.ts` and to
   `.github/CODEOWNERS`.
8. **Build station first run was missed.** Issue #5 got `factory:planned`
   36 s before PR #6 merged `build.yml`. `issues` events run the workflow
   from `main`, so nothing ran. A workflow is only live after merge.

## Stage notes

- `docs/stages/00-target-and-oracle.md`: product + black-box oracle
- `docs/stages/01-the-loop.md`: bare loop prototype and what it got wrong
- `docs/stages/02-benchmark.md`: model benchmark with a hidden test
- `docs/stages/03-build-station.md`: first end-to-end run of the build station
