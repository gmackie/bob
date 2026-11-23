import { toolData } from "./bridge";
import type { PlanningData } from "./render";
import { mountPlanning, startView } from "./shared.client";

const bridge = startView("bob-planning-review");
const planning = mountPlanning(bridge, document.getElementById("app")!);

bridge.onToolResult = (result) => {
  if (result.isError) {
    document.getElementById("app")!.textContent = result.content?.find((part) => part.type === "text")?.text ?? "Planning review failed to load.";
    return;
  }
  planning.show(toolData<PlanningData>(result));
};
void bridge.connect();
