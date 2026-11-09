// Gate: trust roots change only with the `intent-change` label, added by an approver.
// Runs from main via pull_request_target and never reads PR code: trust roots come from .github/CODEOWNERS in
// this checkout (main), the PR's files from the API. The result is the commit status `protected-paths` on the PR head.
// Usage: node factory/gates/protected-paths.ts <pr-number> <head-sha>   (env APPROVERS, GH_TOKEN; GITHUB_REPOSITORY)
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const CONTEXT = "protected-paths";
const LABEL = "intent-change";

type File = { filename: string; previous_filename?: string };
type Event = { event: string; actor: { login: string } | null; label?: { name: string } };

// CODEOWNERS line: "<pattern> <owner>...". Supported patterns: /file and /dir/.
function trustRoots(codeowners: string): string[] {
  const paths = codeowners
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split(/\s+/)[0] ?? "");
  for (const p of paths) {
    if (!p.startsWith("/") || /[*?[\]!]/.test(p)) throw new Error(`CODEOWNERS: unsupported pattern ${p}`);
  }
  return paths.map((p) => p.slice(1));
}

const gh = (args: string[]) => execFileSync("gh", args, { encoding: "utf8" });
const api = (path: string) => JSON.parse(gh(["api", "--paginate", "--slurp", path])).flat();

function check(repo: string, pr: string): { ok: boolean; message: string } {
  const approvers = (process.env.APPROVERS ?? "").split(",").filter(Boolean);
  if (approvers.length === 0) throw new Error("APPROVERS is empty");
  const roots = trustRoots(readFileSync(".github/CODEOWNERS", "utf8"));
  const files: File[] = api(`repos/${repo}/pulls/${pr}/files`);
  const paths = files.flatMap((f) => (f.previous_filename ? [f.filename, f.previous_filename] : [f.filename]));
  const hits = [...new Set(paths.filter((f) => roots.some((p) => (p.endsWith("/") ? f.startsWith(p) : f === p))))];
  if (hits.length === 0) return { ok: true, message: "no trust roots changed" };

  const events: Event[] = api(`repos/${repo}/issues/${pr}/events`);
  const last = events.findLast((e) => (e.event === "labeled" || e.event === "unlabeled") && e.label?.name === LABEL);
  const by = last?.actor?.login ?? "";
  const detail = `\n  ${hits.join("\n  ")}`;
  if (last?.event === "labeled" && approvers.includes(by)) return { ok: true, message: `${LABEL} by ${by}:${detail}` };
  const why = last?.event === "labeled" ? `${LABEL} added by ${by}, not an approver` : `no ${LABEL} label`;
  return { ok: false, message: `${why}; needed for:${detail}` };
}

function status(repo: string, sha: string, ok: boolean, description: string) {
  const runUrl = `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID ?? ""}`;
  gh([
    "api", "-X", "POST", `repos/${repo}/statuses/${sha}`,
    "-f", `state=${ok ? "success" : "failure"}`,
    "-f", `context=${CONTEXT}`,
    "-f", `description=${description.slice(0, 140)}`,
    "-f", `target_url=${runUrl}`,
  ]);
}

const [pr, sha] = process.argv.slice(2);
if (!pr || !sha) throw new Error("usage: protected-paths.ts <pr-number> <head-sha>");
const repo = process.env.GITHUB_REPOSITORY ?? gh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]).trim();
try {
  const res = check(repo, pr);
  status(repo, sha, res.ok, res.message.replace(/\n\s*/g, " "));
  console.log(`${CONTEXT}: ${res.message}`);
  if (!res.ok) process.exitCode = 1;
} catch (e) {
  status(repo, sha, false, `gate error: ${e instanceof Error ? e.message : String(e)}`);
  throw e;
}
