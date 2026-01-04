/// Core type definitions for the WASM module

/// Tile type enumeration for 5 simple tile types
/// 
/// **Learning Point**: Simplified tile types for hex grid layout generation.
/// Each tile type represents a terrain or structure type.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[repr(i32)]
pub enum TileType {
    Grass = 0,
    Building = 1,
    Road = 2,
    Forest = 3,
    Water = 4,
}

/// Hex coordinate structure for Voronoi generation
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct HexCoord {
    pub q: i32,
    pub r: i32,
}

/// Cube coordinate structure
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct CubeCoord {
    pub q: i32,
    pub r: i32,
    pub s: i32,
}

/// Seed point for Voronoi region generation
#[derive(Clone, Copy, Debug)]
pub struct VoronoiSeed {
    pub q: i32,
    pub r: i32,
    pub tile_type: TileType,
}

/// A* node for pathfinding with parent pointer for path reconstruction
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AStarNode {
    pub q: i32,
    pub r: i32,
    pub g: i32,
    pub h: i32,
    pub f: i32,
    pub parent_q: i32,
    pub parent_r: i32,
}

impl AStarNode {
    pub fn new(q: i32, r: i32, g: i32, h: i32, parent_q: i32, parent_r: i32) -> Self {
        AStarNode {
            q,
            r,
            g,
            h,
            f: g + h,
            parent_q,
            parent_r,
        }
    }
}

use std::cmp::Ordering;

impl Ord for AStarNode {
    fn cmp(&self, other: &Self) -> Ordering {
        // Reverse order for min-heap (lowest f score first)
        other.f.cmp(&self.f)
            .then_with(|| other.h.cmp(&self.h))
    }
}

impl PartialOrd for AStarNode {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

