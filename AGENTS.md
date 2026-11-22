# Kakaw backend: agent rules

NestJS API: auth, connections, chats, and the bridge to the agent service.

## Docs are part of every change

Kakaw's user docs (`frontend/src/content/docs`, served at `/docs` and to AI agents as Markdown) and the architecture notes (org `.github` repo, `docs/`) must match the code. After any code change, before you finish or commit, follow the `docs-sync` skill (`.claude/skills/docs-sync/SKILL.md`):

- Check the pages that `docs-map.json` lists for the paths you changed, and search the docs for anything you renamed or re-valued.
- Update what is now wrong or missing, or decide that nothing a reader sees changed.
- Add `Docs: updated <pages>` or `Docs: none, <reason>` to the commit message.

A Stop hook (`scripts/docs-check.mjs --hook`) sends you back once when documented code changed without a docs edit. CI warns on every commit that touches documented code without a `Docs:` line.
