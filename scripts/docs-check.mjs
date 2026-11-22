#!/usr/bin/env node
/* global process, console */
// Keeps the docs in step with the code. Reads docs-map.json at the repo root,
// which lists the code paths each docs page describes.
//
//   node scripts/docs-check.mjs --hook        Claude Code Stop hook
//   node scripts/docs-check.mjs --ci <range>  CI: warn per commit, never fail
//
// The same file lives in frontend, backend and agent; keep the copies equal.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const map = JSON.parse(readFileSync(join(root, "docs-map.json"), "utf8"));

const git = (args, cwd = root) => {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
};
const lines = (text) => text.split("\n").map((line) => line.trim()).filter(Boolean);

/** `src/agent/**` and `src/net/web-*.ts` style globs. */
const globToRegExp = (glob) =>
  new RegExp(
    `^${glob
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*\//g, "(?:.*/)?")
      .replace(/\*\*/g, ".*")
      .replace(/\*/g, "[^/]*")}$`,
  );
const rules = map.rules.map((rule) => ({ ...rule, patterns: rule.paths.map(globToRegExp) }));

/** The docs pages (and architecture notes) that the changed files touch. */
function affected(files) {
  const pages = new Set();
  const architecture = new Set();
  const matchedFiles = new Set();
  for (const file of files) {
    for (const rule of rules) {
      if (rule.patterns.some((pattern) => pattern.test(file))) {
        matchedFiles.add(file);
        for (const page of rule.docs ?? []) pages.add(page);
        for (const note of rule.architecture ?? []) architecture.add(note);
      }
    }
  }
  return { files: [...matchedFiles], pages: [...pages], architecture: [...architecture] };
}

/** Uncommitted changes plus commits not pushed yet. */
function localChanges(cwd) {
  const status = lines(git(["status", "--porcelain", "--untracked-files=all"], cwd)).map((line) => line.slice(3).replace(/^.* -> /, ""));
  const unpushed = lines(git(["diff", "--name-only", "@{upstream}..HEAD"], cwd));
  return [...new Set([...status, ...unpushed])];
}

function hook() {
  let input = {};
  try {
    input = JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    // no input
  }
  // Already sent back once this turn: the agent has looked, let it finish.
  if (input.stop_hook_active) return;

  const { files, pages, architecture } = affected(localChanges(root));
  if (files.length === 0) return;

  const docsRoot = resolve(root, map.docsRepo);
  const docsChanged = existsSync(docsRoot) && localChanges(docsRoot).some((file) => file.startsWith(`${map.docsPath}/`));
  if (docsChanged) return;

  const reason = [
    `Code the docs describe changed (${files.slice(0, 8).join(", ")}${files.length > 8 ? ", ..." : ""}).`,
    `Pages to check, in ${map.docsRepo}/${map.docsPath}: ${pages.join(", ")}.`,
    architecture.length ? `Architecture notes to check (org .github repo, docs/): ${architecture.join(", ")}.` : "",
    "Follow the docs-sync skill: update the pages that are now wrong or incomplete, or if nothing a reader sees changed,",
    "say so in one line ('Docs: none, <reason>') and add that line to the commit message. Then finish.",
  ]
    .filter(Boolean)
    .join(" ");
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
}

function ci(range) {
  const commits = lines(git(["rev-list", "--no-merges", range]));
  let warned = 0;
  for (const sha of commits) {
    const files = lines(git(["show", "--name-only", "--format=", sha]));
    const { pages } = affected(files);
    if (pages.length === 0) continue;
    const message = git(["show", "-s", "--format=%B", sha]);
    if (/^Docs:/im.test(message)) continue;
    // A commit to the docs pages themselves answers its own question.
    if (files.some((file) => file.startsWith(`${map.docsPath}/`))) continue;
    warned += 1;
    const subject = message.split("\n")[0];
    console.log(
      `::warning title=Docs not checked::${sha.slice(0, 7)} "${subject}" changes code described in ${pages.join(", ")} but has no "Docs:" line. Update the docs or add "Docs: none, <reason>".`,
    );
  }
  console.log(warned ? `${warned} commit(s) without a docs check.` : "Every commit that touches documented code has a Docs: line.");
}

const [mode, arg] = process.argv.slice(2);
if (mode === "--hook") hook();
else if (mode === "--ci") ci(arg || "HEAD~1..HEAD");
else {
  console.error("usage: docs-check.mjs --hook | --ci <git range>");
  process.exit(2);
}
