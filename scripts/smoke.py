#!/usr/bin/env python3
"""Hivemind end-to-end smoke test. Run via `npm run smoke` (server is started for you).

Hivemind runs live models only — there is no simulation engine. Every mission
here runs against a local mock provider; failure paths must HALT, never fake.

Covers, against a live server + Postgres:
  1. Run-loop protocol: exactly one `end` per SSE connection, reconnect on
     beat-budget rollover, approval gate, mission reaches done, DB parked after.
  2. Harness pack: ship writes all six guidance files with real content.
  3. No-sim honesty: nothing in a mission carries meta.simulated; generated
     artifacts are tagged generated; harness-pack and imported files are not.
  4. Import missions: existing imported files are kept, not scaffolded over.
  5. Pause parks the mission (running=false, no phantom ACTIVE).
  6. Failure honesty: with an unreachable provider endpoint the swarm HALTS
     with the real error, points at `doctor`, and fakes nothing.
  7. `doctor` diagnoses and fixes: flags the dead key, probes the good one,
     auto-rewrites a retired codex slug.
  8. `cli hive "…"` queues a real task (at the approval gate and by reopening
     a shipped mission); Vector extracts the task list from the model.
  9. Codex (ChatGPT) device login: the mock serves the device-auth endpoints,
     the PKCE token exchange, the model catalog, and the Responses-API SSE —
     a full mission runs end-to-end over the codex provider.

Uses a dedicated smoke user (smoke@local.test); missions are deleted on exit.
Requires Postgres to be up (npm run db:up).
"""
import http.client
import io
import json
import re
import sys
import threading
import time
import zipfile
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 3100
HOST = "127.0.0.1"
COOKIE = None
FAILURES = []


def check(name, ok, detail=""):
    print(("PASS  " if ok else "FAIL  ") + name + (f"  [{detail}]" if detail else ""), flush=True)
    if not ok:
        FAILURES.append(name)


def req(method, path, body=None):
    headers = {"content-type": "application/json"}
    if COOKIE:
        headers["cookie"] = COOKIE
    c = http.client.HTTPConnection(HOST, PORT, timeout=90)
    payload = json.dumps(body) if body is not None else None
    c.request(method, path, payload, headers)
    r = c.getresponse()
    set_cookie = r.getheader("set-cookie")
    data = r.read()
    c.close()
    return r.status, set_cookie, data


def stream(pid, timeout=120):
    """Consume one SSE connection; return (end_count, last_end, term_lines, saw_live_mode)."""
    c = http.client.HTTPConnection(HOST, PORT, timeout=timeout)
    c.request("GET", f"/api/projects/{pid}/events", headers={"cookie": COOKIE})
    r = c.getresponse()
    buf = b""  # bytes until a full frame — multi-byte chars can span read() chunks
    ends = 0
    last = None
    terms = []
    live_mode = False
    while True:
        chunk = r.read(4096)
        if not chunk:
            break
        buf += chunk
        while b"\n\n" in buf:
            raw, buf = buf.split(b"\n\n", 1)
            for line in raw.decode("utf-8", "replace").split("\n"):
                if not line.startswith("data:"):
                    continue
                try:
                    obj = json.loads(line[5:])
                except json.JSONDecodeError:
                    continue
                if obj.get("type") == "end":
                    ends += 1
                    last = obj
                elif obj.get("type") == "term":
                    terms += [l.get("text", "") for l in obj.get("lines", [])]
                elif obj.get("type") == "mode" and obj.get("llm"):
                    live_mode = True
    c.close()
    return ends, last, terms, live_mode


def drive_to_done(pid, label):
    """Act like the browser client: reconnect on running:true, approve at the gate."""
    connections = 0
    saw_rollover = False
    all_terms = []
    live_mode = False
    for _ in range(25):
        ends, last, terms, live = stream(pid)
        connections += 1
        all_terms += terms
        live_mode = live_mode or live
        check(f"{label}: conn#{connections} exactly one end event", ends == 1, f"got {ends}")
        if last is None:
            break
        if last.get("stage") == "done":
            return connections, saw_rollover, True, all_terms, live_mode
        if last.get("awaiting"):
            req("POST", f"/api/projects/{pid}/action", {"type": "approve"})
        elif last.get("running"):
            saw_rollover = True
        else:
            break
    return connections, saw_rollover, False, all_terms, live_mode


def get_project(pid):
    status, _, data = req("GET", f"/api/projects/{pid}")
    return status, json.loads(data)


AGENT_AUTHORS = {"nova", "vector", "sentinel", "probe", "forge"}
PACK_PATHS = {"HARNESS.md", "AGENTS.md", "CLAUDE.md", "GEMINI.md", "CONVENTIONS.md", ".cursor/rules/project.mdc"}


