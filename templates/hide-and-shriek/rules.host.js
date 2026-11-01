// HIDE & SHRIEK — roles, generators, the gate and win conditions. Host only.
const GENS = 4, ROUND_SECONDS = 540;
game.config({ ghosts: true, batterySeconds: 420 });
game.state.set('gens', 0);
game.state.set('timeLeft', ROUND_SECONDS);

let hollow = null;   // the monster player (or null if an AI plays it)
let ai = null;

function pickHollow() {
  const list = players.all();
  if (list.length < 2) return spawnAI();
  hollow = rand.pick(list);
  hollow.setRole('monster', { model: 'stalker', speed: 1.12, voice: 'demon', vision: 'thermal' });
  hollow.teleport(HS.monsterSpawn.x, 0.1, HS.monsterSpawn.z, Math.PI);
  hollow.toast('You are THE HOLLOW. Hunt them down.', 6, '#ff4040');
  for (const p of list) if (p !== hollow) p.toast('One of you is The Hollow. Fix the generators. Stay quiet.', 6);
  net.broadcast('roles', { hollow: hollow.id });
}
function spawnAI() {
  hollow = null;
  ai = prefab.monster({ pos: [HS.monsterSpawn.x, 0, HS.monsterSpawn.z], model: 'stalker', hearing: 1.3, sight: 15, chaseSpeed: 4.5 });
  net.broadcast('roles', { hollow: null });
}
after(1.5, pickHollow);

// generators
HS.gens.forEach(([x, z], i) => {
  prefab.generator({ pos: [x, 0, z], rotY: i * 1.3, hold: 9, noise: 0.6, onRepaired: (p) => {
    const n = game.state.get('gens') + 1;
    game.state.set('gens', n);
    p.addScore(1);
    fx.everyone({ sound: 'bell', volume: 0.5 });
    if (n >= GENS) openGate();
  } });
});

const exit = prefab.exit({ pos: [HS.exit[0], 1.5, HS.exit[1]], size: [8, 3, 5], onEscape: (p) => { p.toast('You escaped the farm.', 5, '#a0ffa0'); p.freeze(true); p.fade(1, 2); check(); } });

function openGate() {
  world.findOne('gate')?.unlock();
  world.findOne('gate')?.toggle(true);
  for (const l of world.find('gatelight')) l.set({ color: 0x40ff60 });
  exit.activate();
  fx.everyone({ sound: 'stinger', glitch: 0.8 });
  net.broadcast('subtitle', { text: 'THE GATE IS OPEN. RUN NORTH.', secs: 5 });
}

// The Hollow strikes with left click.
let lastHit = 0;
net.on('attack', (d, p) => {
  if (!p || p.role !== 'monster' || !p.alive || game.time - lastHit < 1.1) return;
  lastHit = game.time;
  audio.play('swoosh', { pos: p.pos, everyone: true });
  const fwd = { x: -Math.sin(p.yaw), z: -Math.cos(p.yaw) };
  let victim = null, best = 2.4;
  for (const s of players.alive()) {
    if (s === p || s.role === 'monster') continue;
    const dx = s.pos.x - p.pos.x, dz = s.pos.z - p.pos.z, d = Math.hypot(dx, dz);
    if (d < best && (dx * fwd.x + dz * fwd.z) / (d || 1) > 0.35) { best = d; victim = s; }
  }
  if (!victim) return;
  if (victim.hidden) victim.unhide();
  victim.jumpscare('stalker');
  audio.play('scream', { pos: victim.pos, everyone: true, volume: 0.9 });
  after(0.9, () => victim.kill('hollow'));
  p.addScore(1);
});

// The Hollow sees every loud noise, including survivors' real voices.
on('noise', (p, level) => {
  if (!hollow || p === hollow || !p.alive || level < 0.28) return;
  net.to(hollow, 'ping', { pos: p.pos, level });
});

// clock
every(1, () => {
  if (game.ended) return;
  const t = game.state.get('timeLeft') - 1;
  game.state.set('timeLeft', t);
  if (t === 60) net.broadcast('subtitle', { text: 'One minute until dawn.', secs: 3 });
  if (t <= 0) game.end({ title: 'DAWN NEVER CAME', text: 'The Hollow kept everyone.', win: false });
});

function check() {
  const survivors = players.all().filter((p) => p.role !== 'monster');
  if (!survivors.length) return;
  if (survivors.some((p) => p.alive && !p.data.escaped)) return;
  const out = survivors.filter((p) => p.data.escaped);
  if (out.length) game.end({ title: 'SURVIVORS WIN', text: `${out.map((p) => p.name).join(', ')} escaped before dawn.`, win: true });
  else game.end({ title: 'THE HOLLOW WINS', text: hollow ? `${hollow.name} was The Hollow.` : 'Nobody escaped.', win: false });
}
on('playerDeath', check);
on('playerLeave', (p) => {
  if (hollow && p.id === hollow.id) { net.broadcast('subtitle', { text: 'The Hollow left... but something else took its place.', secs: 4 }); spawnAI(); }
  after(0.1, check);
});
on('playerJoin', (p) => p.toast('Round in progress. Help the survivors.', 4));
