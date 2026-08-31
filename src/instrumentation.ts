/**
 * Server bootstrap. When HIVEMIND_EGRESS_PROXY is set (app-up.sh points it at
 * the host-side CONNECT proxy on the vmnet gateway), route every outbound
 * fetch through it: WARP in TunnelOnly mode RSTs kernel-forwarded NAT flows,
 * so direct container egress fails while host-originated flows pass. Node 22
 * global fetch ignores proxy env vars, hence the swap to undici's fetch with
 * a ProxyAgent dispatcher.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const proxyUrl = process.env.HIVEMIND_EGRESS_PROXY;
  if (!proxyUrl) return;
  const { fetch: undiciFetch, ProxyAgent } = await import("undici");
  const dispatcher = new ProxyAgent(proxyUrl);
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    undiciFetch(input as never, { ...init, dispatcher } as never)) as unknown as typeof fetch;
}
