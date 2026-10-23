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

## Stage notes

- `docs/stages/00-target-and-oracle.md`: product + black-box oracle
- `docs/stages/01-the-loop.md`: bare loop prototype and what it got wrong
