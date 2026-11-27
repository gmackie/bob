export const ONBOARDING_SLIDES = [
  {
    scene: "plan",
    title: "Capture the issue.\nScope the task.",
    bullets: [
      "Use work items to move from intake into execution",
      "Keep planning, comments, and artifacts in one place",
    ],
  },
  {
    scene: "work",
    title: "Open the task.\nWork with Bob.",
    bullets: [
      "Jump directly into the execution workspace from mobile",
      "Track blocked, review-ready, and verification states",
    ],
  },
  {
    scene: "ship",
    title: "Stay aligned\nfrom anywhere.",
    bullets: [
      "Review notifications, comments, and artifacts on the go",
      "Keep execution moving without the old dashboard sprawl",
    ],
  },
] as const;
