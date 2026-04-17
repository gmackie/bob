import { Effect, Layer, ServiceMap } from "effect";
import {
  writeArticle,
  buildIndex,
  findOrphanedArticles,
  type WikiArticle,
  type WikiIndex,
} from "@gmacko/wiki";

const VAULT_PATH = process.env.VAULT_PATH ?? process.cwd();

export class WikiService extends ServiceMap.Service<
  WikiService,
  {
    readonly writeArticle: (article: WikiArticle) => Effect.Effect<string, Error>;
    readonly listArticles: () => Effect.Effect<WikiIndex[], Error>;
    readonly findOrphans: () => Effect.Effect<string[], Error>;
  }
>()("@gmacko/server/WikiService") {}

export const WikiServiceLive = Layer.succeed(WikiService)({
  writeArticle: (article: WikiArticle) =>
    Effect.tryPromise({
      try: () => writeArticle(VAULT_PATH, article),
      catch: (error) => new Error(`Failed to write article: ${error}`),
    }),

  listArticles: () =>
    Effect.tryPromise({
      try: () => buildIndex(VAULT_PATH),
      catch: (error) => new Error(`Failed to build wiki index: ${error}`),
    }),

  findOrphans: () =>
    Effect.tryPromise({
      try: async () => {
        const index = await buildIndex(VAULT_PATH);
        return findOrphanedArticles(index);
      },
      catch: (error) => new Error(`Failed to find orphans: ${error}`),
    }),
});
