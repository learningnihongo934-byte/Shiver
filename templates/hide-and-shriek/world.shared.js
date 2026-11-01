// HIDE & SHRIEK — farm at night. Runs on every player.
world.fog(0x111a2e, 0.03);
world.ambient(0.7, 0x5068a0, 0x0a0a10);
world.moon(1.0, 0x7088c0);

build.outdoor({ size: 74, ground: 'grass', trees: 0, fence: true });

// buildings
build.room({ x: -14, z: 6, w: 12, d: 10, h: 3, wall: 'wood', floor: 'wood', ceiling: 'wood', doors: [{ side: 'e', door: true }, { side: 'n', at: -2, door: true }], flicker: 0.5, lightColor: 0xffb070 });
build.room({ x: 15, z: -4, w: 11, d: 15, h: 4.2, wall: 'wood', floor: 'dirt', ceiling: 'wood', wallColor: 0x8a4a3a, doors: [{ side: 'w', width: 3, height: 3.4 }, { side: 's', width: 2 }], flicker: 0.7, lightColor: 0xff7040, lightIntensity: 1 });
build.room({ x: 9, z: 22, w: 5, d: 5, h: 2.6, wall: 'metal', floor: 'concrete', ceiling: 'metal', doors: [{ side: 'n', door: true }], flicker: 0.9 });

// north fence wall with the exit gate in the middle
build.wall(-37, -30, -1.6, -30, { height: 3.2, texture: 'brick' });
build.wall(1.6, -30, 37, -30, { height: 3.2, texture: 'brick' });
prefab.door({ pos: [-1.5, 0, -30], width: 3, height: 3, texture: 'metal', color: 0x777777, locked: true, key: 'Gate power', lockedText: 'The gate is electric. Restart all four generators.', tags: ['gate'] });
prefab.light({ pos: [-2.4, 3.6, -29.6], fixture: 'bulb', color: 0xff2020, intensity: 1.2, range: 7, tags: ['gatelight'] });
prefab.light({ pos: [2.4, 3.6, -29.6], fixture: 'bulb', color: 0xff2020, intensity: 1.2, range: 7, tags: ['gatelight'] });

// trees, avoiding buildings and paths
const blocked = [[-14, 6, 9], [15, -4, 10], [9, 22, 5], [0, -27, 6], [0, 26, 6]];
let n = 0;
while (n < 34) {
  const x = sharedRand.range(-34, 34), z = sharedRand.range(-27, 34);
  if (blocked.some(([bx, bz, r]) => Math.hypot(x - bx, z - bz) < r)) continue;
  prefab.prop('tree', { pos: [x, 0, z], rotY: sharedRand() * 6, scale: 0.8 + sharedRand() * 0.6 });
  n++;
}
for (let i = 0; i < 6; i++) prefab.prop(sharedRand.pick(['crate', 'barrel']), { pos: [sharedRand.range(-20, 25), 0, sharedRand.range(-20, 30)], rotY: sharedRand() * 6 });

// lamp posts
for (const [x, z] of [[-6, 14], [6, 10], [-4, -12], [22, 12], [-24, -8]]) {
  world.box({ pos: [x, 1.6, z], size: [0.12, 3.2, 0.12], color: 0x222222 });
  prefab.light({ pos: [x, 3.25, z], fixture: 'bulb', color: 0xffc070, range: 9, flicker: 0.15 });
}

prefab.locker({ pos: [-19.4, 0, 3], rotY: Math.PI / 2 });
prefab.locker({ pos: [19.9, 0, -10], rotY: -Math.PI / 2 });
prefab.locker({ pos: [10.9, 0, 23.5], rotY: -Math.PI / 2 });
prefab.prop('bed', { pos: [-17.5, 0, 8.5], rotY: Math.PI });
prefab.tv({ pos: [-9, 0, 2], rotY: -Math.PI / 2 });
prefab.note({ pos: [-12, 0.02, 4], title: 'Farmhand', text: 'The Hollow wears one of us. It hears what we say, even the whispering. Fix the generators to power the gate. Whatever you do, do not call out to each other.' });

world.spawnPoint(-3, 0.1, 30, 0);
world.spawnPoint(-1, 0.1, 31, 0);
world.spawnPoint(1, 0.1, 30, 0);
world.spawnPoint(3, 0.1, 31, 0);
world.spawnPoint(-2, 0.1, 32, 0);
world.spawnPoint(2, 0.1, 32, 0);
world.spawnPoint(0, 0.1, 33, 0);

globalThis.HS = { monsterSpawn: { x: 17, z: -8 }, gens: [[-16, 8.5], [16, 0.5], [9, 21], [-28, -18]], exit: [0, -33] };
