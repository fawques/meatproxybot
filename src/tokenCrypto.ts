import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const PREFIX = "v1:";

export class TokenDecryptionError extends Error {
  override name = "TokenDecryptionError";
}

/**
 * Decodes INSTALLATION_ENCRYPTION_KEY: 32 random bytes, base64-encoded
 * (`openssl rand -base64 32`). Throws on anything else, so a truncated or
 * hex key is caught at startup rather than silently weakening encryption.
 */
export function parseEncryptionKey(value: string): Buffer {
  const key = Buffer.from(value, "base64");
  if (key.length !== KEY_BYTES || key.toString("base64") !== value) {
    throw new Error(
      `INSTALLATION_ENCRYPTION_KEY must be 32 bytes encoded as base64 (generate one with \`openssl rand -base64 32\`)`,
    );
  }
  return key;
}

export function isEncryptedToken(stored: string): boolean {
  return stored.startsWith(PREFIX);
}

/**
 * Encrypts a token with AES-256-GCM and a random IV, as
 * `v1:<iv>:<tag>:<ciphertext>` (each part base64). The version prefix leaves
 * room to rotate the key or format later.
 */
export function encryptToken(token: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

/**
 * Reverses encryptToken. Throws a TokenDecryptionError when the value is
 * malformed or was encrypted with a different key: GCM authentication fails
 * instead of returning garbage that Slack would later reject.
 */
export function decryptToken(stored: string, key: Buffer): string {
  const parts = isEncryptedToken(stored)
    ? stored.slice(PREFIX.length).split(":")
    : [];
  if (parts.length !== 3) {
    throw new TokenDecryptionError(
      "Stored bot token is not in the v1:<iv>:<tag>:<ciphertext> format",
    );
  }
  const [iv, tag, ciphertext] = parts.map((part) =>
    Buffer.from(part, "base64"),
  ) as [Buffer, Buffer, Buffer];
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new TokenDecryptionError(
      "Could not decrypt the stored bot token: INSTALLATION_ENCRYPTION_KEY is not the key it was encrypted with, or the value is corrupt",
    );
  }
}
