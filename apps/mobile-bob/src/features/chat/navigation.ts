export function getAuthenticatedHomeHref(input: {
  isTablet: boolean;
}): "/chat" | "/tasks" {
  return input.isTablet ? "/tasks" : "/chat";
}
