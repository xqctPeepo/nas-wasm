/// Utility functions module

use wasm_bindgen::prelude::*;
use std::collections::HashSet;
use crate::state::WFC_STATE;
use crate::hex_utils::{parse_valid_terrain_json, get_hex_neighbors};

/// Batch query tile types for multiple hex coordinates
/// Returns JSON array with tile types: [{"q":0,"r":0,"tileType":1},...]
/// 
/// @param hex_coords_json - JSON array of hex coordinates: [{"q":0,"r":0},...]
/// @returns JSON array with tile types for each coordinate
#[wasm_bindgen]
pub fn batch_get_tile_types(hex_coords_json: String) -> String {
    let state = WFC_STATE.lock().unwrap();
    
    // Parse hex coordinates
    let hex_coords = parse_valid_terrain_json(&hex_coords_json);
    
    let mut json_parts = Vec::new();
    for (q, r) in hex_coords {
        if let Some(tile) = state.get_tile(q, r) {
            json_parts.push(format!(
                r#"{{"q":{},"r":{},"tileType":{}}}"#,
                q, r, tile as i32
            ));
        }
    }
    
    format!("[{}]", json_parts.join(","))
}

/// Shuffle array in WASM using Fisher-Yates algorithm
/// Returns shuffled JSON array
/// 
/// @param array_json - JSON array to shuffle: [{"q":0,"r":0},...]
/// @returns Shuffled JSON array
#[wasm_bindgen]
pub fn shuffle_array(array_json: String) -> String {
    // Parse array
    let mut coords: Vec<(i32, i32)> = Vec::new();
    
    let trimmed = array_json.trim();
    if trimmed.is_empty() || trimmed == "[]" {
        return "[]".to_string();
    }
    
    // Simple JSON parsing: find all {"q":X,"r":Y} patterns
    let mut i = 0;
    let chars: Vec<char> = trimmed.chars().collect();
    while i < chars.len() {
        if chars[i] == '{' {
            let mut q_value: Option<i32> = None;
            let mut r_value: Option<i32> = None;
            
            i += 1;
            while i < chars.len() && chars[i] != '}' {
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
                } else {
                    i += 1;
                }
            }
            
            if let (Some(q), Some(r)) = (q_value, r_value) {
                coords.push((q, r));
            }
        }
        i += 1;
    }
    
    // Fisher-Yates shuffle using a simple PRNG
    // Use a deterministic seed based on array content for reproducibility
    let mut seed: u64 = 0;
    for (q, r) in &coords {
        seed = seed.wrapping_mul(31).wrapping_add((*q as u64).wrapping_mul(17).wrapping_add(*r as u64));
    }
    
    let mut rng_state = seed;
    let mut rng = || {
        rng_state = rng_state.wrapping_mul(1103515245).wrapping_add(12345);
        rng_state
    };
    
    for i in (1..coords.len()).rev() {
        let j = (rng() % (i as u64 + 1)) as usize;
        coords.swap(i, j);
    }
    
    // Convert back to JSON
    let mut json_parts = Vec::new();
    for (q, r) in coords {
        json_parts.push(format!(r#"{{"q":{},"r":{}}}"#, q, r));
    }
    
    format!("[{}]", json_parts.join(","))
}

/// Count adjacent roads for a given hex coordinate
/// 
/// @param hex_q - Hex q coordinate
/// @param hex_r - Hex r coordinate
/// @param road_network_json - JSON array of road coordinates: [{"q":0,"r":0},...]
/// @returns Number of adjacent roads (0-6)
#[wasm_bindgen]
pub fn count_adjacent_roads(hex_q: i32, hex_r: i32, road_network_json: String) -> i32 {
    let roads = parse_valid_terrain_json(&road_network_json);
    let roads_set: HashSet<(i32, i32)> = roads.iter().cloned().collect();
    
    let neighbors = get_hex_neighbors(hex_q, hex_r);
    let mut count = 0;
    
    for (nq, nr) in neighbors {
        if roads_set.contains(&(nq, nr)) {
            count += 1;
        }
    }
    
    count
}

/// Get all valid terrain hexes adjacent to existing roads
/// Returns array of hex coordinates that are:
/// - Adjacent to at least one road in the network
/// - On valid terrain (in valid_terrain_json)
/// - Not already occupied
/// 
/// @param road_network_json - JSON array of road coordinates: [{"q":0,"r":0},...]
/// @param valid_terrain_json - JSON array of valid terrain: [{"q":0,"r":0},...]
/// @param occupied_json - JSON array of occupied hexes: [{"q":0,"r":0},...]
/// @returns JSON array of adjacent valid terrain: [{"q":0,"r":0},...]
#[wasm_bindgen]
pub fn get_adjacent_valid_terrain(
    road_network_json: String,
    valid_terrain_json: String,
    occupied_json: String,
) -> String {
    let roads = parse_valid_terrain_json(&road_network_json);
    let valid_terrain = parse_valid_terrain_json(&valid_terrain_json);
    let occupied = parse_valid_terrain_json(&occupied_json);
    
    let roads_set: HashSet<(i32, i32)> = roads.iter().cloned().collect();
    let valid_terrain_set: HashSet<(i32, i32)> = valid_terrain.iter().cloned().collect();
    let occupied_set: HashSet<(i32, i32)> = occupied.iter().cloned().collect();
    
    let mut adjacent_hexes: HashSet<(i32, i32)> = HashSet::new();
    
    // For each road, find its neighbors
    for (road_q, road_r) in roads {
        let neighbors = get_hex_neighbors(road_q, road_r);
        for (nq, nr) in neighbors {
            let neighbor_key = (nq, nr);
            
            // Skip if already a road
            if roads_set.contains(&neighbor_key) {
                continue;
            }
            
            // Skip if occupied
            if occupied_set.contains(&neighbor_key) {
                continue;
            }
            
            // Check if this neighbor is in valid terrain
            if valid_terrain_set.contains(&neighbor_key) {
                adjacent_hexes.insert(neighbor_key);
            }
        }
    }
    
    // Convert to JSON
    let mut adjacent_vec: Vec<(i32, i32)> = adjacent_hexes.iter().cloned().collect();
    adjacent_vec.sort();
    
    let mut json_parts = Vec::new();
    for (q, r) in adjacent_vec {
        json_parts.push(format!(r#"{{"q":{},"r":{}}}"#, q, r));
    }
    
    format!("[{}]", json_parts.join(","))
}

/// Generate building placement on valid terrain adjacent to roads
/// 
/// @param valid_terrain_json - JSON array of valid terrain: [{"q":0,"r":0},...]
/// @param road_network_json - JSON array of road coordinates: [{"q":0,"r":0},...]
/// @param occupied_json - JSON array of occupied hexes: [{"q":0,"r":0},...]
/// @param building_rules_json - JSON string with building rules: {"minAdjacentRoads":1}
/// @param target_count - Target number of buildings to place
/// @returns JSON array of building positions: [{"q":0,"r":0},...]
#[wasm_bindgen]
pub fn generate_building_placement(
    valid_terrain_json: String,
    road_network_json: String,
    occupied_json: String,
    building_rules_json: String,
    target_count: i32,
) -> String {
    let valid_terrain = parse_valid_terrain_json(&valid_terrain_json);
    let roads = parse_valid_terrain_json(&road_network_json);
    let occupied = parse_valid_terrain_json(&occupied_json);
    
    let roads_set: HashSet<(i32, i32)> = roads.iter().cloned().collect();
    let occupied_set: HashSet<(i32, i32)> = occupied.iter().cloned().collect();
    
    // Parse building rules
    let mut min_adjacent_roads = 1;
    let trimmed_rules = building_rules_json.trim();
    if !trimmed_rules.is_empty() && trimmed_rules != "{}" {
        // Simple JSON parsing for minAdjacentRoads
        let chars: Vec<char> = trimmed_rules.chars().collect();
        let mut i = 0;
        while i < chars.len() {
            if i + 18 < chars.len() && chars[i] == '"' && chars[i + 1] == 'm' && chars[i + 2] == 'i' 
                && chars[i + 3] == 'n' && chars[i + 4] == 'A' && chars[i + 5] == 'd' 
                && chars[i + 6] == 'j' && chars[i + 7] == 'a' && chars[i + 8] == 'c' 
                && chars[i + 9] == 'e' && chars[i + 10] == 'n' && chars[i + 11] == 't' 
                && chars[i + 12] == 'R' && chars[i + 13] == 'o' && chars[i + 14] == 'a' 
                && chars[i + 15] == 'd' && chars[i + 16] == 's' && chars[i + 17] == '"' {
                i += 18;
                while i < chars.len() && (chars[i] == ':' || chars[i] == ' ' || chars[i] == '\t') {
                    i += 1;
                }
                if i < chars.len() && chars[i].is_ascii_digit() {
                    let start = i;
                    i += 1;
                    while i < chars.len() && chars[i].is_ascii_digit() {
                        i += 1;
                    }
                    let num_str: String = chars[start..i].iter().collect();
                    if let Ok(num) = num_str.parse::<i32>() {
                        min_adjacent_roads = num;
                    }
                }
                break;
            }
            i += 1;
        }
    }
    
    // Find available hexes for buildings
    let mut available_building_hexes: Vec<(i32, i32)> = Vec::new();
    
    for (terrain_q, terrain_r) in &valid_terrain {
        let terrain_key = (*terrain_q, *terrain_r);
        
        // Skip if occupied
        if occupied_set.contains(&terrain_key) {
            continue;
        }
        
        // Count adjacent roads
        let neighbors = get_hex_neighbors(*terrain_q, *terrain_r);
        let mut adjacent_road_count = 0;
        for (nq, nr) in neighbors {
            if roads_set.contains(&(nq, nr)) {
                adjacent_road_count += 1;
            }
        }
        
        // Check if meets minimum adjacent roads requirement
        if adjacent_road_count >= min_adjacent_roads {
            available_building_hexes.push(terrain_key);
        }
    }
    
    // Shuffle available building hexes
    if available_building_hexes.len() > 1 {
        // Use deterministic seed based on content
        let mut seed: u64 = 0;
        for (q, r) in &available_building_hexes {
            seed = seed.wrapping_mul(31).wrapping_add((*q as u64).wrapping_mul(17).wrapping_add(*r as u64));
        }
        
        let mut rng_state = seed;
        let mut rng = || {
            rng_state = rng_state.wrapping_mul(1103515245).wrapping_add(12345);
            rng_state
        };
        
        for i in (1..available_building_hexes.len()).rev() {
            let j = (rng() % (i as u64 + 1)) as usize;
            available_building_hexes.swap(i, j);
        }
    }
    
    // Limit to target count
    let building_count = target_count.min(available_building_hexes.len() as i32);
    let selected_buildings = &available_building_hexes[0..(building_count as usize)];
    
    // Convert to JSON
    let mut json_parts = Vec::new();
    for (q, r) in selected_buildings {
        json_parts.push(format!(r#"{{"q":{},"r":{}}}"#, q, r));
    }
    
    format!("[{}]", json_parts.join(","))
}

/// Batch convert hex coordinates to world positions
/// 
/// @param hex_coords_json - JSON array of hex coordinates: [{"q":0,"r":0},...]
/// @param hex_size - Size of hexagon for coordinate conversion
/// @returns JSON array with world positions: [{"q":0,"r":0,"x":0.0,"z":0.0},...]
#[wasm_bindgen]
pub fn batch_hex_to_world(hex_coords_json: String, hex_size: f64) -> String {
    let hex_coords = parse_valid_terrain_json(&hex_coords_json);
    
    // Formula for pointy-top hexagons:
    // x = size * (√3 * q + √3/2 * r)
    // z = size * (3/2 * r)
    // Adjusted for the scaling factor used in TypeScript (hexSize / 1.34)
    let adjusted_hex_size = hex_size / 1.34;
    let sqrt3 = 3.0_f64.sqrt();
    
    let mut json_parts = Vec::new();
    for (q, r) in hex_coords {
        let q_f = q as f64;
        let r_f = r as f64;
        let x = adjusted_hex_size * (sqrt3 * 2.0 * q_f + sqrt3 * r_f);
        let z = adjusted_hex_size * (3.0 * r_f);
        
        json_parts.push(format!(
            r#"{{"q":{},"r":{},"x":{},"z":{}}}"#,
            q, r, x, z
        ));
    }
    
    format!("[{}]", json_parts.join(","))
}

