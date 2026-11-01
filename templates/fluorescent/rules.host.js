// FLUORESCENT — keycards, the exit and The Grinner. Host only.
game.state.set('cards', 0);

// keycards in the dead ends farthest from the start
const far = MAZE.deadEnds
  .filter((d) => Math.hypot(d.x - MAZE.start.x, d.z - MAZE.start.z) > 12 && Math.hypot(d.x - MAZE.end.x, d.z - MAZE.end.z) > 4)
  .sort(() => rand() - 0.5)
  .slice(0, 3);
for (const d of far) {
  prefab.item({ model: 'radio', color: 0x2060c0, name: 'Keycard', glowColor: 0x40a0ff, pos: [d.x, 0.9, d.z], inventory: false, pickupText: 'Keycard found', onPickup: () => {
    game.state.set('cards', game.state.get('cards') + 1);
    audio.play('success', { everyone: true, volume: 0.6 });
  } });
}

// exit: needs all three keycards
const panel = world.box({ pos: [MAZE.end.x, 1.2, MAZE.end.z], size: [0.6, 0.8, 0.15], color: 0x222222, emissive: 0x003300, prompt: 'Exit lock (0/3 keycards)', range: 2.5 });
const exit = prefab.exit({ pos: [MAZE.end.x, 1.5, MAZE.end.z], size: [4, 3, 4], onEscape: (p) => { p.toast('You found a way out.', 4, '#a0ffa0'); p.freeze(true); p.fade(1, 2); check(); } });
game.state.watch('cards', (n) => panel.set({ prompt: n >= 3 ? 'Exit open' : `Exit lock (${n}/3 keycards)` }));
panel.on('interact', (p) => {
  if (game.state.get('cards') < 3) { p.toast('You need all three keycards.'); p.sound('locked'); return; }
  if (!exit.active) { exit.activate(); panel.set({ emissive: 0x30ff60 }); audio.play('bell', { everyone: true }); net.broadcast('open', {}); }
});

// THE GRINNER: silent, fast, and frozen while anyone looks at it.
const start = MAZE.deadEnds.sort((a, b) => Math.hypot(b.x - MAZE.start.x, b.z - MAZE.start.z) - Math.hypot(a.x - MAZE.start.x, a.z - MAZE.start.z))[0] || MAZE.end;
let grinner = null;
after(15, () => {
  grinner = prefab.monster({ pos: [start.x, 0, start.z], model: 'grinner', steps: null, speed: 2.2, investigateSpeed: 4.2, chaseSpeed: 6.2, sight: 20, fov: 1.5, hearing: 1.4, screech: false });
  net.broadcast('awake', {});
});

on('update', () => {
  if (!grinner) return;
  const gp = grinner.pos;
  const head = { x: gp.x, y: 1.7, z: gp.z };
  let watched = false;
  for (const p of players.alive()) {
    const dx = gp.x - p.pos.x, dz = gp.z - p.pos.z, d = Math.hypot(dx, dz);
    if (d > 16 || d < 0.01) continue;
    const look = { x: -Math.sin(p.yaw), z: -Math.cos(p.yaw) };
    if ((dx * look.x + dz * look.z) / d > 0.82 && world.lineOfSight({ x: p.pos.x, y: 1.6, z: p.pos.z }, head)) { watched = true; break; }
  }
  if (watched) grinner.stun(0.1);
});

// lights near it die
every(0.5, () => {
  if (!grinner) return;
  for (const l of world.find('light')) if (vec.dist2d(l.pos, grinner.pos) < 7 && rand() < 0.5) l.flicker(0.8);
});

function check() {
  const left = players.all().filter((p) => p.alive && !p.data.escaped);
  if (left.length) return;
  const out = players.all().filter((p) => p.data.escaped);
  if (out.length) game.end({ title: 'YOU GOT OUT', text: `${out.map((p) => p.name).join(', ')} escaped the maze. Probably.`, win: true });
  else game.end({ title: 'SMILE', text: 'The Grinner kept you.', win: false });
}
on('playerDeath', check);
on('playerLeave', () => after(0.1, check));
