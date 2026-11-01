// THE WARD — rules. Runs only on the host.
game.config({ batterySeconds: 240 });
game.state.set('fuses', 0);
game.state.set('power', false);

const cell = (c, r) => ({ x: -33.75 + (c + 0.5) * 2.5, z: -16.25 + (r + 0.5) * 2.5 });

// Fuses hide in random spots in the side rooms (never in the hallway).
const fuseSpots = rand.shuffle([[3, 4], [6, 1], [10, 3], [13, 4], [18, 3], [24, 2], [2, 8], [5, 10], [10, 11], [13, 8], [17, 9], [21, 11]]);
for (const [c, r] of fuseSpots.slice(0, 3)) prefab.fuse({ pos: [cell(c, r).x, 0.45, cell(c, r).z] });
for (const [c, r] of fuseSpots.slice(3, 5)) prefab.battery({ pos: [cell(c, r).x, 0.4, cell(c, r).z] });
prefab.radio({ pos: [cell(fuseSpots[5][0], fuseSpots[5][1]).x, 0.45, cell(fuseSpots[5][0], fuseSpots[5][1]).z] });

// The fuse box on the hallway wall.
const fb = cell(13, 6);
const box = world.model('generator', { pos: [fb.x, 0, fb.z - 0.75], rot: [0, 0, 0], color: 0x58606a, solid: true, prompt: 'Fuse box (0/3)', range: 2.4 });
box.on('interact', (p) => {
  if (game.state.get('power')) return;
  if (!p.has('Fuse')) { p.toast('The fuse box has three empty slots.'); p.sound('fail'); return; }
  p.take('Fuse');
  const n = game.state.get('fuses') + 1;
  game.state.set('fuses', n);
  box.set({ prompt: `Fuse box (${n}/3)` });
  audio.play('click', { pos: box.pos, everyone: true, volume: 2 });
  p.makeNoise?.(0.5);
  if (n >= 3) powerOn();
});

// Elevator exit.
const ex = cell(24, 9.5);
const exit = prefab.exit({
  pos: [ex.x, 1.5, ex.z], size: [6, 3, 8],
  onEscape: (p) => { p.toast('The doors close behind you.', 4, '#a0e0a0'); p.freeze(true); p.fade(1, 2.5); checkEnd(); },
});

let monster = null;
after(22, () => {
  const far = cell(rand.pick([22, 24]), rand.pick([1, 3]));
  monster = prefab.monster({ pos: [far.x, 0, far.z], model: 'stalker', hearing: 1.25, sight: 13, speed: 1.5, chaseSpeed: 4.1 });
  fx.everyone({ sound: 'scream', pos: [far.x, 1.5, far.z], volume: 0.8, range: 60 });
  net.broadcast('subtitle', { text: 'Something on the ward is awake.', secs: 4 });
});

function powerOn() {
  game.state.set('power', true);
  box.set({ prompt: '', glowColor: 0x30ff60 });
  fx.everyone({ sound: 'stinger', glitch: 1, shake: 0.6 });
  for (const l of world.find('light')) {
    if (l.props.fixture !== 'lamp') continue;
    l.set({ color: 0xf2f0e0, intensity: 1.7, flicker: rand() < 0.25 ? 0.4 : 0 });
    l.flicker(2);
  }
  world.findOne('elevator')?.unlock();
  exit.activate();
  if (monster) {
    monster.setSpeed(2.4, 4.9);
    const victim = players.nearest(monster.pos);
    if (victim) monster.hunt(victim);
  }
}

function checkEnd() {
  const all = players.all();
  const stillIn = all.filter((p) => p.alive && !p.data.escaped);
  if (stillIn.length) return;
  const out = all.filter((p) => p.data.escaped);
  if (out.length) game.end({ title: 'ESCAPED', text: `${out.map((p) => p.name).join(', ')} made it out of Ward 4.`, win: true });
  else game.end({ title: 'WARD 4 KEEPS YOU', text: 'Nobody made it out. She is still listening.' });
}
on('playerDeath', checkEnd);
on('playerLeave', () => after(0.1, checkEnd));
on('catch', (m, p) => net.broadcast('subtitle', { text: `${p.name} was taken.`, secs: 3 }));
