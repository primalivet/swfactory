// Build the agent's task from an issue: its body plus the latest plan comment written by an approver.
// Comments by anyone else are never passed to the agent (the repo is public).
// Usage: node factory/build-task.ts <issue-number>   (env APPROVERS: comma-separated logins)
import { execFileSync } from "node:child_process";

type Comment = { author: { login: string }; body: string };
type Issue = { number: number; title: string; body: string; author: { login: string }; comments: Comment[] };

const PLAN_MARKER = "**Plan**";

const number = process.argv[2];
if (!number) throw new Error("usage: build-task.ts <issue-number>");
const approvers = (process.env.APPROVERS ?? "").split(",").filter(Boolean);
if (approvers.length === 0) throw new Error("APPROVERS is empty");

const issue: Issue = JSON.parse(
  execFileSync("gh", ["issue", "view", number, "--json", "number,title,body,author,comments"], { encoding: "utf8" }),
);
const plan = issue.comments.findLast((c) => approvers.includes(c.author.login) && c.body.includes(PLAN_MARKER));
if (!plan) throw new Error(`issue #${number}: no ${PLAN_MARKER} comment by ${approvers.join(", ")}`);
const body = approvers.includes(issue.author.login) ? issue.body : "(issue body omitted: author is not an approver)";

console.log(`Implement the approved plan for issue #${issue.number} in this repository.

# Issue: ${issue.title}

${body}

# Approved plan

${plan.body}

Read \`app/SPEC.md\` and the existing code first and follow their style.
Change only the files the plan names.`);
