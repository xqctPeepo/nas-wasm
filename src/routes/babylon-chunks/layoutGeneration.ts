/**
 * Layout Generation Module
 * 
 * Handles layout constraint parsing and pre-constraint generation.
 */

import type { LayoutConstraints, BuildingRules, TileType, WasmModuleBabylonChunks } from '../../types';
import type { LlmManager } from './llmManagement';
import type { PatternCacheManager } from './dbManagement';
import type { WasmManager } from './wasmManagement';
import type { CanvasManager } from './canvasManagement';
import { tileTypeFromNumber, tileTypeToNumber } from './wasmManagement';
import * as HexUtils from './hexUtils';
import { showThinkingAnimation, hideThinkingAnimation } from './canvasManagement';

/**
 * Extract function arguments from string
 * Handles formats like: forest=5, water=3 or {"forest": 5, "water": 3}
 */
function extractFunctionArguments(argsString: string): Record<string, string> {
  const result: Record<string, string> = {};
  
  // Try JSON format
  try {
    const parsed: unknown = JSON.parse(argsString);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      for (const [key, value] of Object.entries(parsed)) {
        result[key] = String(value);
      }
      return result;
    }
  } catch {
    // Not JSON, parse key=value format
  }

  // Parse key="value" or key=value format
  const keyValueRegex = /(\w+)\s*=\s*"([^"]*)"|(\w+)\s*=\s*([^\s,)]+)/g;
  let match: RegExpExecArray | null;
  while ((match = keyValueRegex.exec(argsString)) !== null) {
    const key = match[1] || match[3];
    const value = match[2] || match[4];
    if (key) {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Execute a layout function and return updated constraints
 * Functions modify the constraints object that will be used for generation
 */
function executeLayoutFunction(
  functionName: string,
  args: Record<string, string>,
  currentConstraints: LayoutConstraints
): LayoutConstraints {
  const updatedConstraints: LayoutConstraints = { ...currentConstraints };

  if (functionName === 'set_voronoi_seeds') {
    const forest = Number.parseInt(args.forest ?? '0', 10);
    const water = Number.parseInt(args.water ?? '0', 10);
    const grass = Number.parseInt(args.grass ?? '0', 10);
    if (!Number.isNaN(forest) && !Number.isNaN(water) && !Number.isNaN(grass) && forest >= 0 && water >= 0 && grass >= 0) {
      updatedConstraints.voronoiSeeds = { forest, water, grass };
    }
  } else if (functionName === 'set_road_density') {
    const density = parseFloat(args.density ?? '0');
    if (!Number.isNaN(density) && density >= 0 && density <= 1) {
      updatedConstraints.roadDensity = density;
    }
  } else if (functionName === 'set_grid_size') {
    const rings = Number.parseInt(args.rings ?? args.maxLayer ?? '0', 10);
    if (!Number.isNaN(rings) && rings >= 0 && rings <= 50) {
      updatedConstraints.rings = rings;
    }
  } else if (functionName === 'set_building_rules') {
    const buildingRules: BuildingRules = {};
    const minAdjacentRoads = Number.parseInt(args.minAdjacentRoads ?? '0', 10);
    if (!Number.isNaN(minAdjacentRoads) && minAdjacentRoads >= 0) {
      buildingRules.minAdjacentRoads = minAdjacentRoads;
    }
    const minSize = Number.parseInt(args.minSize ?? '0', 10);
    const maxSize = Number.parseInt(args.maxSize ?? '0', 10);
    if (!Number.isNaN(minSize) && !Number.isNaN(maxSize) && minSize > 0 && maxSize >= minSize) {
      buildingRules.sizeConstraints = { min: minSize, max: maxSize };
    }
    if (Object.keys(buildingRules).length > 0) {
      updatedConstraints.buildingRules = buildingRules;
    }
  }

  return updatedConstraints;
}

/**
 * Parse all function calls from output and execute them
 * Returns updated constraints after applying all function calls
 */
export function parseAndExecuteFunctionCalls(
  output: string,
  baseConstraints: LayoutConstraints
): LayoutConstraints {
  let currentConstraints = baseConstraints;
  
  // Try to find multiple function calls using regex patterns
  const functionCallPattern = /\[FUNCTION:\s*(\w+)\s*\(([^)]*)\)\]|(?:call|use|execute|set)\s+(\w+)\s*\(([^)]*)\)/gi;
  let match: RegExpExecArray | null;
  const functionCalls: Array<{ function: string; arguments: string }> = [];

  while ((match = functionCallPattern.exec(output)) !== null) {
    const funcName = match[1] || match[4];
    const args = match[2] || match[5];
    if (funcName && args) {
      functionCalls.push({ function: funcName, arguments: args });
    }
  }

  // Also try JSON format for function calls
  try {
    const jsonMatch = output.match(/\{[\s\S]*"function"[\s\S]*\}/);
    if (jsonMatch) {
      const parsed: unknown = JSON.parse(jsonMatch[0]);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const entries: Array<[string, unknown]> = Object.entries(parsed);
        const funcNameEntry = entries.find(([key]) => key === 'function');
        const argsEntry = entries.find(([key]) => key === 'arguments');
        const funcName = funcNameEntry && typeof funcNameEntry[1] === 'string' ? funcNameEntry[1] : null;
        const args = argsEntry ? argsEntry[1] : null;
        if (funcName && args) {
          functionCalls.push({
            function: funcName,
            arguments: typeof args === 'string' ? args : JSON.stringify(args),
          });
        }
      }
    }
  } catch {
    // Ignore JSON parse errors
  }

  for (const functionCall of functionCalls) {
    const args = extractFunctionArguments(functionCall.arguments);
    currentConstraints = executeLayoutFunction(functionCall.function, args, currentConstraints);
  }

  return currentConstraints;
}