def check_no_sim(pj, label):
    """Live-only honesty: nothing in a mission may carry meta.simulated."""
    sim_msgs = [m["id"] for m in pj["messages"] if m.get("meta", {}).get("simulated") is True]
    check(f"{label}: no simulated stand-in messages", not sim_msgs, f"ids: {sim_msgs[:5]}")
    sim_arts = [a["id"] for a in pj["artifacts"] if a.get("meta", {}).get("simulated") is True]
    check(f"{label}: no simulated artifacts", not sim_arts, f"ids: {sim_arts[:5]}")


# ---- sign in ----------------------------------------------------------
status, set_cookie, _ = req(
    "POST", "/api/auth/session", {"name": "Smoke Test", "email": "smoke@local.test"}
)
COOKIE = set_cookie.split(";")[0]
check("sign-in issues session cookie", status == 200 and "hive_session" in COOKIE)

# Phase 5: the seeded demo mission is labeled as a fixture.
status, _, data = req("GET", "/api/projects")
missions0 = json.loads(data)["projects"]
lumen = next((m for m in missions0 if m["name"] == "Lumen Board"), None)
check("seeded demo mission is marked fixture", lumen is not None and lumen.get("fixture") is True)

# ---- mock provider (all missions run live against it) -----------------
MOCK_PORT = 3123  # fixed: smoke.sh points CODEX_AUTH_ISSUER/CODEX_API_BASE here

MOCK_TASKS = json.dumps(
    [
        {"title": "Wire the photon catalog schema", "detail": "Add the photon table and seed script in src/lib/db.ts."},
        {"title": "Build the photon browse panel", "detail": "Service, endpoint and panel for browsing photons."},
        {"title": "Harden the intake guards", "detail": "Rate limits and server-side validation on photon mutations."},
    ]
)


MOCK_BUILD = (
    "FILE: src/lib/photon-catalog.ts\n"
    "```ts\n"
    "export const PHOTON_LEDGER_SEED = [\n"
    '  { id: "p1", rarity: "mythic", name: "Aurora Spike" },\n'
    "];\n"
    "\n"
    "export function listPhotons() {\n"
    "  return PHOTON_LEDGER_SEED;\n"
    "}\n"
    "```\n"
    "\n"
    "SUMMARY: Photon catalog with rarity tiers wired for the browse panel."
)

REVIEW_APPROVED = "# Code review\n\n## Findings\n- No blocking issues; the work holds up.\n\nVERDICT: APPROVED"
QA_STATIC = "# QA checklist — static review\n\n- Paths reviewed against the schema.\n- Nothing was executed — static review only."
MOCK_SHIP = (
    "# Ship report\n\n"
    "## What shipped\n- The workspace files listed above.\n\n"
    "## How it was verified\nStatic review only — nothing was executed.\n\n"
    "## Next moves\n- Wire a real provider key and re-run the mission.\n"
)


def review_changes(flagged: str) -> str:
    return (
        "# Code review\n"
        "\n"
        "## Findings\n"
        f"1. **[P1] `{flagged}`** — reads have no pagination; the table will grow unbounded.\n"
        "2. **[P3]** README would benefit from a summary table.\n"
        "\n"
        f"VERDICT: CHANGES: {flagged}"
    )


def pick_model_text(msg: str) -> str:
    if "Re-read the fixed files" in msg:
        return review_changes(MockLLM.last_flagged) if MockLLM.reject_twice else REVIEW_APPROVED
    if "Review the workspace files" in msg:
        # Flag the first real workspace file named in the digest.
        m = re.search(r"^- ([A-Za-z0-9._/-]+\.[A-Za-z0-9]+)\s*$", msg, re.M)
        MockLLM.last_flagged = m.group(1) if m else "src/lib/photon-catalog.ts"
        return review_changes(MockLLM.last_flagged)
    flagged = re.search(r"code review flagged `([^`]+)`", msg)
    if flagged:
        path = flagged.group(1)
        return (
            f"FILE: {path}\n```ts\nexport const PHOTON_LEDGER_SEED = [];\n"
            "export const fixed = true; // review findings applied\n```\n\n"
            "SUMMARY: Applied the review findings."
        )
    if "already exists in the imported codebase" in msg:
        keep = re.search(r"maps to (\S+),", msg)
        kept_path = keep.group(1) if keep else "the existing file"
        return f"I read {kept_path} and kept it as-is — it already covers the task. No rewrite needed."
    if "Pony Repo" in msg and "Implement this task completely" in msg:
        return "FILE: src/lib/db.ts\n```ts\nexport const db = { kept: true };\n```\n\nSUMMARY: Kept the existing db module."
    if "Rewrite the product spec" in msg:
        return "# Spec v2\n\n## Vision\nRevised per the commander's notes — everything else holds.\n"
    if "Implement this task completely" in msg:
        return MOCK_BUILD
    if "JSON array" in msg:
        return MOCK_TASKS
    if "Write the ship report" in msg:
        return MOCK_SHIP
    if "verification checklist" in msg.lower():
        return QA_STATIC
    if "architecture" in msg.lower():
        return "# Architecture v1\n\n## Stack\nNext.js + Postgres.\n\n## Shape\nbrowser → api → postgres."
    return "Copy. Live model on the wire."


