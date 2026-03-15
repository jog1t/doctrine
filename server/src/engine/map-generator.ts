import {
  type GameMap,
  type Tile,
  MAP_WIDTH,
  MAP_HEIGHT,
} from "@doctrine/shared";

/**
 * Seeded PRNG (mulberry32) for deterministic map generation.
 */
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateMap(seed: number): GameMap {
  const rng = mulberry32(seed);

  const tiles: Tile[][] = [];

  for (let y = 0; y < MAP_HEIGHT; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < MAP_WIDTH; x++) {
      const roll = rng();

      if (roll < 0.08) {
        // 8% chance of resource node
        row.push({
          type: "resource",
          resources: Math.floor(rng() * 8) + 3, // 3-10 resources
        });
      } else if (roll < 0.13) {
        // 5% chance of obstacle
        row.push({ type: "obstacle", resources: 0 });
      } else {
        row.push({ type: "empty", resources: 0 });
      }
    }
    tiles.push(row);
  }

  // Clear area around center (base) — 3x3 guaranteed empty
  const cx = Math.floor(MAP_WIDTH / 2);
  const cy = Math.floor(MAP_HEIGHT / 2);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      tiles[cy + dy][cx + dx] = { type: "empty", resources: 0 };
    }
  }

  return { width: MAP_WIDTH, height: MAP_HEIGHT, tiles };
}
