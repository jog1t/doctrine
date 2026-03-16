import { setup } from "rivetkit";
import { gameWorld } from "./game-world.js";

export const registry = setup({
  use: { gameWorld },
});