def sse_openai(text: str) -> str:
    chunks = [text[i : i + 40] for i in range(0, len(text), 40)]
    return (
        "".join(f"data: {json.dumps({'choices': [{'delta': {'content': c}}]})}\n\n" for c in chunks)
        + "data: [DONE]\n\n"
    )


def sse_responses(text: str) -> str:
    """Codex Responses-API framing: typed events with output_text deltas."""
    events = ['data: {"type":"response.created"}']
    for c in [text[i : i + 40] for i in range(0, len(text), 40)]:
        events.append(f"data: {json.dumps({'type': 'response.output_text.delta', 'delta': c})}")
    events.append('data: {"type":"response.completed"}')
    return "\n\n".join(events) + "\n\n"


class MockLLM(BaseHTTPRequestHandler):
    """Auth + chat endpoints for every provider the smoke run exercises. Offline-safe."""

    reject_twice = False  # set True to make Sentinel's re-read keep objecting
    last_flagged = "src/lib/photon-catalog.ts"
    hits: dict[str, int] = {}
    codex_rejections = 0  # 400s served for the retired model slug

    def _send(self, status: int, ctype: str, payload: bytes) -> None:
        self.send_response(status)
        self.send_header("content-type", ctype)
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def send_json(self, obj, status: int = 200) -> None:
        self._send(status, "application/json", json.dumps(obj).encode())

    def send_sse(self, body: str) -> None:
        self._send(200, "text/event-stream", body.encode())

    def do_GET(self) -> None:
        MockLLM.hits["GET " + self.path.split("?")[0]] = MockLLM.hits.get("GET " + self.path.split("?")[0], 0) + 1
        if self.path.split("?")[0].endswith("/models"):
            # Codex catalog shape: slug/display_name/priority/visibility,
            # with a hidden retired slug that must be filtered out.
            self.send_json(
                {
                    "data": [
                        {"slug": "gpt-5.6-sol", "display_name": "GPT-5.6 Sol", "priority": 1, "visibility": "list"},
                        {"slug": "gpt-5.6-terra", "display_name": "GPT-5.6 Terra", "priority": 2, "visibility": "list"},
                        {"slug": "gpt-5.6-luna", "display_name": "GPT-5.6 Luna", "priority": 3, "visibility": "list"},
                        {"slug": "gpt-5.5", "display_name": "GPT-5.5", "priority": 7, "visibility": "list"},
                        {"slug": "gpt-5.1-codex", "display_name": "GPT-5.1 Codex", "priority": 99, "visibility": "hide"},
                    ]
                }
            )
            return
        self.send_json({})

    def do_POST(self) -> None:
        path = self.path.split("?")[0]
        MockLLM.hits["POST " + path] = MockLLM.hits.get("POST " + path, 0) + 1
        # Codex device-auth endpoints (CODEX_AUTH_ISSUER points here).
        if path.endswith("/api/accounts/deviceauth/usercode"):
            self.send_json({"device_auth_id": "dev-smoke-1", "user_code": "SMOKE-CODE", "interval": "1"})
            return
        if path.endswith("/api/accounts/deviceauth/token"):
            self.send_json({"authorization_code": "ac-smoke", "code_challenge": "cc", "code_verifier": "cv-smoke"})
            return
        if path.endswith("/oauth/token"):
            self.send_json(
                {"id_token": "idt", "access_token": "codex-access-smoke", "refresh_token": "codex-refresh-smoke", "expires_in": 3600}
            )
            return
        length = int(self.headers.get("content-length", 0))
        body = json.loads(self.rfile.read(length) or b"{}")
        # Chat-completions bodies carry `messages`; Responses bodies carry `input`.
        if isinstance(body.get("input"), list) and body["input"]:
            msg = str((body["input"][-1].get("content") or [{}])[-1].get("text", ""))
        else:
            msg = str((body.get("messages") or [{}])[-1].get("content", ""))
        text = pick_model_text(msg)
        if path.endswith("/responses"):
            # Mirror production: ChatGPT-account tokens demand store=false.
            if body.get("store") is not False:
                self.send_json({"detail": "Store must be set to false"}, status=400)
                return
            # Mirror production: the codex backend rejects token caps.
            if "max_output_tokens" in body:
                self.send_json({"detail": "Unsupported parameter: max_output_tokens"}, status=400)
                return
            # Mirror production: the retired slug is rejected with the real
            # 400 so the smoke exercises the app's fallback ladder.
            if body.get("model") == "gpt-5.1-codex":
                MockLLM.codex_rejections += 1
                self.send_json(
                    {"detail": "The 'gpt-5.1-codex' model is not supported when using Codex with a ChatGPT account."},
                    status=400,
                )
                return
            self.send_sse(sse_responses(text))
        else:
            self.send_sse(sse_openai(text))

    def log_message(self, *args):
        pass