/**
 * Parse layout constraints from Qwen output
 * Handles extended constraints with optional parameters
 * Also extracts specific requests from the original prompt
 * Optionally uses semantic pattern matching for better constraint inference
 */
export async function parseLayoutConstraints(
  output: string,
  originalPrompt: string | undefined,
  llmManager: LlmManager,
  patternCache: PatternCacheManager
): Promise<LayoutConstraints> {
  let result: LayoutConstraints = {
    buildingDensity: 'medium',
    clustering: 'random',
    grassRatio: 0.3,
    buildingSizeHint: 'medium',
  };

  if (originalPrompt) {
    try {
      const cachedPatterns = await patternCache.loadCachedPatterns();
      if (cachedPatterns.length > 0) {
        const bestMatch = await llmManager.findBestMatchingPattern(originalPrompt, cachedPatterns);
        if (bestMatch?.pattern.constraints) {
          result = { ...result, ...bestMatch.pattern.constraints };
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      // Log error if log function available
      console.error(`Semantic pattern matching failed: ${errorMsg}`);
    }
  }

  // Try JSON parsing first
  try {
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed: unknown = JSON.parse(jsonMatch[0]);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const entries: Array<[string, unknown]> = Object.entries(parsed);
        
        // Required fields
        const densityEntry = entries.find(([key]) => key === 'buildingDensity');
        const clusteringEntry = entries.find(([key]) => key === 'clustering');
        const grassRatioEntry = entries.find(([key]) => key === 'grassRatio');
        const sizeEntry = entries.find(([key]) => key === 'buildingSizeHint');

        const density = densityEntry && typeof densityEntry[1] === 'string' ? densityEntry[1] : null;
        const clustering = clusteringEntry && typeof clusteringEntry[1] === 'string' ? clusteringEntry[1] : null;
        const grassRatio = grassRatioEntry && typeof grassRatioEntry[1] === 'number' ? grassRatioEntry[1] : null;
        const size = sizeEntry && typeof sizeEntry[1] === 'string' ? sizeEntry[1] : null;

        if (
          density &&
          (density === 'sparse' || density === 'medium' || density === 'dense') &&
          clustering &&
          (clustering === 'clustered' || clustering === 'distributed' || clustering === 'random') &&
          grassRatio !== null &&
          grassRatio >= 0 &&
          grassRatio <= 1 &&
          size &&
          (size === 'small' || size === 'medium' || size === 'large')
        ) {
          result.buildingDensity = density;
          result.clustering = clustering;
          result.grassRatio = grassRatio;
          result.buildingSizeHint = size;

          // Optional extended fields
          const voronoiSeedsEntry = entries.find(([key]) => key === 'voronoiSeeds');
          if (voronoiSeedsEntry && typeof voronoiSeedsEntry[1] === 'object' && voronoiSeedsEntry[1] !== null && !Array.isArray(voronoiSeedsEntry[1])) {
            const seedsEntries: Array<[string, unknown]> = Object.entries(voronoiSeedsEntry[1]);
            const forestEntry = seedsEntries.find(([key]) => key === 'forest');
            const waterEntry = seedsEntries.find(([key]) => key === 'water');
            const grassEntry = seedsEntries.find(([key]) => key === 'grass');
            
            const forest = forestEntry && typeof forestEntry[1] === 'number' ? forestEntry[1] : null;
            const water = waterEntry && typeof waterEntry[1] === 'number' ? waterEntry[1] : null;
            const grass = grassEntry && typeof grassEntry[1] === 'number' ? grassEntry[1] : null;
            
            if (forest !== null && water !== null && grass !== null && forest >= 0 && water >= 0 && grass >= 0) {
              result.voronoiSeeds = { forest, water, grass };
            }
          }

          const roadDensityEntry = entries.find(([key]) => key === 'roadDensity');
          if (roadDensityEntry && typeof roadDensityEntry[1] === 'number') {
            const density = roadDensityEntry[1];
            if (density >= 0 && density <= 1) {
              result.roadDensity = density;
            }
          }

          const ringsEntry = entries.find(([key]) => key === 'rings');
          if (ringsEntry && typeof ringsEntry[1] === 'number') {
            const rings = ringsEntry[1];
            if (rings >= 0 && rings <= 50) {
              // Only set if not already set from prompt extraction
              if (result.rings === undefined) {
                result.rings = rings;
              }
            }
          }
          // Legacy support: also check for maxLayer
          const maxLayerEntry = entries.find(([key]) => key === 'maxLayer');
          if (maxLayerEntry && typeof maxLayerEntry[1] === 'number' && result.rings === undefined) {
            const maxLayer = maxLayerEntry[1];
            if (maxLayer > 0 && maxLayer <= 50) {
              result.rings = maxLayer;
            }
          }

          const buildingRulesEntry = entries.find(([key]) => key === 'buildingRules');
          if (buildingRulesEntry && typeof buildingRulesEntry[1] === 'object' && buildingRulesEntry[1] !== null && !Array.isArray(buildingRulesEntry[1])) {
            const rulesEntries: Array<[string, unknown]> = Object.entries(buildingRulesEntry[1]);
            const buildingRules: BuildingRules = {};
            
            const minAdjacentRoadsEntry = rulesEntries.find(([key]) => key === 'minAdjacentRoads');
            if (minAdjacentRoadsEntry && typeof minAdjacentRoadsEntry[1] === 'number') {
              const minAdjacentRoads = minAdjacentRoadsEntry[1];
              if (minAdjacentRoads >= 0) {
                buildingRules.minAdjacentRoads = minAdjacentRoads;
              }
            }

            const sizeConstraintsEntry = rulesEntries.find(([key]) => key === 'sizeConstraints');
            if (sizeConstraintsEntry && typeof sizeConstraintsEntry[1] === 'object' && sizeConstraintsEntry[1] !== null && !Array.isArray(sizeConstraintsEntry[1])) {
              const sizeEntries: Array<[string, unknown]> = Object.entries(sizeConstraintsEntry[1]);
              const minEntry = sizeEntries.find(([key]) => key === 'min');
              const maxEntry = sizeEntries.find(([key]) => key === 'max');
              
              const min = minEntry && typeof minEntry[1] === 'number' ? minEntry[1] : null;
              const max = maxEntry && typeof maxEntry[1] === 'number' ? maxEntry[1] : null;
              
              if (min !== null && max !== null && min > 0 && max >= min) {
                buildingRules.sizeConstraints = { min, max };
              }
            }

            if (Object.keys(buildingRules).length > 0) {
              result.buildingRules = buildingRules;
            }
          }

          return result;
        }
      }
    }
  } catch {
    // JSON parsing failed, try regex
  }

  // Fallback to regex parsing (only for required fields)
  const densityMatch = output.match(/buildingDensity["\s:]+(sparse|medium|dense)/i);
  const clusteringMatch = output.match(/clustering["\s:]+(clustered|distributed|random)/i);
  const grassRatioMatch = output.match(/grassRatio["\s:]+([\d.]+)/i);
  const sizeMatch = output.match(/buildingSizeHint["\s:]+(small|medium|large)/i);

  if (densityMatch && (densityMatch[1] === 'sparse' || densityMatch[1] === 'medium' || densityMatch[1] === 'dense')) {
    result.buildingDensity = densityMatch[1];
  }
  if (clusteringMatch && (clusteringMatch[1] === 'clustered' || clusteringMatch[1] === 'distributed' || clusteringMatch[1] === 'random')) {
    result.clustering = clusteringMatch[1];
  }
  if (grassRatioMatch) {
    const grassRatio = parseFloat(grassRatioMatch[1]);
    if (!Number.isNaN(grassRatio)) {
      result.grassRatio = Math.max(0, Math.min(1, grassRatio));
    }
  }
  if (sizeMatch && (sizeMatch[1] === 'small' || sizeMatch[1] === 'medium' || sizeMatch[1] === 'large')) {
    result.buildingSizeHint = sizeMatch[1];
  }

  return result;
}

/**
 * Convert layout constraints to pre-constraints
 * 
 * Simplified version: Sets tile types for all hexagon tiles using hash map storage.
 * No bounds checking needed - all hexagon tiles are stored.
 * 
 * Now includes:
 * - Voronoi region priors for forest, water, and grass
 * - Road connectivity validation
 * - Road and building placement restricted to grass/forest (not water)
 * - Buildings must be adjacent to at least one road
 * 
 * This function is async to avoid blocking the main thread during generation.
 */
export async function constraintsToPreConstraints(
  constraints: LayoutConstraints,
  wasmModule: WasmModuleBabylonChunks,
  currentRings: number,
  setCurrentRings: (rings: number) => void,
  logFn?: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void
): Promise<Array<{ q: number; r: number; tileType: TileType }>> {
  const rings = constraints.rings ?? currentRings;
  setCurrentRings(rings);
  
  // Yield control before starting heavy computation
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
  
  const centerQ = 0;
  const centerR = 0;
  const hexGrid = HexUtils.HEX_UTILS.generateHexGrid(rings, centerQ, centerR);

  // Step 1: Generate Voronoi regions for forest, water, and grass using WASM
  // Use voronoiSeeds from constraints or default values
  const baseVoronoiSeeds = constraints.voronoiSeeds ?? { forest: 4, water: 3, grass: 6 };
  
  // Create a copy to modify
  const voronoiSeeds = {
    forest: baseVoronoiSeeds.forest,
    water: baseVoronoiSeeds.water,
    grass: baseVoronoiSeeds.grass,
  };
  
  const excludeTypes = constraints.excludeTileTypes ?? [];
  if (excludeTypes.includes('forest')) {
    voronoiSeeds.forest = 0;
  }
  if (excludeTypes.includes('water')) {
    voronoiSeeds.water = 0;
  }
  if (excludeTypes.includes('grass')) {
    voronoiSeeds.grass = 0;
  }

  const primaryTileType = constraints.primaryTileType;
  if (primaryTileType) {
    if (primaryTileType === 'forest') {
      voronoiSeeds.forest = Math.max(8, voronoiSeeds.forest * 2);
      voronoiSeeds.water = Math.max(1, Math.floor(voronoiSeeds.water * 0.5));
      voronoiSeeds.grass = Math.max(2, Math.floor(voronoiSeeds.grass * 0.5));
    } else if (primaryTileType === 'water') {
      voronoiSeeds.water = Math.max(6, voronoiSeeds.water * 2);
      voronoiSeeds.forest = Math.max(1, Math.floor(voronoiSeeds.forest * 0.5));
      voronoiSeeds.grass = Math.max(2, Math.floor(voronoiSeeds.grass * 0.5));
    } else if (primaryTileType === 'grass') {
      voronoiSeeds.grass = Math.max(10, voronoiSeeds.grass * 2);
      voronoiSeeds.forest = Math.max(1, Math.floor(voronoiSeeds.forest * 0.5));
      voronoiSeeds.water = Math.max(1, Math.floor(voronoiSeeds.water * 0.5));
    }
  }

  const forestSeeds = voronoiSeeds.forest;
  const waterSeeds = voronoiSeeds.water;
  const grassSeeds = voronoiSeeds.grass;

  if (logFn) {
    logFn(`Generating Voronoi regions: ${forestSeeds} forest, ${waterSeeds} water, ${grassSeeds} grass seeds`, 'info');
  }

  // Call WASM function with error handling
  let voronoiJson: string;
  try {
    const result = wasmModule.generate_voronoi_regions(
      rings,
      centerQ,
      centerR,
      forestSeeds,
      waterSeeds,
      grassSeeds
    );
    
    voronoiJson = typeof result === 'string' ? result : '[]';
    
    // Yield control after WASM call
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    if (logFn) {
      logFn(`Error calling generate_voronoi_regions: ${errorMsg}`, 'error');
    }
    voronoiJson = '[]';
  }

  const voronoiConstraints: Array<{ q: number; r: number; tileType: TileType }> = [];
  try {
    const parsed: unknown = JSON.parse(voronoiJson);
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
          if ('q' in item && 'r' in item && 'tileType' in item) {
            // Use Object.getOwnPropertyDescriptor for safe property access
            const qDesc = Object.getOwnPropertyDescriptor(item, 'q');
            const rDesc = Object.getOwnPropertyDescriptor(item, 'r');
            const tileTypeDesc = Object.getOwnPropertyDescriptor(item, 'tileType');
            
            if (!qDesc || !rDesc || !tileTypeDesc || !('value' in qDesc) || !('value' in rDesc) || !('value' in tileTypeDesc)) {
              continue;
            }
            
            const qValue: unknown = qDesc.value;
            const rValue: unknown = rDesc.value;
            const tileTypeValue: unknown = tileTypeDesc.value;
            
            if (
              typeof qValue === 'number' &&
              typeof rValue === 'number' &&
              typeof tileTypeValue === 'number'
            ) {
              const tileType = tileTypeFromNumber(tileTypeValue);
              if (tileType) {
                voronoiConstraints.push({ q: qValue, r: rValue, tileType });
              }
            }
          }
        }
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    if (logFn) {
      logFn(`Failed to parse Voronoi regions: ${errorMsg}`, 'warning');
    }
  }

  // Step 2: Create a set of occupied hexes from Voronoi regions
  // Only water tiles are considered "occupied" - grass and forest can be overridden by roads/buildings
  const occupiedHexes = new Set<string>();
  for (const constraint of voronoiConstraints) {
    if (constraint.tileType.type === 'water') {
      occupiedHexes.add(`${constraint.q},${constraint.r}`);
    }
  }

  // Step 3: Generate roads on valid terrain (grass/forest only) using growing tree algorithm
  // This ensures all roads form a single connected component
  const roadConstraints: Array<{ q: number; r: number; tileType: TileType }> = [];

  // Get valid terrain hexes (grass/forest only, not water)
  const validTerrainHexes: Array<HexUtils.HexCoord> = [];
  const voronoiMap = new Map<string, TileType>();
  for (const constraint of voronoiConstraints) {
    voronoiMap.set(`${constraint.q},${constraint.r}`, constraint.tileType);
  }
  for (const hex of hexGrid) {
    const tileType = voronoiMap.get(`${hex.q},${hex.r}`);
    if (tileType && (tileType.type === 'grass' || tileType.type === 'forest')) {
      validTerrainHexes.push(hex);
    }
  }

  const roadDensity = constraints.roadDensity ?? 0.1;
  const targetRoadCount = Math.floor(validTerrainHexes.length * roadDensity);

  // Create set of valid terrain for A* pathfinding
  const validTerrainSet = new Set<string>();
  for (const hex of validTerrainHexes) {
    validTerrainSet.add(`${hex.q},${hex.r}`);
  }

  // Helper function to check if a hex is valid for road placement
  const isValidForRoad = (q: number, r: number): boolean => {
    const hexKey = `${q},${r}`;
    return validTerrainSet.has(hexKey) && !occupiedHexes.has(hexKey);
  };

  // Step 3a: Select seed points (20-30% of target road count, distributed across terrain)
  const seedCount = Math.max(1, Math.floor(targetRoadCount * 0.25));
  const availableForSeeds: Array<HexUtils.HexCoord> = [];
  for (const hex of validTerrainHexes) {
    const hexKey = `${hex.q},${hex.r}`;
    if (!occupiedHexes.has(hexKey)) {
      availableForSeeds.push(hex);
    }
  }

  // Shuffle and select seed points
  for (let i = availableForSeeds.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = availableForSeeds[i];
    if (temp && availableForSeeds[j]) {
      availableForSeeds[i] = availableForSeeds[j];
      availableForSeeds[j] = temp;
    }
  }

  const seedPoints = availableForSeeds.slice(0, Math.min(seedCount, availableForSeeds.length));

  let roadNetwork: Array<HexUtils.HexCoord> = [];
  
  const seedsJson = JSON.stringify(seedPoints);
  const validTerrainJson = JSON.stringify(validTerrainHexes);
  const occupiedArray: Array<HexUtils.HexCoord> = [];
  for (const key of occupiedHexes) {
    const parts = key.split(',');
    if (parts.length === 2) {
      const q = Number.parseInt(parts[0] ?? '0', 10);
      const r = Number.parseInt(parts[1] ?? '0', 10);
      if (!Number.isNaN(q) && !Number.isNaN(r)) {
        occupiedArray.push({ q, r });
      }
    }
  }
  const occupiedJson = JSON.stringify(occupiedArray);
  
  const result = wasmModule.generate_road_network_growing_tree(
    seedsJson,
    validTerrainJson,
    occupiedJson,
    targetRoadCount
  );
  
  // Yield control after WASM road generation
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
  
  const parsedRoads = HexUtils.parseHexCoordArray(result);
  if (parsedRoads) {
    roadNetwork = parsedRoads;
    for (const road of roadNetwork) {
      occupiedHexes.add(`${road.q},${road.r}`);
    }
  }
  
  if (roadNetwork.length === 0) {
    // Start with first seed point
    if (seedPoints.length > 0) {
      const firstSeed = seedPoints[0];
      if (firstSeed) {
        roadNetwork.push(firstSeed);
        occupiedHexes.add(`${firstSeed.q},${firstSeed.r}`);
      }
    }

    // Connect remaining seed points to the network
    for (let i = 1; i < seedPoints.length; i++) {
      const seed = seedPoints[i];
      if (!seed) {
        continue;
      }

      // Find nearest road in current network
      const nearestRoad = HexUtils.findNearestRoad(seed, roadNetwork);
      if (!nearestRoad) {
        // Shouldn't happen, but add seed directly if no network exists
        roadNetwork.push(seed);
        occupiedHexes.add(`${seed.q},${seed.r}`);
        continue;
      }

      // Build path from nearest road to seed
      const path = HexUtils.buildPathBetweenRoads(nearestRoad, seed, isValidForRoad, wasmModule, hexGrid);
      if (path && path.length > 0) {
        // Add all hexes along the path to the network
        for (const pathHex of path) {
          const pathKey = `${pathHex.q},${pathHex.r}`;
          if (!occupiedHexes.has(pathKey)) {
            roadNetwork.push(pathHex);
            occupiedHexes.add(pathKey);
          }
        }
        // Add the seed itself (end of path) if not already added
        const seedKey = `${seed.q},${seed.r}`;
        if (!occupiedHexes.has(seedKey)) {
          roadNetwork.push(seed);
          occupiedHexes.add(seedKey);
        }
      }
    }

    while (roadNetwork.length < targetRoadCount) {
      const adjacentHexes = HexUtils.getAdjacentValidTerrain(roadNetwork, validTerrainHexes, occupiedHexes);
      if (adjacentHexes.length === 0) {
        break;
      }

      // Shuffle adjacent hexes for random selection
      for (let i = adjacentHexes.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const temp = adjacentHexes[i];
        if (temp && adjacentHexes[j]) {
          adjacentHexes[i] = adjacentHexes[j];
          adjacentHexes[j] = temp;
        }
      }

      // Add first available adjacent hex
      const newRoad = adjacentHexes[0];
      if (newRoad) {
        roadNetwork.push(newRoad);
        occupiedHexes.add(`${newRoad.q},${newRoad.r}`);
      } else {
        break;
      }
    }
  }

  // Convert road network to constraints
  for (const road of roadNetwork) {
    roadConstraints.push({ q: road.q, r: road.r, tileType: { type: 'road' } });
  }

  const roadsJson = JSON.stringify(roadConstraints.map((rc) => ({ q: rc.q, r: rc.r })));
  const roadsConnected = wasmModule.validate_road_connectivity(roadsJson);
  if (!roadsConnected && logFn) {
    logFn('Road connectivity validation failed', 'error');
  }

  // Step 4: Generate buildings on valid terrain (grass/forest only) adjacent to roads
  const buildingConstraints: Array<{ q: number; r: number; tileType: TileType }> = [];
  const availableBuildingHexes: Array<HexUtils.HexCoord> = [];

  // Get building rules from constraints
  const buildingRules = constraints.buildingRules;
  const minAdjacentRoads = buildingRules?.minAdjacentRoads ?? 1;

  // Helper function to count adjacent roads
  const countAdjacentRoads = (q: number, r: number): number => {
    const neighbors = HexUtils.HEX_UTILS.getNeighbors(q, r);
    let count = 0;
    for (const neighbor of neighbors) {
      if (roadConstraints.some((rc) => rc.q === neighbor.q && rc.r === neighbor.r)) {
        count += 1;
      }
    }
    return count;
  };

  // Find available hexes for buildings (only on valid terrain, not already occupied, adjacent to roads)
  for (const hex of validTerrainHexes) {
    const hexKey = `${hex.q},${hex.r}`;
    if (!occupiedHexes.has(hexKey)) {
      const adjacentRoadCount = countAdjacentRoads(hex.q, hex.r);
      if (adjacentRoadCount >= minAdjacentRoads) {
        availableBuildingHexes.push(hex);
      }
    }
  }

  // Shuffle available building hexes for random placement
  for (let i = availableBuildingHexes.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = availableBuildingHexes[i];
    if (temp && availableBuildingHexes[j]) {
      availableBuildingHexes[i] = availableBuildingHexes[j];
      availableBuildingHexes[j] = temp;
    }
  }

  let targetBuildingCount: number;
  if (constraints.buildingCount !== undefined) {
    targetBuildingCount = constraints.buildingCount;
  } else {
    const buildingDensity = constraints.buildingDensity;
    const buildingRatio = buildingDensity === 'sparse' ? 0.05 : buildingDensity === 'dense' ? 0.15 : 0.1;
    targetBuildingCount = Math.floor(availableBuildingHexes.length * buildingRatio);
  }

  // Limit to available hexes
  const buildingCount = Math.min(targetBuildingCount, availableBuildingHexes.length);
  for (let i = 0; i < buildingCount && i < availableBuildingHexes.length; i++) {
    const hex = availableBuildingHexes[i];
    if (hex) {
      // Double-check adjacency (in case roads changed during retries)
      const roadSet = new Set<string>();
      for (const road of roadConstraints) {
        roadSet.add(`${road.q},${road.r}`);
      }
      const neighbors = HexUtils.HEX_UTILS.getNeighbors(hex.q, hex.r);
      const isAdjacent = neighbors.some((neighbor) => roadSet.has(`${neighbor.q},${neighbor.r}`));
      if (isAdjacent) {
        buildingConstraints.push({ q: hex.q, r: hex.r, tileType: { type: 'building' } });
        occupiedHexes.add(`${hex.q},${hex.r}`);
      }
    }
  }

  // Yield control after building generation
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });

  // Step 5: Fill remaining tiles with grass
  const allConstraints = [...voronoiConstraints, ...buildingConstraints, ...roadConstraints];
  const finalOccupied = new Set<string>();
  for (const constraint of allConstraints) {
    finalOccupied.add(`${constraint.q},${constraint.r}`);
  }

  const grassConstraints: Array<{ q: number; r: number; tileType: TileType }> = [];
  // Process grass constraints in batches to avoid blocking
  const BATCH_SIZE = 500;
  for (let i = 0; i < hexGrid.length; i += BATCH_SIZE) {
    const batch = hexGrid.slice(i, Math.min(i + BATCH_SIZE, hexGrid.length));
    for (const hex of batch) {
      const hexKey = `${hex.q},${hex.r}`;
      if (!finalOccupied.has(hexKey)) {
        grassConstraints.push({ q: hex.q, r: hex.r, tileType: { type: 'grass' } });
      }
    }
    
    // Yield control if not last batch
    if (i + BATCH_SIZE < hexGrid.length) {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    }
  }

  // Combine all constraints
  const preConstraints = [...voronoiConstraints, ...buildingConstraints, ...roadConstraints, ...grassConstraints];

  return preConstraints;
}

/**
 * Generate layout from text prompt
 */
export async function generateLayoutFromText(
  prompt: string,
  wasmManager: WasmManager,
  llmManager: LlmManager,
  patternCache: PatternCacheManager,
  canvasManager: CanvasManager,
  renderGrid: (constraints?: LayoutConstraints) => void,
  errorEl: HTMLElement | null,
  modelStatusEl: HTMLElement | null,
  logFn?: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void
): Promise<void> {
  const wasmModule = wasmManager.getModule();
  if (!wasmModule) {
    if (errorEl) {
      errorEl.textContent = 'WASM module not loaded';
    }
    return;
  }

  // Track when thinking animation was shown for minimum display time
  const thinkingStartTime = Date.now();
  const minDisplayTime = 2000; // 2 seconds minimum

  try {
    await showThinkingAnimation(logFn);

    if (modelStatusEl) {
      modelStatusEl.textContent = 'Loading Qwen model...';
    }

    await llmManager.loadQwenModel((progress) => {
      if (modelStatusEl) {
        modelStatusEl.textContent = `Loading model: ${Math.floor(progress * 100)}%`;
      }
    });

    if (modelStatusEl) {
      modelStatusEl.textContent = 'Generating 3D grid layout...';
    }

    const layoutDescription = await llmManager.generateLayoutDescription(prompt);

    if (modelStatusEl) {
      modelStatusEl.textContent = 'Parsing constraints...';
    }

    let constraints = await parseLayoutConstraints(layoutDescription, prompt, llmManager, patternCache);
    constraints = parseAndExecuteFunctionCalls(layoutDescription, constraints);

    if (modelStatusEl) {
      modelStatusEl.textContent = 'Applying constraints...';
    }

    wasmModule.clear_pre_constraints();
    const preConstraints = await constraintsToPreConstraints(
      constraints,
      wasmModule,
      canvasManager.getCurrentRings(),
      (rings) => canvasManager.setCurrentRings(rings),
      logFn
    );

    for (const preConstraint of preConstraints) {
      const tileNum = tileTypeToNumber(preConstraint.tileType);
      wasmModule.set_pre_constraint(preConstraint.q, preConstraint.r, tileNum);
    }

    if (modelStatusEl) {
      modelStatusEl.textContent = 'Generating layout...';
    }

    wasmModule.generate_layout();

    if (modelStatusEl) {
      modelStatusEl.textContent = 'Rendering...';
    }

    renderGrid(constraints);

    if (modelStatusEl) {
      modelStatusEl.textContent = 'Ready';
    }

    // Hide thinking animation with minimum display time
    const elapsed = Date.now() - thinkingStartTime;
    const remainingTime = elapsed < minDisplayTime ? minDisplayTime - elapsed : 0;
    
    if (remainingTime > 0) {
      // Use requestAnimationFrame to wait for remaining time
      const targetFrames = Math.ceil(remainingTime / 16); // ~60fps = ~16ms per frame
      let frameCount = 0;
      const delayFrames = (): void => {
        frameCount++;
        if (frameCount < targetFrames) {
          requestAnimationFrame(delayFrames);
        } else {
          hideThinkingAnimation(logFn);
        }
      };
      requestAnimationFrame(delayFrames);
    } else {
      requestAnimationFrame(() => {
        hideThinkingAnimation(logFn);
      });
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    if (logFn) {
      logFn(`Error during layout generation: ${errorMsg}`, 'error');
    }
    if (errorEl) {
      errorEl.textContent = `Error generating layout: ${errorMsg}`;
    }
    if (modelStatusEl) {
      modelStatusEl.textContent = 'Error';
    }
    hideThinkingAnimation(logFn);
  }
}

