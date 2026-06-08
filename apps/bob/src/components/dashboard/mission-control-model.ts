export type MissionControlSection =
  | "provider-capacity"
  | "work-pipeline"
  | "running-now";

const MISSION_CONTROL_SECTIONS: MissionControlSection[] = [
  "provider-capacity",
  "work-pipeline",
  "running-now",
];

export function getMissionControlSections(): MissionControlSection[] {
  return [...MISSION_CONTROL_SECTIONS];
}
