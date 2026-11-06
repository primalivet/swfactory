// Build the agent's task from an issue: its body plus the approved plan.
// Approved plan = latest **Plan** comment by an approver or the plan bot, last edited before an approver
// labelled factory:planned. A plan edited after approval is never built. Other comments never reach the agent.
// Usage: node factory/build-task.ts <issue-number>   (env APPROVERS: comma-separated logins)
import { execFileSync } from "node:child_process";

type Comment = { user: { login: string }; body: string; updated_at: string };
type Issue = { number: number; title: string; body: string | null; user: { login: string } };
type Event = { event: string; actor: { login: string } | null; label?: { name: string }; created_at: string };

const PLAN_MARKER = "**Plan**";
const PLAN_BOT = "swfactory-triage-plan[bot]";

const number = process.argv[2];
if (!number) throw new Error("usage: build-task.ts <issue-number>");
const approvers = (process.env.APPROVERS ?? "").split(",").filter(Boolean);
if (approvers.length === 0) throw new Error("APPROVERS is empty");

const repo = process.env.GITHUB_REPOSITORY ?? execFileSync("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], { encoding: "utf8" }).trim();
const api = (path: string) => JSON.parse(execFileSync("gh", ["api", "--paginate", "--slurp", path], { encoding: "utf8" })).flat();

const [issue]: Issue[] = api(`repos/${repo}/issues/${number}`);
const comments: Comment[] = api(`repos/${repo}/issues/${number}/comments`);
const events: Event[] = api(`repos/${repo}/issues/${number}/events`);

const approval = events.findLast(
  (e) => e.event === "labeled" && e.label?.name === "factory:planned" && approvers.includes(e.actor?.login ?? ""),
);
if (!approval) throw new Error(`issue #${number}: no factory:planned label by ${approvers.join(", ")}`);
const plan = comments.findLast(
  (c) =>
    (approvers.includes(c.user.login) || c.user.login === PLAN_BOT) &&
    c.body.includes(PLAN_MARKER) &&
    c.updated_at <= approval.created_at,
);
if (!plan) throw new Error(`issue #${number}: no ${PLAN_MARKER} comment edited before approval at ${approval.created_at}`);
const body = approvers.includes(issue.user.login) ? issue.body ?? "" : "(issue body omitted: author is not an approver)";

console.log(`Implement the approved plan for issue #${issue.number} in this repository.

# Issue: ${issue.title}

${body}

# Approved plan

${plan.body}

Read \`app/SPEC.md\` and the existing code first and follow their style.
Change only the files the plan names.`);
