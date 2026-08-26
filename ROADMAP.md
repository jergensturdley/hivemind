# Hivemind — Delivery Roadmap: Real Output, Honest Swarm

Source: the 2026-08-25 completeness review plus the post-review fix pass. The run-loop,
harness pack, lint, import-digest, and dead-code items are **done**. This roadmap covers
everything still scripted, simulated, or promised-but-missing.

## Principles (from PRODUCT.md, binding for every phase)

1. **The swarm does not self-certify.** No stage may print PASS/APPROVED/✅ that no agent
   actually earned. Simulated content must be labeled as simulated, always.
2. **Sim mode stays first-class.** No key → full demo works. Live mode (key + model
   selected) must be genuinely model-driven, never template theater.
3. **Operator in the loop.** Approve stays the gate; nothing auto-executes on disk or
   spawns processes without an explicit decision point below.
4. **Reuse over rewrite** (the "ponytail" rule). Extend `spokenTurn`, `insertArtifact`,
   `routeTasks`, the existing combobox, and the e2e harness; no second HTTP stack, no new
   heavy deps.

---

## The lie inventory (what is still fake today)

| # | Promise (where) | Current behavior | Code |
|---|---|---|---|
| L1 | Swarm implements the product | Build-stage files are hardcoded templates (`undefined as never` placeholders) in **both** sim and live mode; no LLM ever writes a file | `engine.ts` build case → `sim.ts genCodeForTask` |
| L2 | Plan reflects the spec | Task list is always the same 5–6 generic tasks from `genPlanTasks`, even with keys configured; imported repos get "Scaffold schema" tasks for a tree that exists | `engine.ts` plan case |
| L3 | Review is real | Sentinel always finds the same P1; the "fix" appends a comment line to the first file; approval is a fixed string | `engine.ts` review case, `sim.ts genReview` |
| L4 | "The swarm does not self-certify" | QA checklist is a static all-PASS doc ("0 P0 / 0 P1", "Lighthouse ≥ 90") that nothing verified | `engine.ts` ship case → `sim.ts genChecklist` |
| L5 | Live model speaks | A failed live LLM call silently swaps in simulated content; operator can't tell | `engine.ts spokenTurn` catch, `speakWithFallback` |
| L6 | External harnesses "return patches" | Patches are attributed to Claude Code/Grok/etc. that never ran | `engine.ts` build case (`dest.id` as author) |
| L7 | `cli hive "task"` in the terminal bridge | Prints the command, refuses to act, doesn't even queue the task | `cli/route.ts` case `"cli"`; PRODUCT.md:33 |
| L8 | "A shipped app out" | Mission output exists only as artifact rows in Postgres; nothing exports a runnable tree | whole app; PRODUCT.md:17,23 |
| L9 | OAuth flows are durable | xAI device-login pending state is an in-process `Map`; server restart kills it | `lib/oauth-pending.ts` |
| L10 | DESIGN.md is binding | Audit fails: sub-44px targets in phone workbench, missing focus rings, one native `<select>`, off-palette syntax colors, iOS-zoom textarea | see Phase 6 |

---

## Decision points (operator call needed before the marked phases)

- **D1 — Do external harnesses ever actually run?** (blocks the "real dispatch" part of
  Phase 2; Phase 2 is designed to work with the default answer "no").
  Default per PRODUCT.md "Undecided": **no spawning** — Forge generates natively in live
  mode; harness routing stays a label; `cli` prints commands for self-hosters.
- **D2 — May QA execute real commands** (typecheck/tests against exported output)?
  Default: **no execution** — Probe does model-read verification with an explicit
  "nothing was executed" disclosure. Execution is the upgrade path.
- **D3 — Import/export symmetry: write back to disk?** Import reads a folder; export
  (Phase 4) writes a zip download by default. Writing back into the original folder
  needs D3 approval.
- **D4 — Encrypt `api_keys` at rest?** (Phase 5, optional). Local single-user tool;
  current stance is documented "treat as credential material".

---

## Phase 0 — Honesty baseline  *(S · ~1 day · no dependencies)* — ✅ shipped 2026-08-25

`meta.simulated` tagging, failure term lines, sim chips in chat + Files, honest
dispatch copy, and `npm run smoke` are live; acceptance verified by
`scripts/smoke.py` (including the bad-key failure path via an unreachable endpoint).
Template files, review/QA/ship documents stay tagged `simulated: true` until
Phases 2–4 replace their generators.

Nothing new gets built here; what exists stops lying. Do this first so every later phase
inherits the labeling.

