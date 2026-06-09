# Optional Pi Host Adapter Template: `.pi/extensions/constellation.ts`
#template #pi-ai #host-adapter

This is optional host plumbing only. It must not contain Constellation runtime, planning, context, tool-selection, or subagent logic.

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createConstellationTool } from "../src/constellation/index.js";

export default function extension(pi: ExtensionAPI) {
  const constellationTool = createConstellationTool();
  pi.registerTool(constellationTool);

  pi.on("session_start", () => {
    const active = pi.getActiveTools();
    if (!active.includes(constellationTool.name)) {
      pi.setActiveTools([...active, constellationTool.name]);
    }
  });
}
```
