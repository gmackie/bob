import { execSync } from "node:child_process";
import { copyFileSync, unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pbkdf2Sync, createDecipheriv } from "node:crypto";
import Database from "better-sqlite3";

import { type BrowserProfile, getKeychainService } from "./browser-detect";

export interface RawCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number | null;
  secure: boolean;
  httpOnly: boolean;
  sameSite: "Strict" | "Lax" | "None";
}

const CHROMIUM_EPOCH_OFFSET = 11644473600n;

function getKeychainPassword(browserName: string): string {
  const service = getKeychainService(browserName);
  if (process.platform === "darwin") {
    try {
      const result = execSync(
        `security find-generic-password -s "${service}" -w`,
        { timeout: 10000, encoding: "utf8" },
      );
      return result.trim();
    } catch {
      throw new Error(
        `Failed to get keychain password for ${service}. You may need to click "Allow" in the macOS dialog.`,
      );
    }
  } else {
    // Linux v11
    try {
      const result = execSync(
        `secret-tool lookup xdg:schema chrome_libsecret_os_crypt_password_v2 application ${browserName}`,
        { timeout: 5000, encoding: "utf8" },
      );
      return result.trim();
    } catch {
      return "peanuts"; // Linux v10 fallback
    }
  }
}

function deriveKey(password: string): Buffer {
  const iterations = process.platform === "darwin" ? 1003 : 1;
  return pbkdf2Sync(password, "saltysalt", iterations, 16, "sha1");
}

function decryptValue(encryptedValue: Buffer, key: Buffer): string {
  if (encryptedValue.length === 0) return "";

  const prefix = encryptedValue.subarray(0, 3).toString("utf8");
  if (prefix !== "v10" && prefix !== "v11") {
    // Unencrypted
    return encryptedValue.toString("utf8");
  }

  const data = encryptedValue.subarray(3);
  const iv = Buffer.alloc(16, 0x20); // 16 spaces
  const decipher = createDecipheriv("aes-128-cbc", key, iv);
  decipher.setAutoPadding(false);

  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);

  // Remove PKCS7 padding
  const padLen = decrypted[decrypted.length - 1]!;
  if (padLen > 0 && padLen <= 16) {
    return decrypted.subarray(0, decrypted.length - padLen).toString("utf8");
  }
  return decrypted.toString("utf8");
}

function chromiumTimestampToUnix(chromiumTs: bigint): number | null {
  if (chromiumTs === 0n) return null;
  const unixMicro = chromiumTs - CHROMIUM_EPOCH_OFFSET * 1000000n;
  return Number(unixMicro / 1000000n);
}

function mapSameSite(value: number): "Strict" | "Lax" | "None" {
  switch (value) {
    case 2: return "Strict";
    case 1: return "Lax";
    default: return "None";
  }
}

export function readCookiesForDomain(
  profile: BrowserProfile,
  domain: string,
): RawCookie[] {
  const password = getKeychainPassword(profile.browser);
  const key = deriveKey(password);

  // Copy DB to temp file (browser may have it locked)
  const tmpDb = join(tmpdir(), `bob-cookies-${Date.now()}.sqlite`);
  copyFileSync(profile.cookieDbPath, tmpDb);

  try {
    const db = new Database(tmpDb, { readonly: true });

    const rows = db
      .prepare(
        `SELECT name, encrypted_value, host_key, path, expires_utc, is_secure, is_httponly, samesite
         FROM cookies
         WHERE host_key LIKE ?`,
      )
      .all(`%${domain}%`) as Array<{
        name: string;
        encrypted_value: Buffer;
        host_key: string;
        path: string;
        expires_utc: bigint;
        is_secure: number;
        is_httponly: number;
        samesite: number;
      }>;

    db.close();

    return rows.map((row) => ({
      name: row.name,
      value: decryptValue(row.encrypted_value, key),
      domain: row.host_key,
      path: row.path,
      expires: chromiumTimestampToUnix(row.expires_utc),
      secure: row.is_secure === 1,
      httpOnly: row.is_httponly === 1,
      sameSite: mapSameSite(row.samesite),
    }));
  } finally {
    if (existsSync(tmpDb)) unlinkSync(tmpDb);
  }
}
