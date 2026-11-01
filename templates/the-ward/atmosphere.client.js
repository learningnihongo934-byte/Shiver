// THE WARD — what each player sees and hears.
audio.loop('drone', { volume: 0.35 });

game.state.watch('fuses', (n) => {
  if (!game.state.get('power')) ui.objective(`Find fuses for the fuse box in the hallway (${n}/3)`);
});
game.state.watch('power', (on) => {
  if (!on) return;
  ui.objective('Power restored. GET TO THE ELEVATOR.');
  audio.loop('hum', { volume: 0.2 });
});

net.on('subtitle', (d) => ui.subtitle(d.text, d.secs));

// Intro cutscene (Esc skips). Each player sees it when they click in.
cutscene.define('intro', async (c) => {
  c.camera.at([-31.5, 2.3, 0], [-20, 1.5, 0]);
  c.title('THE WARD', 'St. Agnes Hospital · 3:12 AM', 3.5);
  await c.camera.moveTo([-25, 1.7, 0.3], { lookAt: [-12, 1.3, 0], duration: 5 });
  c.sound('static', { volume: 0.6 });
  await c.say('Radio', 'If anyone can hear this... the power is out on Ward 4.', 3);
  await c.say('Radio', "Find the fuses. And don't call out. She follows voices.", 3.4);
  c.sound('drip', { pos: [-20, 2, 0] });
  await c.camera.player({ duration: 1.2 });
});
on('begin', () => cutscene.play('intro'));

// The building is never quiet.
every(7, () => {
  if (rand() > 0.55) return;
  const a = rand() * Math.PI * 2, d = 8 + rand() * 12;
  audio.play(rand.pick(['drip', 'knock', 'creak', 'whisper', 'giggle', 'thud']), { pos: { x: me.pos.x + Math.cos(a) * d, y: 1.5, z: me.pos.z + Math.sin(a) * d }, volume: 0.7 });
});