mock_server = HTTPServer(("127.0.0.1", MOCK_PORT), MockLLM)
threading.Thread(target=mock_server.serve_forever, daemon=True).start()

status, _, data = req(
    "POST",
    "/api/keys",
    {
        "provider": "custom",
        "label": "smoke-mock-llm",
        "baseUrl": f"http://127.0.0.1:{MOCK_PORT}",
        "secret": "mock",
        "model": "mock-model",
        "isDefault": True,
    },
)
mock_key_id = json.loads(data).get("id")
check("mock provider key saved", bool(mock_key_id))

# ---- mission 1: pasted spec, full lifecycle (live against the mock) ---
status, _, data = req(
    "POST",
    "/api/projects",
    {
        "name": "Ponyfield Notes",
        "spec": 'Build "Ponyfield Notes" — a fast local notes app with markdown notes, tag filtering, and full-text search.',
    },
)
pid1 = json.loads(data)["id"]
conns, rolled_over, done, _, live1 = drive_to_done(pid1, "mission1")
check("mission1 reaches done", done, f"{conns} connections")
check("mission1 needed a reconnect (run-loop rollover works)", rolled_over and conns >= 2, f"{conns} conns")
check("mission1 ran in live mode", live1 is True)

status, pj1 = get_project(pid1)
check("mission1 DB stage is done", pj1["project"]["stage"] == "done")
check("mission1 DB running is false after done", pj1["project"]["running"] is False)
titles1 = [t["title"] for t in pj1["tasks"]]
check("mission1 plan comes from the live model (not a template)", titles1 and titles1[0] == "Wire the photon catalog schema", str(titles1[:2]))
paths = [a.get("path") for a in pj1["artifacts"] if a["type"] == "file"]
missing = PACK_PATHS - set(paths)
check("ship writes the full 6-file harness pack", not missing, f"missing: {sorted(missing)}" if missing else "all six present")
cl = next((a for a in pj1["artifacts"] if a.get("path") == "CLAUDE.md"), None)
check("CLAUDE.md pack file has real content", bool(cl) and "Ponyfield" in cl["content"] and len(cl["content"]) > 200)

# Phase 4: export — python's zipfile parses it and verifies every CRC.
status, _, zbytes1 = req("GET", f"/api/projects/{pid1}/export")
check("export returns a zip", status == 200 and zbytes1[:2] == b"PK")
try:
    z1 = zipfile.ZipFile(io.BytesIO(zbytes1))
    names1 = z1.namelist()
    crc1 = z1.testzip()
except Exception as e:  # noqa: BLE001
    z1, names1, crc1 = None, [], str(e)
check("zip integrity (CRC verified on every entry)", crc1 is None, str(crc1))
expected_tree = {
    "HARNESS.md", "AGENTS.md", "CLAUDE.md", "GEMINI.md", "CONVENTIONS.md", ".cursor/rules/project.mdc",
    "src/lib/photon-catalog.ts", "docs/spec.md", "docs/architecture.md", "docs/review.md", "docs/qa-checklist.md", "docs/ship-report.md",
}
check("export contains the full tree (pack, code, docs)", expected_tree <= set(names1), str(sorted(expected_tree - set(names1))))
check("export carries NO SIMULATED.md (nothing was faked)", "SIMULATED.md" not in names1)
check_no_sim(pj1, "mission1")

# ---- mission 2: imported folder ---------------------------------------
files = [
    {"path": "ponyrepo/README.md", "content": "# Pony Repo\nA tiny existing app that already works.\n"},
    {"path": "ponyrepo/package.json", "content": json.dumps({"name": "pony-repo", "description": "existing local app"}, indent=2)},
    {"path": "ponyrepo/src/lib/db.ts", "content": "export const db = {\n  query: (q: string): unknown[] => [],\n};\n"},
    {"path": "ponyrepo/src/app/page.tsx", "content": "export default function Home() {\n  return <main>pony repo</main>;\n}\n"},
]
spec2 = (
    "Pony Repo — existing project imported into Hivemind.\n\nA tiny existing app that already works.\n\n"
    "## Tree (imported)\n- `README.md`\n- `package.json`\n- `src/lib/db.ts`\n- `src/app/page.tsx`\n\n"
    "Continue from this codebase. Do not scaffold a blank app."
)
status, _, data = req("POST", "/api/projects", {"name": "Pony Repo", "spec": spec2, "files": files})
pid2 = json.loads(data)["id"]
conns2, _, done2, _, _ = drive_to_done(pid2, "mission2")
check("mission2 reaches done", done2, f"{conns2} connections")

