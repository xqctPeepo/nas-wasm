/// Hex coordinate utilities module

use std::collections::HashSet;
use crate::types::{HexCoord, CubeCoord};

/// Cube directions for hex grid navigation
pub const CUBE_DIRECTIONS: [CubeCoord; 6] = [
    CubeCoord { q: 1, r: 0, s: -1 },   // Direction 0
    CubeCoord { q: 1, r: -1, s: 0 },   // Direction 1
    CubeCoord { q: 0, r: -1, s: 1 },   // Direction 2
    CubeCoord { q: -1, r: 0, s: 1 },  // Direction 3
    CubeCoord { q: -1, r: 1, s: 0 },  // Direction 4
    CubeCoord { q: 0, r: 1, s: -1 },  // Direction 5
];

/// Calculate hex distance between two hex coordinates (cube distance)
/// Uses axial coordinates converted to cube coordinates
/// Formula: (|dq| + |dr| + |ds|) / 2 where s = -q - r
/// This matches the Python example: (abs(q1-q2) + abs(r1-r2) + abs(s1-s2)) // 2
pub fn hex_distance(q1: i32, r1: i32, q2: i32, r2: i32) -> i32 {
    let s1 = -q1 - r1;
    let s2 = -q2 - r2;
    ((q1 - q2).abs() + (r1 - r2).abs() + (s1 - s2).abs()) / 2
}

/// Get all 6 hex neighbors of a coordinate (axial)
pub fn get_hex_neighbors(q: i32, r: i32) -> Vec<(i32, i32)> {
    vec![
        (q + 1, r),
        (q - 1, r),
        (q, r + 1),
        (q, r - 1),
        (q + 1, r - 1),
        (q - 1, r + 1),
    ]
}

/// Convert axial coordinates to cube coordinates
/// Cube coordinates: (q, r, s) where q + r + s = 0
pub fn axial_to_cube(q: i32, r: i32) -> CubeCoord {
    CubeCoord {
        q,
        r,
        s: -q - r,
    }
}

/// Calculate cube distance between two cube coordinates
/// Formula: max(|dq|, |dr|, |ds|)
/// This matches TypeScript HEX_UTILS.cubeDistance
pub fn cube_distance(a: CubeCoord, b: CubeCoord) -> i32 {
    (a.q - b.q).abs().max((a.r - b.r).abs()).max((a.s - b.s).abs())
}

/// Add two cube coordinates
pub fn cube_add(a: CubeCoord, b: CubeCoord) -> CubeCoord {
    CubeCoord {
        q: a.q + b.q,
        r: a.r + b.r,
        s: a.s + b.s,
    }
}

/// Scale a cube coordinate by a factor
pub fn cube_scale(hex: CubeCoord, factor: i32) -> CubeCoord {
    CubeCoord {
        q: hex.q * factor,
        r: hex.r * factor,
        s: hex.s * factor,
    }
}

/// Get cube neighbor in specified direction (0-5)
pub fn cube_neighbor(cube: CubeCoord, direction: usize) -> CubeCoord {
    cube_add(cube, CUBE_DIRECTIONS[direction % 6])
}

/// Generate ring of tiles at specific layer (radius) around center
pub fn cube_ring(center: CubeCoord, radius: i32) -> Vec<CubeCoord> {
    if radius == 0 {
        return vec![center];
    }
    
    let mut results = Vec::new();
    
    // Start at the first hex of the ring by moving from the center
    // Move 'radius' steps in direction 4 (CUBE_DIRECTIONS[4])
    let mut current_hex = cube_add(center, cube_scale(CUBE_DIRECTIONS[4], radius));
    
    // Traverse the six sides of the hexagonal ring
    for i in 0..6 {
        // For each side, take 'radius' steps in the current direction
        for _j in 0..radius {
            results.push(current_hex);
            current_hex = cube_neighbor(current_hex, i);
        }
    }
    
    results
}

/// Generate hexagon grid up to max_layer
/// Returns all hex coordinates within the hexagon pattern
/// Matches TypeScript implementation using cube coordinates
pub fn generate_hex_grid(max_layer: i32, center_q: i32, center_r: i32) -> Vec<HexCoord> {
    let mut grid_set = HashSet::new();
    let center_cube = CubeCoord {
        q: center_q,
        r: center_r,
        s: -center_q - center_r,
    };
    
    // Generate grid from center outwards, adding one ring at a time
    for layer in 0..=max_layer {
        let ring = cube_ring(center_cube, layer);
        for cube in ring {
            // Use tuple of coordinates as hashable key for the set
            grid_set.insert((cube.q, cube.r, cube.s));
        }
    }
    
    // Convert set to array of HexCoord, verifying cube coordinate constraint
    let mut grid = Vec::new();
    for (q, r, s) in grid_set {
        // Verify cube coordinate is valid (q + r + s = 0)
        if q + r + s == 0 {
            grid.push(HexCoord { q, r });
        }
    }
    
    grid
}

/// Parse valid terrain JSON string into HashSet
/// Format: [{"q":0,"r":0},{"q":1,"r":0},...]
/// Returns empty HashSet if parsing fails
pub fn parse_valid_terrain_json(valid_terrain_json: &str) -> HashSet<(i32, i32)> {
    let mut valid_terrain = HashSet::new();
    
    let trimmed = valid_terrain_json.trim();
    if trimmed.is_empty() || trimmed == "[]" {
        return valid_terrain;
    }
    
    // Simple JSON parsing: find all {"q":X,"r":Y} patterns
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
                valid_terrain.insert((q, r));
            }
        }
        i += 1;
    }
    
    valid_terrain
}

/// Parse path JSON and return vector of coordinates
/// Format: [{"q":0,"r":0},{"q":1,"r":0},...]
pub fn parse_path_json(path_json: &str) -> Vec<(i32, i32)> {
    let mut path = Vec::new();
    
    if path_json == "null" || path_json.is_empty() {
        return path;
    }
    
    let trimmed = path_json.trim();
    if trimmed == "[]" || trimmed.len() < 3 {
        return path;
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
                path.push((q, r));
            }
        }
        i += 1;
    }
    
    path
}

