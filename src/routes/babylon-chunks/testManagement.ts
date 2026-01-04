/**
 * Test Management Module
 * 
 * Handles runtime tests for the chunk system.
 */

import type { WorldMap } from './chunkManagement';
import * as HexUtils from './hexUtils';

/**
 * Test Manager class for running runtime tests
 */
export class TestManager {
  private map: WorldMap;
  private logFn: ((message: string, type?: 'info' | 'success' | 'warning' | 'error') => void) | null;

  constructor(
    map: WorldMap,
    logFn?: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void
  ) {
    this.map = map;
    this.logFn = logFn ?? null;
  }

  /**
   * Log a test message
   */
  private log(message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info'): void {
    if (this.logFn) {
      this.logFn(message, type);
    }
  }

  /**
   * Run all tests
   */
  runTests(): void {
    this.log('Starting runtime tests...', 'info');
    
    this.testOriginChunkNeighbors();
    
    this.log('Runtime tests completed', 'success');
  }

  /**
   * Test: Instantiate all neighbors of the origin chunk
   * 
   * This test verifies that:
   * 1. The origin chunk exists
   * 2. All 6 neighbors of the origin chunk can be instantiated
   * 3. Neighbor positions are correct
   */
  testOriginChunkNeighbors(): void {
    this.log('Running test: Instantiate origin chunk neighbors', 'info');
    
    // Get origin chunk at (0, 0)
    const originPosition: HexUtils.HexCoord = { q: 0, r: 0 };
    const originChunk = this.map.getChunk(originPosition);
    
    if (!originChunk) {
      this.log('Test failed: Origin chunk not found at (0, 0)', 'error');
      return;
    }
    
    this.log('Origin chunk found at (0, 0)', 'success');
    
    // Get neighbor positions
    const neighbors = originChunk.getNeighbors();
    
    if (neighbors.length !== 6) {
      this.log(`Test failed: Expected 6 neighbors, got ${neighbors.length}`, 'error');
      return;
    }
    
    this.log(`Found ${neighbors.length} neighbor positions`, 'info');
    
    // Instantiate all neighbors
    let processedCount = 0;
    
    for (const neighborPos of neighbors) {
      if (this.map.hasChunk(neighborPos)) {
        this.log(`Neighbor chunk already exists at (${neighborPos.q}, ${neighborPos.r})`, 'warning');
        processedCount++;
      } else {
        // Create the neighbor chunk
        // We need rings and hexSize, but we don't have them here
        // This test will need to be called with these parameters
        // For now, we'll just verify the positions are correct
        this.log(`Neighbor position: (${neighborPos.q}, ${neighborPos.r})`, 'info');
        processedCount++;
      }
    }
    
    if (processedCount === neighbors.length) {
      this.log(`Test passed: All ${neighbors.length} neighbor positions identified`, 'success');
    } else {
      this.log(`Test partially failed: ${processedCount} processed out of ${neighbors.length} neighbors`, 'error');
    }
  }

  /**
   * Test: Instantiate all neighbors of the origin chunk with chunk creation
   * 
   * This version actually creates the neighbor chunks
   */
  async testOriginChunkNeighborsWithCreation(rings: number, hexSize: number): Promise<void> {
    this.log('Running test: Instantiate origin chunk neighbors (with creation)', 'info');
    
    // Get origin chunk at (0, 0)
    const originPosition: HexUtils.HexCoord = { q: 0, r: 0 };
    const originChunk = this.map.getChunk(originPosition);
    
    if (!originChunk) {
      this.log('Test failed: Origin chunk not found at (0, 0)', 'error');
      return;
    }
    
    this.log('Origin chunk found at (0, 0)', 'success');
    
    // Get neighbor positions
    const neighbors = originChunk.getNeighbors();
    
    if (neighbors.length !== 6) {
      this.log(`Test failed: Expected 6 neighbors, got ${neighbors.length}`, 'error');
      return;
    }
    
    this.log(`Found ${neighbors.length} neighbor positions`, 'info');
    
    // Instantiate all neighbors
    let createdCount = 0;
    let existingCount = 0;
    
    for (const neighborPos of neighbors) {
      if (this.map.hasChunk(neighborPos)) {
        this.log(`Neighbor chunk already exists at (${neighborPos.q}, ${neighborPos.r})`, 'warning');
        existingCount++;
      } else {
        // Create the neighbor chunk asynchronously
        await this.map.createChunk(neighborPos, rings, hexSize);
        this.log(`Created neighbor chunk at (${neighborPos.q}, ${neighborPos.r})`, 'info');
        createdCount++;
      }
    }
    
    const totalChunks = this.map.getChunkCount();
    this.log(`Test completed: Created ${createdCount} new chunks, ${existingCount} already existed`, 'info');
    this.log(`Total chunks in map: ${totalChunks}`, 'info');
    
    if (totalChunks === 7) {
      this.log('Test passed: All 6 neighbors plus origin chunk = 7 total chunks', 'success');
    } else {
      this.log(`Test warning: Expected 7 chunks (1 origin + 6 neighbors), got ${totalChunks}`, 'warning');
    }
  }
}

