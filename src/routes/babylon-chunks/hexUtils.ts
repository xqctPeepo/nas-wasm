/**
 * Hex Grid Utilities
 * 
 * Provides hex grid coordinate utilities and pathfinding algorithms.
 * Based on Red Blob Games hex grid guide: https://www.redblobgames.com/grids/hexagons/
 */

import type { WasmModuleBabylonChunks } from '../../types';

/**
 * Hex grid coordinate type (axial coordinates)
 */
export interface HexCoord {
  q: number;
  r: number;
}

/**
 * Cube coordinate type (q + r + s = 0)
 */
export interface CubeCoord {
  q: number;
  r: number;
  s: number;
}

/**
 * Cube direction vectors for hex grid navigation
 */
export const CUBE_DIRECTIONS: Array<CubeCoord> = [
  { q: +1, r: 0, s: -1 },  // Direction 0
  { q: +1, r: -1, s: 0 },  // Direction 1
  { q: 0, r: -1, s: +1 },  // Direction 2
  { q: -1, r: 0, s: +1 },  // Direction 3
  { q: -1, r: +1, s: 0 },  // Direction 4
  { q: 0, r: +1, s: -1 },  // Direction 5
];

/**
 * Hex grid utility functions
 */
export const HEX_UTILS = {
  /**
   * Convert offset coordinates (col, row) to axial coordinates (q, r)
   * Uses even-r offset layout (offset even rows)
   */
  offsetToAxial(col: number, row: number): HexCoord {
    const q = col;
    const r = row - (col + (col & 1)) / 2;
    return { q, r };
  },

  /**
   * Convert axial coordinates (q, r) to offset coordinates (col, row)
   * Uses even-r offset layout
   */
  axialToOffset(q: number, r: number): { col: number; row: number } {
    const col = q;
    const row = r + (q + (q & 1)) / 2;
    return { col, row };
  },

  /**
   * Get all 6 neighbors of a hex coordinate (axial)
   */
  getNeighbors(q: number, r: number): Array<HexCoord> {
    return [
      { q: q + 1, r },
      { q: q - 1, r },
      { q: q, r: r + 1 },
      { q: q, r: r - 1 },
      { q: q + 1, r: r - 1 },
      { q: q - 1, r: r + 1 },
    ];
  },

  /**
   * Calculate distance between two hex coordinates (axial)
   */
  distance(q1: number, r1: number, q2: number, r2: number): number {
    return (Math.abs(q1 - q2) + Math.abs(q1 + r1 - q2 - r2) + Math.abs(r1 - r2)) / 2;
  },

  /**
   * Convert hex coordinates (axial) to 3D world position
   * Uses pointy-top hex layout
   * 
   * Formula for pointy-top hexagons:
   * - x = size * (√3 * q + √3/2 * r)
   * - z = size * (3/2 * r)
   * 
   * Note: Uses z instead of y for 3D world space (BabylonJS convention)
   * 
   * @param q - Axial q coordinate
   * @param r - Axial r coordinate
   * @param hexSize - Size of hexagon (distance from center to vertex)
   * @returns World position {x, z} in 3D space
   */
  hexToWorld(q: number, r: number, hexSize: number): { x: number; z: number } {
    hexSize = hexSize / 1.34;
    // For pointy-top hexagons, spacing between centers:
    // Horizontal spacing = sqrt(3) * hexSize
    // Vertical spacing = 3/2 * hexSize
    // The coefficients were half what they should be - doubling them
    const x = hexSize * (Math.sqrt(3) * 2 * q + Math.sqrt(3) * r);
    const z = hexSize * (3 * r);
    return { x, z };
  },

  /**
   * Convert world space coordinates (x, z) to the containing hex coordinate
   * Uses pointy-top hex layout
   * 
   * Algorithm:
   * 1. Convert world coordinates to fractional axial coordinates
   * 2. Convert to fractional cube coordinates
   * 3. Round to nearest integer hex
   * 4. Reset component with largest rounding difference to maintain q + r + s = 0 constraint
   * 
   * @param x - World x coordinate
   * @param z - World z coordinate (BabylonJS uses z instead of y)
   * @param hexSize - Size of hexagon (distance from center to vertex)
   * @returns Hex coordinate {q, r} containing the world point
   */
  worldToHex(x: number, z: number, hexSize: number): HexCoord {
    // Validate inputs to prevent overflow/infinity errors
    // Clamp very large values to prevent precision loss
    const MAX_SAFE_COORD = 1e6; // Maximum safe coordinate value
    const clampedX = Math.max(-MAX_SAFE_COORD, Math.min(MAX_SAFE_COORD, x));
    const clampedZ = Math.max(-MAX_SAFE_COORD, Math.min(MAX_SAFE_COORD, z));
    
    // Check for invalid values (NaN, Infinity)
    if (!Number.isFinite(clampedX) || !Number.isFinite(clampedZ)) {
      return { q: 0, r: 0 };
    }
    
    hexSize = hexSize / 1.34;
    
    // Validate hexSize to prevent division by zero or very small values
    if (!Number.isFinite(hexSize) || hexSize <= 0 || hexSize < 0.001) {
      return { q: 0, r: 0 };
    }
    
    // 1. Convert world coordinates to fractional axial coordinates
    // Inverse of hexToWorld: x = hexSize * sqrt(3) * (2q + r), z = hexSize * 3 * r
    // Solving: r = z / (3 * hexSize), q = (x / (hexSize * sqrt(3)) - r) / 2
    const sqrt3 = Math.sqrt(3);
    const denominatorQ = 2 * hexSize * sqrt3;
    const denominatorR = 3 * hexSize;
    
    // Check for division by zero or very small denominators
    if (!Number.isFinite(denominatorQ) || !Number.isFinite(denominatorR) || 
        Math.abs(denominatorQ) < 0.001 || Math.abs(denominatorR) < 0.001) {
      return { q: 0, r: 0 };
    }
    
    const fracQ = clampedX / denominatorQ - clampedZ / (6 * hexSize);
    const fracR = clampedZ / denominatorR;
    
    // Validate fractional coordinates
    if (!Number.isFinite(fracQ) || !Number.isFinite(fracR)) {
      return { q: 0, r: 0 };
    }
    
    // 2. Convert to fractional cube coordinates
    const fracS = -fracQ - fracR;
    
    // Validate fracS
    if (!Number.isFinite(fracS)) {
      return { q: 0, r: 0 };
    }
    
    // 3. Round fractional cube coordinates to the nearest integer hex
    let q = Math.round(fracQ);
    let r = Math.round(fracR);
    let s = Math.round(fracS);
    
    // Validate rounded coordinates
    if (!Number.isFinite(q) || !Number.isFinite(r) || !Number.isFinite(s)) {
      return { q: 0, r: 0 };
    }
    
    // 4. Calculate rounding differences
    const qDiff = Math.abs(q - fracQ);
    const rDiff = Math.abs(r - fracR);
    const sDiff = Math.abs(s - fracS);
    
    // 5. Reset the component with the largest rounding difference to maintain
    // the q + r + s = 0 constraint
    if (qDiff > rDiff && qDiff > sDiff) {
      q = -r - s;
    } else if (rDiff > sDiff) {
      r = -q - s;
    } else {
      s = -q - r;
    }
    
    // Final validation
    if (!Number.isFinite(q) || !Number.isFinite(r)) {
      return { q: 0, r: 0 };
    }
    
    // Return as axial coordinates (q, r)
    return { q, r };
  },

  /**
   * Check if offset coordinate is within bounds
   */
  inBounds(col: number, row: number, width: number, height: number): boolean {
    return col >= 0 && col < width && row >= 0 && row < height;
  },

  /**
   * Check if hex coordinate is within hexagonal boundary (distance from center)
   * @param q - Axial q coordinate
   * @param r - Axial r coordinate
   * @param centerQ - Center q coordinate
   * @param centerR - Center r coordinate
   * @param radius - Maximum distance from center
   */
  inHexBoundary(q: number, r: number, centerQ: number, centerR: number, radius: number): boolean {
    const dist = this.distance(q, r, centerQ, centerR);
    return dist <= radius;
  },

  /**
   * Validate that a cube coordinate satisfies the constraint q + r + s = 0
   * 
   * Cube coordinates must always satisfy this constraint for proper hex grid operations.
   * 
   * @param cube - Cube coordinate to validate
   * @returns True if q + r + s === 0, false otherwise
   */
  validateCubeCoord(cube: CubeCoord): boolean {
    return cube.q + cube.r + cube.s === 0;
  },

  /**
   * Convert axial coordinates to cube coordinates
   * Cube coordinates: (q, r, s) where q + r + s = 0
   * 
   * This conversion automatically ensures the constraint is satisfied.
   */
  axialToCube(q: number, r: number): CubeCoord {
    return { q, r, s: -q - r };
  },

  /**
   * Convert cube coordinates to axial coordinates
   */
  cubeToAxial(cube: CubeCoord): HexCoord {
    return { q: cube.q, r: cube.r };
  },

  /**
   * Calculate cube distance between two cube coordinates
   */
  cubeDistance(a: CubeCoord, b: CubeCoord): number {
    return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.s - b.s));
  },

  /**
   * Add two cube coordinates together
   * 
   * Note: The result automatically satisfies q + r + s = 0 if both inputs do,
   * since (a.q + b.q) + (a.r + b.r) + (a.s + b.s) = (a.q + a.r + a.s) + (b.q + b.r + b.s) = 0 + 0 = 0
   */
  cube_add(a: CubeCoord, b: CubeCoord): CubeCoord {
    return { q: a.q + b.q, r: a.r + b.r, s: a.s + b.s };
  },

  /**
   * Scale a cube coordinate by a factor
   * 
   * Note: The result automatically satisfies q + r + s = 0 if the input does,
   * since (factor * q) + (factor * r) + (factor * s) = factor * (q + r + s) = factor * 0 = 0
   */
  cube_scale(hex: CubeCoord, factor: number): CubeCoord {
    return { q: hex.q * factor, r: hex.r * factor, s: hex.s * factor };
  },

  /**
   * Get cube neighbor in specified direction (0-5)
   */
  cubeNeighbor(cube: CubeCoord, direction: number): CubeCoord {
    const dir = CUBE_DIRECTIONS[direction % 6];
    return this.cube_add(cube, dir);
  },

  /**
   * Generate ring of tiles at specific layer (radius) around center
   * Returns all tiles that form a ring at distance 'radius' from center
   * 
   * Corrected implementation: starts at a corner of the target ring and walks
   * along its six sides to trace the perimeter accurately.
   */
  cubeRing(center: CubeCoord, radius: number): Array<CubeCoord> {
    if (radius === 0) {
      return [center];
    }
    
    const results: Array<CubeCoord> = [];
    
    // Start at the first hex of the ring by moving from the center
    // Move 'radius' steps in direction 4 (CUBE_DIRECTIONS[4])
    let currentHex = this.cube_add(center, this.cube_scale(CUBE_DIRECTIONS[4], radius));
    
    // Traverse the six sides of the hexagonal ring
    for (let i = 0; i < 6; i++) {
      // For each side, take 'radius' steps in the current direction
      for (let j = 0; j < radius; j++) {
        results.push({ q: currentHex.q, r: currentHex.r, s: currentHex.s });
        currentHex = this.cubeNeighbor(currentHex, i);
      }
    }
    
    return results;
  },

  /**
   * Generate all tiles in hexagon up to rings
   * Ring 0: 1 tile (center)
   * Ring n: adds 6n tiles
   * Total: 3*rings*(rings+1) + 1 tiles
   * 
   * Uses Set for deduplication and O(1) lookups, then converts to array.
   */
  generateHexGrid(rings: number, centerQ: number, centerR: number): Array<HexCoord> {
    // Use Set with string keys for deduplication and O(1) lookups
    const gridSet = new Set<string>();
    const centerCube = this.axialToCube(centerQ, centerR);
    
    // Generate grid from center outwards, adding one ring at a time
    for (let ring = 0; ring <= rings; ring++) {
      const ringHexes = this.cubeRing(centerCube, ring);
      for (const cube of ringHexes) {
        // Use tuple of coordinates as hashable key for the set
        const key = `${cube.q},${cube.r},${cube.s}`;
        gridSet.add(key);
      }
    }
    
    // Convert set to array of HexCoord
    const grid: Array<HexCoord> = [];
    for (const key of gridSet) {
      const parts = key.split(',');
      if (parts.length === 3) {
        const q = Number.parseInt(parts[0] ?? '0', 10);
        const r = Number.parseInt(parts[1] ?? '0', 10);
        const s = Number.parseInt(parts[2] ?? '0', 10);
        // Verify cube coordinate is valid (q + r + s = 0)
        if (q + r + s === 0) {
          grid.push({ q, r });
        }
      }
    }
    
    // Validate grid size matches expected formula
    const expectedSize = 3 * rings * (rings + 1) + 1;
    if (grid.length !== expectedSize) {
      console.error(`Hexagon grid size mismatch: expected ${expectedSize}, got ${grid.length}`);
    }
    
    return grid;
  },

  /**
   * Check if hex coordinate is part of hexagon pattern (layer-based using cube coordinates)
   * 
   * Hexagonal tile grids form centered hexagonal numbers, where each layer adds a ring
   * around the previous shape. Layer 0 is 1 tile (center), layer 1 adds 6 tiles (total 7),
   * layer 2 adds 12 tiles (total 19), etc. Layer n adds 6n tiles.
   * 
   * Total tiles up to layer n: 3n(n+1) + 1
   * For n=30: 3×30×31 + 1 = 2791 tiles
   * 
   * @param rings - Number of rings (distance from center)
   * @param q - Axial q coordinate
   * @param r - Axial r coordinate
   * @param centerQ - Center q coordinate
   * @param centerR - Center r coordinate
   * @returns True if hex is within rings distance from center (using cube distance)
   */
  isInHexagonPattern(rings: number, q: number, r: number, centerQ: number, centerR: number): boolean {
    const centerCube = this.axialToCube(centerQ, centerR);
    const tileCube = this.axialToCube(q, r);
    const dist = this.cubeDistance(tileCube, centerCube);
    return dist <= rings;
  },
};

