import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import path from "node:path";

/** A local installation owns its auth identity independently of the proxy token. */
export async function localAuthEnvironment(baseDir: string, origin: string) {
  const url = new URL(origin);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("Local account authentication requires a loopback HTTP origin");
  }
  const directory = path.join(baseDir, "userdata");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const secretPath = path.join(directory, "auth-secret");
  try {
    await writeFile(secretPath, randomBytes(48).toString("hex"), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  await chmod(secretPath, 0o600);
  const secret = await readFile(secretPath, "utf8");
  if (!/^[a-f0-9]{96}$/.test(secret)) throw new Error("Invalid local authentication secret; preserve or restore the installation secret");
  return { BOB_DESKTOP_LOCAL_AUTH: "1", AUTH_SECRET: secret, FRONTEND_URL: url.origin };
}
