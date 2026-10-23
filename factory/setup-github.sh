#!/usr/bin/env bash
# One-time factory setup on GitHub: state labels and branch protection. Idempotent.
set -euo pipefail

repo="$(gh repo view --json nameWithOwner -q .nameWithOwner)"

label() { gh label create "$1" --color "$2" --description "$3" --force -R "$repo"; }

# QUEUE states (one at a time per issue)
label "factory:new"      "ededed" "Queued, not yet triaged"
label "factory:triaged"  "c5def5" "Clear and in scope; needs a plan"
label "factory:planned"  "bfd4f2" "Plan approved by a human; ready to build"
label "factory:building" "fbca04" "A build station is working on it"
label "factory:review"   "0e8a16" "PR open, waiting on gates and review"
label "factory:blocked"  "b60205" "Needs human input (question asked on the issue)"
# Signals and overrides
label "source:monitor"   "d93f0b" "Filed by the monitor"
label "intent-change"    "5319e7" "Human-approved change to spec, tests or factory"

# REVIEW GATE: main only changes through PRs with green required checks.
gh api -X PUT "repos/$repo/branches/main/protection" --input - <<'JSON'
{
  "required_status_checks": { "strict": true, "contexts": ["checks", "protected-paths"] },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
echo "factory setup done for $repo"
