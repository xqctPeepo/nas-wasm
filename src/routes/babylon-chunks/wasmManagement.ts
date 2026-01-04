/**
 * WASM Management Module
 * 
 * Handles WASM module loading, validation, and function wrappers.
 */

import type { WasmModuleBabylonChunks, TileType } from '../../types';
import { loadWasmModule, validateWasmModule } from '../../wasm/loader';
import { WasmInitError } from '../../wasm/types';

/**
 * WASM Manager class for loading and managing WASM module
 */
export class WasmManager {
  private wasmModuleRecord: Record<string, unknown> | null = null;
  private wasmModule: WasmModuleBabylonChunks | null = null;

  /**
   * Get the WASM module initialization function
   */
  private async getInitWasm(): Promise<unknown> {
    if (!this.wasmModuleRecord) {
      // Import path will be rewritten by vite plugin to absolute path in production
      const moduleUnknown: unknown = await import('../../../pkg/wasm_babylon_chunks/wasm_babylon_chunks.js');
      
      if (typeof moduleUnknown !== 'object' || moduleUnknown === null) {
        throw new Error('Imported module is not an object');
      }
      
      const moduleKeys = Object.keys(moduleUnknown);
      
      if (!('default' in moduleUnknown) || typeof moduleUnknown.default !== 'function') {
        throw new Error(`Module missing 'default' export. Available: ${moduleKeys.join(', ')}`);
      }
      if (!('generate_layout' in moduleUnknown) || typeof moduleUnknown.generate_layout !== 'function') {
        throw new Error(`Module missing 'generate_layout' export. Available: ${moduleKeys.join(', ')}`);
      }
      if (!('get_tile_at' in moduleUnknown) || typeof moduleUnknown.get_tile_at !== 'function') {
        throw new Error(`Module missing 'get_tile_at' export. Available: ${moduleKeys.join(', ')}`);
      }
      if (!('clear_layout' in moduleUnknown) || typeof moduleUnknown.clear_layout !== 'function') {
        throw new Error(`Module missing 'clear_layout' export. Available: ${moduleKeys.join(', ')}`);
      }
      if (!('set_pre_constraint' in moduleUnknown) || typeof moduleUnknown.set_pre_constraint !== 'function') {
        throw new Error(`Module missing 'set_pre_constraint' export. Available: ${moduleKeys.join(', ')}`);
      }
      if (!('clear_pre_constraints' in moduleUnknown) || typeof moduleUnknown.clear_pre_constraints !== 'function') {
        throw new Error(`Module missing 'clear_pre_constraints' export. Available: ${moduleKeys.join(', ')}`);
      }
      if (!('get_stats' in moduleUnknown) || typeof moduleUnknown.get_stats !== 'function') {
        throw new Error(`Module missing 'get_stats' export. Available: ${moduleKeys.join(', ')}`);
      }
      if (!('generate_voronoi_regions' in moduleUnknown) || typeof moduleUnknown.generate_voronoi_regions !== 'function') {
        throw new Error(`Module missing 'generate_voronoi_regions' export. Available: ${moduleKeys.join(', ')}`);
      }
      if (!('validate_road_connectivity' in moduleUnknown) || typeof moduleUnknown.validate_road_connectivity !== 'function') {
        throw new Error(`Module missing 'validate_road_connectivity' export. Available: ${moduleKeys.join(', ')}`);
      }
      if (!('hex_astar' in moduleUnknown) || typeof moduleUnknown.hex_astar !== 'function') {
        throw new Error(`Module missing 'hex_astar' export. Available: ${moduleKeys.join(', ')}`);
      }
      if (!('build_path_between_roads' in moduleUnknown) || typeof moduleUnknown.build_path_between_roads !== 'function') {
        throw new Error(`Module missing 'build_path_between_roads' export. Available: ${moduleKeys.join(', ')}`);
      }
      if (!('generate_road_network_growing_tree' in moduleUnknown) || typeof moduleUnknown.generate_road_network_growing_tree !== 'function') {
        throw new Error(`Module missing 'generate_road_network_growing_tree' export. Available: ${moduleKeys.join(', ')}`);
      }
      if (!('get_wasm_version' in moduleUnknown) || typeof moduleUnknown.get_wasm_version !== 'function') {
        throw new Error(`Module missing 'get_wasm_version' export. Available: ${moduleKeys.join(', ')}`);
      }
      
      // Store module as Record after validation
      // TypeScript can't narrow dynamic import types, so we use Record pattern
      // We've validated all properties exist, so this is safe
      const record: Record<string, unknown> = {};
      for (const key of Object.keys(moduleUnknown)) {
        const descriptor = Object.getOwnPropertyDescriptor(moduleUnknown, key);
        if (descriptor && 'value' in descriptor) {
          record[key] = descriptor.value;
        }
      }
      this.wasmModuleRecord = record;
    }
    
    if (!this.wasmModuleRecord) {
      throw new Error('Failed to initialize module record');
    }
    
    const defaultFunc = this.wasmModuleRecord.default;
    if (typeof defaultFunc !== 'function') {
      throw new Error('default export is not a function');
    }
    
    // Call the function - we've validated it's a function
    // TypeScript can't narrow Function to specific signature, but runtime is safe
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
    const result = defaultFunc();
    if (!(result instanceof Promise)) {
      throw new Error('default export did not return a Promise');
    }
    
    return result;
  }