- **0.1 Simulated tag.** `meta.simulated: true` on every message/artifact whose content
  came from `sim.ts` (fallbacks, template files, static checklists). `persistSpoken` and
  `insertArtifact` gain an explicit flag instead of inferring from `provider` presence.
- **0.2 No silent LLM failure.** `spokenTurn`'s `catch { content = "" }` and
  `speakWithFallback`: on live-call failure emit a term line
  (`live call failed (<provider>) — simulated stand-in`) and tag the message simulated.
  Same for `resolveCfg`'s swallowed settings-read error.
- **0.3 UI badge.** SIM chip on simulated messages in the chat (reuse the existing
  SIM/KEYS/LIVE badge styles); workbench Files tab shows a "simulated" marker on
  template-generated files.
- **0.4 Reword live-mode dispatch copy.** When `llm` mode is on and a task routes to an
  external harness, the Atlas line says the bridge is a routing label and Forge writes
  natively — retire "patch returned from <harness>" attribution (fixes L6 wording now,
  ahead of Phase 2's real fix).
- **Acceptance:** with a key configured and the key made invalid mid-run, the operator
  sees the failure and every affected message is visibly simulated; zero untagged sim
  content in `messages.meta`.

## Phase 1 — Live planning  *(M · 1–2 days · after Phase 0)* — ✅ shipped 2026-08-25

Live task extraction (silent structured turn + defensive JSON parse), import-aware
delta instructions, and a real `cli hive "task"` (queues + wakes, reopens shipped
missions) are in; verified by `scripts/smoke.py` missions 5/6, including a mock
OpenAI-compatible provider that proves the extracted plan reaches the board.

- **1.1 Real task extraction.** After Vector's (already-live) architecture doc, add a
  second structured turn: "emit 4–8 tasks as JSON `[{title, detail}]` derived from the
  spec/architecture/imported tree". Parse defensively (fenced JSON → fallback to
  `genPlanTasks` tagged simulated). Validate shape; cap count/length.
