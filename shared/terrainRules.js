// Intrinsic fence terrain remains a fence even if a deploy platform is placed on top of it.
export const isFenceTile = tile => !!tile && (tile.tileKey==='tile_fence'||tile.tileKey==='tile_fence_bound');
