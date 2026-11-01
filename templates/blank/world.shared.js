// world.shared.js runs on EVERY player. Build your level here so everyone sees the same thing.
// Things spawned here are kept in sync by the host (doors opening, items taken, monsters moving).

world.fog(0x050505, 0.08);   // fog colour + density
world.ambient(0.06);         // how dark the dark is

// Room you start in, with a door on its north side...
build.room({ x: 0, z: 0, w: 10, d: 10, wall: 'plaster', floor: 'tiles', doors: [{ side: 'n', door: true }], flicker: 0.2 });
// ...and a darker room behind that door (no south wall: the first room already has one).
build.room({ x: 0, z: -10, w: 10, d: 10, wall: 'concrete', floor: 'concrete', open: ['s'], flicker: 0.8, lightColor: 0xff4030 });

world.spawnPoint(0, 0.1, 3);  // where players appear

prefab.note({ pos: [2, 0.02, 1], title: 'Welcome to Shiver', text: 'Scripts ending in .shared.js run on every player (build the level).\n.host.js runs only on the host (rules, monsters).\n.client.js runs on each player (HUD, sounds).\n\nOpen the Docs for the full API.' });
prefab.locker({ pos: [-4.5, 0, 2], rotY: Math.PI / 2 });
prefab.prop('bed', { pos: [3.5, 0, 3], rotY: 0 });