- **1.2 Import-aware deltas.** For imported missions the prompt includes the codebase
  digest (already wired in `spokenTurn`) and instructs delta tasks ("extend/modify
  existing"), never "scaffold". The keep-existing guard from the fix pass continues to
  protect colliding paths.
- **1.3 `cli hive "task"` becomes real** (L7, no spawning needed): the command queues a
  task row (`status: backlog`, routed via `routeTasks`) + wakes the swarm — it is the
  in-product way to add work from the terminal. External ids keep the print-and-refuse
  message until D1.
- **Acceptance:** live mission task lists differ per spec and reference actual
  capabilities/imported files; `cli hive "add an export button"` shows up in the Plan tab
  and gets built; sim mode unchanged.

## Phase 2 — Live construction  *(L · 3–5 days · after Phase 1)* — ✅ shipped 2026-08-25 (2.5 pending D1)

`forgeTurn` generates real per-task files in live mode (silent structured turn,
FILE-block output, one retry), with context budgets (arch digest + capped
prior-file excerpts, guidance pack excluded), honest attribution
(`createdBy: forge`, `meta.generated`/`meta.dispatchedTo`), version-bumped
writes when a path already exists (which makes imported-file modification real),
and failure handling that leaves the task visibly on the board (⚠ marker) with
the requeue path spelled out. Verified by smoke missions 4 (bad key → failures
surface, nothing faked) and 6 (mock provider → model-written files land with
`generated` meta and version bumps). 2.5 (real spawning) stays unscheduled
until D1 is approved.

The core of L1/L6. In live mode, Forge writes the code; sim mode keeps templates
(tagged).

- **2.1 Per-task generation.** New `forgeTurn(p, task, priorFiles)`: streaming
  `spokenTurn`-style call whose instruction takes the task, the architecture doc digest,
  the import digest, and paths+excerpts of files already written this mission, and
  returns one file as `path` + fenced content (or small JSON manifest for multi-file;
  cap 3 files/task). Parse, validate non-empty/plausible, `insertArtifact` with real
  `path`.
- **2.2 Context budget.** Excerpt caps (reuse `codebaseDigest` constants), skip files >
  N KB, total prompt ceiling; drop oldest prior-file excerpts first. No new deps.
- **2.3 Honest attribution.** Artifacts: `createdBy: "forge"`, `meta.dispatchedTo:
  <harness>` when routed externally, never authoring credit to a harness that didn't run.
  Chat copy: "routed to <harness> · generated natively by Forge" until D1.
- **2.4 Failure handling.** Empty/unparseable generation → retry once with a tighter
  prompt → surface error in chat, leave task `backlog`, mission keeps running (no fake
  "✓ landed").
- **2.5 (D1 only) Real spawn path.** If D1 is ever approved: `detect-harness` + spawn
  `harness.template` in the mission workspace dir (created by Phase 4 export), stream
  stdout to the terminal, import resulting files as artifacts. Behind a setting, off by
  default. **Not scheduled until the operator says yes.**
- **Acceptance:** live mission produces model-written files that reference the real spec
  and, for imports, edit the real tree paths; a forced bad key surfaces errors instead of
  templates; sim missions identical to today (plus tags).

## Phase 3 — Live review & QA  *(M · 2–3 days · after Phase 2)* — ✅ shipped 2026-08-25 (3.3 pending D2)

Sentinel now reads the actual files and must end with a parseable
`VERDICT: APPROVED | CHANGES: <paths>` token; CHANGES triggers exactly one
Forge fix round (reusing the FILE-block writer, version-bumped) plus one
re-read. Unresolved reviews park at `review` with the operator holding the only
ship key (`ship anyway` override, logged on the record). Probe's checklist is
model-generated in live mode and always discloses "static review — nothing was
executed"; the fabricated PASS/Lighthouse lines are gone from the sim template
too. Verified by smoke missions 6 (fix→approve) and 7 (park→override).

- **3.1 Real review.** Sentinel turn with the actual file set (paths + capped contents,
  latest versions) → findings markdown with file/line references and an explicit verdict
  token (`VERDICT: APPROVED` / `CHANGES: <files>`). Persist as the review artifact.
- **3.2 Real fix loop.** On CHANGES: one Forge turn per named file applying the finding
  (new artifact version), then one Sentinel re-read. Max one round — then the operator
  decides (approve anyway / revise). Retire the scripted P1 + comment-append fix in live
  mode; keep both in sim, tagged.
- **3.3 Honest QA.** Probe turn generates the verification checklist from the actual
  files and always discloses "static review — nothing was executed". No PASS verdict
  unless… (D2) execution is approved and wired; otherwise the checklist ships as
  *checks performed: static*, full stop. Delete the fabricated Lighthouse/metrics lines.
- **Acceptance:** live review text names real files and real issues (or genuinely
  approves); ship is gated on the parsed verdict; no output anywhere claims verification
  that didn't happen.

## Phase 4 — Ship truth & export  *(M · 2–3 days · after Phase 3)* — ✅ shipped 2026-08-25 (4.3 pending D3)

Ship reports are model-written in live mode from the real stats (files,
done/failed tasks, paths) with an explicit no-invented-verification instruction;
sim keeps the honest template, tagged. `GET /api/projects/[id]/export` streams a
zip built by a zero-dependency store-mode writer (`src/lib/zip.ts`): latest file
artifacts at their paths, docs in `docs/`, and a `SIMULATED.md` notice whenever
any exported file is simulated. Download actions live in the workspace header
and on Studio cards. Verified by smoke: Python's `zipfile` parses both exports
and verifies every CRC; sim exports carry the notice, live exports don't. 4.3
(folder write-back) stays parked until D3 is approved.

Delivers L8 literally: "One spec in. A shipped app out."

- **4.1 Honest ship report.** Replace `genShipSummary`'s canned sections in live mode
  with a model summary grounded in the real stats + artifact list; keep the stats row
  (already real). Sim keeps the template, tagged.
- **4.2 Export endpoint.** `GET /api/projects/[id]/export` streams a zip: latest-version
  `file` artifacts at their paths, harness pack at root, spec/arch/review in `docs/`.
  Zero-dep zip via `node:zlib` store-mode (or a single tiny dep if store-mode proves
  brittle — decide then). Studio/workspace gets a **Download** action.
- **4.3 Folder write-back (needs D3).** If approved: write export into the import source
  folder (paths already sanitized by `import-folder.ts` rules).
- **Acceptance:** a live mission's export opens as a real tree with the pack in place;
  sim exports carry a top-level `SIMULATED.md` note; download works from both Studio and
  the workspace.

## Phase 5 — Durability & hardening  *(S/M · 1–2 days · independent, any time)* — ✅ shipped 2026-08-25 (5.4 pending D4)

The xAI device-login flow is persisted in `userSettings` (restart-safe, expiry
kept); the seeded Lumen Board mission carries `ctx.fixture` and shows a **demo**
chip in Studio; approvals are tightened — strong words count anywhere, weak
words ("yes", "ok", "looks good") only when the message is nothing but the
approval, so "yes, but change X" is a revision. Verified by smoke (fixture
marker + the yes-but/approve gate test). 5.4 (key encryption at rest) stays
parked until D4 is approved.

- **5.1 Persist xAI device flow (L9).** Move `oauth-pending.ts` state into a
  `oauth_pending` table (or `userSettings` key) with expiry; poll survives restarts.
- **5.2 Fixture labeling.** "Demo" chip on the seeded Lumen Board mission (PRODUCT.md
  already declares it demonstration data — make the UI say so).
- **5.3 Approve regex tightening.** `APPROVE_RE`'s `yes\b|wfm|looks good` only counts at
  `awaiting_approval` (it already only fires there — keep, but require a word boundary
  on "approve" family in live mode to avoid accidental approvals from chatty messages).
- **5.4 (D4) Key encryption at rest.** AES-GCM with a local key file; reversible because
  keys must be sent to providers. Only if the operator opts in.
- **Acceptance:** restart mid-device-login still completes the poll; demo mission is
  visibly demo; no accidental approvals.

## Phase 6 — Design conformance  *(S/M · 1–2 days · independent)* — ✅ shipped 2026-08-25

All audit FAILs closed and re-verified by an independent design audit pass:
44px targets (`min-h-11 lg:min-h-0`) on workbench file list/version
pills/ModelPicker/provider/template chips and KeyPicker; the honey focus ring
lives as a shared `cls.focus` recipe applied to every interactive control
(terminal toggle, sign-out, key remove, workbench tabs/files/versions,
ArtifactChip, combobox options, HarnessGrid); the native `<select>` is gone,
replaced by a KeyPicker combobox; syntax colors are palette tokens
(`--color-code-str`/`--color-code-num`); the import textarea keeps phones at
16px; the toast honors the bottom safe-area; `animate-spin` yields under
reduced motion; zero hardcoded hex outside `globals.css`.

Close every FAIL from the design audit against DESIGN.md:

- 44px hit targets below `lg` for: workbench file list + version pills
  (`Workbench.tsx:133,210`), ModelPicker rows, provider chips, template chips.
- Honey focus ring (2px, offset) on: terminal toggle, sign-out, key remove, workbench
  tabs/files/versions, ArtifactChip, template chips, combobox options; add offset to the
  three ring sites missing it.
- Replace the native `<select>` in per-agent routing (`SettingsClient.tsx:597`) with the
  existing filtered-combobox pattern.
- Fold the two hardcoded syntax colors (`ui.tsx:157,159`) into the palette as
  `--color-code-str` / `--color-code-num` tokens.
- Fix the import textarea's conflicting `text-[12px]` (iOS zoom risk); add bottom
  safe-area to the fixed toast; disable `animate-spin` under `prefers-reduced-motion`.
- **Acceptance:** re-run the design audit — every rule PASS or N-A.

## Cross-cutting — keep the lights honest (start Phase 0, grow each phase)

- **Productize the e2e harness.** The throwaway Python client from the fix pass becomes
  `scripts/smoke.py` + `npm run smoke`: spins up `next start` on a scratch port, drives a
  mission to `done`, asserts: one `end` per connection, reconnect-on-rollover, gate
  behavior, pack completeness, pause parking, import keep-existing. Extend per phase
  (e.g., Phase 2: live-mode failure surfacing with a deliberately bad key).
- **Unit tests where they pay rent.** `node:test` (no new deps) for `parseSpec`,
  `sanitizeImportFiles`, `stripThink`/`createThinkFilter`, task-JSON parsing, export
  path sanitization.
- **Docs stay true.** Each phase updates the line it makes honest (e.g., Phase 2 rewrites
  the CLAUDE.md harness paragraph if D1 defaults hold). No doc may describe behavior the
  app doesn't have — that's how this backlog happened.

## Suggested order & effort

| Phase | Blocks | Effort | Ship value |
|---|---|---|---|
| 0 Honesty baseline | 1–4 | ~1 d | trust |
| 1 Live planning | 2 | 1–2 d | real plans, `cli` works |
| 2 Live construction | 3 | 3–5 d | the product keeps its core promise |
| 3 Live review & QA | 4 | 2–3 d | no self-certification |
| 4 Ship truth & export | — | 2–3 d | literal "shipped app out" |
| 5 Durability | — | 1–2 d | anytime |
| 6 Design conformance | — | 1–2 d | anytime |

Total ≈ 12–18 focused days. Phases 5 and 6 are parallelizable with anything; 0→1→2→3→4
is the critical path.

## Explicitly not in scope (PRODUCT.md constraints)

Real harness spawning unless D1 is approved · test/command execution unless D2 ·
write-back to source folders unless D3 · multi-tenant/team/IdP/hosted anything · native
apps · fabricated proof (testimonials, metrics, SLAs) — ever.
