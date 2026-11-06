// Factory state on GitHub, declared below. `setup` applies what can be scripted; `assert` checks all of it.
// Usage: node factory/github.ts setup|assert
import { execFileSync } from "node:child_process";

type Label = { name: string; color: string; description: string };

const LABELS: Label[] = [
  // QUEUE states (one at a time per issue)
  { name: "factory:new", color: "ededed", description: "Queued, not yet triaged" },
  { name: "factory:triaged", color: "c5def5", description: "Clear and in scope; needs a plan" },
  { name: "factory:planned", color: "bfd4f2", description: "Plan approved by a human; ready to build" },
  { name: "factory:building", color: "fbca04", description: "A build station is working on it" },
  { name: "factory:review", color: "0e8a16", description: "PR open, waiting on gates and review" },
  { name: "factory:blocked", color: "b60205", description: "Needs human input (question asked on the issue)" },
  { name: "factory:done", color: "c2e0c6", description: "Closed as completed; left the queue" },
  // Signals and overrides
  { name: "source:monitor", color: "d93f0b", description: "Filed by the monitor" },
  { name: "intent-change", color: "5319e7", description: "Human-approved change to spec, tests or factory" },
];

// REVIEW GATE: main only changes through PRs with green required checks and one approval.
// Files in .github/CODEOWNERS need the owner's approval. Bot PRs: the owner approves.
// The owner's own PRs cannot be self-approved; enforce_admins=false lets the owner merge them.
const PROTECTION = {
  required_status_checks: { strict: true, contexts: ["checks", "protected-paths"] },
  enforce_admins: false,
  required_pull_request_reviews: {
    required_approving_review_count: 1,
    require_code_owner_reviews: true,
    dismiss_stale_reviews: true,
  },
  restrictions: null,
  allow_force_pushes: false,
  allow_deletions: false,
};

// Not scriptable: secret values and GitHub Apps. `assert` checks they exist; App permissions are checked by hand.
// Every App: webhook off, no OAuth/Device Flow, installable on this account only, installed on this repo only.
// Unlisted permissions: No access (Workflows in particular).
type App = { slug: string; secrets: string[]; permissions: Record<string, "read" | "write">; why: string };
const APPS: App[] = [
  {
    slug: "swfactory-build",
    secrets: ["BUILD_BOT_APP_ID", "BUILD_BOT_PRIVATE_KEY"],
    permissions: { contents: "write", pull_requests: "write", issues: "read", metadata: "read" },
    why: "push the issue branch, open the PR, read the plan",
  },
  {
    slug: "swfactory-triage-plan",
    secrets: ["TRIAGE_PLAN_BOT_APP_ID", "TRIAGE_PLAN_BOT_PRIVATE_KEY"],
    permissions: { issues: "write", metadata: "read" },
    why: "comment questions and plans, move factory:* labels",
  },
];
const SECRETS = ["OPENROUTER_API_KEY", ...APPS.flatMap((a) => a.secrets)];

type Protection = {
  required_status_checks?: { strict: boolean; contexts: string[] };
  enforce_admins?: { enabled: boolean };
  required_pull_request_reviews?: {
    required_approving_review_count?: number;
    require_code_owner_reviews?: boolean;
    dismiss_stale_reviews?: boolean;
  };
  allow_force_pushes?: { enabled: boolean };
  allow_deletions?: { enabled: boolean };
};

const gh = (args: string[], input?: string) =>
  execFileSync("gh", args, { encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"] });
const tryGh = (args: string[]): string | undefined => {
  try {
    return gh(args);
  } catch {
    return undefined;
  }
};
const repo = gh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]).trim();

function setup() {
  for (const l of LABELS) {
    gh(["label", "create", l.name, "--color", l.color, "--description", l.description, "--force", "-R", repo]);
  }
  gh(["api", "-X", "PUT", `repos/${repo}/branches/main/protection`, "--input", "-"], JSON.stringify(PROTECTION));
  console.log(`factory setup done for ${repo}`);
}