  /**
   * Validate that the WASM module has all required exports
   */
  private validateBabylonChunksModule(exports: unknown): WasmModuleBabylonChunks | null {
    if (!validateWasmModule(exports)) {
      return null;
    }
    
    if (typeof exports !== 'object' || exports === null) {
      return null;
    }
    
    const getProperty = (obj: object, key: string): unknown => {
      const descriptor = Object.getOwnPropertyDescriptor(obj, key);
      return descriptor ? descriptor.value : undefined;
    };
    
    const exportKeys = Object.keys(exports);
    const missingExports: string[] = [];
    
    const memoryValue = getProperty(exports, 'memory');
    if (!memoryValue || !(memoryValue instanceof WebAssembly.Memory)) {
      missingExports.push('memory (WebAssembly.Memory)');
    }
    
    // Validate all required functions exist on exports
    // All functions should be on the module object (wasmModuleRecord), not the init result
    // This matches the pattern used for get_wasm_version which works correctly
    const generateLayoutValue = this.wasmModuleRecord ? getProperty(this.wasmModuleRecord, 'generate_layout') : getProperty(exports, 'generate_layout');
    const getTileAtValue = this.wasmModuleRecord ? getProperty(this.wasmModuleRecord, 'get_tile_at') : getProperty(exports, 'get_tile_at');
    const clearLayoutValue = this.wasmModuleRecord ? getProperty(this.wasmModuleRecord, 'clear_layout') : getProperty(exports, 'clear_layout');
    const setPreConstraintValue = this.wasmModuleRecord ? getProperty(this.wasmModuleRecord, 'set_pre_constraint') : getProperty(exports, 'set_pre_constraint');
    const clearPreConstraintsValue = this.wasmModuleRecord ? getProperty(this.wasmModuleRecord, 'clear_pre_constraints') : getProperty(exports, 'clear_pre_constraints');
    const getStatsValue = this.wasmModuleRecord ? getProperty(this.wasmModuleRecord, 'get_stats') : getProperty(exports, 'get_stats');
    const generateVoronoiRegionsValue = this.wasmModuleRecord ? getProperty(this.wasmModuleRecord, 'generate_voronoi_regions') : getProperty(exports, 'generate_voronoi_regions');
    const validateRoadConnectivityValue = this.wasmModuleRecord ? getProperty(this.wasmModuleRecord, 'validate_road_connectivity') : getProperty(exports, 'validate_road_connectivity');
    const hexAstarValue = this.wasmModuleRecord ? getProperty(this.wasmModuleRecord, 'hex_astar') : getProperty(exports, 'hex_astar');
    const buildPathBetweenRoadsValue = this.wasmModuleRecord ? getProperty(this.wasmModuleRecord, 'build_path_between_roads') : getProperty(exports, 'build_path_between_roads');
    const generateRoadNetworkGrowingTreeValue = this.wasmModuleRecord ? getProperty(this.wasmModuleRecord, 'generate_road_network_growing_tree') : getProperty(exports, 'generate_road_network_growing_tree');
    const getWasmVersionValue = this.wasmModuleRecord ? getProperty(this.wasmModuleRecord, 'get_wasm_version') : getProperty(exports, 'get_wasm_version');
    const calculateChunkRadiusValue = this.wasmModuleRecord ? getProperty(this.wasmModuleRecord, 'calculate_chunk_radius') : getProperty(exports, 'calculate_chunk_radius');
    const calculateChunkNeighborsValue = this.wasmModuleRecord ? getProperty(this.wasmModuleRecord, 'calculate_chunk_neighbors') : getProperty(exports, 'calculate_chunk_neighbors');
    const findNearestNeighborChunkValue = this.wasmModuleRecord ? getProperty(this.wasmModuleRecord, 'find_nearest_neighbor_chunk') : getProperty(exports, 'find_nearest_neighbor_chunk');
    const disableDistantChunksValue = this.wasmModuleRecord ? getProperty(this.wasmModuleRecord, 'disable_distant_chunks') : getProperty(exports, 'disable_distant_chunks');
    const batchGetTileTypesValue = this.wasmModuleRecord ? getProperty(this.wasmModuleRecord, 'batch_get_tile_types') : getProperty(exports, 'batch_get_tile_types');
    const calculateChunkForTileValue = this.wasmModuleRecord ? getProperty(this.wasmModuleRecord, 'calculate_chunk_for_tile') : getProperty(exports, 'calculate_chunk_for_tile');
    const shuffleArrayValue = this.wasmModuleRecord ? getProperty(this.wasmModuleRecord, 'shuffle_array') : getProperty(exports, 'shuffle_array');
    const countAdjacentRoadsValue = this.wasmModuleRecord ? getProperty(this.wasmModuleRecord, 'count_adjacent_roads') : getProperty(exports, 'count_adjacent_roads');
    const getAdjacentValidTerrainValue = this.wasmModuleRecord ? getProperty(this.wasmModuleRecord, 'get_adjacent_valid_terrain') : getProperty(exports, 'get_adjacent_valid_terrain');
    const generateBuildingPlacementValue = this.wasmModuleRecord ? getProperty(this.wasmModuleRecord, 'generate_building_placement') : getProperty(exports, 'generate_building_placement');
    const batchHexToWorldValue = this.wasmModuleRecord ? getProperty(this.wasmModuleRecord, 'batch_hex_to_world') : getProperty(exports, 'batch_hex_to_world');
    
    if (typeof generateLayoutValue !== 'function') {
      missingExports.push('generate_layout (function)');
    }
    if (typeof getTileAtValue !== 'function') {
      missingExports.push('get_tile_at (function)');
    }
    if (typeof clearLayoutValue !== 'function') {
      missingExports.push('clear_layout (function)');
    }
    if (typeof setPreConstraintValue !== 'function') {
      missingExports.push('set_pre_constraint (function)');
    }
    if (typeof clearPreConstraintsValue !== 'function') {
      missingExports.push('clear_pre_constraints (function)');
    }
    if (typeof getStatsValue !== 'function') {
      missingExports.push('get_stats (function)');
    }
    if (typeof generateVoronoiRegionsValue !== 'function') {
      missingExports.push('generate_voronoi_regions (function)');
    }
    if (typeof validateRoadConnectivityValue !== 'function') {
      missingExports.push('validate_road_connectivity (function)');
    }
    if (typeof hexAstarValue !== 'function') {
      missingExports.push('hex_astar (function)');
    }
    if (typeof buildPathBetweenRoadsValue !== 'function') {
      missingExports.push('build_path_between_roads (function)');
    }
    if (typeof generateRoadNetworkGrowingTreeValue !== 'function') {
      missingExports.push('generate_road_network_growing_tree (function)');
    }
    if (typeof calculateChunkRadiusValue !== 'function') {
      missingExports.push('calculate_chunk_radius (function)');
    }
    if (typeof calculateChunkNeighborsValue !== 'function') {
      missingExports.push('calculate_chunk_neighbors (function)');
    }
    if (typeof findNearestNeighborChunkValue !== 'function') {
      missingExports.push('find_nearest_neighbor_chunk (function)');
    }
    if (typeof disableDistantChunksValue !== 'function') {
      missingExports.push('disable_distant_chunks (function)');
    }
    if (typeof batchGetTileTypesValue !== 'function') {
      missingExports.push('batch_get_tile_types (function)');
    }
    if (typeof calculateChunkForTileValue !== 'function') {
      missingExports.push('calculate_chunk_for_tile (function)');
    }
    if (typeof shuffleArrayValue !== 'function') {
      missingExports.push('shuffle_array (function)');
    }
    if (typeof countAdjacentRoadsValue !== 'function') {
      missingExports.push('count_adjacent_roads (function)');
    }
    if (typeof getAdjacentValidTerrainValue !== 'function') {
      missingExports.push('get_adjacent_valid_terrain (function)');
    }
    if (typeof generateBuildingPlacementValue !== 'function') {
      missingExports.push('generate_building_placement (function)');
    }
    if (typeof batchHexToWorldValue !== 'function') {
      missingExports.push('batch_hex_to_world (function)');
    }
    
    if (missingExports.length > 0) {
      throw new Error(`WASM module missing required exports: ${missingExports.join(', ')}. Available exports from init result: ${exportKeys.join(', ')}`);
    }
    
    const memory = memoryValue;
    if (!(memory instanceof WebAssembly.Memory)) {
      return null;
    }
    
    // Extract functions from exports after validation
    const generateLayoutFunc = generateLayoutValue;
    const getTileAtFunc = getTileAtValue;
    const clearLayoutFunc = clearLayoutValue;
    const setPreConstraintFunc = setPreConstraintValue;
    const clearPreConstraintsFunc = clearPreConstraintsValue;
    const getStatsFunc = getStatsValue;
    const generateVoronoiRegionsFunc = generateVoronoiRegionsValue;
    const validateRoadConnectivityFunc = validateRoadConnectivityValue;
    const hexAstarFunc = hexAstarValue;
    const buildPathBetweenRoadsFunc = buildPathBetweenRoadsValue;
    const generateRoadNetworkGrowingTreeFunc = generateRoadNetworkGrowingTreeValue;
    const getWasmVersionFunc = getWasmVersionValue;
    const calculateChunkRadiusFunc = calculateChunkRadiusValue;
    const calculateChunkNeighborsFunc = calculateChunkNeighborsValue;
    const findNearestNeighborChunkFunc = findNearestNeighborChunkValue;
    const disableDistantChunksFunc = disableDistantChunksValue;
    const batchGetTileTypesFunc = batchGetTileTypesValue;
    const calculateChunkForTileFunc = calculateChunkForTileValue;
    const shuffleArrayFunc = shuffleArrayValue;
    const countAdjacentRoadsFunc = countAdjacentRoadsValue;
    const getAdjacentValidTerrainFunc = getAdjacentValidTerrainValue;
    const generateBuildingPlacementFunc = generateBuildingPlacementValue;
    const batchHexToWorldFunc = batchHexToWorldValue;
    
    if (
      typeof generateLayoutFunc !== 'function' ||
      typeof getTileAtFunc !== 'function' ||
      typeof clearLayoutFunc !== 'function' ||
      typeof setPreConstraintFunc !== 'function' ||
      typeof clearPreConstraintsFunc !== 'function' ||
      typeof getStatsFunc !== 'function' ||
      typeof generateVoronoiRegionsFunc !== 'function' ||
      typeof validateRoadConnectivityFunc !== 'function' ||
      typeof hexAstarFunc !== 'function' ||
      typeof buildPathBetweenRoadsFunc !== 'function' ||
      typeof generateRoadNetworkGrowingTreeFunc !== 'function' ||
      typeof getWasmVersionFunc !== 'function' ||
      typeof calculateChunkRadiusFunc !== 'function' ||
      typeof calculateChunkNeighborsFunc !== 'function' ||
      typeof findNearestNeighborChunkFunc !== 'function' ||
      typeof disableDistantChunksFunc !== 'function' ||
      typeof batchGetTileTypesFunc !== 'function' ||
      typeof calculateChunkForTileFunc !== 'function' ||
      typeof shuffleArrayFunc !== 'function' ||
      typeof countAdjacentRoadsFunc !== 'function' ||
      typeof getAdjacentValidTerrainFunc !== 'function' ||
      typeof generateBuildingPlacementFunc !== 'function' ||
      typeof batchHexToWorldFunc !== 'function'
    ) {
      return null;
    }
    
    // All functions have been validated to exist and be functions
    // TypeScript can't narrow Function to specific signatures, but runtime validation ensures safety
    // We wrap them in functions with proper types to avoid type assertions
    return {
      memory,
      generate_layout: (): void => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        generateLayoutFunc();
      },
      get_tile_at: (x: number, y: number): number => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return
        return getTileAtFunc(x, y);
      },
      clear_layout: (): void => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        clearLayoutFunc();
      },
      set_pre_constraint: (x: number, y: number, tile_type: number): boolean => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
        const result = setPreConstraintFunc(x, y, tile_type);
        return typeof result === 'boolean' ? result : false;
      },
      clear_pre_constraints: (): void => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        clearPreConstraintsFunc();
      },
      get_stats: (): string => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
        const result = getStatsFunc();
        return typeof result === 'string' ? result : '{}';
      },
      generate_voronoi_regions: (
        max_layer: number,
        center_q: number,
        center_r: number,
        forest_seeds: number,
        water_seeds: number,
        grass_seeds: number
      ): string => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
        const result = generateVoronoiRegionsFunc(max_layer, center_q, center_r, forest_seeds, water_seeds, grass_seeds);
        return typeof result === 'string' ? result : '[]';
      },
      validate_road_connectivity: (roads_json: string): boolean => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
        const result = validateRoadConnectivityFunc(roads_json);
        return typeof result === 'boolean' ? result : false;
      },
      hex_astar: (
        start_q: number,
        start_r: number,
        goal_q: number,
        goal_r: number,
        valid_terrain_json: string
      ): string => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
        const result = hexAstarFunc(start_q, start_r, goal_q, goal_r, valid_terrain_json);
        return typeof result === 'string' ? result : 'null';
      },
      build_path_between_roads: (
        start_q: number,
        start_r: number,
        end_q: number,
        end_r: number,
        valid_terrain_json: string
      ): string => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
        const result = buildPathBetweenRoadsFunc(start_q, start_r, end_q, end_r, valid_terrain_json);
        return typeof result === 'string' ? result : 'null';
      },
      generate_road_network_growing_tree: (
        seeds_json: string,
        valid_terrain_json: string,
        occupied_json: string,
        target_count: number
      ): string => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
        const result = generateRoadNetworkGrowingTreeFunc(seeds_json, valid_terrain_json, occupied_json, target_count);
        return typeof result === 'string' ? result : '[]';
      },
      get_wasm_version: (): string => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
          const result = getWasmVersionFunc();
          if (typeof result === 'string') {
            return result;
          }
          return `unknown (type: ${typeof result})`;
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          return `unknown (error: ${errorMsg})`;
        }
      },
      calculate_chunk_radius: (rings: number): number => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
        const result = calculateChunkRadiusFunc(rings);
        return typeof result === 'number' ? result : rings;
      },
      calculate_chunk_neighbors: (center_q: number, center_r: number, rings: number): string => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
        const result = calculateChunkNeighborsFunc(center_q, center_r, rings);
        return typeof result === 'string' ? result : '[]';
      },
      find_nearest_neighbor_chunk: (
        current_chunk_q: number,
        current_chunk_r: number,
        current_tile_q: number,
        current_tile_r: number,
        rings: number,
        existing_chunks_json: string
      ): string => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
        const result = findNearestNeighborChunkFunc(current_chunk_q, current_chunk_r, current_tile_q, current_tile_r, rings, existing_chunks_json);
        return typeof result === 'string' ? result : 'null';
      },
      disable_distant_chunks: (
        current_chunk_q: number,
        current_chunk_r: number,
        all_chunks_json: string,
        max_distance: number
      ): string => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
        const result = disableDistantChunksFunc(current_chunk_q, current_chunk_r, all_chunks_json, max_distance);
        return typeof result === 'string' ? result : '{"toDisable":[],"toEnable":[]}';
      },
      batch_get_tile_types: (hex_coords_json: string): string => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
        const result = batchGetTileTypesFunc(hex_coords_json);
        return typeof result === 'string' ? result : '[]';
      },
      calculate_chunk_for_tile: (
        tile_q: number,
        tile_r: number,
        rings: number,
        chunk_positions_json: string
      ): string => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
        const result = calculateChunkForTileFunc(tile_q, tile_r, rings, chunk_positions_json);
        return typeof result === 'string' ? result : 'null';
      },
      shuffle_array: (array_json: string): string => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
        const result = shuffleArrayFunc(array_json);
        return typeof result === 'string' ? result : '[]';
      },
      count_adjacent_roads: (hex_q: number, hex_r: number, road_network_json: string): number => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
        const result = countAdjacentRoadsFunc(hex_q, hex_r, road_network_json);
        return typeof result === 'number' ? result : 0;
      },
      get_adjacent_valid_terrain: (
        road_network_json: string,
        valid_terrain_json: string,
        occupied_json: string
      ): string => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
        const result = getAdjacentValidTerrainFunc(road_network_json, valid_terrain_json, occupied_json);
        return typeof result === 'string' ? result : '[]';
      },
      generate_building_placement: (
        valid_terrain_json: string,
        road_network_json: string,
        occupied_json: string,
        building_rules_json: string,
        target_count: number
      ): string => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
        const result = generateBuildingPlacementFunc(valid_terrain_json, road_network_json, occupied_json, building_rules_json, target_count);
        return typeof result === 'string' ? result : '[]';
      },
      batch_hex_to_world: (hex_coords_json: string, hex_size: number): string => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
        const result = batchHexToWorldFunc(hex_coords_json, hex_size);
        return typeof result === 'string' ? result : '[]';
      },
    };
  }

  /**
   * Initialize the WASM module
   */
  async initialize(): Promise<void> {
    const wasmModule = await loadWasmModule<WasmModuleBabylonChunks>(
      () => this.getInitWasm(),
      (exports) => this.validateBabylonChunksModule(exports)
    );
    
    if (!wasmModule) {
      throw new WasmInitError('WASM module failed validation');
    }
    
    this.wasmModule = wasmModule;
  }

  /**
   * Get the WASM module
   */
  getModule(): WasmModuleBabylonChunks | null {
    return this.wasmModule;
  }

  /**
   * Get the WASM module record (for validation)
   */
  getModuleRecord(): Record<string, unknown> | null {
    return this.wasmModuleRecord;
  }
}

/**
 * Convert WASM tile type number to TypeScript TileType
 */
export function tileTypeFromNumber(tileNum: number): TileType | null {
  switch (tileNum) {
    case 0:
      return { type: 'grass' };
    case 1:
      return { type: 'building' };
    case 2:
      return { type: 'road' };
    case 3:
      return { type: 'forest' };
    case 4:
      return { type: 'water' };
    default:
      return null;
  }
}

/**
 * Convert tile type to number for WASM
 */
export function tileTypeToNumber(tileType: TileType): number {
  switch (tileType.type) {
    case 'grass':
      return 0;
    case 'building':
      return 1;
    case 'road':
      return 2;
    case 'forest':
      return 3;
    case 'water':
      return 4;
  }
}

