import { HARNESSES, type HarnessDef, type HarnessId, isKnownHarnessId } from "@/lib/harnesses";

/** Hivemind Native — construction, critique, review, QA always land here. */
export const HOME_HARNESS: HarnessId = "hive";

/** Tasks that must stay on Hivemind (construct / critique / test path). */
export function staysHome(title: string): boolean {
  return /scaffold|schema|data layer|compose|surface|landing|wire|edge cases|polish|test|qa|review/i.test(title);
}

export function workerPool(preferred: string, customs: HarnessDef[] = []): HarnessId[] {
  const ext = HARNESSES.filter((h) => h.id !== HOME_HARNESS).map((h) => h.id);
  const pref = isKnownHarnessId(preferred, customs) && preferred !== HOME_HARNESS ? preferred : null;
  if (!pref) return ext;
  return [pref, ...ext.filter((id) => id !== pref)];
}

/** Atlas routing: implementation fans out; everything else returns home. */
export function routeTasks(titles: string[], preferred: string, customs: HarnessDef[] = []): HarnessId[] {
  const workers = workerPool(preferred, customs);
  let w = 0;
  return titles.map((title) => {
    if (staysHome(title) || workers.length === 0) return HOME_HARNESS;
    const id = workers[w % workers.length] ?? HOME_HARNESS;
    w += 1;
    return id;
  });
}
