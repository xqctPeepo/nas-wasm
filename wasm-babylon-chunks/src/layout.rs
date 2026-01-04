/// WFC layout generation module

use wasm_bindgen::prelude::*;
use crate::state::WFC_STATE;
use crate::types::TileType;

/// Initialize the WASM module
#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
}

/// Get WASM module version for debugging and cache verification
/// 
/// Returns a version string that can be used to verify which WASM build is loaded.
/// Update this version when making significant changes to help debug caching issues.
#[wasm_bindgen]
pub fn get_wasm_version() -> String {
    "1.1.0-20250102-performance".to_string()
}

/// Generate a simplified layout using pre-constraints
/// 
/// **Learning Point**: This implements a simple algorithm:
/// 1. Apply pre-constraints to grid (all tile types set by TypeScript)
/// 2. Fill any remaining empty cells with grass (shouldn't happen if pre-constraints are complete)
#[wasm_bindgen]
pub fn generate_layout() {
    let mut state = WFC_STATE.lock().unwrap();
    state.clear();
    
    // Step 1: Apply pre-constraints to grid
    // Pre-constraints take absolute precedence - TypeScript sets all tiles
    // Collect pre-constraints into a vector first to avoid borrow checker issues
    let pre_constraints: Vec<((i32, i32), TileType)> = state.pre_constraints().collect();
    for ((q, r), tile_type) in pre_constraints {
        state.insert_tile(q, r, tile_type);
    }
    
    // Step 2: Fill any remaining empty cells with grass (shouldn't be needed if pre-constraints are complete)
    // This is a safety fallback
}

/// Get tile type at a specific hex grid position
/// 
/// **Learning Point**: This function is called from TypeScript to get the tile
/// at a specific hex position for rendering. Returns -1 if position is invalid or empty.
/// 
/// @param q - Hex column coordinate (axial, 0-49)
/// @param r - Hex row coordinate (axial, 0-49)
/// @returns Tile type as i32, or -1 if invalid/empty
#[wasm_bindgen]
pub fn get_tile_at(q: i32, r: i32) -> i32 {
    let state = WFC_STATE.lock().unwrap();
    if let Some(tile) = state.get_tile(q, r) {
        tile as i32
    } else {
        -1
    }
}

/// Clear the current layout
/// 
/// **Learning Point**: This resets the grid to all empty cells. Called when
/// the user clicks "Recompute Wave Collapse" to start fresh.
#[wasm_bindgen]
pub fn clear_layout() {
    let mut state = WFC_STATE.lock().unwrap();
    state.clear();
}

/// Set a pre-constraint at a specific hex position
/// 
/// **Learning Point**: Pre-constraints allow external systems to set specific tiles.
/// This enables guided generation based on high-level layout descriptions.
/// 
/// @param q - Hex column coordinate (axial q)
/// @param r - Hex row coordinate (axial r)
/// @param tile_type - Tile type as i32 (0-4, matching TileType enum)
/// @returns true if constraint was set successfully, false if tile type is invalid
#[wasm_bindgen]
pub fn set_pre_constraint(q: i32, r: i32, tile_type: i32) -> bool {
    let mut state = WFC_STATE.lock().unwrap();
    
    // Convert i32 to TileType
    let tile = match tile_type {
        0 => TileType::Grass,
        1 => TileType::Building,
        2 => TileType::Road,
        3 => TileType::Forest,
        4 => TileType::Water,
        _ => return false, // Invalid tile type
    };
    
    state.set_pre_constraint(q, r, tile)
}

/// Clear all pre-constraints
/// 
/// **Learning Point**: This clears all pre-constraints, allowing WFC to generate
/// completely random layouts again. Useful for resetting after text-guided generation.
#[wasm_bindgen]
pub fn clear_pre_constraints() {
    let mut state = WFC_STATE.lock().unwrap();
    state.clear_pre_constraints();
}

/// Get statistics about the current grid
/// 
/// **Learning Point**: This function iterates over the hash map to count all tile types.
/// Returns a JSON string with counts for each tile type.
/// Follows the pattern from wasm-agent-tools - builds JSON manually without serde
/// to keep WASM size small.
/// 
/// @returns JSON string with tile counts: {"grass":X,"building":Y,"road":Z,"forest":A,"water":B,"total":C}
#[wasm_bindgen]
pub fn get_stats() -> String {
    let state = WFC_STATE.lock().unwrap();
    
    let mut grass = 0;
    let mut building = 0;
    let mut road = 0;
    let mut forest = 0;
    let mut water = 0;
    
    for tile_type in state.grid_values() {
        match tile_type {
            TileType::Grass => grass += 1,
            TileType::Building => building += 1,
            TileType::Road => road += 1,
            TileType::Forest => forest += 1,
            TileType::Water => water += 1,
        }
    }
    
    let total = grass + building + road + forest + water;
    
    format!(
        r#"{{"grass":{},"building":{},"road":{},"forest":{},"water":{},"total":{}}}"#,
        grass, building, road, forest, water, total
    )
}

