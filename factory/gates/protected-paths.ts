// Gate: trust roots change only with a human's `intent-change` label.
// Trust roots = paths in .github/CODEOWNERS, read from the base ref so a PR cannot shrink the list.
// Usage: node factory/gates/protected-paths.ts <base-ref>   (env PR_LABELS: comma-separated)
import { execFileSync } from "node:child_process";

const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" });

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

const base = process.argv[2];
if (!base) throw new Error("usage: protected-paths.ts <base-ref>");
const labels = (process.env.PR_LABELS ?? "").split(",");

const roots = trustRoots(git("show", `${base}:.github/CODEOWNERS`));
const changed = git("diff", "--name-only", `${base}...HEAD`).split("\n").filter(Boolean);
const hits = changed.filter((f) => roots.some((p) => (p.endsWith("/") ? f.startsWith(p) : f === p)));

if (hits.length === 0) {
  console.log("protected-paths: no trust roots changed");
} else if (labels.includes("intent-change")) {
  console.log(`protected-paths: allowed by intent-change label:\n  ${hits.join("\n  ")}`);
} else {
  console.error(`protected-paths: these trust roots need the intent-change label:\n  ${hits.join("\n  ")}`);
  process.exitCode = 1;
}
