/**
 * Chunk Generation Queue
 * 
 * Manages asynchronous chunk generation tasks to prevent blocking the main thread.
 * Uses a curried approach where each step is a small function that does minimal work.
 */

import type { WorldMap } from './chunkManagement';
import { Chunk } from './chunkManagement';
import * as HexUtils from './hexUtils';

/**
 * Status of a chunk generation task
 */
type ChunkGenerationStatus = 'pending' | 'generating' | 'completed' | 'failed';

/**
 * Step function type - takes state, returns next step or null if complete
 */
type ProcessingStep = (state: ChunkGenerationState) => ProcessingStep | null;

/**
 * State for incremental chunk generation
 */
interface ChunkGenerationState {
  chunk: Chunk;
  rings: number;
  hexSize: number;
  chunkHex: HexUtils.HexCoord;
  worldMap: WorldMap;
  // Grid generation state
  hexGrid: Array<HexUtils.HexCoord> | null;
  validatedGrid: Array<{ hex: HexUtils.HexCoord; tileType: null; enabled: boolean; meshInstance: null }>;
  gridBatchIndex: number;
  // Spatial index state
  spatialIndexBatchIndex: number;
  // Step tracking
  currentStep: 'grid' | 'neighbors' | 'spatialIndex' | 'complete';
}

/**
 * Task for generating a chunk asynchronously
 */
interface ChunkGenerationTask {
  chunkHex: HexUtils.HexCoord;
  rings: number;
  hexSize: number;
  priority: number;
  status: ChunkGenerationStatus;
  promise: Promise<import('./chunkManagement').Chunk>;
  resolve: (chunk: import('./chunkManagement').Chunk) => void;
  reject: (error: Error) => void;
  // Curried processing state
  processingState: ChunkGenerationState | null;
  currentStep: ProcessingStep | null;
}

/**
 * Queue for managing chunk generation tasks
 * Processes tasks incrementally to avoid blocking the main thread
 */
export class ChunkGenerationQueue {
  private tasks: globalThis.Map<string, ChunkGenerationTask>;
  private frameBudget: number; // ms per frame (e.g., 5ms)
  private readonly GRID_BATCH_SIZE = 150;
  private readonly SPATIAL_INDEX_BATCH_SIZE = 200;

  constructor(frameBudget: number = 5) {
    this.tasks = new globalThis.Map<string, ChunkGenerationTask>();
    this.frameBudget = frameBudget;
    // Bind step functions to preserve 'this' context
    this.stepGenerateGrid = this.stepGenerateGrid.bind(this);
    this.stepComputeNeighbors = this.stepComputeNeighbors.bind(this);
    this.stepUpdateSpatialIndex = this.stepUpdateSpatialIndex.bind(this);
  }

  /**
   * Get a task key string from hex coordinates
   */
  private getTaskKey(chunkHex: HexUtils.HexCoord): string {
    return `${chunkHex.q},${chunkHex.r}`;
  }

  /**
   * Enqueue a chunk generation task
   */
  enqueue(
    chunkHex: HexUtils.HexCoord,
    rings: number,
    hexSize: number,
    priority: number,
    worldMap: import('./chunkManagement').WorldMap
  ): Promise<import('./chunkManagement').Chunk> {
    const key = this.getTaskKey(chunkHex);

    // Check if task already exists
    const existing = this.tasks.get(key);
    if (existing) {
      if (priority > existing.priority) {
        existing.priority = priority;
      }
      return existing.promise;
    }

    // Check if chunk already exists in world map
    const existingChunk = worldMap.getChunk(chunkHex);
    if (existingChunk) {
      if (!existingChunk.isInitialized()) {
        // Check if there's already a task for this chunk
        const existingTask = this.tasks.get(key);
        if (existingTask) {
          // Task already exists - return its promise
          return existingTask.promise;
        }
        // No task exists - create one for the existing placeholder chunk
        // Fall through to create task below
      } else {
        // Chunk is already initialized
        return Promise.resolve(existingChunk);
      }
    }

    // Add placeholder chunk to map immediately (if it doesn't exist)
    if (!existingChunk) {
      const placeholderChunk = new Chunk(chunkHex, hexSize);
      worldMap.addChunkPlaceholder(chunkHex, placeholderChunk);
    }

    // Create new task
    let taskResolve: (chunk: import('./chunkManagement').Chunk) => void = () => {
      // Dummy - will be replaced
    };
    let taskReject: (error: Error) => void = () => {
      // Dummy - will be replaced
    };
    const taskPromise = new Promise<import('./chunkManagement').Chunk>((res, rej) => {
      taskResolve = res;
      taskReject = rej;
    });

    const task: ChunkGenerationTask = {
      chunkHex,
      rings,
      hexSize,
      priority,
      status: 'pending',
      promise: taskPromise,
      resolve: taskResolve,
      reject: taskReject,
      processingState: null,
      currentStep: null,
    };

    this.tasks.set(key, task);
    return taskPromise;
  }

