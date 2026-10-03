import { promoteNote } from "@gmacko/ooda/thread-workspace";
import { isDurablyPublished } from "@gmacko/ooda/vault";

/** Host injection only; share the route host's persistent gate and generation. */
export interface RunnerVaultPublication {
  storage: NonNullable<NonNullable<Parameters<typeof promoteNote>[1]>["publication"]>;
  admission: {
    execute<T>(operation: () => Promise<T>): Promise<T>;
    closeAndDrain(): Promise<void>;
  };
}

export async function promoteRunnerNote(
  input: Parameters<typeof promoteNote>[0],
  publication?: RunnerVaultPublication,
) {
  if (!publication) return promoteNote(input);
  let drainage: Promise<void> | undefined;
  try { return await publication.admission.execute(async () => {
    try {
    const result = await promoteNote(input, { publication: publication.storage });
    if (!result.publication || !isDurablyPublished(result.publication)) {
      // Keep the receipt for reconciliation. Never emit promotion_available or
      // report this as completed merely because the local files were written.
      throw new PendingVaultPromotion(result);
    }
    return result;
    } catch (error) {
      // The runner polls failed requests again. Close the shared generation
      // before releasing admission so those polls cannot create another note.
      drainage = publication.admission.closeAndDrain();
      void drainage.catch(() => {});
      throw error;
    }
  }); } finally { await drainage; }
}

export class PendingVaultPromotion extends Error {
  readonly code = "PublicationPending";
  constructor(readonly result: Awaited<ReturnType<typeof promoteNote>>) {
    super("Vault publication requires reconciliation before completion");
  }
}
