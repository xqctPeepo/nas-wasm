/// Main library entry point for wasm-babylon-chunks
/// 
/// This module organizes the WASM crate into logical sub-modules:
/// - types: Core type definitions
/// - state: WFC state management
/// - hex_utils: Hex coordinate utilities
/// - astar: A* pathfinding algorithms
/// - voronoi: Voronoi region generation
/// - layout: WFC layout generation
/// - roads: Road network generation
/// - chunks: Chunk management
/// - utils: Utility functions

// Module declarations
mod types;
mod state;
mod hex_utils;
mod astar;
mod voronoi;
mod layout;
mod roads;
mod chunks;
mod utils;

// Re-export all public functions from sub-modules
// This maintains the same public API as before the refactoring

// From layout module
pub use layout::{init, get_wasm_version, generate_layout, get_tile_at, clear_layout, set_pre_constraint, clear_pre_constraints, get_stats};

// From astar module
pub use astar::{hex_astar, build_path_between_roads, validate_road_connectivity};

// From voronoi module
pub use voronoi::generate_voronoi_regions;

// From roads module
pub use roads::generate_road_network_growing_tree;

// From chunks module
pub use chunks::{calculate_chunk_radius, calculate_chunk_neighbors, find_nearest_neighbor_chunk, disable_distant_chunks, calculate_chunk_for_tile};

// From utils module
pub use utils::{batch_get_tile_types, shuffle_array, count_adjacent_roads, get_adjacent_valid_terrain, generate_building_placement, batch_hex_to_world};
