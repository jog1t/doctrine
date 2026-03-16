import { createRivetKit } from "@rivetkit/react";
import type { registry } from "../../server/src/actors/registry.js";

// Defaults to window.location.origin + "/api/rivet" in the browser,
// which goes through the Vite dev proxy to http://localhost:6420
const { useActor } = createRivetKit<typeof registry>();

export { useActor };
