---
name: docs-sync
description: Check and update the Kakaw docs after any code change. Use after editing code in the frontend, backend or agent repos, before committing, and whenever the docs-check Stop hook says documented code changed. Covers which pages to read, what counts as a docs change, how to write it, and the "Docs:" commit line.
---

# docs-sync

Kakaw's docs must describe what the code does today. A change is not finished until the docs have been checked.

## Where the docs live

| Docs | Location | Audience |
| --- | --- | --- |
| User docs (Fumadocs) | `frontend/src/content/docs/**/*.mdx`, served at `/docs` | People using Kakaw, and AI agents through `/llms.txt`, `/llms-full.txt` and `<page>.md` |
| Architecture notes | org `.github` repo, `docs/*.md` | Developers |
| AI crawler intro | `frontend/src/app/llms.txt/route.ts` (the `INTRO` text) | Crawlers and assistants |

`docs-map.json` at each repo root lists which code paths each page describes.

## Steps

1. **List what changed.** `git status` and `git diff` (plus `git diff @{upstream}..HEAD` for committed, unpushed work).
2. **Find the pages.** Match the changed paths against `docs-map.json`. The Stop hook names them for you when it fires. Also search the docs for the names of anything you changed: a setting, a button label, a limit, an error message (`grep -rn "Think" frontend/src/content/docs`).
3. **Read each page and decide.** A page needs an edit when, after your change, any sentence in it is false, a step no longer works, a number (limit, timeout, size, rate) changed, or a reader-visible feature exists that no page mentions.
   Not a docs change: refactors, tests, internal renames, performance work that changes no limit, and fixes that make the code do what the docs already say.
4. **Edit.** Change only what is now wrong or missing; keep each page's structure. New feature a reader can see: add it to the page where a reader would look, and add a `docs-map.json` rule for its code. Architecture-level change (a service, the data model, security, configuration, timeouts): update the matching note in the `.github` repo too.
5. **Check.** In `frontend`, run `npx next build`; it fails on broken MDX. For a page you changed, read its Markdown twin at `/docs/<page>.md` if a server is running.
6. **Record it.** In the commit message of the code change, add one line:
   - `Docs: updated models/providers.mdx` (list the pages), or
   - `Docs: none, <reason>` (for example `Docs: none, internal refactor`).
   Commit docs in the frontend repo when the code was in backend or agent, and push both.

## Writing rules

- Every claim must be true of the code: check the value in the code, never from memory. Limits, defaults, file sizes, timeouts and rate limits come from the source.
- Plain English, short sentences, present tense, second person (*you*). Name buttons exactly as the UI does, in **bold**.
- Say what Kakaw does, not how proud we are of it. No marketing words.
- Never claim more privacy or security than the code gives. If data leaves Kakaw (to a model provider, a search engine), say so.
- Frontmatter needs `title` and a one-sentence `description`: both feed `/llms.txt`.
- New page: add it to the folder's `meta.json` `pages` list, or it won't appear in the sidebar.
- Moved or renamed page: add a redirect in `frontend/next.config.mjs`.

## The guards

- **Stop hook** (`.claude/settings.json` runs `scripts/docs-check.mjs --hook`): when an agent tries to finish with documented code changed and no docs edited, it is sent back once with the pages to check. Answer by editing the docs or by stating `Docs: none, <reason>`.
- **CI** (`scripts/docs-check.mjs --ci`): every commit that touches documented code without a `Docs:` line gets a warning on the run. It does not fail the build.