  /**
   * Create initial processing state
   */
  private createProcessingState(
    chunk: Chunk,
    rings: number,
    hexSize: number,
    chunkHex: HexUtils.HexCoord,
    worldMap: WorldMap
  ): ChunkGenerationState {
    return {
      chunk,
      rings,
      hexSize,
      chunkHex,
      worldMap,
      hexGrid: null,
      validatedGrid: [],
      gridBatchIndex: 0,
      spatialIndexBatchIndex: 0,
      currentStep: 'grid',
    };
  }

  /**
   * Step 1: Generate hex grid (one batch per call)
   */
  private stepGenerateGrid(state: ChunkGenerationState): ProcessingStep | null {
    if (!state.hexGrid) {
      // Generate full grid once
      state.hexGrid = HexUtils.HEX_UTILS.generateHexGrid(
        state.rings,
        state.chunkHex.q,
        state.chunkHex.r
      );
    }

    const totalTiles = state.hexGrid.length;
    const batchEnd = Math.min(
      state.gridBatchIndex + this.GRID_BATCH_SIZE,
      totalTiles
    );
    const batch = state.hexGrid.slice(state.gridBatchIndex, batchEnd);

    // Process batch
    for (const hex of batch) {
      const distance = HexUtils.HEX_UTILS.distance(
        state.chunkHex.q,
        state.chunkHex.r,
        hex.q,
        hex.r
      );
      if (distance <= state.rings) {
        state.validatedGrid.push({
          hex,
          tileType: null,
          enabled: true,
          meshInstance: null,
        });
      }
    }

    state.gridBatchIndex = batchEnd;

    if (batchEnd < totalTiles) {
      // More batches to process - return continuation
      return this.stepGenerateGrid;
    }

    // Grid generation complete - set grid on chunk and move to next step
    state.chunk.setGrid(state.validatedGrid);
    state.currentStep = 'neighbors';
    return this.stepComputeNeighbors;
  }

  /**
   * Step 2: Compute neighbor chunk positions and finalize chunk
   */
  private stepComputeNeighbors(state: ChunkGenerationState): ProcessingStep | null {
    const neighbors = state.chunk.calculateChunkNeighborsPublic(state.rings);
    state.chunk.setNeighbors(neighbors);
    state.chunk.markInitialized();
    state.currentStep = 'spatialIndex';
    return this.stepUpdateSpatialIndex;
  }

  /**
   * Step 3: Update spatial index (one batch per call)
   */
  private stepUpdateSpatialIndex(state: ChunkGenerationState): ProcessingStep | null {
    const chunkGrid = state.chunk.getGrid();
    const totalTiles = chunkGrid.length;
    const batchEnd = Math.min(
      state.spatialIndexBatchIndex + this.SPATIAL_INDEX_BATCH_SIZE,
      totalTiles
    );
    const batch = chunkGrid.slice(state.spatialIndexBatchIndex, batchEnd);

    for (const tile of batch) {
      const tileKey = `${tile.hex.q},${tile.hex.r}`;
      state.worldMap.addSpatialIndexEntry(tileKey, state.chunkHex);
    }

    state.spatialIndexBatchIndex = batchEnd;

    if (batchEnd < totalTiles) {
      // More batches to process - return continuation
      return this.stepUpdateSpatialIndex;
    }

    // Spatial index update complete
    state.currentStep = 'complete';
    return null; // Done
  }

