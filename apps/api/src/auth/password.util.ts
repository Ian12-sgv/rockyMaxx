import { createHmac, timingSafeEqual } from "node:crypto";

const HASH_PREFIX = "h$";
export const LEGACY_PASSWORD_FALLBACK_PEPPER = "change-me";

function safeEquals(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function hashLegacyPassword(password: string, pepper: string) {
  const digest = createHmac("sha256", pepper).update(password).digest("base64");
  return `${HASH_PREFIX}${digest}`;
}

export function verifyLegacyPassword(storedPassword: string | null | undefined, plainPassword: string, pepper: string) {
  if (!storedPassword) {
    return false;
  }

  if (storedPassword.startsWith(HASH_PREFIX)) {
    return safeEquals(storedPassword, hashLegacyPassword(plainPassword, pepper));
  }

  return safeEquals(storedPassword, plainPassword);
}

export function findMatchingLegacyPasswordPepper(
  storedPassword: string | null | undefined,
  plainPassword: string,
  peppers: string[],
) {
  for (const pepper of peppers) {
    if (verifyLegacyPassword(storedPassword, plainPassword, pepper)) {
      return pepper;
    }
  }

  return null;
}
