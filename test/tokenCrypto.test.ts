import { describe, expect, it } from "vitest";
import {
  TokenDecryptionError,
  decryptToken,
  encryptToken,
  isEncryptedToken,
  parseEncryptionKey,
} from "../src/tokenCrypto.js";

const key = Buffer.alloc(32, 1);
const otherKey = Buffer.alloc(32, 2);

describe("tokenCrypto", () => {
  it("round-trips a token through v1:<iv>:<tag>:<ciphertext>", () => {
    const stored = encryptToken("xoxb-secret", key);
    expect(stored).toMatch(
      /^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/,
    );
    expect(stored).not.toContain("xoxb-");
    expect(isEncryptedToken(stored)).toBe(true);
    expect(decryptToken(stored, key)).toBe("xoxb-secret");
  });

  it("uses a random IV, so the same token encrypts differently", () => {
    expect(encryptToken("xoxb-secret", key)).not.toBe(
      encryptToken("xoxb-secret", key),
    );
  });

  it("treats a token without the v1: prefix as plain text", () => {
    expect(isEncryptedToken("xoxb-secret")).toBe(false);
  });

  it("fails loudly when decrypting with the wrong key", () => {
    const stored = encryptToken("xoxb-secret", key);
    expect(() => decryptToken(stored, otherKey)).toThrow(TokenDecryptionError);
    expect(() => decryptToken(stored, otherKey)).toThrow(
      /INSTALLATION_ENCRYPTION_KEY is not the key it was encrypted with/,
    );
  });

  it("rejects a tampered ciphertext", () => {
    const [prefix, iv, tag, ciphertext] = encryptToken(
      "xoxb-secret",
      key,
    ).split(":") as [string, string, string, string];
    const flipped = Buffer.from(ciphertext, "base64");
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    const tampered = [prefix, iv, tag, flipped.toString("base64")].join(":");
    expect(() => decryptToken(tampered, key)).toThrow(TokenDecryptionError);
  });

  it("rejects a malformed value", () => {
    expect(() => decryptToken("v1:abc", key)).toThrow(/not in the v1:/);
  });

  it("parses a 32-byte base64 key and rejects anything else", () => {
    const encoded = key.toString("base64");
    expect(parseEncryptionKey(encoded).equals(key)).toBe(true);
    expect(() => parseEncryptionKey(key.toString("hex"))).toThrow(
      /must be 32 bytes encoded as base64/,
    );
    expect(() => parseEncryptionKey("")).toThrow(
      /must be 32 bytes encoded as base64/,
    );
  });
});