  /**
   * Process the next task in the queue
   * Uses curried approach - processes one task, doing as many steps as possible within budget
   */
  async processNext(worldMap: WorldMap): Promise<boolean> {
    if (this.tasks.size === 0) {
      return false;
    }

    // Sort tasks by priority
    const sortedTasks = Array.from(this.tasks.values()).sort((a, b) => {
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      if (a.status === 'pending' && b.status !== 'pending') {
        return -1;
      }
      if (a.status !== 'pending' && b.status === 'pending') {
        return 1;
      }
      return 0;
    });

    // Find a task ready to process
    let task: ChunkGenerationTask | undefined;
    for (const candidateTask of sortedTasks) {
      if (candidateTask.status === 'pending') {
        task = candidateTask;
        break;
      }
      if (candidateTask.status === 'generating' && candidateTask.currentStep !== null) {
        task = candidateTask;
        break;
      }
    }

    if (!task) {
      return false;
    }

    const frameStartTime = performance.now();

    try {
      if (task.status === 'pending') {
        task.status = 'generating';
        const existingChunk = worldMap.getChunk(task.chunkHex);
        if (existingChunk) {
          task.processingState = this.createProcessingState(
            existingChunk,
            task.rings,
            task.hexSize,
            task.chunkHex,
            worldMap
          );
          task.currentStep = this.stepGenerateGrid;
        } else {
          throw new Error('Chunk placeholder not found');
        }
      }

      // Process this task, doing as many steps as possible within budget
      if (!task.currentStep || !task.processingState) {
        throw new Error('Task in generating state but has no current step or processing state');
      }

      let currentStep: ProcessingStep = task.currentStep;
      while (currentStep !== null) {
        const nextStep: ProcessingStep | null = currentStep(task.processingState);

        // Check frame budget
        const elapsed = performance.now() - frameStartTime;
        if (elapsed > this.frameBudget) {
          // Over budget - save progress and continue next frame
          task.currentStep = nextStep;
          return true;
        }

        if (nextStep) {
          // More work to do - continue with next step
          currentStep = nextStep;
          task.currentStep = nextStep;
        } else {
          // All steps complete
          task.status = 'completed';
          if (task.processingState) {
            task.resolve(task.processingState.chunk);
          }
          this.tasks.delete(this.getTaskKey(task.chunkHex));
          return this.tasks.size > 0;
        }
      }
    } catch (error) {
      task.status = 'failed';
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      task.reject(new Error(`Chunk generation failed: ${errorMessage}`));
      this.tasks.delete(this.getTaskKey(task.chunkHex));
    }

    return this.tasks.size > 0;
  }

  /**
   * Get a task by chunk hex coordinate
   */
  getTask(chunkHex: HexUtils.HexCoord): ChunkGenerationTask | undefined {
    const key = this.getTaskKey(chunkHex);
    return this.tasks.get(key);
  }

  /**
   * Check if a task exists for the given chunk
   */
  hasTask(chunkHex: HexUtils.HexCoord): boolean {
    const key = this.getTaskKey(chunkHex);
    return this.tasks.has(key);
  }

  /**
   * Get the number of pending tasks
   */
  getPendingCount(): number {
    let count = 0;
    for (const task of this.tasks.values()) {
      if (task.status === 'pending' || task.status === 'generating') {
        count++;
      }
    }
    return count;
  }

  /**
   * Clear all tasks (for cleanup)
   */
  clear(): void {
    for (const task of this.tasks.values()) {
      if (task.status === 'pending' || task.status === 'generating') {
        task.reject(new Error('Chunk generation queue cleared'));
      }
    }
    this.tasks.clear();
  }
}
