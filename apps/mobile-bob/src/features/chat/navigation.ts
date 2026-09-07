export function getAuthenticatedHomeHref(_input: {
  isTablet: boolean;
}): "/home" | "/chat" | "/tasks" {
  // home-mode-model has always specified triage as the phone home
  // ("Phone home is always triage, regardless of mode"); this returned /chat,
  // so the app opened on a conversation with no view of what needed attention.
  return "/home";
}