/**
 * Parse HexCoord array from JSON string
 * Uses Object.getOwnPropertyDescriptor for type-safe property access without casts
 * 
 * @param jsonString - JSON string containing array of HexCoord objects
 * @returns Array of HexCoord or null if parsing fails
 */
export function parseHexCoordArray(jsonString: string): Array<HexCoord> | null {
  if (jsonString === 'null' || jsonString === null || jsonString === '[]') {
    return null;
  }
  
  const parsed: unknown = JSON.parse(jsonString);
  if (!Array.isArray(parsed)) {
    return null;
  }
  
  const result: Array<HexCoord> = [];
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      continue;
    }
    
    // Check for required properties using 'in' operator
    if (!('q' in item) || !('r' in item)) {
      continue;
    }
    
    // Use Object.getOwnPropertyDescriptor to access properties without type casts
    const qDesc = Object.getOwnPropertyDescriptor(item, 'q');
    const rDesc = Object.getOwnPropertyDescriptor(item, 'r');
    
    // Narrow the value types
    if (!qDesc || !rDesc || !('value' in qDesc) || !('value' in rDesc)) {
      continue;
    }
    
    const qValue: unknown = qDesc.value;
    const rValue: unknown = rDesc.value;
    
    if (typeof qValue === 'number' && typeof rValue === 'number') {
      result.push({ q: qValue, r: rValue });
    }
  }
  
  return result.length > 0 ? result : null;
}

