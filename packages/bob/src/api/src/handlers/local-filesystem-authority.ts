import { ServiceMap } from "effect";
import type { LocalFilesystemCapability } from "./context";

/** A trusted server runtime can provide this capability. The hosted runtime
 * defaults to no API-host filesystem access; authentication alone is insufficient. */
export const LocalFilesystemAuthority = ServiceMap.Reference<LocalFilesystemCapability | ((userId: string, headers: Readonly<Record<string, string | undefined>>) => LocalFilesystemCapability | undefined) | undefined>(
  "bob/LocalFilesystemAuthority",
  { defaultValue: () => undefined },
);
