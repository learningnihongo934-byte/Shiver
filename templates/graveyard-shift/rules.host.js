// GRAVEYARD SHIFT — candles, the bell and The Mourner. Host only.
const CANDLES = 6, MINUTES = 5;
game.state.set('lit', 0);
game.state.set('timeLeft', MINUTES * 60);

for (const g of rand.shuffle(GRAVES).slice(0, CANDLES)) {
  const c = prefab.candle({ pos: [g.x, 0.02, g.z + 0.6], on: false });
  c.set({ prompt: 'Light candle', hold: 2.5, holdNoise: 0.3, range: 2.5 });
  c.on('interact', (p) => {
    if (c.props.on) return;
    c.set({ on: true, prompt: '' });
    p.addScore(1);
    audio.play('pickup', { pos: c.pos, everyone: true });
    const n = game.state.get('lit') + 1;
    game.state.set('lit', n);
    if (n >= CANDLES) game.end({ title: 'THE DEAD REST', text: 'Every candle burns. The Mourner sinks back into the earth.', win: true });
  });
}

after(10, () => {
  const m = prefab.monster({ pos: [18, 0, -18], model: 'crawler', steps: 'step', stride: 0.9, stepVolume: 0.6, speed: 1.6, investigateSpeed: 3, chaseSpeed: 4.4, hearing: 1.5, sight: 9 });
  fx.everyone({ sound: 'scream', pos: [18, 1, -18], range: 80, volume: 0.6 });
});

every(1, () => {
  if (game.ended) return;
  const t = game.state.get('timeLeft') - 1;
  game.state.set('timeLeft', t);
  if (t % 60 === 0 && t > 0) audio.play('bell', { everyone: true, volume: 0.8 });
  if (t <= 0) {
    for (let i = 0; i < 12; i++) after(i * 0.6, () => audio.play('bell', { everyone: true }));
    after(7, () => game.end({ title: 'MIDNIGHT', text: 'The bell struck twelve. The graves opened.', win: false }));
  }
});

on('playerDeath', () => {
  if (players.alive().length === 0) game.end({ title: 'BURIED', text: 'The Mourner found everyone.', win: false });
});
