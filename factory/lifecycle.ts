// Issue lifecycle: the factory:* states, which station moves an issue between them, and what each
// station writes to GitHub. Workflows only prepare the runner (checkout, tools, tokens) and call this file.
//
//   human adds        triage-plan            human adds            build
//   factory:new ────► triaged ─────────────► factory:planned ────► building ──► review ──► (PR merged)
//        │                                                            │
//        └──── question or failure ──► blocked ◄──── failure ─────────┘
//   issue closed: factory:* removed; closed as completed → done
//
// Usage (env APPROVERS; GH_TOKEN for commands that write to GitHub):
//   node factory/lifecycle.ts authorize <login>                        fail unless <login> is an approver
//   node factory/lifecycle.ts move <n> <state>                         set the one factory:* state
//   node factory/lifecycle.ts post-triage <n> <triage.json> <plan.md>  comment **Question** or **Plan**, then move
//   node factory/lifecycle.ts scan-secrets                             stage all changes; fail if they hold OPENROUTER_API_KEY
//   node factory/lifecycle.ts open-pr <n> <loop.txt>                   commit as BOT, push issue-<n>, open the PR
//   node factory/lifecycle.ts fail <n> <station>                       move to blocked, comment with the run link
//   node factory/lifecycle.ts close <n> <state_reason>                 remove factory:*; completed → factory:done
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { isDecision } from "./triage-plan.ts";

const STATES = ["new", "triaged", "planned", "building", "review", "blocked", "done"] as const;
type State = (typeof STATES)[number];
const isState = (s: string): s is State => STATES.some((x) => x === s);

// Moves a station makes. Humans add factory:new and factory:planned; `close` sets factory:done.
const MOVES: { to: State; from: State[] | "any" }[] = [
  { to: "triaged", from: ["new"] },
  { to: "blocked", from: "any" },
  { to: "building", from: ["planned"] },
  { to: "review", from: ["building"] },
];

const env = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is empty`);
  return v;
};
const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { encoding: "utf8" }).trim();
const repo = process.env.GITHUB_REPOSITORY ?? run("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);
const runLink = () =>
  process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : "local run";

function factoryLabels(n: string): string[] {
  const out = run("gh", ["issue", "view", n, "-R", repo, "--json", "labels", "-q", ".labels[].name"]);
  return out.split("\n").filter((l) => l.startsWith("factory:"));
}

function edit(n: string, remove: string[], add?: string) {
  if (remove.length === 0 && !add) return;
  const args = ["issue", "edit", n, "-R", repo];
  if (remove.length > 0) args.push("--remove-label", remove.join(","));
  if (add) args.push("--add-label", add);
  run("gh", args);
}

function comment(n: string, body: string) {
  execFileSync("gh", ["issue", "comment", n, "-R", repo, "--body-file", "-"], { input: body, stdio: ["pipe", "inherit", "inherit"] });
}

function authorize(login: string) {
  const approvers = env("APPROVERS").split(",").filter(Boolean);
  if (!approvers.includes(login)) throw new Error(`${login} is not an approver`);
}

function move(n: string, to: State) {
  const rule = MOVES.find((m) => m.to === to);
  if (!rule) throw new Error(`no station moves an issue to factory:${to}`);
  const current = factoryLabels(n);
  if (rule.from !== "any" && !rule.from.some((s) => current.includes(`factory:${s}`))) {
    throw new Error(`issue #${n}: cannot move to factory:${to} from [${current.join(", ")}]`);
  }
  edit(n, current.filter((l) => l !== `factory:${to}`), `factory:${to}`);
}

function postTriage(n: string, triageFile: string, planFile: string) {
  const decision: unknown = JSON.parse(readFileSync(triageFile, "utf8"));
  if (!isDecision(decision)) throw new Error(`${triageFile}: not a triage decision`);
  if (decision.decision === "blocked") {
    comment(n, `**Question**

${decision.question}

Why: ${decision.reason}

An approver answers in a comment (only approvers' comments reach the agent), then re-adds \`factory:new\`.`);
    move(n, "blocked");
    return;
  }
  if (!existsSync(planFile)) throw new Error(`${planFile}: missing for a triaged issue`);
  comment(n, `**Plan**

${readFileSync(planFile, "utf8").trim()}

---
Triaged: ${decision.reason}
Written by the triage-plan station (\`${env("MODEL")}\`, pi ${env("PI_VERSION")}). Run: ${runLink()}
Approve: an approver adds \`factory:planned\`. Editing this comment after approval excludes it from the build.`);
  move(n, "triaged");
}

function scanSecrets() {
  const key = env("OPENROUTER_API_KEY");
  run("git", ["add", "-A"]);
  if (run("git", ["diff", "--cached"]).includes(key)) throw new Error("staged diff contains OPENROUTER_API_KEY");
}

function openPr(n: string, loopFile: string) {
  const bot = env("BOT");
  const token = env("GH_TOKEN");
  const id = run("gh", ["api", `users/${bot}`, "--jq", ".id"]);
  run("git", ["-c", `user.name=${bot}`, "-c", `user.email=${id}+${bot}@users.noreply.github.com`, "commit", "-q", "-m", `Implement #${n}`, "-m", `Closes #${n}`]);
  run("git", ["push", `https://x-access-token:${token}@github.com/${repo}.git`, `HEAD:refs/heads/issue-${n}`]);
  const title = run("gh", ["issue", "view", n, "-R", repo, "--json", "title", "-q", ".title"]);
  const tail = readFileSync(loopFile, "utf8").trimEnd().split("\n").slice(-5).join("\n");
  const body = `Closes #${n}

Built by the build station (\`${env("MODEL")}\`, pi ${env("PI_VERSION")}). Run: ${runLink()}

\`\`\`
${tail}
\`\`\``;
  console.log(run("gh", ["pr", "create", "-R", repo, "--base", "main", "--head", `issue-${n}`, "--title", title, "--body", body]));
}

function fail(n: string, station: string) {
  move(n, "blocked");
  comment(n, `${station} station failed. Run: ${runLink()}`);
}

function close(n: string, reason: string) {
  const completed = reason === "completed";
  const stale = factoryLabels(n).filter((l) => !(completed && l === "factory:done"));
  edit(n, stale, completed ? "factory:done" : undefined);
}

if (import.meta.main) {
  const [command, a, b, c] = process.argv.slice(2);
  if (command === "authorize" && a) authorize(a);
  else if (command === "move" && a && b && isState(b)) move(a, b);
  else if (command === "post-triage" && a && b && c) postTriage(a, b, c);
  else if (command === "scan-secrets") scanSecrets();
  else if (command === "open-pr" && a && b) openPr(a, b);
  else if (command === "fail" && a && b) fail(a, b);
  else if (command === "close" && a && b) close(a, b);
  else throw new Error("usage: see the header of factory/lifecycle.ts");
}