/**
 * Hex A* pathfinding for road connectivity validation
 * 
 * Uses WASM implementation when available for better performance.
 * Falls back to TypeScript implementation if WASM is not available.
 * 
 * Uses cube coordinates for distance calculations and explores 6 hex neighbors.
 * Returns path from start to goal, or null if unreachable.
 * 
 * @param start - Start hex coordinate
 * @param goal - Goal hex coordinate
 * @param isValid - Callback function to check if a hex is valid for pathfinding
 * @param wasmModule - Optional WASM module for pathfinding
 * @param hexGrid - Optional hex grid to use for building valid terrain array (for WASM)
 * @returns Path from start to goal, or null if unreachable
 */
export function hexAStar(
  start: HexCoord,
  goal: HexCoord,
  isValid: (q: number, r: number) => boolean,
  wasmModule?: WasmModuleBabylonChunks | null,
  hexGrid?: Array<HexCoord>
): Array<HexCoord> | null {
  // Try WASM implementation if available
  if (wasmModule && hexGrid) {
    // Build valid terrain array from hexGrid and isValid callback
    const validTerrain: Array<HexCoord> = [];
    for (const hex of hexGrid) {
      if (isValid(hex.q, hex.r)) {
        validTerrain.push(hex);
      }
    }
    
    const validTerrainJson = JSON.stringify(validTerrain);
    const result = wasmModule.hex_astar(
      start.q,
      start.r,
      goal.q,
      goal.r,
      validTerrainJson
    );
    
    if (result === 'null' || result === null) {
      return null;
    }
    
    // Parse and validate result using utility function
    return parseHexCoordArray(result);
  }
  
  // Fallback to TypeScript implementation
  interface AStarNode {
    q: number;
    r: number;
    g: number;
    h: number;
    f: number;
    parent: AStarNode | null;
  }

  // Convert axial to cube for distance calculation
  const goalCube = HEX_UTILS.axialToCube(goal.q, goal.r);

  // Calculate hex distance heuristic (cube distance)
  const heuristic = (q: number, r: number): number => {
    const cube = HEX_UTILS.axialToCube(q, r);
    return HEX_UTILS.cubeDistance(cube, goalCube);
  };

  const startNode: AStarNode = {
    q: start.q,
    r: start.r,
    g: 0,
    h: heuristic(start.q, start.r),
    f: 0,
    parent: null,
  };
  startNode.f = startNode.g + startNode.h;

  const openSet = new Map<string, AStarNode>();
  const closedSet = new Set<string>();
  openSet.set(`${start.q},${start.r}`, startNode);

  while (openSet.size > 0) {
    // Find node with lowest f score
    let current: AStarNode | null = null;
    let currentKey = '';
    let minF = Number.POSITIVE_INFINITY;

    for (const [key, node] of openSet.entries()) {
      if (node.f < minF) {
        minF = node.f;
        current = node;
        currentKey = key;
      }
    }

    if (!current) {
      break;
    }

    // Remove from open set, add to closed set
    openSet.delete(currentKey);
    closedSet.add(currentKey);

    // Check if we reached the goal
    if (current.q === goal.q && current.r === goal.r) {
      // Reconstruct path
      const path: Array<HexCoord> = [];
      let node: AStarNode | null = current;
      while (node) {
        path.unshift({ q: node.q, r: node.r });
        node = node.parent;
      }
      return path;
    }

    // Explore neighbors
    const neighbors = HEX_UTILS.getNeighbors(current.q, current.r);
    for (const neighbor of neighbors) {
      const neighborKey = `${neighbor.q},${neighbor.r}`;

      if (closedSet.has(neighborKey)) {
        continue;
      }

      if (!isValid(neighbor.q, neighbor.r)) {
        continue;
      }

      const tentativeG = current.g + 1;
      const existingNode = openSet.get(neighborKey);

      if (!existingNode || tentativeG < existingNode.g) {
        const h = heuristic(neighbor.q, neighbor.r);
        const newNode: AStarNode = {
          q: neighbor.q,
          r: neighbor.r,
          g: tentativeG,
          h,
          f: tentativeG + h,
          parent: current,
        };
        openSet.set(neighborKey, newNode);
      }
    }
  }

  return null;
}

