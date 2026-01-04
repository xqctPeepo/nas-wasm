/// A* pathfinding module

use wasm_bindgen::prelude::*;
use std::collections::{HashMap, HashSet, BinaryHeap};
use crate::types::AStarNode;
use crate::hex_utils::{get_hex_neighbors, parse_valid_terrain_json, axial_to_cube, cube_distance, hex_distance};

/// Hex A* pathfinding between two road tiles
/// Returns path length, or -1 if unreachable
/// Only considers road tiles as valid path nodes
/// 
/// Algorithm matches Python example:
/// - Uses f_cost = g_cost + h_cost for priority
/// - g_cost is path cost from start (uniform cost of 1 per step)
/// - h_cost is hex distance heuristic
/// - Explores nodes with lowest f_cost first
pub fn hex_astar_path(
    start_q: i32,
    start_r: i32,
    goal_q: i32,
    goal_r: i32,
    roads: &HashSet<(i32, i32)>,
) -> i32 {
    // Check if start and goal are roads
    if !roads.contains(&(start_q, start_r)) || !roads.contains(&(goal_q, goal_r)) {
        return -1;
    }

    // If start equals goal, path length is 0
    if start_q == goal_q && start_r == goal_r {
        return 0;
    }

    // Calculate heuristic (hex distance) - now using correct formula
    let h_start = hex_distance(start_q, start_r, goal_q, goal_r);

    let mut open_set = BinaryHeap::new();
    let mut closed_set = HashSet::new();
    let mut g_scores: HashMap<(i32, i32), i32> = HashMap::new();

    open_set.push(AStarNode::new(start_q, start_r, 0, h_start, start_q, start_r));
    g_scores.insert((start_q, start_r), 0);

    while let Some(current) = open_set.pop() {
        let current_key = (current.q, current.r);

        // Skip if already processed (duplicate in open_set)
        if closed_set.contains(&current_key) {
            continue;
        }

        closed_set.insert(current_key);

        // Check if we reached the goal
        if current.q == goal_q && current.r == goal_r {
            return current.g;
        }

        // Explore neighbors - get all 6 hex neighbors
        let neighbors = get_hex_neighbors(current.q, current.r);
        for (nq, nr) in neighbors {
            let neighbor_key = (nq, nr);

            // Skip if not a road (obstacle check)
            if !roads.contains(&neighbor_key) {
                continue;
            }

            // Skip if already closed
            if closed_set.contains(&neighbor_key) {
                continue;
            }

            // Calculate tentative g score (uniform cost of 1 per step)
            let tentative_g = current.g + 1;

            // Check if this is a better path (matches Python: if neighbor not in g_cost or tentative_g < g_cost[neighbor])
            let current_g = g_scores.get(&neighbor_key).copied().unwrap_or(i32::MAX);
            if tentative_g < current_g {
                // This path to neighbor is better - record it
                g_scores.insert(neighbor_key, tentative_g);
                let h = hex_distance(nq, nr, goal_q, goal_r);
                open_set.push(AStarNode::new(nq, nr, tentative_g, h, current.q, current.r));
            }
        }
    }

    // No path found
    -1
}

