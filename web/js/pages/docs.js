import { el } from '../api.js';

const code = (s) => `<pre><code>${s.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</code></pre>`;
const table = (rows) => `<table>${rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table>`;

const SECTIONS = [
  ['start', 'Getting started', `
<p>Shiver games are JavaScript. Open <b>Create</b>, start from a template (or remix any published game), write code on the left, and press <b>▶ Test</b> to play it instantly on the right. <b>Publish</b> puts it on the front page for everyone.</p>
<p>A game is a set of scripts. The file name decides <i>where</i> each script runs:</p>
${table([
  ['name.shared.js', 'Runs on <b>every</b> player. Build the level here. Doors, items, lights and monsters spawned here are identical on every machine and kept in sync by the host.'],
  ['name.host.js', 'Runs on <b>one</b> player, the room host. This is your server: rules, monsters, scores, win/lose. Things spawned here are sent to everyone.'],
  ['name.client.js', 'Runs on <b>each</b> player for things only they see or hear: HUD, ambience, local effects. Things spawned here are visible only to that player.'],
])}
${code(`// level.shared.js
world.fog(0x050505, 0.08);
build.room({ x: 0, z: 0, w: 10, d: 10, doors: [{ side: 'n', door: true }], flicker: 0.3 });
world.spawnPoint(0, 0.1, 3);

// rules.host.js
const key = prefab.key({ pos: [3, 0.5, -3] });
prefab.monster({ pos: [0, 0, -12] });
on('pickup', (player, item) => player.toast('Now run.'));

// hud.client.js
ui.objective('Find the key.');
audio.loop('drone', { volume: 0.4 });`)}
<div class="callout">Scripts run top to bottom when a round starts, so you can use <code>await wait(2)</code> anywhere. <code>game.restart()</code> wipes the world and runs every script again.</div>`],

  ['multiplayer', 'How multiplayer works', `
<p>There is no game server to write. The first player in a room is the <b>host</b>, and their browser runs the <code>.host.js</code> scripts. Every player moves their own character and sends their position 15 times a second. The host decides everything else and replicates it.</p>
<ul>
<li><b>Entities</b> replicate automatically. Change one with <code>e.set({...})</code>, <code>e.x = 3</code> or <code>e.rotY = 1</code> on the host and everyone sees it.</li>
<li><b>Interactions</b> (pressing E) are sent to the host, which runs the entity's <code>on('interact')</code> handler with the player who pressed it.</li>
<li><b>game.state</b> is a shared key/value store. The host sets values and everyone can <code>watch</code> them.</li>
<li><b>net</b> carries your own messages. <code>net.send()</code> goes from a client to the host, <code>net.broadcast()</code> goes from the host to everyone, and <code>net.to(player)</code> reaches one player.</li>
<li>If the host leaves, the next player becomes host and the round restarts.</li>
<li>Late joiners get a snapshot of the current world.</li>
</ul>
${code(`// host: count fuses for everyone
game.state.set('fuses', 0);
on('pickup', (p, item) => { if (item === 'Fuse') game.state.set('fuses', game.state.get('fuses') + 1); });

// client: show it
game.state.watch('fuses', (n) => ui.objective(\`Fuses: \${n}/3\`));`)}
<p>Share data between your own scripts with <code>globalThis.MY_THING = ...</code>. Shared scripts run first, then host, then client.</p>
<div class="callout">In shared scripts, use <code>sharedRand()</code> instead of <code>Math.random()</code> so every player builds the same level. It is seeded per room, so each match is different.</div>`],

  ['voice', 'Voice, mic & noise', `
<p>This is what makes Shiver different. Every player has proximity voice chat, and <b>their real microphone volume becomes in-game noise</b>.</p>
${table([
  ['player.noise', '0..1. The loudest of footsteps (sprinting is loud, crouching is quiet), actions such as repairing, and the player\'s live mic volume.'],
  ["on('noise', (p, level))", 'Host event, fired when someone is louder than 0.3. Monsters use it to hunt.'],
  ["prefab.monster({ hearing })", 'Built-in monsters walk toward noises. hearing: 2 means twice as sensitive.'],
  ["game.config({ voice })", "'proximity' (default) fades with distance and goes muffled through walls. 'global' means everyone hears everyone. 'off' disables voice."],
  ['game.config({ voiceRange })', 'How far voices carry (default 22 m).'],
  ["player.setRole('monster', { voice: 'demon' })", "Changes how that player sounds to everyone: 'demon', 'ghost', 'robot' or 'none'."],
  ['Radio items', "A player holding an item named <i>Radio</i> or <i>Walkie</i> can hold R to talk to everyone else with one, at any distance, with a radio filter."],
  ['Ghosts', 'Dead players speak with a ghost voice. The living hear them only as faint whispers up close, while ghosts hear each other clearly.'],
])}
<h3>voice.mix(fn)</h3>
<p>Runs on each player for every other speaker. Return changes to the mix to invent your own voice rules.</p>
${code(`// Only teammates can hear each other
voice.mix((speaker, mix) => {
  if (speaker.team !== players.me.team) return { gain: 0 };
});

// Monsters sound HUGE
voice.mix((speaker, mix) => speaker.role === 'monster' ? { gain: mix.gain * 2, spatial: true } : null);`)}`],

  ['levels', 'Building levels', `
<h3>build.room(opts)</h3>
${code(`build.room({ x: 0, z: 0, w: 10, d: 8, h: 3, wall: 'tiles', floor: 'floortiles',
  doors: [{ side: 'n', at: 2, door: true }, { side: 'e', width: 2 }],  // door:false = open doorway
  open: ['s'],          // skip a wall (when two rooms touch)
  flicker: 0.4, lightColor: 0xff3020 });`)}
<h3>build.layout(rows, opts) — draw your level in text</h3>
${code(`const map = build.layout([
  '##########',
  '#..L..#..#',
  '#.....D..#',
  '###D###..#',
  '#..K.....#',
  '##########',
], {
  cell: 2.5, walls: { '#': 'plaster' }, floor: 'concrete',
  doors: { D: {}, X: { locked: true, key: 'Key' } },
  legend: { K: (pos) => prefab.key({ pos: [pos.x, 0.5, pos.z] }) },
});
map.pos(3, 4);      // world position of a cell
map.random('.');    // random floor cell`)}
<h3>build.maze(opts)</h3>
<p>A seeded maze with thin walls and lights. It returns <code>start</code>, <code>end</code>, <code>deadEnds</code> and <code>cells</code>.</p>
<h3>build.outdoor(opts), build.scatter(model, count, area), build.wall(x1, z1, x2, z2)</h3>
<p>Textures: <code>concrete plaster tiles floortiles wallpaper carpet ceiling wood door metal rust brick dirt grass stone hazard paper blood static</code>.</p>
<p>Models: <code>humanoid stalker crawler grinner doll ghost key fuse battery radio note generator locker bed wheelchair desk chair shelf lamp bulb barrel crate tree gravestone cross fence candle tv toilet pillar</code>.</p>`],

  ['cutscenes', 'Cutscenes & movies', `
<p>Direct the camera, place actors, write dialogue and title cards. Cutscenes run in the middle of a game, and a whole game can be a film. Press <b>● Rec</b> in the Studio or on the play screen to export a <b>.webm</b> video. Subtitles, letterbox bars and sound are recorded too.</p>
${code(`cutscene.define('intro', async (c) => {
  c.camera.at([0, 2, 6], [0, 1.5, 0]);                    // instant shot: position, look-at
  c.title('THE WARD', 'Chapter one', 3);
  await c.camera.moveTo([0, 1.7, 3], { lookAt: [0, 1.4, 0], duration: 4, ease: 'inOut' });

  const nurse = c.actor('humanoid', { pos: [-3, 0, 0], name: 'Nurse' });   // or 'asset:my_pixeter_sprite'
  c.camera.follow(nurse, { offset: [0, 2, 3.5] });
  await nurse.walkTo([0, 0, 0], { speed: 1.2 });
  await nurse.say("You shouldn't be here.");               // types out; Space/click to continue

  const pick = await c.choice('What do you do?', ['Run', 'Hide']);
  await c.camera.orbit({ around: [0, 1, 0], radius: 4, from: 0, to: Math.PI, duration: 5 });
  c.sound('stinger'); c.shake(0.5);
  await c.jumpscare('stalker');
  await c.fade(1, 0.5);
  await c.camera.player({ duration: 1 });                  // glide back to the player's eyes
});

on('begin', () => cutscene.play('intro'));                  // Esc skips (skippable: false to stop that)
// host: play it on every player at once
cutscene.play('intro', { everyone: true });`)}
<p>For a <b>movie</b>, call <code>game.config({ movie: true })</code>. Players then click to watch, with no controls or HUD. Remix <i>The Last Shift</i> for a complete example. <code>movie.record()</code> and <code>movie.stop()</code> let scripts record on their own.</p>
<h3>Sprite editor</h3>
<p>Click <b>✎</b> next to Assets (or <b>🎨 Sprite editor</b>) to draw pixel sprites in the Studio. It has pencil, fill, line, rectangle, ellipse and eyedropper tools, plus mirror drawing, onion skin, frames and named animations. Double-click any asset to edit it. Everything is a real Pixeter document, so <b>⬇ .pixeter</b> lets you keep working at pixeter.app.</p>`],

  ['pixeter', 'Pixeter art', `
<p>Draw characters, monsters, items and textures in <a href="https://pixeter.app" target="_blank">Pixeter</a>. Then drop the <b>.pixeter</b> file onto the Studio, or click <b>+</b> next to Assets. Layers, every animation frame, frame timings and animation tags come along. Sprite sheets (PNG plus Pixeter or Aseprite JSON) and plain images work too.</p>
${code(`// A Pixeter sprite in the world. It always faces the camera and the flashlight lights it.
const cat = world.sprite('cat', { pos: [2, 0, -4], animation: 'idle' });

// Any model name can be 'asset:<name>'. Monsters pick the tag that matches their state
// (chase, investigate, wander), or walk/run/idle based on speed.
prefab.monster({ model: 'asset:creep', ppm: 12 });   // ppm = pixels per metre (default 16)
player.setRole('monster', { model: 'asset:hollow', voice: 'demon' });
player.jumpscare('asset:creep');

// As a texture on walls and floors
world.box({ pos: [0, 1.5, -6], size: [4, 3, 0.2], texture: 'asset:wallpaper' });

// On the HUD
ui.image('face', 'creep', { x: 50, y: 50, size: 500 });
after(0.5, () => ui.remove('face'));`)}
<p>Name your Pixeter animation tags <code>idle</code>, <code>walk</code>, <code>run</code> and <code>chase</code> to make monsters animate automatically.</p>`],

  ['prefabs', 'Prefabs', table([
  ['prefab.door({pos, rotY, locked, key})', 'A hinged door. Methods: toggle(), slam(), burst(), lock(key), unlock().'],
  ['prefab.light({pos, color, flicker, fixture})', "A ceiling light. Fixtures: 'lamp', 'bulb', 'candle', 'none'. Methods: turnOn(), turnOff(), flicker(secs)."],
  ['prefab.item({pos, name, model})', 'Something to pick up into the inventory. Shortcuts: key(), fuse(), radio(), battery().'],
  ['prefab.note({pos, title, text})', 'A readable note.'],
  ['prefab.locker({pos, rotY})', "A hiding spot. Monsters ignore hidden players unless they saw them go in."],
  ['prefab.generator({pos, hold, needs, onRepaired})', 'Hold E to repair (noisy!), or insert an item.'],
  ['prefab.trigger({pos, size, onEnter, once})', 'An invisible zone that fires when players walk in.'],
  ['prefab.exit({pos, size, onEscape})', 'An escape zone. Call exit.activate() to open it.'],
  ['prefab.monster({...})', 'An AI monster. See below.'],
  ['prefab.tv / blood / writing / prop / candle / bulb', 'Decoration.'],
])],

  ['monsters', 'Monsters', `
${code(`const m = prefab.monster({
  pos: [0, 0, -10], model: 'stalker',   // or crawler, grinner, doll, ghost, humanoid
  speed: 1.7, investigateSpeed: 2.8, chaseSpeed: 4.3,
  hearing: 1,          // multiplier on how far it hears noise (and voices!)
  sight: 16, fov: 1.15, // metres, radians
  stunnedByLight: true, // flashlight in its face for 2s stuns it
  opensDoors: true, patrol: [[0,0,0], [10,0,0]],
  onCatch: (player, m) => { player.jumpscare('stalker'); player.kill(); },
});
m.on('spotted', (p) => net.broadcast('panic', { name: p.name }));
m.on('heard', (p) => log(p.name, 'made noise'));
m.hunt(players.random());  m.stun(3);  m.goTo([5, 0, 5]);  m.calm();`)}
<p>States: <code>wander</code> → <code>investigate</code> (heard something) → <code>chase</code> (saw someone). Everyone automatically gets a heartbeat, a flickering flashlight and chase music when a monster is near.</p>
<h3>Write your own AI</h3>
${code(`const thing = world.model('doll', { pos: [0, 0, 0], tags: ['monster'] });
let path = null;
every(0.5, () => {                                  // re-plan twice a second
  const p = players.nearest(thing.pos);
  path = p ? nav.path(thing.pos, p.pos) : null;     // A* over the level
});
thing.behave((dt) => {
  const t = path?.[1];
  if (!t) return;
  const dx = t.x - thing.x, dz = t.z - thing.z, d = Math.hypot(dx, dz);
  if (d < 0.2) return path.shift();
  thing.moveTo(thing.x + (dx / d) * 2 * dt, 0, thing.z + (dz / d) * 2 * dt);
  thing.lookAt(t);
});`)}`],

  ['players', 'Players', `<p>The <code>players</code> list gives you <code>all()</code>, <code>alive()</code>, <code>dead()</code>, <code>me</code>, <code>host</code>, <code>nearest(pos)</code> and <code>random()</code>. Each player has:</p>
${table([
  ['id name pos yaw alive role team noise crouching flashlight hidden speaking inventory data score', 'Read anywhere.'],
  ['give(item) take(item) has(item) kill() revive() setRole(role, {model, speed, voice, vision}) setData(k, v) addScore(n) setSpeed(m)', 'Change state (host scripts).'],
  ['toast() subtitle() objective() note() jumpscare(model) shake() fade() flash() sound() teleport() freeze() send(name, data)', 'Send something to that one player.'],
])}
<p>The local player is <code>me</code>: <code>me.pos</code>, <code>me.forward</code>, <code>me.flashlight</code>, <code>me.battery</code>, <code>me.stamina</code>, <code>me.makeNoise(0.5)</code>, <code>me.teleport()</code>, <code>me.lookAt()</code>.</p>`],

  ['ui', 'UI, audio & effects', table([
  ['ui.objective(text)', 'Top-left objective.'],
  ['ui.toast(text, secs, color) / ui.subtitle(text, secs, who)', 'Messages.'],
  ['ui.text(id, text, {x, y, size, color}) / ui.progress(id, 0..1) / ui.remove(id)', 'Your own HUD (x/y in % of screen).'],
  ['ui.element("div")', 'A real DOM element for anything else.'],
  ["audio.play(name, {pos, volume, pitch, everyone})", 'Synthesized one-shots: step thud door slam locked pickup click screech jumpscare whisper heartbeat stinger static bell glitch drip knock scream beep giggle radio hit success fail swoosh thunder creak.'],
  ["audio.loop(name, {pos, volume})", 'Ambience: drone wind hum generator rain static heartbeat whispers clock.'],
  ["audio.music('chase' | 'tension' | 'calm' | null)", 'Procedural score.'],
  ['fx.shake / flash / fade / glitch / damage / thermal / jumpscare', 'Screen effects. fx.everyone({...}) from the host hits all players.'],
])],

  ['look', 'Styles & camera', `
${table([
  ["render.style('retro')", 'PS1: 240p, dithering, wobbly vertices.'],
  ["render.style('vhs')", 'Tape tracking, chromatic aberration, scanlines, timestamp.'],
  ["render.style('hd')", 'Full resolution, shadows, filmic tone mapping.'],
  ["render.style('noir')", 'Black-and-white film grain.'],
  ["render.style('pixel')", 'Chunky 180p pixel art. Looks great with the top-down camera.'],
  ["render.set({ grain: 0.2, chroma: 2 })", 'Tweak any part of the look.'],
  ["camera.mode('first' | 'third' | 'topdown')", 'Or game.config({ camera: "topdown" }).'],
])}`],

  ['events', 'Events', table([
  ["on('update', dt)", 'Every frame.'],
  ["on('start') / on('begin') / on('end', result)", 'Round started / player clicked in / game ended.'],
  ["on('playerJoin' | 'playerLeave' | 'playerDeath', p)", 'People.'],
  ["on('interact', p, entity) / on('pickup', p, item) / on('escape', p)", 'Actions (host).'],
  ["on('noise', p, level)", 'Someone was loud (host).'],
  ["on('catch' | 'spotted' | 'heard', monster, p)", 'Monster events (host).'],
  ["on('haunt', ghost, light)", 'A ghost flickered a light (host).'],
  ["on('keydown', code) / on('mousedown', button)", 'Input (client). Also input.key("KeyQ").'],
  ["on('chat', p, text)", 'Text chat.'],
])],

  ['three', 'Raw three.js', `<p>Everything is a three.js scene underneath. <code>THREE</code>, <code>world.scene</code>, <code>camera.object</code>, <code>render.renderer</code> and <code>entity.obj</code> are all available, so you can write shaders, particles or anything else. Objects you add directly are local to each player.</p>
${code(`const geo = new THREE.TorusKnotGeometry(0.5, 0.15, 64, 8);
const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x880000, emissive: 0x330000 }));
mesh.position.set(0, 1.5, -3);
world.add(mesh);
on('update', (dt) => (mesh.rotation.y += dt));`)}
<div class="callout">Games run in a locked-down sandbox. They have no network access, no access to your account and no microphone. The platform passes only the mic <i>volume</i> in. Players are safe to try anything.</div>`],
];

export function docsPage(root) {
  const page = el(`<div class="wrap"><div class="docs">
    <nav>${SECTIONS.map(([id, t]) => `<a href="#${id}">${t}</a>`).join('')}</nav>
    <article><h1>Make horror with code</h1><p class="tagline">Everything you need to build a multiplayer horror game on Shiver.</p>
    ${SECTIONS.map(([id, t, body]) => `<h2 id="${id}">${t}</h2>${body}`).join('')}</article>
  </div></div>`);
  page.querySelectorAll('nav a').forEach((a) => (a.onclick = (e) => { e.preventDefault(); page.querySelector(a.getAttribute('href')).scrollIntoView({ behavior: 'smooth' }); }));
  root.appendChild(page);
}
