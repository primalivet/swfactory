// Gate: intent (SPEC) and oracle (black-box tests) change only with a human's `intent-change` label.
// Usage: node factory/gates/protected-paths.ts <base-ref>   (env PR_LABELS: comma-separated)
import { execFileSync } from "node:child_process";

const PROTECTED = ["app/SPEC.md", "tests/blackbox/", ".github/", "factory/"];

const base = process.argv[2];
if (!base) throw new Error("usage: protected-paths.ts <base-ref>");
const labels = (process.env.PR_LABELS ?? "").split(",");

const changed = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);
const hits = changed.filter((f) => PROTECTED.some((p) => f === p || f.startsWith(p)));

if (hits.length === 0) {
  console.log("protected-paths: no protected files changed");
} else if (labels.includes("intent-change")) {
  console.log(`protected-paths: allowed by intent-change label:\n  ${hits.join("\n  ")}`);
} else {
  console.error(`protected-paths: these files need the intent-change label:\n  ${hits.join("\n  ")}`);
  process.exitCode = 1;
}