/// Hex A* pathfinding that returns full path
/// Matches TypeScript hexAStar algorithm exactly:
/// - Uses cube coordinates for distance calculation (cube_distance)
/// - Maintains open set as BinaryHeap (min-heap by f score, then h score)
/// - Maintains closed set as HashSet
/// - Maintains g_scores as HashMap
/// - Stores parent pointers for path reconstruction
/// 
/// @param start_q - Start q coordinate (axial)
/// @param start_r - Start r coordinate (axial)
/// @param goal_q - Goal q coordinate (axial)
/// @param goal_r - Goal r coordinate (axial)
/// @param valid_terrain_json - JSON string with array of valid terrain coordinates: [{"q":0,"r":0},...]
/// @returns JSON string with path array [{"q":0,"r":0},...] or "null" if no path found
#[wasm_bindgen]
pub fn hex_astar(
    start_q: i32,
    start_r: i32,
    goal_q: i32,
    goal_r: i32,
    valid_terrain_json: String,
) -> String {
    // Parse valid terrain from JSON
    let valid_terrain = parse_valid_terrain_json(&valid_terrain_json);
    
    // Check if start and goal are in valid terrain
    if !valid_terrain.contains(&(start_q, start_r)) || !valid_terrain.contains(&(goal_q, goal_r)) {
        return "null".to_string();
    }
    
    // If start equals goal, return path with single node
    if start_q == goal_q && start_r == goal_r {
        return format!(r#"[{{"q":{},"r":{}}}]"#, start_q, start_r);
    }
    
    // Convert goal to cube for distance calculation (matches TypeScript)
    let goal_cube = axial_to_cube(goal_q, goal_r);
    
    // Calculate heuristic function (cube distance)
    let heuristic = |q: i32, r: i32| -> i32 {
        let cube = axial_to_cube(q, r);
        cube_distance(cube, goal_cube)
    };
    
    // Initialize A* data structures
    let h_start = heuristic(start_q, start_r);
    let mut open_set = BinaryHeap::new();
    let mut closed_set = HashSet::new();
    let mut g_scores: HashMap<(i32, i32), i32> = HashMap::new();
    let mut parents: HashMap<(i32, i32), (i32, i32)> = HashMap::new();
    
    // Start node (parent is itself to mark as root)
    open_set.push(AStarNode::new(start_q, start_r, 0, h_start, start_q, start_r));
    g_scores.insert((start_q, start_r), 0);
    
    while let Some(current) = open_set.pop() {
        let current_key = (current.q, current.r);
        
        // Skip if already processed (duplicate in open_set)
        if closed_set.contains(&current_key) {
            continue;
        }
        
        closed_set.insert(current_key);
        
        // Check if we reached the goal
        if current.q == goal_q && current.r == goal_r {
            // Reconstruct path by following parent pointers
            let mut path: Vec<(i32, i32)> = Vec::new();
            let mut node_key = (goal_q, goal_r);
            
            // Follow parent pointers from goal to start
            loop {
                path.push(node_key);
                
                // Get parent for this node
                if let Some(parent_key) = parents.get(&node_key) {
                    // If parent is the start, add it and break
                    if parent_key.0 == start_q && parent_key.1 == start_r {
                        path.push((start_q, start_r));
                        break;
                    }
                    node_key = *parent_key;
                } else {
                    // No parent in map means we're at start (shouldn't happen in normal flow)
                    // But handle it just in case
                    if node_key.0 != start_q || node_key.1 != start_r {
                        path.push((start_q, start_r));
                    }
                    break;
                }
            }
            
            // Reverse path to get start-to-goal order
            path.reverse();
            
            // Build JSON string
            let mut json_parts = Vec::new();
            for (q, r) in path {
                json_parts.push(format!(r#"{{"q":{},"r":{}}}"#, q, r));
            }
            
            return format!("[{}]", json_parts.join(","));
        }
        
        // Explore neighbors
        let neighbors = get_hex_neighbors(current.q, current.r);
        for (nq, nr) in neighbors {
            let neighbor_key = (nq, nr);
            
            // Skip if not in valid terrain
            if !valid_terrain.contains(&neighbor_key) {
                continue;
            }
            
            // Skip if already closed
            if closed_set.contains(&neighbor_key) {
                continue;
            }
            
            // Calculate tentative g score (uniform cost of 1 per step)
            let tentative_g = current.g + 1;
            
            // Check if this is a better path
            let current_g = g_scores.get(&neighbor_key).copied().unwrap_or(i32::MAX);
            if tentative_g < current_g {
                // This path to neighbor is better - record it
                g_scores.insert(neighbor_key, tentative_g);
                parents.insert(neighbor_key, (current.q, current.r));
                let h = heuristic(nq, nr);
                open_set.push(AStarNode::new(nq, nr, tentative_g, h, current.q, current.r));
            }
        }
    }
    
    // No path found
    "null".to_string()
}

/// Build a path between two road points using A* pathfinding
/// Returns array of intermediate hexes (excluding start, including end)
/// Matches TypeScript buildPathBetweenRoads function
/// 
/// @param start_q - Start q coordinate (axial)
/// @param start_r - Start r coordinate (axial)
/// @param end_q - End q coordinate (axial)
/// @param end_r - End r coordinate (axial)
/// @param valid_terrain_json - JSON string with array of valid terrain coordinates: [{"q":0,"r":0},...]
/// @returns JSON string with path array excluding start, including end, or "null" if no path found
#[wasm_bindgen]
pub fn build_path_between_roads(
    start_q: i32,
    start_r: i32,
    end_q: i32,
    end_r: i32,
    valid_terrain_json: String,
) -> String {
    // Call hex_astar to get full path
    let full_path_json = hex_astar(start_q, start_r, end_q, end_r, valid_terrain_json);
    
    // If no path, return null
    if full_path_json == "null" || full_path_json.is_empty() {
        return "null".to_string();
    }
    
    // Parse the path JSON
    // Simple parsing: extract all {"q":X,"r":Y} patterns and skip first one
    let trimmed = full_path_json.trim();
    if trimmed == "[]" || trimmed.len() < 3 {
        return "null".to_string();
    }
    
    // Find all coordinate pairs
    let mut coords: Vec<(i32, i32)> = Vec::new();
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
    
    // If path has less than 2 nodes, return null
    if coords.len() < 2 {
        return "null".to_string();
    }
    
    // Return path excluding start (first element), including end (last element)
    let path_without_start = &coords[1..];
    
    // Build JSON string
    let mut json_parts = Vec::new();
    for (q, r) in path_without_start {
        json_parts.push(format!(r#"{{"q":{},"r":{}}}"#, q, r));
    }
    
    format!("[{}]", json_parts.join(","))
}

/// Validate that all road tiles are reachable from each other using A* pathfinding
/// 
/// Uses transitive property: if all roads are reachable from one source road,
/// then all pairs have paths (by transitivity: A->B and B->C implies A->C).
/// 
/// @param roads_json - JSON string with array of road coordinates: [{"q":0,"r":0},{"q":1,"r":0},...]
/// @returns true if all roads are reachable from source, false otherwise
#[wasm_bindgen]
pub fn validate_road_connectivity(roads_json: String) -> bool {
    // Parse roads from JSON
    // Simple JSON parsing without serde to keep WASM size small
    let mut roads: Vec<(i32, i32)> = Vec::new();
    
    // Remove whitespace and brackets
    let trimmed = roads_json.trim();
    if trimmed.is_empty() || trimmed == "[]" {
        return true; // Empty roads is trivially connected
    }

    // Simple JSON parsing: find all {"q":X,"r":Y} patterns
    // This is a simplified parser that handles the expected format: [{"q":0,"r":0},...]
    let mut i = 0;
    let chars: Vec<char> = trimmed.chars().collect();
    while i < chars.len() {
        // Look for opening brace
        if chars[i] == '{' {
            let mut q_value: Option<i32> = None;
            let mut r_value: Option<i32> = None;
            
            i += 1;
            while i < chars.len() && chars[i] != '}' {
                // Look for "q" or "r" followed by colon and number
                if i + 3 < chars.len() && chars[i] == '"' && chars[i + 1] == 'q' && chars[i + 2] == '"' {
                    i += 3;
                    // Skip colon and whitespace
                    while i < chars.len() && (chars[i] == ':' || chars[i] == ' ' || chars[i] == '\t') {
                        i += 1;
                    }
                    // Parse number
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
                    // Skip colon and whitespace
                    while i < chars.len() && (chars[i] == ':' || chars[i] == ' ' || chars[i] == '\t') {
                        i += 1;
                    }
                    // Parse number
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
                roads.push((q, r));
            }
        }
        i += 1;
    }

    if roads.is_empty() {
        return true;
    }

    if roads.len() == 1 {
        // Single road - check if it has at least one road neighbor
        // For single road, we consider it valid (can't check neighbors without more context)
        return true;
    }

    // Convert to HashSet for O(1) lookups
    let roads_set: HashSet<(i32, i32)> = roads.iter().cloned().collect();

    // Use first road as source
    let source = roads[0];

    // Check if all other roads are reachable from source using A*
    for road in roads.iter().skip(1) {
        let path_length = hex_astar_path(source.0, source.1, road.0, road.1, &roads_set);
        if path_length == -1 {
            return false; // Unreachable road found
        }
    }

    true // All roads reachable from source
}

