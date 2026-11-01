// FLUORESCENT — a new maze every round (seeded, so every player gets the same one).
world.fog(0x2a2410, 0.05);
world.ambient(0.22, 0xfff0b0, 0x40300a);

const maze = build.maze({
  cols: 12, rows: 12, cell: 4.5, height: 3,
  wall: 'wallpaper', floor: 'carpet', ceiling: 'ceiling',
  loops: 0.18, lightEvery: 1, lightColor: 0xfff6c8, lightIntensity: 1.3, flickerChance: 0.12, deadChance: 0.12,
});

// a few pillars and abandoned desks so it isn't all corridors
for (let i = 0; i < 16; i++) {
  const c = maze.random();
  if (Math.hypot(c.x - maze.start.x, c.z - maze.start.z) < 6) continue;
  if (sharedRand() < 0.5) prefab.prop('desk', { pos: [c.x + sharedRand.range(-0.8, 0.8), 0, c.z + sharedRand.range(-0.8, 0.8)], rotY: sharedRand.pick([0, Math.PI / 2, Math.PI]) });
  else prefab.prop('chair', { pos: [c.x, 0, c.z], rotY: sharedRand() * 6, solid: false });
}

// spawn at the start, exit at the far corner
for (let i = 0; i < 6; i++) world.spawnPoint(maze.start.x - 1 + (i % 3), 0.1, maze.start.z - 0.5 + Math.floor(i / 3), maze.openYaw(0, 0));

const exitSign = world.text('EXIT', { pos: [maze.end.x, 2.6, maze.end.z], billboard: true, textColor: '#30ff60', fontSize: 0.45 });
prefab.light({ pos: [maze.end.x, 2.8, maze.end.z], color: 0x40ff70, intensity: 1.2, range: 6, fixture: 'none' });

globalThis.MAZE = maze;