status, pj2 = get_project(pid2)
db_arts = [a for a in pj2["artifacts"] if a.get("path") == "src/lib/db.ts"]
check("imported src/lib/db.ts kept (exactly one artifact)", len(db_arts) == 1, f"{len(db_arts)} artifacts")
check(
    "imported src/lib/db.ts content untouched",
    len(db_arts) == 1 and db_arts[0]["content"] == files[2]["content"],
)
check(
    "imported file NOT tagged simulated (it is real user content)",
    len(db_arts) == 1 and db_arts[0].get("meta", {}).get("simulated") is not True,
)
msgs2 = " ".join(m["content"] for m in pj2["messages"])
check("forge reports keeping the imported file", "src/lib/db.ts" in msgs2 and ("kept" in msgs2 or "already covers" in msgs2))

# ---- mission 3: pause parks the mission -------------------------------
status, _, data = req(
    "POST", "/api/projects", {"name": "Pause Probe", "spec": 'Build "Pause Probe" — a habit tracker with streaks and weekly digests.'}
)
pid3 = json.loads(data)["id"]
result = {}


def run_stream():
    result["r"] = stream(pid3, timeout=90)


t = threading.Thread(target=run_stream)
t.start()
time.sleep(4)
req("POST", f"/api/projects/{pid3}/action", {"type": "pause"})
t.join(95)
status, pj3 = get_project(pid3)
check("pause parks mission (DB running=false)", pj3["project"]["running"] is False, f"stage={pj3['project']['stage']}")
last3 = result.get("r", (None, None, [], False))[1]
check("pause end event says running=false", last3 is not None and last3.get("running") is False, str(last3))

# ---- mission 4: a dead provider HALTS the run — nothing is faked --------
status, _, data = req(
    "POST",
    "/api/keys",
    {
        "provider": "custom",
        "label": "smoke-unreachable",
        "baseUrl": "http://127.0.0.1:9",  # closed port — instant connection refusal, offline-safe
        "secret": "not-a-real-key",
        "model": "smoke-model",
        "isDefault": True,
    },
)
bad_key_id = json.loads(data).get("id")
check("unreachable key saved", bool(bad_key_id))

status, _, data = req(
    "POST", "/api/projects", {"name": "Failure Probe", "spec": 'Build "Failure Probe" — a recipe box with import and shopping lists.'}
)
pid4 = json.loads(data)["id"]
conns4, _, done4, terms4, live4 = drive_to_done(pid4, "mission4")
check("mission4 does NOT reach done — the run halts on the dead provider", not done4, f"{conns4} connections")
check("mission4 ran in live mode (key configured)", live4 is True)
check(
    "terminal surfaces the live call failure",
    any("live call failed" in t for t in terms4),
    f"{sum('live call failed' in t for t in terms4)} failure lines",
)
status, pj4 = get_project(pid4)
check("halted mission is parked at intake", pj4["project"]["stage"] == "intake" and pj4["project"]["running"] is False, pj4["project"]["stage"])
no_provider = [m["id"] for m in pj4["messages"] if m.get("meta", {}).get("provider")]
check("no message claims a provider (the call never succeeded)", not no_provider, f"ids: {no_provider[:5]}")
check_no_sim(pj4, "mission4")
msgs4 = " ".join(m["content"] for m in pj4["messages"])
check("halt message names the failure and points at doctor", "could not run" in msgs4 and "doctor" in msgs4)

# ---- doctor: diagnose + fix -------------------------------------------
status, _, data = req(
    "POST",
    "/api/keys",
    {
        "provider": "codex",
        "label": "smoke-codex-retired",
        "baseUrl": f"http://127.0.0.1:{MOCK_PORT}",  # mocked codex responses base
        "secret": "mock-codex",
        "model": "gpt-5.1-codex",  # retired slug — doctor must rewrite it
        "isDefault": False,
    },
)
retired_key_id = json.loads(data).get("id")
check("retired-slug codex key saved", bool(retired_key_id))

status, _, data = req("POST", f"/api/projects/{pid4}/cli", {"command": "doctor"})
doc_lines = [l.get("text", "") for l in json.loads(data).get("lines", [])]
doc_text = "\n".join(doc_lines)
check("doctor flags the unreachable key", any("smoke-unreachable" in t for t in doc_lines if t.startswith("✗")), doc_text[:200])
check("doctor probes the mock key live", any("smoke-mock-llm" in t and "live" in t for t in doc_lines if t.startswith("✓")), doc_text[:200])
check("doctor auto-fixes the retired codex slug", any("gpt-5.6-sol" in t and "retired" in t for t in doc_lines), doc_text[:300])
check("doctor probes the fixed codex key through the mock", any("smoke-codex-retired" in t for t in doc_lines if t.startswith("✓")), doc_text[:300])
check("doctor summary counts the problems", any("problem" in t for t in doc_lines), doc_text[-160:])
status, _, data = req("GET", "/api/keys")
retired_row = next((k for k in json.loads(data)["keys"] if k["id"] == retired_key_id), None)
check("retired slug rewritten in the DB", retired_row is not None and retired_row["model"] == "gpt-5.6-sol", str(retired_row))
if bad_key_id:
    req("PATCH", "/api/keys", {"id": bad_key_id, "model": ""})  # out of the ready set before the mock run