/**
 * Find the nearest road in the network to a given seed point
 * Returns the hex coordinate of the nearest road
 */
export function findNearestRoad(
  seed: HexCoord,
  roadNetwork: Array<HexCoord>
): HexCoord | null {
  if (roadNetwork.length === 0) {
    return null;
  }

  let nearest: HexCoord | null = null;
  let minDistance = Number.POSITIVE_INFINITY;

  for (const road of roadNetwork) {
    const distance = HEX_UTILS.distance(seed.q, seed.r, road.q, road.r);
    if (distance < minDistance) {
      minDistance = distance;
      nearest = road;
    }
  }

  return nearest;
}

/**
 * Build a path between two road points using A* pathfinding
 * Returns array of intermediate hexes (excluding start, including end)
 * Returns null if no path found
 * 
 * Uses WASM implementation when available for better performance.
 * 
 * @param start - Start hex coordinate
 * @param end - End hex coordinate
 * @param isValid - Callback function to check if a hex is valid for pathfinding
 * @param wasmModule - Optional WASM module for pathfinding
 * @param hexGrid - Optional hex grid to use for building valid terrain array (for WASM)
 * @returns Path excluding start, including end, or null if no path found
 */
export function buildPathBetweenRoads(
  start: HexCoord,
  end: HexCoord,
  isValid: (q: number, r: number) => boolean,
  wasmModule?: WasmModuleBabylonChunks | null,
  hexGrid?: Array<HexCoord>
): Array<HexCoord> | null {
  // Try WASM implementation if available
  if (wasmModule && hexGrid) {
    // Build valid terrain array from hexGrid and isValid callback
    const validTerrain: Array<HexCoord> = [];
    for (const hex of hexGrid) {
      if (isValid(hex.q, hex.r)) {
        validTerrain.push(hex);
      }
    }
    
    const validTerrainJson = JSON.stringify(validTerrain);
    const result = wasmModule.build_path_between_roads(
      start.q,
      start.r,
      end.q,
      end.r,
      validTerrainJson
    );
    
    if (result === 'null' || result === null) {
      return null;
    }
    
    // Parse and validate result using utility function
    return parseHexCoordArray(result);
  }
  
  // Fallback to TypeScript implementation
  const path = hexAStar(start, end, isValid, wasmModule, hexGrid);
  if (!path || path.length === 0) {
    return null;
  }
  // Return path excluding start (we already have it), including end
  return path.slice(1);
}