function assert() {
  const SETUP = "node factory/github.ts setup";
  const problems: { what: string; fix: string }[] = [];
  const expect = (ok: boolean, what: string, fix: string) => ok || problems.push({ what, fix });

  const labels: Label[] = JSON.parse(gh(["label", "list", "-R", repo, "--limit", "200", "--json", "name,color,description"]));
  for (const want of LABELS) {
    const have = labels.find((l) => l.name === want.name);
    expect(!!have, `label ${want.name} missing`, SETUP);
    if (have) {
      expect(
        have.color.toLowerCase() === want.color.toLowerCase() && have.description === want.description,
        `label ${want.name} has color/description ${have.color} "${have.description}"`,
        SETUP,
      );
    }
  }
  for (const extra of labels.filter((l) => l.name.startsWith("factory:") && !LABELS.some((w) => w.name === l.name))) {
    expect(false, `label ${extra.name} not declared`, "add it to LABELS in factory/github.ts or delete it");
  }

  const raw = tryGh(["api", `repos/${repo}/branches/main/protection`]);
  expect(!!raw, "main has no branch protection", SETUP);
  if (raw) {
    const have: Protection = JSON.parse(raw);
    const want = PROTECTION;
    const reviews = have.required_pull_request_reviews;
    const fields: [string, unknown, unknown][] = [
      ["required_status_checks.strict", have.required_status_checks?.strict, want.required_status_checks.strict],
      [
        "required_status_checks.contexts",
        (have.required_status_checks?.contexts ?? []).toSorted().join(","),
        want.required_status_checks.contexts.toSorted().join(","),
      ],
      ["enforce_admins", have.enforce_admins?.enabled, want.enforce_admins],
      ["required_approving_review_count", reviews?.required_approving_review_count, want.required_pull_request_reviews.required_approving_review_count],
      ["require_code_owner_reviews", reviews?.require_code_owner_reviews, want.required_pull_request_reviews.require_code_owner_reviews],
      ["dismiss_stale_reviews", reviews?.dismiss_stale_reviews, want.required_pull_request_reviews.dismiss_stale_reviews],
      ["allow_force_pushes", have.allow_force_pushes?.enabled, want.allow_force_pushes],
      ["allow_deletions", have.allow_deletions?.enabled, want.allow_deletions],
    ];
    for (const [name, h, w] of fields) expect(h === w, `main protection ${name} is ${h}, want ${w}`, SETUP);
  }

  const secrets: { name: string }[] = JSON.parse(gh(["secret", "list", "-R", repo, "--json", "name"]));
  for (const name of SECRETS) {
    expect(secrets.some((s) => s.name === name), `secret ${name} missing`, `gh secret set ${name} -R ${repo}  (see docs/FACTORY.md, Credentials)`);
  }

  for (const app of APPS) {
    expect(
      !!tryGh(["api", `users/${app.slug}[bot]`]),
      `bot ${app.slug}[bot] does not exist`,
      `create GitHub App ${app.slug} with the permissions below (see docs/FACTORY.md, Agent identity)`,
    );
  }

  const errors: { errors: unknown[] } = JSON.parse(tryGh(["api", `repos/${repo}/codeowners/errors`]) ?? '{"errors":["no CODEOWNERS file"]}');
  expect(errors.errors.length === 0, `CODEOWNERS errors: ${JSON.stringify(errors.errors)}`, "fix .github/CODEOWNERS");

  for (const p of problems) console.error(`FAIL ${p.what}\n     fix: ${p.fix}`);
  const apps = APPS.map((a) => {
    const perms = Object.entries(a.permissions).map(([k, v]) => `${k}: ${v}`).join(", ");
    return `  - ${a.slug}: ${perms}; all other: No access (${a.why})`;
  });
  console.log(`
Not checkable with a user token; verify by hand at https://github.com/settings/apps:
${apps.join("\n")}
  - each App: webhook off, installed on ${repo} only
`);
  if (problems.length > 0) {
    console.error(`${problems.length} problem(s) in ${repo}`);
    process.exitCode = 1;
  } else {
    console.log(`github setup ok for ${repo}`);
  }
}

const command = process.argv[2];
if (command === "setup") setup();
else if (command === "assert") assert();
else throw new Error("usage: github.ts setup|assert");
