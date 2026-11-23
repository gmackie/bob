import type { VaultService } from "./vault-service";
import { VersionedStorageError } from "./versioned-storage";

export interface VaultRouteBinding {
  actor: string;
  kind: "personal" | "research";
  service: VaultService;
}

export interface VaultAdmissionGate {
  execute<T>(operation: () => Promise<T>): Promise<T>;
  closeAndDrain(): Promise<void>;
}

/**
 * One trusted host instance per active workspace generation, shared by every
 * request. Serializes the whole file-write/commit/publication sequence, not
 * just Git operations. Never put this object in caller-controlled input.
 *
 * closeAndDrain permanently closes admissions, then waits for all admitted
 * operations, including queued ones. Only after it resolves may the host
 * replace this instance with a new generation. Errors still release the gate.
 * This is process-local: legacy writers, other processes, crash recovery and
 * outstanding provider requests require separate fencing/reconciliation.
 */
export class VaultRouteHost {
  private readonly bindings: readonly Readonly<VaultRouteBinding>[];
  private closed = false;
  private tail: Promise<void> = Promise.resolve();

  constructor(bindings: readonly VaultRouteBinding[], private readonly admission?: VaultAdmissionGate) {
    const seen = new Set<string>();
    this.bindings = bindings.map((binding) => {
      const key = JSON.stringify([binding.actor, binding.kind]);
      if (!binding.actor.trim() || seen.has(key)) {
        throw new VersionedStorageError("NotAuthorized", "Invalid or duplicate vault route binding");
      }
      seen.add(key);
      return Object.freeze({ ...binding });
    });
  }

  async execute<T>(
    actor: string,
    kind: VaultRouteBinding["kind"],
    operation: (service: VaultService) => Promise<T>,
  ): Promise<T> {
    const binding = this.bindings.find((entry) => entry.actor === actor && entry.kind === kind);
    if (!binding) throw new VersionedStorageError("NotAuthorized", "Vault access denied");
    if (this.closed) throw new VersionedStorageError("NotReady", "Vault generation is closed");
    const result = this.tail.then(() => this.admission
      ? this.admission.execute(() => operation(binding.service))
      : operation(binding.service));
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  async closeAndDrain(): Promise<void> {
    this.closed = true;
    // Close shared admissions immediately, including work still in local queues.
    // Await both branches even if shared drainage reports an orphan admission.
    const results = await Promise.allSettled([this.tail, this.admission?.closeAndDrain()]);
    for (const result of results) if (result.status === "rejected") throw result.reason;
  }
}
