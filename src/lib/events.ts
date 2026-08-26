/** Wire types shared between the server orchestrator and the browser. */

export type WireMessage = {
  id: number;
  author: string;
  kind: string;
  content: string;
  meta: Record<string, unknown>;
  createdAt: string;
};

export type WireArtifact = {
  id: number;
  type: string;
  title: string;
  path: string | null;
  content: string;
  version: number;
  createdBy: string;
  meta: Record<string, unknown>;
  createdAt: string;
};

export type WireTask = {
  id: number;
  title: string;
  detail: string;
  assignee: string;
  harness: string;
  status: string;
  sort: number;
};

export type TermLine = { text: string; tone?: "ok" | "warn" | "err" | "dim" | "cmd" };

export type SwarmEvent =
  | { type: "turn_start"; agent: string }
  | { type: "delta"; agent: string; text: string }
  | { type: "message"; msg: WireMessage }
  | { type: "artifact"; artifact: WireArtifact }
  | { type: "tasks"; tasks: WireTask[] }
  | { type: "stage"; stage: string }
  | { type: "term"; lines: TermLine[] }
  | { type: "mode"; llm: boolean }
  | { type: "end"; stage: string; running: boolean; awaiting: boolean };
