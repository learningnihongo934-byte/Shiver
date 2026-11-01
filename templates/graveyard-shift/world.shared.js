// GRAVEYARD SHIFT — a top-down cemetery. Runs on every player.
game.config({ camera: 'topdown', topdownHeight: 15, jump: false, nameTagRange: 30 });
world.fog(0x0e1424, 0.02);
world.ambient(0.95, 0x6070b0, 0x141414);
world.moon(1.3, 0x8090c8);

build.outdoor({ size: 56, ground: 'grass', trees: 18, clear: 22 });
// stone paths
build.floor({ x: 0, z: 0, w: 3, d: 54, y: 0.01, texture: 'stone', thickness: 0.02 });
build.floor({ x: 0, z: 0, w: 54, d: 3, y: 0.01, texture: 'stone', thickness: 0.02 });

// chapel at the north end
build.room({ x: 0, z: -20, w: 8, d: 7, h: 4, wall: 'brick', floor: 'stone', ceiling: 'wood', doors: [{ side: 's', door: true, width: 1.6 }], lightColor: 0xffa060, flicker: 0.3, fixture: 'bulb' });
prefab.candle({ pos: [-2.5, 0.9, -22.5] });
prefab.candle({ pos: [2.5, 0.9, -22.5] });
world.box({ pos: [0, 0.45, -22.5], size: [3, 0.9, 1], texture: 'wood' });

// rows of graves
const graves = [];
for (let gx = -22; gx <= 22; gx += 3) for (let gz = -12; gz <= 22; gz += 4) {
  if (Math.abs(gx) < 3 || Math.abs(gz) < 3) continue;
  if (sharedRand() < 0.18) continue;
  const g = prefab.prop(sharedRand() < 0.75 ? 'gravestone' : 'cross', { pos: [gx + sharedRand.range(-0.4, 0.4), 0, gz], rotY: sharedRand.range(-0.2, 0.2) });
  graves.push({ x: gx, z: gz });
}
world.spawnPoint(-1, 0.1, 24, 0);
world.spawnPoint(1, 0.1, 24, 0);
world.spawnPoint(-1, 0.1, 25.5, 0);
world.spawnPoint(1, 0.1, 25.5, 0);

globalThis.GRAVES = graves;
