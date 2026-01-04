/// WFC state management module

use std::sync::{LazyLock, Mutex};
use std::collections::HashMap;
use crate::types::TileType;

/// State structure using hash map for efficient sparse grid storage
/// 
/// **Learning Point**: Uses HashMap<(i32, i32), TileType> for O(1) lookups and
/// no size limitations. Keys are (q, r) hex coordinates.
pub struct WfcState {
    grid: HashMap<(i32, i32), TileType>,
    pre_constraints: HashMap<(i32, i32), TileType>,
}

impl WfcState {
    pub fn new() -> Self {
        WfcState {
            grid: HashMap::new(),
            pre_constraints: HashMap::new(),
        }
    }
    
    pub fn clear(&mut self) {
        self.grid.clear();
        // DO NOT clear pre_constraints - they must persist
    }
    
    /// Set a pre-constraint at a specific hex position (q, r)
    /// Returns true if the constraint was set successfully
    pub fn set_pre_constraint(&mut self, q: i32, r: i32, tile_type: TileType) -> bool {
        self.pre_constraints.insert((q, r), tile_type);
        true
    }
    
    /// Clear all pre-constraints
    pub fn clear_pre_constraints(&mut self) {
        self.pre_constraints.clear();
    }
    
    /// Get tile at hex coordinate (q, r)
    pub fn get_tile(&self, q: i32, r: i32) -> Option<TileType> {
        self.grid.get(&(q, r)).copied()
    }
    
    /// Get pre-constraints iterator
    pub fn pre_constraints(&self) -> impl Iterator<Item = ((i32, i32), TileType)> + '_ {
        self.pre_constraints.iter().map(|((q, r), tile_type)| ((*q, *r), *tile_type))
    }
    
    /// Insert tile into grid
    pub fn insert_tile(&mut self, q: i32, r: i32, tile_type: TileType) {
        self.grid.insert((q, r), tile_type);
    }
    
    /// Get grid values iterator
    pub fn grid_values(&self) -> impl Iterator<Item = TileType> + '_ {
        self.grid.values().copied()
    }
}

/// Global WFC state (thread-safe)
pub static WFC_STATE: LazyLock<Mutex<WfcState>> = LazyLock::new(|| Mutex::new(WfcState::new()));

