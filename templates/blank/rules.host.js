// rules.host.js runs ONLY on the host. It is your "server": monsters, scores, win/lose.

const key = prefab.key({ pos: [3, 0.5, -12] });

// The exit only works once someone has the key.
const exit = prefab.exit({ pos: [0, 1, 3], size: [3, 3, 3] });

on('pickup', (player, item) => {
  if (item !== 'Key') return;
  player.toast('Now get back to where you started.');
  exit.activate();
});

on('escape', (player) => game.end({ title: 'YOU ESCAPED', text: `${player.name} got out.`, win: true }));

// A monster that hunts by sound. Talk loudly on voice chat and it will come for you.
after(8, () => {
  prefab.monster({ pos: [-3, 0, -12], model: 'stalker' });
});

on('playerDeath', () => {
  if (players.alive().length === 0) game.end({ title: 'DEAD', text: 'It heard you.' });
});
