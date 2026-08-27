/**
 * Derive "who is working on what" from live swarm state. Pure client-side:
 * `typing` comes from turn_start events, `stage` + `tasks` are persisted, so
 * the build indicator even survives a mid-run page reload (typing does not).
 */

import type { WireTask } from "@/lib/events";
import { cliAgentById } from "@/lib/agents";

export type Activity = {
  agent: string;
  verb: string;
  target?: string;
  via?: string;
};

type ActivityInput = {
  running: boolean;
  stage?: string;
  typing: string | null;
  tasks: WireTask[];
};

const VERBS: Record<string, Record<string, string>> = {
  intake: { nova: "kicking off the mission", atlas: "routing the mission" },
  spec: { nova: "writing the spec" },
  plan: { vector: "drafting the architecture" },
  critique: { sentinel: "raising concerns", vector: "weighing the concerns", nova: "revising the spec" },
  build: { forge: "building" },
  review: { sentinel: "reviewing the workspace", forge: "applying review fixes" },
  ship: { probe: "writing the QA checklist", atlas: "writing the ship report" },
};

export function activityOf({ running, stage, typing, tasks }: ActivityInput): Activity | null {
  if (!running) return null;
  const building = tasks.find((t) => t.status === "building");

  if (typing) {
    const verb = VERBS[stage ?? ""]?.[typing];
    if (!verb) return null;
    const act: Activity = { agent: typing, verb };
    if (stage === "build" && building) {
      act.target = building.title;
      if (building.harness && building.harness !== "hive") act.via = `via ${cliAgentById(building.harness).name} bridge`;
    }
    return act;
  }

  // Reload mid-build: typing is gone, but the building task is persisted.
  if (stage === "build" && building) {
    const act: Activity = { agent: building.assignee || "forge", verb: "building", target: building.title };
    if (building.harness && building.harness !== "hive") act.via = `via ${cliAgentById(building.harness).name} bridge`;
    return act;
  }
  return null;
}

/** One-line label for the feed's typing row: "Forge is building 'X'…" */
export function activityLabel(act: Activity): string {
  const target = act.target ? ` “${act.target}”` : "";
  if (act.verb === "building") return `is building${target}`;
  return `is ${act.verb}`;
}
