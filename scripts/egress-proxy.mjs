#!/usr/bin/env node
/**
 * Minimal CONNECT proxy for the Hivemind container.
 *
 * Cloudflare WARP in TunnelOnly mode RSTs kernel-forwarded (NAT) flows, so
 * containers on the vmnet bridge cannot egress directly while WARP is
 * connected — only host-originated sockets pass. This proxy runs on the host,
 * binds the vmnet gateway IP, and forwards container traffic as ordinary
 * host-originated connections. CONNECT-only, port 443; the gateway IP is not
 * reachable from the physical LAN, so the audience is the container bridge.
 */
import net from "node:net";

const BIND = process.env.HIVEMIND_PROXY_BIND || "192.168.64.1";
const PORT = Number(process.env.HIVEMIND_PROXY_PORT || 8118);
const IDLE_MS = 10 * 60_000;

const server = net.createServer((client) => {
  client.setTimeout(IDLE_MS);
  client.once("data", (chunk) => {
    const head = chunk.toString("latin1");
    const line = head.split("\r\n")[0] ?? "";
    const m = /^CONNECT (\S+):(\d+) HTTP\/1\.[01]$/.exec(line);
    if (!m || m[2] !== "443") {
      client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    const [, host, port] = m;
    const upstream = net.connect({ host, port: Number(port) }, () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      // Any bytes past the request head arrived with the first chunk.
      const rest = chunk.subarray(Buffer.byteLength(head, "latin1"));
      if (rest.length) upstream.write(rest);
      upstream.setTimeout(IDLE_MS);
      client.pipe(upstream);
      upstream.pipe(client);
    });
    const fail = () => {
      client.destroy();
      upstream.destroy();
    };
    upstream.on("error", fail);
    client.on("error", fail);
    upstream.on("timeout", fail);
    client.on("timeout", fail);
    client.on("close", () => upstream.destroy());
    upstream.on("close", () => client.destroy());
  });
});

server.on("error", (e) => {
  console.error(`egress-proxy: ${e.message}`);
  process.exit(1);
});

server.listen(PORT, BIND, () => {
  console.log(`egress-proxy: CONNECT :443 via ${BIND}:${PORT}`);
});