/**
 * Get all valid terrain hexes adjacent to existing roads
 * Returns array of hex coordinates that are:
 * - Adjacent to at least one road in the network
 * - On valid terrain (grass/forest)
 * - Not already occupied
 */
export function getAdjacentValidTerrain(
  roadNetwork: Array<HexCoord>,
  validTerrainHexes: Array<HexCoord>,
  occupiedHexes: Set<string>
): Array<HexCoord> {
  const roadSet = new Set<string>();
  for (const road of roadNetwork) {
    roadSet.add(`${road.q},${road.r}`);
  }

  const adjacentHexes: Array<HexCoord> = [];
  const adjacentSet = new Set<string>();

  // For each road, find its neighbors
  for (const road of roadNetwork) {
    const neighbors = HEX_UTILS.getNeighbors(road.q, road.r);
    for (const neighbor of neighbors) {
      const neighborKey = `${neighbor.q},${neighbor.r}`;
      
      // Skip if already a road or already added to adjacent list
      if (roadSet.has(neighborKey) || adjacentSet.has(neighborKey)) {
        continue;
      }

      // Skip if occupied
      if (occupiedHexes.has(neighborKey)) {
        continue;
      }

      // Check if this neighbor is in valid terrain
      const isValidTerrain = validTerrainHexes.some(
        (hex) => hex.q === neighbor.q && hex.r === neighbor.r
      );

      if (isValidTerrain) {
        adjacentHexes.push(neighbor);
        adjacentSet.add(neighborKey);
      }
    }
  }

  return adjacentHexes;
}

