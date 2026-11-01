// FLUORESCENT — that noise. You know the one.
audio.loop('hum', { volume: 0.35 });

game.state.watch('cards', (n) => ui.objective(n >= 3 ? 'Find the green EXIT sign and open it.' : `Find the keycards (${n}/3). Don't look away from it.`));
net.on('awake', () => {
  ui.subtitle('You hear a wet smile somewhere in the walls.', 4);
  audio.play('giggle', { volume: 0.5 });
});
net.on('open', () => ui.subtitle('The exit is open.', 3));

on('begin', () => ui.subtitle("It can't move while someone is looking at it.", 5));