if mock_key_id:
    req("PATCH", "/api/keys", {"id": mock_key_id, "isDefault": True})  # the unreachable key stole the default flag

# ---- custom bridges: add, probe, switch, doctor recognizes --------------
status, _, data = req("GET", "/api/settings")
settings_before = json.loads(data).get("data", {})
with_bridge = list(settings_before.get("customHarnesses", [])) + [
    {"name": "Smoke Bridge", "bin": "smoke-bridge-nope", "template": 'smoke-bridge-nope "{task}"'}
]
status, _, data = req("POST", "/api/settings", {"customHarnesses": with_bridge})
check("custom bridge saved to settings", status == 200)
status, _, data = req("GET", "/api/harnesses")
hrows = json.loads(data).get("harnesses", [])
sbridge = next((h for h in hrows if h.get("name") == "Smoke Bridge"), None)
check(
    "custom bridge listed with a PATH probe",
    sbridge is not None and sbridge.get("custom") is True and sbridge.get("installed") is False,
    str(sbridge),
)
status, _, data = req("POST", f"/api/projects/{pid4}/cli", {"command": "harness use c-smoke-bridge"})
check(
    "harness use accepts the custom id",
    any("bridge switched" in l.get("text", "") for l in json.loads(data).get("lines", [])),
    str(json.loads(data).get("lines")),
)
status, _, data = req("POST", f"/api/projects/{pid4}/cli", {"command": "doctor"})
doc_lines = [l.get("text", "") for l in json.loads(data).get("lines", [])]
check(
    "doctor reports the custom bridge off PATH",
    any("Smoke Bridge" in t and "off PATH" in t for t in doc_lines),
    str([t for t in doc_lines if "Smoke" in t]),
)
req("POST", "/api/settings", {"customHarnesses": settings_before.get("customHarnesses", [])})  # restore

# ---- mission 5: `cli hive "task"` queues real work ---------------------
status, _, data = req(
    "POST", "/api/projects", {"name": "Cli Queue", "spec": 'Build "Cli Queue" — a reading queue with shareable lists.'}
)
pid5 = json.loads(data)["id"]
ends5, last5, _, _ = stream(pid5)
check("mission5 first connection reaches the approval gate", last5 is not None and last5.get("awaiting") is True, str(last5))

status, _, data = req("POST", f"/api/projects/{pid5}/cli", {"command": 'cli hive "Add an export button"'})
cli_res = json.loads(data)
check("cli hive queues the task", any("task queued" in l.get("text", "") for l in cli_res.get("lines", [])), str(cli_res.get("lines")))
check("cli hive response carries the wake flag", cli_res.get("wake") is True)
status, pj5 = get_project(pid5)
check("queued task is on the board as backlog", any(t["title"] == "Add an export button" and t["status"] == "backlog" for t in pj5["tasks"]))

# Phase 5: a chatty "yes, but…" is a revision, not an approval; "approve" approves.
req("POST", f"/api/projects/{pid5}/messages", {"content": "yes I like it but change the name to Queue Plus"})
_, last5b, _, _ = stream(pid5)
check("chatty yes-but message does not approve the gate", last5b is not None and last5b.get("awaiting") is True, str(last5b))
req("POST", f"/api/projects/{pid5}/messages", {"content": "approve"})

conns5, _, done5, _, _ = drive_to_done(pid5, "mission5")
check("mission5 reaches done with the queued task", done5)
status, pj5 = get_project(pid5)
check("queued task got built", any(t["title"] == "Add an export button" and t["status"] == "done" for t in pj5["tasks"]))

# queue on a SHIPPED mission reopens it at build
status, _, data = req("POST", f"/api/projects/{pid5}/cli", {"command": 'cli hive "Add a dark mode toggle"'})
reopen_res = json.loads(data)
check("cli hive on a done mission wakes and reports reopen", reopen_res.get("wake") is True and any("reopened" in l.get("text", "") for l in reopen_res.get("lines", [])))
status, pj5 = get_project(pid5)
check("done mission reopened at build", pj5["project"]["stage"] == "build")
conns5b, _, done5b, _, _ = drive_to_done(pid5, "mission5b")
check("mission5 ships again after the extension", done5b)
status, pj5 = get_project(pid5)
check("extension task got built", any(t["title"] == "Add a dark mode toggle" and t["status"] == "done" for t in pj5["tasks"]))

