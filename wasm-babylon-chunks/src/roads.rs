/// Road network generation module

use wasm_bindgen::prelude::*;
use std::collections::HashSet;
use crate::astar::hex_astar;
use crate::hex_utils::{parse_valid_terrain_json, parse_path_json, hex_distance};

/// Find nearest point in connected set to a given point
/// Returns the nearest point and its distance
fn find_nearest_in_set(
    point: (i32, i32),
    connected_set: &HashSet<(i32, i32)>,
) -> Option<((i32, i32), i32)> {
    if connected_set.is_empty() {
        return None;
    }
    
    let mut nearest: Option<(i32, i32)> = None;
    let mut min_distance = i32::MAX;
    
    for &connected_point in connected_set {
        let dist = hex_distance(point.0, point.1, connected_point.0, connected_point.1);
        if dist < min_distance {
            min_distance = dist;
            nearest = Some(connected_point);
        }
    }
    
    nearest.map(|n| (n, min_distance))
}

/// Generate road network using true growing tree algorithm
/// 
/// Algorithm:
/// 1. Start with first seed point
/// 2. For each remaining seed: find nearest connected road, build A* path, add path
/// 3. For expansion: repeatedly find nearest unconnected valid terrain to any connected road,
///    build A* path, add path. Continue until target count reached.
/// 
/// This creates a true tree structure where every road is connected via a path,
/// not just adjacent (which would be flood fill).
/// 
/// @param seeds_json - JSON array of seed points: [{"q":0,"r":0},...]
/// @param valid_terrain_json - JSON array of valid terrain: [{"q":0,"r":0},...]
/// @param occupied_json - JSON array of occupied hexes: [{"q":0,"r":0},...]
/// @param target_count - Target number of roads to generate
/// @returns JSON array of road coordinates: [{"q":0,"r":0},...]
#[wasm_bindgen]
pub fn generate_road_network_growing_tree(
    seeds_json: String,
    valid_terrain_json: String,
    occupied_json: String,
    target_count: i32,
) -> String {
    // Parse inputs
    let seeds = parse_valid_terrain_json(&seeds_json);
    let valid_terrain = parse_valid_terrain_json(&valid_terrain_json);
    let occupied = parse_valid_terrain_json(&occupied_json);
    
    // Build valid terrain set (valid terrain minus occupied)
    let mut valid_terrain_set = HashSet::new();
    for &hex in &valid_terrain {
        if !occupied.contains(&hex) {
            valid_terrain_set.insert(hex);
        }
    }
    
    // Convert valid terrain to JSON for hex_astar calls
    let mut valid_terrain_vec: Vec<(i32, i32)> = valid_terrain_set.iter().cloned().collect();
    valid_terrain_vec.sort();
    let mut valid_terrain_json_parts = Vec::new();
    for (q, r) in &valid_terrain_vec {
        valid_terrain_json_parts.push(format!(r#"{{"q":{},"r":{}}}"#, q, r));
    }
    let valid_terrain_json_for_astar = format!("[{}]", valid_terrain_json_parts.join(","));
    
    // Connected set: roads in the network
    let mut connected: HashSet<(i32, i32)> = HashSet::new();
    
    // Unconnected set: valid terrain not yet roads
    let mut unconnected: HashSet<(i32, i32)> = valid_terrain_set.clone();
    
    // Phase 1: Connect seed points
    if !seeds.is_empty() {
        let first_seed = seeds.iter().next().copied();
        if let Some(seed) = first_seed {
            if valid_terrain_set.contains(&seed) {
                connected.insert(seed);
                unconnected.remove(&seed);
            }
        }
        
        // Connect remaining seeds
        for seed in seeds.iter().skip(1) {
            if !valid_terrain_set.contains(seed) {
                continue;
            }
            
            if connected.is_empty() {
                // No connected roads yet, add seed directly
                connected.insert(*seed);
                unconnected.remove(seed);
                continue;
            }
            
            // Find nearest connected road
            if let Some((nearest_road, _)) = find_nearest_in_set(*seed, &connected) {
                // Build path from nearest road to seed
                let path_json = hex_astar(
                    nearest_road.0,
                    nearest_road.1,
                    seed.0,
                    seed.1,
                    valid_terrain_json_for_astar.clone(),
                );
                
                if path_json != "null" && !path_json.is_empty() {
                    let path = parse_path_json(&path_json);
                    // Add all path hexes to connected
                    for path_hex in path {
                        connected.insert(path_hex);
                        unconnected.remove(&path_hex);
                    }
                }
            }
        }
    }
    
    // Phase 2: Expand to target density using growing tree
    while (connected.len() as i32) < target_count && !unconnected.is_empty() {
        let mut best_unconnected: Option<(i32, i32)> = None;
        let mut best_connected: Option<(i32, i32)> = None;
        let mut min_distance = i32::MAX;
        
        // Find nearest unconnected point to any connected road
        for &unconnected_point in &unconnected {
            if let Some((nearest_road, distance)) = find_nearest_in_set(unconnected_point, &connected) {
                if distance < min_distance {
                    min_distance = distance;
                    best_unconnected = Some(unconnected_point);
                    best_connected = Some(nearest_road);
                }
            }
        }
        
        // Build path and add to network
        if let (Some(unconnected_point), Some(connected_road)) = (best_unconnected, best_connected) {
            let path_json = hex_astar(
                connected_road.0,
                connected_road.1,
                unconnected_point.0,
                unconnected_point.1,
                valid_terrain_json_for_astar.clone(),
            );
            
            if path_json != "null" && !path_json.is_empty() {
                let path = parse_path_json(&path_json);
                // Add all path hexes to connected
                for path_hex in path {
                    connected.insert(path_hex);
                    unconnected.remove(&path_hex);
                }
            } else {
                // Can't reach this point, remove it from unconnected
                unconnected.remove(&unconnected_point);
            }
        } else {
            // No more reachable points
            break;
        }
    }
    
    // Convert connected set to JSON array
    let mut road_vec: Vec<(i32, i32)> = connected.iter().cloned().collect();
    road_vec.sort();
    let mut json_parts = Vec::new();
    for (q, r) in road_vec {
        json_parts.push(format!(r#"{{"q":{},"r":{}}}"#, q, r));
    }
    
    format!("[{}]", json_parts.join(","))
}

