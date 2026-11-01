// HIDE & SHRIEK — per-player HUD, monster controls and sounds.
audio.loop('wind', { volume: 0.5 });
audio.loop('drone', { volume: 0.2 });

let hollowId = null;
const isHollow = () => players.me.role === 'monster';

net.on('roles', (d) => { hollowId = d.hollow; });
net.on('subtitle', (d) => ui.subtitle(d.text, d.secs));

game.state.watch('gens', (n) => {
  if (isHollow()) ui.objective(`Stop them. Generators running: ${n}/4`);
  else ui.objective(n >= 4 ? 'The gate is open. Escape north!' : `Restart the generators (${n}/4). Hold E. Repairs are loud.`);
});
game.state.watch('timeLeft', (t) => {
  ui.text('clock', `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')} until dawn`, { x: 50, y: 5, size: 15, color: t < 60 ? '#ff4040' : '#c8c0a8' });
});

// --- monster player ---
let cooldown = 0;
on('update', (dt) => {
  cooldown -= dt;
  if (!isHollow()) return;
  me.flashlight = false;
  ui.text('role', 'THE HOLLOW · left click to strike · red marks are noises', { x: 50, y: 94, size: 13, color: '#ff5050' });
});
on('mousedown', (b) => {
  if (b !== 0 || !isHollow() || cooldown > 0) return;
  cooldown = 1.1;
  fx.shake(0.4);
  net.send('attack', {});
});
net.on('ping', (d) => {
  const mark = world.text('!', { pos: [d.pos.x, d.pos.y + 2.2, d.pos.z], billboard: true, textColor: '#ff2020', fontSize: 0.6 + d.level });
  audio.play('beep', { pos: { x: d.pos.x, y: d.pos.y + 1, z: d.pos.z }, volume: 0.5, pitch: 0.5 });
  after(2.5, () => mark.remove());
});

on('begin', () => ui.subtitle('Someone here is not who they seem.', 4));
