# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is the operator of this machine: a technical person who pastes one spec, watches a specialist swarm work, interrupts when needed, approves the plan, and keeps every API key. Demo sign-in personas (Avery Chen, Sam Okafor, June Park) are not the audience.

There is no confirmed teammate, client, or multi-operator audience.

## Product Purpose

Hivemind turns a single product spec into a planned, critiqued, implemented, and reviewed application. Success is a mission that reaches **ship** with artifacts (spec, architecture, files, review) assembled in this workspace — not a chat transcript that dies in another tool.

The operator keeps the keys and the final say. The swarm does not self-certify.

## Positioning

One spec in, a shipped app out — the swarm room is the hub.

Specialist agents (Atlas, Nova, Vector, Forge, Sentinel, Probe) plan, debate, and implement in a live group chat. Atlas may dispatch implementation to coding harnesses (Claude Code, Grok, Cursor, Codex, Aider, Gemini, OpenCode). Construction, critique, review, and QA always return to Hivemind Native. A neighboring IDE, chat model, or single CLI could not truthfully claim that return path.

## Operating Context

- Local web app (Next.js) against Postgres. Typical run: Apple `container`s `hivemind-pg` and `hivemind-web`, or `npm run dev` against the same database.
- Operator signs in to a local session, then works in **Studio** (mission list) and the **workspace** (group chat + workbench + optional CLI).
- **Settings** is where keys, per-agent models, and preferred harness are assigned.
- Stages: intake → spec → plan → critique → approve → build → review → ship → done. Approve is the human gate before build.
- `swarm-cli` is the in-app terminal bridge (`harness use`, `cli hive "task"`, status).
- Ship writes a multi-harness pack into the mission output so other CLIs can pick the repo up.

## Capabilities and Constraints

Confirmed:

- BYOK chat (OpenAI-compatible and Anthropic messages) plus first-class providers; xAI device-code OAuth, OpenRouter PKCE, and Codex (ChatGPT) device login where wired.
- Per-agent route: each roster role can use a different saved key and model. Empty route uses the default key.
- Simulation engine runs when no key+model is selected; live mode only after a model is chosen.
- Atlas harness routing is dispatch-and-return, not spawning those CLIs from Next as a first-class process.
- Artifacts live in the workbench: spec, architecture/tasks, generated files, review.
- A mission can start from a pasted spec or from an imported local folder (files land in the workbench; init runs the swarm against that tree).
- Product name is **Hivemind**. Missions are the unit of work (API/DB still say `projects`). The operator is addressed as **Commander** in swarm copy.

Constraints:

- Personal tool only. Do not frame this as a company, team, or multi-tenant product.
- No IdP story. Sign-in is a local session (name + email as a handle on this machine). Do not add SSO, SAML, OIDC, work-email, or company-account copy.
- Keys stay in this workspace database and are used server-side only.
- Do not invent customers, pricing, licensing, hosted SLAs, or production-readiness claims.
- Platform is web (responsive). Native apps are not in scope.

Undecided (do not invent):

- Whether PATH-detected harnesses will ever be spawned for real instead of simulated dispatch.
- Any accessibility standard beyond what the current UI already implements.

## Brand Commitments

- Name: **Hivemind**. Wordmark lowercase `hivemind` in chrome; glyph `◈`.
- Voice: operator-to-operator, short, no company theater, no marketing manifesto about “teams” or “your organization.”
- Binding product phrases already in the product: “One spec in. A shipped app out.” / Hivemind is home base / you keep the keys and the final say.
- Visual system is recorded separately in `DESIGN.md` and is not restated here.

## Evidence on Hand

- Runnable app with fixture mission content (e.g. Lumen Board). That content is demonstration data, not a customer case study.
- No testimonials, press, logos (beyond the glyph), or third-party proof. Future work must not fabricate them.

## Product Principles

1. **Operator in the loop.** The human pastes the spec, approves the plan, and holds the keys. Agents propose; they do not close the gate.
2. **Hivemind is home base.** Work may fan out to models and harnesses; construction, critique, review, and QA return here.
3. **One spec is the source.** Everything the swarm produces traces to that mission brief — not to a hidden prompt or a side channel.
4. **Personal, local, honest.** Talk like a tool on this machine. Do not impersonate a team product, an IdP, or a hosted company.
5. **Different jobs, different brains.** Routing exists so the swarm is not six copies of one model — but routing is in service of the hub, not the other way around.