# ---- mission 6: Photon Ledger full lifecycle on the mock provider ---

status, _, data = req(
    "POST", "/api/projects", {"name": "Photon Ledger", "spec": 'Build "Photon Ledger" — a catalog of collectible photons with rarity tiers.'}
)
pid6 = json.loads(data)["id"]
conns6, _, done6, _, live6 = drive_to_done(pid6, "mission6")
check("mission6 reaches done on the mock provider", done6, f"{conns6} connections")
check("mission6 runs live", live6 is True)

status, pj6 = get_project(pid6)
titles6 = [t["title"] for t in pj6["tasks"]]
check("live mode extracted the model's task list", "Wire the photon catalog schema" in titles6, str(titles6))
check("live plan is not the template", "Scaffold schema & data layer" not in titles6)
spec6 = next((a for a in pj6["artifacts"] if a["type"] == "spec"), None)
arch6 = next((a for a in pj6["artifacts"] if a["type"] == "arch"), None)
check("live spec artifact is not tagged simulated", spec6 is not None and spec6.get("meta", {}).get("simulated") is not True)
check("live arch artifact is not tagged simulated", arch6 is not None and arch6.get("meta", {}).get("simulated") is not True)
live_msgs = [m for m in pj6["messages"] if m["author"] in AGENT_AUTHORS and m.get("meta", {}).get("provider")]
check("live specialist messages carry provider meta", len(live_msgs) >= 3, f"{len(live_msgs)} live messages")
cat = next((a for a in pj6["artifacts"] if a.get("path") == "src/lib/photon-catalog.ts"), None)
check(
    "live build wrote the model's file",
    cat is not None and "PHOTON_LEDGER_SEED" in cat["content"],
    f"version v{cat['version'] if cat else '?'}",
)
check(
    "generated file is tagged generated, not simulated",
    cat is not None and cat.get("meta", {}).get("generated") is True and cat.get("meta", {}).get("simulated") is not True,
)
sim_files6 = [a.get("path") for a in pj6["artifacts"] if a["type"] == "file" and a.get("meta", {}).get("simulated")]
check("no live-mode file is tagged simulated", not sim_files6, str(sim_files6))
check("same-path regenerations bump the version", cat is not None and cat["version"] >= 2)

# Phase 3: live review with a parsed verdict, one fix round, honest QA.
gen_reviews6 = [a for a in pj6["artifacts"] if a["type"] == "review" and a.get("meta", {}).get("generated")]
check("live review artifact is model-generated", len(gen_reviews6) >= 1)
msgs6 = " ".join(m["content"] for m in pj6["messages"])
check("sentinel requested changes on the flagged file", "changes requested" in msgs6)
check("review fix bumped the flagged file", cat is not None and cat["version"] >= 4, f"v{cat['version'] if cat else '?'}")
check("re-read approved the fix", "fixes hold" in msgs6 or "APPROVED" in msgs6)
probe_msgs6 = [m["content"] for m in pj6["messages"] if m["author"] == "probe"] + [
    a["content"] for a in pj6["artifacts"] if a["title"].startswith("QA checklist")
]
check(
    "QA discloses that nothing was executed",
    any("nothing was executed" in c.lower() for c in probe_msgs6),
)

# Phase 4: honest ship report + live export.
ship6 = next((a for a in pj6["artifacts"] if a["type"] == "ship"), None)
check("live ship report is model-generated", ship6 is not None and ship6.get("meta", {}).get("generated") is True)
status, _, zbytes6 = req("GET", f"/api/projects/{pid6}/export")
check("live export returns a zip", status == 200 and zbytes6[:2] == b"PK")
try:
    z6 = zipfile.ZipFile(io.BytesIO(zbytes6))
    names6 = z6.namelist()
    crc6 = z6.testzip()
except Exception as e:  # noqa: BLE001
    z6, names6, crc6 = None, [], str(e)
check("live zip integrity (CRC verified)", crc6 is None, str(crc6))
check("live export carries no SIMULATED.md", "SIMULATED.md" not in names6)
check(
    "live export includes generated code + docs",
    "src/lib/photon-catalog.ts" in names6 and "docs/ship-report.md" in names6,
    str(names6[:8]),
)
check(
    "exported file content is the latest version",
    z6 is not None and "PHOTON_LEDGER_SEED" in z6.read("src/lib/photon-catalog.ts").decode(),
)
check(
    "exported ship report states static verification",
    z6 is not None and "static review" in z6.read("docs/ship-report.md").decode().lower(),
)

