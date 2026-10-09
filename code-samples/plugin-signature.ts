/**
 * Plugin signing and integrity (ADR section 8).
 *
 * Closed system: only plugins signed by the publisher key are allowed to run.
 * The signature (Ed25519) covers the plugin bundle (index.js); the checksum
 * (sha256) verifies the integrity of the downloaded .bbplugin. The private key
 * lives outside the repository.
 *
 * Pure module on node:crypto — tested in isolation.
 */

import {
  createHash,
  sign as cryptoSign,
  verify as cryptoVerify,
  generateKeyPairSync,
  type KeyLike,
} from 'node:crypto';

/** sha256 hex — for .bbplugin integrity (the checksum in the registry). */
export function sha256Hex(data: Buffer | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Signs the bundle with the publisher's private key. Returns a base64 signature. */
export function signBundle(bundle: Buffer | Uint8Array, privateKeyPem: string): string {
  // Ed25519: the digest algorithm is null (signs the data itself).
  return cryptoSign(null, Buffer.from(bundle), privateKeyPem).toString('base64');
}

/** Verifies the bundle's signature with the publisher's public key. */
export function verifyBundle(
  bundle: Buffer | Uint8Array,
  signatureB64: string,
  publicKey: KeyLike,
): boolean {
  try {
    return cryptoVerify(null, Buffer.from(bundle), publicKey, Buffer.from(signatureB64, 'base64'));
  } catch {
    return false;
  }
}

export interface VerifyResult {
  ok: boolean;
  reason?: string;
}

/**
 * Full plugin verification before loading:
 *  - the bundle signature is valid for the trusted publisher;
 *  - (optional) the bundle sha256 matches the expected checksum from the registry.
 */
export function verifyPlugin(params: {
  bundle: Buffer;
  signatureB64: string | undefined;
  publisherPublicKey: KeyLike;
  expectedSha256?: string;
}): VerifyResult {
  const { bundle, signatureB64, publisherPublicKey, expectedSha256 } = params;
  if (!signatureB64) return { ok: false, reason: 'NO_SIGNATURE' };
  if (expectedSha256) {
    const actual = sha256Hex(bundle);
    if (actual !== expectedSha256) return { ok: false, reason: 'CHECKSUM_MISMATCH' };
  }
  if (!verifyBundle(bundle, signatureB64, publisherPublicKey)) {
    return { ok: false, reason: 'SIGNATURE_INVALID' };
  }
  return { ok: true };
}

/** Generates a publisher key pair (for dev/CI and offline signing). */
export function generatePublisherKeyPair(): { publicKeyPem: string; privateKeyPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}
