// THE LAST SHIFT — the film. Everything below is a cutscene script: camera, actors, dialogue, sound.
// Press ● Rec in the Studio (or on the play screen) to export it as a video.
game.config({ movie: true, monsterFx: false });

cutscene.define('film', async (c) => {
  c.music('tension', 0.35);
  c.camera.at([0, 2.6, 3.2], [0, 1.1, -1]);
  c.title('THE LAST SHIFT', 'a Shiver short film', 4);
  await c.camera.moveTo([1.2, 1.7, 2.4], { lookAt: [2.4, 1.1, -2.4], duration: 4.5 });

  const guard = c.actor('humanoid', { pos: [-3.2, 0, 1.2], rotY: Math.PI / 2, name: 'Guard', color: 0x2a3550 });
  c.camera.follow(guard, { offset: [0.6, 1.8, 1.9], lookOffset: [0, 1.3, 0] });
  await guard.walkTo([1.6, 0, 0.6], { speed: 1.1 });
  await guard.face([2.4, 0, -2.6], 0.5);
  await c.say('Guard', 'Last round of the night. Then home.', 2.6);

  c.camera.at([3.4, 1.6, 1.8], [1.6, 1.6, 0.6]);
  c.sound('knock', { pos: [-7, 1.4, 0] });
  await c.wait(1.4);
  await guard.face([-7, 0, 0], 0.4);
  await c.say('Guard', 'Hello? ...Is someone out there?', 2.6);

  for (const l of world.find('light')) l.flicker(3);
  c.sound('glitch');
  c.glitch(0.6);
  await c.wait(1.6);

  const thing = c.actor('stalker', { pos: [-5.2, 0, 0.2], rotY: Math.PI / 2 });
  c.camera.at([0.2, 1.5, 1.6], [-5.2, 2.2, 0.2]);
  c.sound('stinger');
  await c.camera.fov(32, { duration: 3, ease: 'in' });
  await c.say(null, '...', 2);
  c.camera.fov(70);
  c.camera.at([2.4, 1.6, 1.4], [0, 1.6, 0.4]);
  await thing.walkTo([0.8, 0, 0.5], { speed: 4.5 });
  await c.jumpscare('stalker');
  await c.fade(1, 0.6);
  c.music(null);
  await c.title('THE END', 'made with code in Shiver', 4);
});

on('begin', () => cutscene.play('film'));
on('cutsceneEnd', () => ui.text('again', 'Press R to watch again', { y: 88, size: 14, color: '#888' }));
on('keydown', (k) => {
  if (k !== 'KeyR' || cutscene.playing) return;
  ui.remove('again');
  fx.fade(0, 0.4);
  cutscene.play('film');
});
