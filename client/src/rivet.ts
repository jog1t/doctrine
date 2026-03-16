import { createRivetKit } from "@rivetkit/react";

// Defaults to window.location.origin + "/api/rivet" in the browser,
// which goes through the Vite dev proxy to http://localhost:6420.
// Registry type is not passed here due to cross-package private brand mismatch;
// action calls are typed via explicit casts in App.tsx.
const { useActor } = createRivetKit();

export { useActor };
