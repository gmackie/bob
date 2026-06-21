import { describe, expect, it } from "vitest";

import { WorkItemsRpc } from "@gmacko/bob/contracts";

import {
  generateOpenApiFromRpcGroups,
  tagToRestPath,
} from "../rpc-openapi.js";

const config = {
  title: "Bob API",
  version: "1.0.0",
  baseUrl: "https://bob.blder.bot",
};

describe("generateOpenApiFromRpcGroups", () => {
  it("produces an OpenAPI 3.1 document", () => {
    const doc = generateOpenApiFromRpcGroups([WorkItemsRpc], config);
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.title).toBe("Bob API");
    expect(doc.servers?.[0]?.url).toBe("https://bob.blder.bot");
  });

  it("maps every rpc tag to a REST path with a POST operation", () => {
    const doc = generateOpenApiFromRpcGroups([WorkItemsRpc], config);
    const listPath = tagToRestPath("workItem.list");
    expect(listPath).toBe("/api/v1/work-item/list");
    expect(doc.paths?.[listPath]?.post).toBeDefined();
    expect(doc.paths?.[listPath]?.post?.operationId).toBe("workItem.list");
  });

  it("includes the payload fields in the request body schema", () => {
    const doc = generateOpenApiFromRpcGroups([WorkItemsRpc], config);
    const op = doc.paths?.[tagToRestPath("workItem.list")]?.post;
    expect(op?.requestBody).toBeDefined();
    const requestBody = op?.requestBody as {
      content: Record<string, { schema: { properties?: Record<string, unknown> } }>;
    };
    const schema = requestBody.content["application/json"]!.schema;
    // WorkItemListRpc payload has workspaceId + optional projectId/kind
    expect(schema.properties).toHaveProperty("workspaceId");
  });

  it("emits a 200 response with the success schema", () => {
    const doc = generateOpenApiFromRpcGroups([WorkItemsRpc], config);
    const op = doc.paths?.[tagToRestPath("workItem.list")]?.post;
    expect(op?.responses?.["200"]).toBeDefined();
  });

  it("declares cookie + bearer security schemes", () => {
    const doc = generateOpenApiFromRpcGroups([WorkItemsRpc], config);
    expect(doc.components?.securitySchemes).toHaveProperty("bearerAuth");
    expect(doc.components?.securitySchemes).toHaveProperty("cookieAuth");
  });

  it("covers every procedure in the group", () => {
    const doc = generateOpenApiFromRpcGroups([WorkItemsRpc], config);
    const opCount = Object.values(doc.paths ?? {}).filter(
      (p) => (p as { post?: unknown }).post,
    ).length;
    const rpcCount = (
      WorkItemsRpc as unknown as { requests: ReadonlyMap<string, unknown> }
    ).requests.size;
    expect(opCount).toBe(rpcCount);
  });
});
