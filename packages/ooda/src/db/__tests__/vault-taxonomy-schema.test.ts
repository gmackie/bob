import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  personalVaultSchema,
  researchVaultSchema,
  personalVaultSources,
  researchVaultSources,
  personalVaultEmbeddings,
  researchVaultEmbeddings,
  personalVaultSourceEmbeddings,
  researchVaultSourceEmbeddings,
  personalVaultTopics,
  researchVaultTopics,
  personalVaultSourceTopics,
  researchVaultSourceTopics,
  personalVaultKbs,
  researchVaultKbs,
  personalVaultKbSources,
  researchVaultKbSources,
  personalVaultImportJobs,
  researchVaultImportJobs,
} from "../schema/vault-taxonomy";

describe("vault taxonomy schema", () => {
  it("exports personal_vault and research_vault pgSchema instances", () => {
    expect(personalVaultSchema.schemaName).toBe("personal_vault");
    expect(researchVaultSchema.schemaName).toBe("research_vault");
  });

  it("exports sources tables for both schemas", () => {
    // Drizzle table objects have a Symbol-keyed name
    expect(personalVaultSources).toBeDefined();
    expect(researchVaultSources).toBeDefined();
  });

  it("exports embeddings tables for both schemas", () => {
    expect(personalVaultEmbeddings).toBeDefined();
    expect(researchVaultEmbeddings).toBeDefined();
  });

  it("stores source embeddings as indexed pgvector values", () => {
    for (const table of [
      personalVaultSourceEmbeddings,
      researchVaultSourceEmbeddings,
    ]) {
      const tableConfig = getTableConfig(table);
      expect(
        tableConfig.columns
          .find((column) => column.name === "embedding")
          ?.getSQLType(),
      ).toBe("vector(768)");
      expect(tableConfig.indexes.map((index) => index.config.name)).toContain(
        "source_embedding_vec_hnsw_idx",
      );
    }
    expect(
      getTableConfig(researchVaultEmbeddings)
        .columns.find((column) => column.name === "vec")
        ?.getSQLType(),
    ).toBe("bytea");
  });

  it("exports topics, source_topics, kbs, kb_sources, import_jobs for both", () => {
    expect(personalVaultTopics).toBeDefined();
    expect(researchVaultTopics).toBeDefined();
    expect(personalVaultSourceTopics).toBeDefined();
    expect(researchVaultSourceTopics).toBeDefined();
    expect(personalVaultKbs).toBeDefined();
    expect(researchVaultKbs).toBeDefined();
    expect(personalVaultKbSources).toBeDefined();
    expect(researchVaultKbSources).toBeDefined();
    expect(personalVaultImportJobs).toBeDefined();
    expect(researchVaultImportJobs).toBeDefined();
  });
});
