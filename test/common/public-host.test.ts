import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertPublicUrl,
  isBlockedAddress,
} from '../../src/common/net/public-host';

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254', // cloud metadata
    '100.64.0.1',
    '::1',
    'fd00::1',
    '::ffff:127.0.0.1', // IPv4-mapped loopback
    'not-an-ip',
  ])('blocks %s', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(['8.8.8.8', '172.32.0.1', '2606:4700:4700::1111'])(
    'allows %s',
    (address) => {
      expect(isBlockedAddress(address)).toBe(false);
    },
  );
});

describe('assertPublicUrl', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('always refuses non-http schemes', async () => {
    await expect(assertPublicUrl('file:///etc/passwd')).rejects.toThrow(/http/);
    await expect(assertPublicUrl('not a url')).rejects.toThrow(/not valid/);
  });

  it('lets local development reach localhost', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    await expect(
      assertPublicUrl('http://127.0.0.1:11434/v1'),
    ).resolves.toBeUndefined();
  });

  it('refuses private targets in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    await expect(assertPublicUrl('http://127.0.0.1:11434/v1')).rejects.toThrow(
      /private/,
    );
    await expect(assertPublicUrl('http://localhost:1234/v1')).rejects.toThrow(
      /private/,
    );
    await expect(
      assertPublicUrl('http://169.254.169.254/latest/meta-data'),
    ).rejects.toThrow(/private/);
    await expect(assertPublicUrl('http://[::1]:8080')).rejects.toThrow(/private/);
    await expect(assertPublicUrl('https://8.8.8.8/v1')).resolves.toBeUndefined();
  });

  it('can be switched off for self-hosted installs', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ALLOW_PRIVATE_HOSTS', 'true');
    await expect(
      assertPublicUrl('http://10.0.0.5:11434/v1'),
    ).resolves.toBeUndefined();
  });
});
