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
  try {
    return await publication.admission.execute(async () => {
      try {
        const result = await promoteNote(input, { publication: publication.storage });
        if (!result.publication || !isDurablyPublished(result.publication)) {
          // Retain the receipt; local files alone never establish completion.
          throw new PendingVaultPromotion(result);
        }
        return result;
      } catch (error) {
        // Polling retries must not create another note while this one is unresolved.
        drainage = publication.admission.closeAndDrain();
        void drainage.catch(() => {});
        throw error;
      }
    });
  } finally {
    await drainage;
  }
}

export class PendingVaultPromotion extends Error {
  readonly code = "PublicationPending";
  constructor(readonly result: Awaited<ReturnType<typeof promoteNote>>) {
    super("Vault publication requires reconciliation before completion");
  }
}
