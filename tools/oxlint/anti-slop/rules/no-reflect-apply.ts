import { defineRule } from "@oxlint/plugins";

import { isGlobalReflectMethodCall, isInsideProxyTrap } from "../shared/reflect-method.ts";

/** Ban Reflect.apply, which bypasses ordinary typed function calls. */
export const noReflectApplyRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow Reflect.apply; call typed functions directly or model dynamic dispatch behind an interface.",
    },
    messages: {
      reflectApply:
        "Replace `Reflect.apply` with a typed function call. Model dynamic dispatch behind a named interface.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type === "Super" || node.callee.type === "V8IntrinsicExpression") return;
        if (isGlobalReflectMethodCall(context.sourceCode, node.callee, "apply")) {
          // Forwarding through Reflect is the correct body of a Proxy `apply` trap.
          if (isInsideProxyTrap(node, "apply")) return;
          context.report({ node, messageId: "reflectApply" });
        }
      },
    };
  },
});
