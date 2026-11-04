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
| queue + states | `factory/setup-github.sh` (labels)     |
| oracle         | `tests/blackbox/`                      |
| gates          | `.github/workflows/ci.yml`, `factory/gates/` |
| review gate    | branch protection (`factory/setup-github.sh`) |
| deploy         | `.github/workflows/release.yml`        |
| monitor        | `.github/workflows/monitor.yml`        |
| build station  | `factory/loop.ts` (prototype, stage 1) |

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
                                    push branch, open PR → author swfactory-build-bot[bot]
```

Why: GitHub forbids approving your own PR. With a bot author, a required
code-owner review by the human becomes possible (backlog item 1, option B).

Why not the alternatives:

| Option                         | Problem                                            |
|--------------------------------|----------------------------------------------------|
| Actions `GITHUB_TOKEN`         | PRs it opens do not trigger workflows: no gates    |
| fine-grained token of a human  | still the human; no separation                     |
| second GitHub account          | extra account to own and secure                    |

### `swfactory-build-bot` settings

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
2. **No terminal state.** #1 closed but kept `factory:review`. Add `factory:done`
   or strip `factory:*` on close.
3. **PR author = human token.** GitHub forbids approving your own PR, so B
   needs the agent to open PRs as a separate identity (GitHub App / machine user).
4. **`intent-change` on every behavior change.** Any fix that adds a black-box
   test needs it, so it risks becoming a rubber stamp. Distinguish "adds
   oracle cases from approved acceptance criteria" from "changes existing
   spec/oracle".
5. **Monitor re-runs CI's suite.** It catches packaging/artifact drift only,
   not real-world signals. Fine for a CLI; a service would need runtime probes.
6. **Release on every green push to main**, including docs-only changes.

## Stage notes

- `docs/stages/00-target-and-oracle.md`: product + black-box oracle
- `docs/stages/01-the-loop.md`: bare loop prototype and what it got wrong
