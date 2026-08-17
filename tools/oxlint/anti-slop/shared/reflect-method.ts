import type { ESTree, Scope, SourceCode, Variable } from "@oxlint/plugins";

function resolveVariable(
  sourceCode: SourceCode,
  identifier: ESTree.IdentifierReference,
): Variable | null {
  let scope: Scope | null = sourceCode.getScope(identifier);
  while (scope !== null) {
    const variable = scope.set.get(identifier.name);
    if (variable !== undefined) return variable;
    scope = scope.upper;
  }
  return null;
}

function isGlobalReflect(sourceCode: SourceCode, expression: ESTree.Expression): boolean {
  if (expression.type !== "Identifier" || expression.name !== "Reflect") return false;
  if (sourceCode.isGlobalReference(expression)) return true;
  const variable = resolveVariable(sourceCode, expression);
  return variable === null || variable.defs.length === 0;
}

/** Reports whether a call target names one method on the global Reflect object. */
export function isGlobalReflectMethodCall(
  sourceCode: SourceCode,
  callee: ESTree.Expression,
  methodName: string,
): boolean {
  if (!("property" in callee) || !("object" in callee) || !("computed" in callee)) return false;
  if (!isGlobalReflect(sourceCode, callee.object)) return false;
  const property = callee.property;
  return callee.computed
    ? property.type === "Literal" && property.value === methodName
    : property.type === "Identifier" && property.name === methodName;
}

/**
 * Reports whether a node sits inside the named trap of a `new Proxy(target, handler)`
 * handler literal.
 *
 * Inside a trap, forwarding through Reflect is the correct implementation rather
 * than a smell: `Reflect.get(target, prop, receiver)` preserves `receiver`, so
 * getters on the target still observe the proxy. Rewriting it as `target[prop]`
 * silently changes that behaviour. The "use typed property access" advice does
 * not apply here, so these rules skip trap bodies.
 */
export function isInsideProxyTrap(node: ESTree.Node, trapName: string): boolean {
  // Walk every enclosing function, not just the nearest one — a trap commonly
  // returns a wrapper closure, and the Reflect call can sit inside it.
  let current: ESTree.Node | null | undefined = node.parent;
  while (current !== null && current !== undefined) {
    const isFunction =
      current.type === "FunctionExpression" ||
      current.type === "ArrowFunctionExpression" ||
      current.type === "FunctionDeclaration";
    if (isFunction && isProxyTrapFunction(current, trapName)) return true;
    current = current.parent;
  }
  return false;
}

function isProxyTrapFunction(fn: ESTree.Node, trapName: string): boolean {
  const property = fn.parent;
  if (property === null || property === undefined || property.type !== "Property") return false;

  const key = property.key;
  const namesTheTrap = property.computed
    ? key.type === "Literal" && key.value === trapName
    : (key.type === "Identifier" && key.name === trapName) ||
      (key.type === "Literal" && key.value === trapName);
  if (!namesTheTrap) return false;

  const handler = property.parent;
  if (handler === null || handler === undefined || handler.type !== "ObjectExpression") return false;

  const construction = handler.parent;
  if (construction === null || construction === undefined || construction.type !== "NewExpression") return false;
  if (construction.callee.type !== "Identifier" || construction.callee.name !== "Proxy") {
    return false;
  }
  // The handler must be the second argument, not the proxied target.
  return construction.arguments[1] === handler;
}
