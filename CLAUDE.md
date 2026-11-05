# Stenmont

@BUILDER-NOTES.md
@plan/README.md

## Update as you work (after every step, not at the end)
- Append a timestamped line under `## Progress` in `BUILDER-NOTES.md`: what changed, in plain words.
- Tick the checkboxes in `plan/` as each step finishes.
- Add the commit lines to `commits.md`. Never run `git add`, `git commit` or `git push`.

## Environments and secrets
- Order: local, then staging, then production. Production only when Hitesh says so; production deploy scripts refuse to run without `STENMONT_CONFIRM_PRODUCTION=yes`.
- Secrets live in Cloudflare (`wrangler secret`), per environment. Never in code, config or git. `.env` is a local paste area (gitignored); `.env.example` lists names only.

## Access
- Cloudflare, full account access: `wrangler` (OAuth) and the `cloudflare-api` and `cloudflare-docs` MCP servers in `.mcp.json`. Handle Cloudflare tasks directly.
- Skills in `.claude/skills/`: Whitechain, World (IDKit, Agent Pass), ENS, Superpowers.
