import { createRivetKit } from "@rivetkit/react";
import type { registry } from "../../server/src/actors/registry.js";

const { useActor } = createRivetKit<typeof registry>({
  endpoint: "http://localhost:6420",
});

export { useActor };
