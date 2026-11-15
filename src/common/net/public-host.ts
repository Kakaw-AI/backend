import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { BadRequestException } from '@nestjs/common';

// Users hand us URLs (a custom LLM endpoint) and this server fetches them from
// inside the deployment network. Without a guard that is a way to reach
// everything the network can: the app database, other containers, the cloud
// metadata address. The agent carries the same list for the hosts it dials.

const blocked = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // carrier-grade NAT (also Tailscale)
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, cloud metadata
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(address, prefix, 'ipv4');
}
for (const [address, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96], // NAT64
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const) {
  blocked.addSubnet(address, prefix, 'ipv6');
}

/**
 * On in production only: local development has to reach localhost. A
 * self-hosted install that keeps its model server on a private network opts
 * out with ALLOW_PRIVATE_HOSTS=true.
 */
function guardEnabled(): boolean {
  return (
    process.env.NODE_ENV === 'production' &&
    process.env.ALLOW_PRIVATE_HOSTS !== 'true'
  );
}

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) {
    return true;
  }
  // BlockList matches IPv4-mapped IPv6 (::ffff:10.0.0.1) against the IPv4 rules.
  return blocked.check(address, family === 6 ? 'ipv6' : 'ipv4');
}

/**
 * Rejects a URL that is not http(s) or that points at a private address.
 *
 * ponytail: this resolves the name and the later fetch resolves it again, so a
 * DNS answer that changes in between slips through. The only caller makes one
 * GET and never returns the body on success; pin the resolved address with an
 * undici dispatcher if a caller ever does more with the response.
 */
export async function assertPublicUrl(value: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BadRequestException('The URL is not valid.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BadRequestException('Only http and https URLs are allowed.');
  }
  if (!guardEnabled()) {
    return;
  }

  // URL keeps the brackets on IPv6 literals; net.isIP wants them gone.
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host)
    ? [host]
    : (await lookup(host, { all: true }).catch(() => [])).map(
        (entry) => entry.address,
      );

  if (addresses.length === 0 || addresses.some(isBlockedAddress)) {
    throw new BadRequestException(
      `"${host}" is a private or internal address and cannot be used here. The server has to be reachable from the public internet.`,
    );
  }
}
