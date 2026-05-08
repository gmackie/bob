import { traceEmbedding } from "@bob/telemetry";

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMS = 1536;

export interface EmbeddingResult {
  model: string;
  embedding: number[];
  dimensions: number;
}

export async function generateEmbedding(
  text: string,
  apiKey: string,
): Promise<EmbeddingResult> {
  return traceEmbedding(
    { model: EMBEDDING_MODEL, inputCount: 1, dimensions: EMBEDDING_DIMS },
    async () => {
      const response = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          input: text,
          model: EMBEDDING_MODEL,
          dimensions: EMBEDDING_DIMS,
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`OpenAI embedding API error ${response.status}: ${body}`);
      }

      const data = (await response.json()) as {
        data: Array<{ embedding: number[] }>;
      };
      return {
        model: EMBEDDING_MODEL,
        embedding: data.data[0]!.embedding,
        dimensions: EMBEDDING_DIMS,
      };
    },
  );
}

export async function generateEmbeddings(
  texts: string[],
  apiKey: string,
): Promise<EmbeddingResult[]> {
  if (texts.length === 0) return [];
  if (texts.length === 1) return [await generateEmbedding(texts[0]!, apiKey)];

  return traceEmbedding(
    { model: EMBEDDING_MODEL, inputCount: texts.length, dimensions: EMBEDDING_DIMS },
    async () => {
      const response = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          input: texts,
          model: EMBEDDING_MODEL,
          dimensions: EMBEDDING_DIMS,
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`OpenAI embedding API error ${response.status}: ${body}`);
      }

      const data = (await response.json()) as {
        data: Array<{ embedding: number[]; index: number }>;
      };

      return data.data
        .sort((a, b) => a.index - b.index)
        .map((d) => ({
          model: EMBEDDING_MODEL,
          embedding: d.embedding,
          dimensions: EMBEDDING_DIMS,
        }));
    },
  );
}
