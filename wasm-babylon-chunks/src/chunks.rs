/// Chunk management module

use wasm_bindgen::prelude::*;
use crate::hex_utils::{parse_valid_terrain_json, hex_distance};

/// Calculate chunk radius for distance threshold calculations
/// The chunk radius is the distance from chunk center to the outer boundary
/// 
/// @param rings - Number of rings per chunk
/// @returns Chunk radius in hex distance units
#[wasm_bindgen]
pub fn calculate_chunk_radius(rings: i32) -> i32 {
    rings
}

/// Calculate chunk neighbor positions using offset vector rotation
/// Returns exactly 6 neighbor hex coordinates, one in each of the 6 directions
/// 
/// Uses the offset vector (rings, rings+1) for rings>0, or (1, 0) for rings=0, and rotates
/// it 60 degrees clockwise 6 times. This ensures chunks are packed without gaps - 
/// each direction has exactly one neighbor. The outer boundaries of adjacent chunks touch.
/// 
/// @param center_q - Center q coordinate
/// @param center_r - Center r coordinate
/// @param rings - Number of rings per chunk
/// @returns JSON string with array of 6 neighbor coordinates: [{"q":0,"r":0},...]
#[wasm_bindgen]
pub fn calculate_chunk_neighbors(center_q: i32, center_r: i32, rings: i32) -> String {
    let mut neighbors = Vec::new();
    
    // Base offset vector: (rings, rings+1) for rings>0, or (1, 0) for rings=0
    let (mut offset_q, mut offset_r) = if rings == 0 {
        (1, 0)
    } else {
        (rings, rings + 1)
    };
    
    // Rotate the starting offset by -120 degrees (4 steps clockwise) to correct angular alignment
    // This compensates for the 120-degree offset in the coordinate system
    for _i in 0..4 {
        let next_q = offset_q + offset_r;
        let next_r = -offset_q;
        offset_q = next_q;
        offset_r = next_r;
    }
    
    // Rotate the offset vector 60 degrees clockwise 6 times
    // Rotation formula in axial coordinates for clockwise: (q, r) -> (q+r, -q)
    let mut current_q = offset_q;
    let mut current_r = offset_r;
    
    for _i in 0..6 {
        // Add the current offset to the center
        neighbors.push((center_q + current_q, center_r + current_r));
        
        // Rotate 60 degrees clockwise: (q, r) -> (q+r, -q)
        let next_q = current_q + current_r;
        let next_r = -current_q;
        current_q = next_q;
        current_r = next_r;
    }
    
    // Convert to JSON
    let mut json_parts = Vec::new();
    for (q, r) in neighbors {
        json_parts.push(format!(r#"{{"q":{},"r":{}}}"#, q, r));
    }
    
    format!("[{}]", json_parts.join(","))
}

/// Find the immediate neighbor chunk of the current chunk that is nearest to the current tile
/// Only considers the 6 immediate neighbors of the current chunk
/// 
/// @param current_chunk_q - Hex q coordinate of current chunk
/// @param current_chunk_r - Hex r coordinate of current chunk
/// @param current_tile_q - Hex q coordinate of current tile
/// @param current_tile_r - Hex r coordinate of current tile
/// @param rings - Number of rings per chunk
/// @param existing_chunks_json - JSON array of existing chunk positions: [{"q":0,"r":0},...]
/// @returns JSON string with nearest neighbor info: {"neighbor":{"q":0,"r":0},"distance":1.5,"isInstantiated":true} or "null"
#[wasm_bindgen]
pub fn find_nearest_neighbor_chunk(
    current_chunk_q: i32,
    current_chunk_r: i32,
    current_tile_q: i32,
    current_tile_r: i32,
    rings: i32,
    existing_chunks_json: String,
) -> String {
    // Parse existing chunks
    let existing_chunks = parse_valid_terrain_json(&existing_chunks_json);
    
    // Calculate immediate neighbors
    let neighbors_json = calculate_chunk_neighbors(current_chunk_q, current_chunk_r, rings);
    let neighbors = parse_valid_terrain_json(&neighbors_json);
    
    if neighbors.is_empty() {
        return "null".to_string();
    }
    
    // Find which of the immediate neighbors is closest to the current tile (in hex distance)
    let mut nearest_neighbor: Option<(i32, i32)> = None;
    let mut min_distance = i32::MAX;
    
    for neighbor_pos in &neighbors {
        let hex_dist = hex_distance(current_tile_q, current_tile_r, neighbor_pos.0, neighbor_pos.1);
        
        if hex_dist < min_distance {
            min_distance = hex_dist;
            nearest_neighbor = Some(*neighbor_pos);
        }
    }
    
    if let Some(neighbor) = nearest_neighbor {
        let is_instantiated = existing_chunks.contains(&neighbor);
        // Return distance as hex distance (TypeScript will convert to world distance if needed)
        format!(
            r#"{{"neighbor":{{"q":{},"r":{}}},"distance":{},"isInstantiated":{}}}"#,
            neighbor.0, neighbor.1, min_distance, is_instantiated
        )
    } else {
        "null".to_string()
    }
}

/// Disable chunks that are more than max_distance away from the current chunk
/// All chunks, including the origin chunk, are subject to the distance threshold
/// 
/// @param current_chunk_q - Hex q coordinate of current chunk
/// @param current_chunk_r - Hex r coordinate of current chunk
/// @param all_chunks_json - JSON array of all chunk positions with enabled state: [{"q":0,"r":0,"enabled":true},...]
/// @param max_distance - Maximum hex distance threshold
/// @returns JSON string with chunks to enable/disable: {"toDisable":[{"q":0,"r":0},...],"toEnable":[{"q":0,"r":0},...]}
#[wasm_bindgen]
pub fn disable_distant_chunks(
    current_chunk_q: i32,
    current_chunk_r: i32,
    all_chunks_json: String,
    max_distance: i32,
) -> String {
    // Parse chunks with enabled state
    // Format: [{"q":0,"r":0,"enabled":true},...]
    let mut chunks: Vec<(i32, i32, bool)> = Vec::new();
    
    let trimmed = all_chunks_json.trim();
    if trimmed.is_empty() || trimmed == "[]" {
        return r#"{"toDisable":[],"toEnable":[]}"#.to_string();
    }
    
    // Simple JSON parsing: find all {"q":X,"r":Y,"enabled":Z} patterns
    let mut i = 0;
    let chars: Vec<char> = trimmed.chars().collect();
    while i < chars.len() {
        if chars[i] == '{' {
            let mut q_value: Option<i32> = None;
            let mut r_value: Option<i32> = None;
            let mut enabled_value: Option<bool> = None;
            
            i += 1;
            while i < chars.len() && chars[i] != '}' {
                // Look for "q", "r", or "enabled"
                if i + 3 < chars.len() && chars[i] == '"' && chars[i + 1] == 'q' && chars[i + 2] == '"' {
                    i += 3;
                    while i < chars.len() && (chars[i] == ':' || chars[i] == ' ' || chars[i] == '\t') {
                        i += 1;
                    }
                    if i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '-') {
                        let start = i;
                        i += 1;
                        while i < chars.len() && chars[i].is_ascii_digit() {
                            i += 1;
                        }
                        let num_str: String = chars[start..i].iter().collect();
                        if let Ok(num) = num_str.parse::<i32>() {
                            q_value = Some(num);
                        }
                    }
                } else if i + 3 < chars.len() && chars[i] == '"' && chars[i + 1] == 'r' && chars[i + 2] == '"' {
                    i += 3;
                    while i < chars.len() && (chars[i] == ':' || chars[i] == ' ' || chars[i] == '\t') {
                        i += 1;
                    }
                    if i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '-') {
                        let start = i;
                        i += 1;
                        while i < chars.len() && chars[i].is_ascii_digit() {
                            i += 1;
                        }
                        let num_str: String = chars[start..i].iter().collect();
                        if let Ok(num) = num_str.parse::<i32>() {
                            r_value = Some(num);
                        }
                    }
                } else if i + 9 < chars.len() && chars[i] == '"' && chars[i + 1] == 'e' && chars[i + 2] == 'n' 
                    && chars[i + 3] == 'a' && chars[i + 4] == 'b' && chars[i + 5] == 'l' 
                    && chars[i + 6] == 'e' && chars[i + 7] == 'd' && chars[i + 8] == '"' {
                    i += 9;
                    while i < chars.len() && (chars[i] == ':' || chars[i] == ' ' || chars[i] == '\t') {
                        i += 1;
                    }
                    if i < chars.len() {
                        if i + 4 < chars.len() && chars[i] == 't' && chars[i + 1] == 'r' 
                            && chars[i + 2] == 'u' && chars[i + 3] == 'e' {
                            enabled_value = Some(true);
                            i += 4;
                        } else if i + 5 < chars.len() && chars[i] == 'f' && chars[i + 1] == 'a' 
                            && chars[i + 2] == 'l' && chars[i + 3] == 's' && chars[i + 4] == 'e' {
                            enabled_value = Some(false);
                            i += 5;
                        }
                    }
                } else {
                    i += 1;
                }
            }
            
            if let (Some(q), Some(r), Some(enabled)) = (q_value, r_value, enabled_value) {
                chunks.push((q, r, enabled));
            }
        }
        i += 1;
    }
    
    // Calculate which chunks to disable/enable
    let mut to_disable: Vec<(i32, i32)> = Vec::new();
    let mut to_enable: Vec<(i32, i32)> = Vec::new();
    
    for (chunk_q, chunk_r, currently_enabled) in chunks {
        let distance = hex_distance(current_chunk_q, current_chunk_r, chunk_q, chunk_r);
        
        if distance > max_distance {
            if currently_enabled {
                to_disable.push((chunk_q, chunk_r));
            }
        } else {
            if !currently_enabled {
                to_enable.push((chunk_q, chunk_r));
            }
        }
    }
    
    // Build JSON response
    let mut disable_parts = Vec::new();
    for (q, r) in &to_disable {
        disable_parts.push(format!(r#"{{"q":{},"r":{}}}"#, q, r));
    }
    
    let mut enable_parts = Vec::new();
    for (q, r) in &to_enable {
        enable_parts.push(format!(r#"{{"q":{},"r":{}}}"#, q, r));
    }
    
    format!(
        r#"{{"toDisable":[{}],"toEnable":[{}]}}"#,
        disable_parts.join(","),
        enable_parts.join(",")
    )
}

/// Calculate which chunk contains a given tile
/// Returns chunk position that contains the tile, or null if not found
/// 
/// @param tile_q - Hex q coordinate of the tile
/// @param tile_r - Hex r coordinate of the tile
/// @param rings - Number of rings per chunk
/// @param chunk_positions_json - JSON array of chunk positions: [{"q":0,"r":0},...]
/// @returns JSON string with chunk position: {"q":0,"r":0} or "null"
#[wasm_bindgen]
pub fn calculate_chunk_for_tile(
    tile_q: i32,
    tile_r: i32,
    rings: i32,
    chunk_positions_json: String,
) -> String {
    // Parse chunk positions
    let chunk_positions = parse_valid_terrain_json(&chunk_positions_json);
    
    if chunk_positions.is_empty() {
        return "null".to_string();
    }
    
    let mut closest_chunk: Option<(i32, i32)> = None;
    let mut min_distance = i32::MAX;
    
    // Find chunk whose center is closest to the tile and within the chunk's boundary
    for chunk_pos in &chunk_positions {
        let distance = hex_distance(tile_q, tile_r, chunk_pos.0, chunk_pos.1);
        
        // If tile is exactly at chunk center, return immediately
        if distance == 0 {
            return format!(r#"{{"q":{},"r":{}}}"#, chunk_pos.0, chunk_pos.1);
        }
        
        // Check if tile is within this chunk's boundary (distance <= rings)
        if distance <= rings {
            // If multiple chunks contain this tile (overlap at boundaries), prefer the closest center
            if distance < min_distance {
                min_distance = distance;
                closest_chunk = Some(*chunk_pos);
            }
        }
    }
    
    if let Some(chunk) = closest_chunk {
        format!(r#"{{"q":{},"r":{}}}"#, chunk.0, chunk.1)
    } else {
        "null".to_string()
    }
}