# Phase 3: an unresolved review parks the mission — only the operator can ship.
MockLLM.reject_twice = True
status, _, data = req(
    "POST", "/api/projects", {"name": "Override Probe", "spec": 'Build "Override Probe" — a warranty tracker with expiry alerts.'}
)
pid7 = json.loads(data)["id"]
conns7, _, done7, _, _ = drive_to_done(pid7, "mission7")
check("unresolved review parks the mission", done7 is False)
status, pj7 = get_project(pid7)
check("parked at review, not running", pj7["project"]["stage"] == "review" and pj7["project"]["running"] is False)
check("atlas explains the override path", any("did not approve" in m["content"] for m in pj7["messages"]))

status, _, data = req("POST", f"/api/projects/{pid7}/messages", {"content": "ship anyway"})
check("ship-anyway message wakes the swarm", json.loads(data).get("wake") is True)
conns7b, _, done7b, _, _ = drive_to_done(pid7, "mission7b")
check("operator override ships the mission", done7b, f"{conns7b} connections")
status, pj7 = get_project(pid7)
check("override is on the record", any("shipped over the review objection" in m["content"] for m in pj7["messages"]))
MockLLM.reject_twice = False

# ---- mission 8: Codex (ChatGPT) device login end-to-end ----------------
# CODEX_AUTH_ISSUER/CODEX_API_BASE point at the mock, so the whole flow —
# device code, PKCE exchange, token storage, model listing, Responses-API
# streaming — runs offline.
status, _, data = req("POST", "/api/keys/oauth/codex/start", None)
start_res = json.loads(data)
check("codex device login starts", bool(start_res.get("device_code")) and bool(start_res.get("user_code")), str(start_res))

status, _, data = req(
    "POST",
    "/api/keys/oauth/codex/poll",
    {"device_code": start_res.get("device_code"), "user_code": start_res.get("user_code")},
)
poll_res = json.loads(data)
check("codex poll exchanges tokens and creates the key", poll_res.get("status") == "ok" and bool(poll_res.get("id")), str(poll_res))
codex_key_id = poll_res.get("id")

status, _, data = req("GET", "/api/keys")
codex_key = next((k for k in json.loads(data)["keys"] if k["id"] == codex_key_id), None)
check(
    "codex key stored as oauth with the overridden responses base",
    codex_key is not None and codex_key["provider"] == "codex" and codex_key["authKind"] == "oauth" and f"127.0.0.1:{MOCK_PORT}" in (codex_key["baseUrl"] or ""),
    str(codex_key),
)

# Leave the key on a retired slug — the exact broken state the backend
# 400s on — so the run proves the fallback ladder rescues it.
status, _, data = req("PATCH", "/api/keys", {"id": codex_key_id, "model": "gpt-5.1-codex"})
status, _, data = req("GET", f"/api/keys/{codex_key_id}/models")
models_res = json.loads(data)
chat_ids = [m["id"] for m in models_res.get("chat", [])]
check(
    "codex model catalog lists current models",
    "gpt-5.6-sol" in chat_ids,
    str(models_res)[:120],
)
check("codex catalog filters hidden/retired slugs", "gpt-5.1-codex" not in chat_ids, str(chat_ids))
check("codex catalog recommends the default model", models_res.get("recommended") == "gpt-5.6-sol", str(models_res.get("recommended")))

status, _, data = req(
    "POST", "/api/projects", {"name": "Codex Probe", "spec": 'Build "Codex Probe" — a changelog viewer with filters and RSS.'}
)
pid8 = json.loads(data)["id"]
conns8, _, done8, _, live8 = drive_to_done(pid8, "mission8")
check("mission8 reaches done on codex (Responses API)", done8, f"{conns8} connections")
check("mission8 runs live via codex", live8 is True)
status, pj8 = get_project(pid8)
codex_msgs = [m for m in pj8["messages"] if m.get("meta", {}).get("provider") == "codex"]
check("messages carry the codex provider", len(codex_msgs) >= 3, f"{len(codex_msgs)} codex messages")
check(
    "engine actually hit the /responses endpoint",
    MockLLM.hits.get("POST /responses", 0) > 0 and MockLLM.hits.get("POST /api/accounts/deviceauth/token", 0) > 0,
    str({k: v for k, v in MockLLM.hits.items() if "deviceauth" in k or "responses" in k}),
)
check(
    "retired model got the 400 and the ladder rescued the mission",
    MockLLM.codex_rejections > 0 and done8,
    f"{MockLLM.codex_rejections} rejections",
)
mock_server.shutdown()

# ---- cleanup ----------------------------------------------------------
for pid in (pid1, pid2, pid3, pid4, pid5, pid6, pid7, pid8):
    req("DELETE", f"/api/projects/{pid}")
for key_id in (mock_key_id, codex_key_id, retired_key_id):
    if key_id:
        req("PATCH", "/api/keys", {"id": key_id, "model": ""})  # take it out of the ready set

print()
if FAILURES:
    print(f"{len(FAILURES)} FAILURE(S): {FAILURES}")
    sys.exit(1)
print("ALL CHECKS PASSED")
