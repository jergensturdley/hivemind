/** Drop model scratchpads so commanders see the spoken turn, not the chain of thought. */
export function stripThink(text: string): string {
  return text
    .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, "")
    .replace(/<think\b[^>]*>[\s\S]*$/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Stream-safe filter: holds partial tags and swallows everything inside <think>…</think>. */
export function createThinkFilter(): { push: (chunk: string) => string; flush: () => string } {
  let inThink = false;
  let hold = "";

  const push = (chunk: string): string => {
    hold += chunk;
    let out = "";
    for (;;) {
      if (inThink) {
        const close = hold.search(/<\/think>/i);
        if (close < 0) {
          if (hold.length > 24) hold = hold.slice(-24);
          return out;
        }
        hold = hold.slice(close + "</think>".length);
        inThink = false;
        continue;
      }
      const open = hold.search(/<think\b/i);
      if (open < 0) {
        const partial = hold.search(/<[tT](?:h(?:i(?:n(?:k)?)?)?)?$/);
        if (partial >= 0) {
          out += hold.slice(0, partial);
          hold = hold.slice(partial);
          return out;
        }
        out += hold;
        hold = "";
        return out;
      }
      const gt = hold.indexOf(">", open);
      if (gt < 0) {
        out += hold.slice(0, open);
        hold = hold.slice(open);
        return out;
      }
      out += hold.slice(0, open);
      hold = hold.slice(gt + 1);
      inThink = true;
    }
  };

  const flush = (): string => (inThink ? "" : stripThink(hold));

  return { push, flush };
}
