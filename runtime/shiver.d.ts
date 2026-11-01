// Type hints for the Shiver scripting API (powers autocomplete in the Studio editor).
type Vec = { x: number; y: number; z: number };
type VecLike = Vec | [number, number, number];

interface Entity {
  readonly id: string;
  readonly kind: string;
  /** Current properties (pos, rot, size, color, texture, prompt, ...). Change them with set(). */
  readonly props: Record<string, any>;
  /** Free storage for your own data. Not synced. */
  data: Record<string, any>;
  x: number; y: number; z: number;
  pos: Vec;
  /** Rotation around the vertical axis, in radians. */
  rotY: number;
  visible: boolean;
  readonly alive: boolean;
  /** Raw three.js object (local only). */
  readonly obj: any;
  set(props: Record<string, any>): Entity;
  moveTo(x: number, y: number, z: number): Entity;
  lookAt(x: number | Vec, z?: number): Entity;
  distanceTo(other: Vec | Entity | Player): number;
  tag(...tags: string[]): Entity;
  hasTag(tag: string): boolean;
  /** 'interact' (player), 'enter'/'exit' for zones, 'removed', or your own events. */
  on(event: string, fn: (...args: any[]) => void): Entity;
  emit(event: string, ...args: any[]): void;
  /** Run fn(dt) every frame (on the host for synced entities). */
  behave(fn: (dt: number, self: Entity) => void): Entity;
  remove(): void;
}

interface Door extends Entity { toggle(open?: boolean): void; slam(): void; burst(): void; lock(key?: string): void; unlock(): void; }
interface Light extends Entity { turnOn(): void; turnOff(): void; toggle(): void; flicker(seconds?: number): void; }
interface Monster extends Entity {
  ai: { state: 'wander' | 'investigate' | 'chase'; target: Player | null };
  config: Record<string, any>;
  goTo(pos: VecLike): void; hunt(player: Player): void; stun(seconds?: number): void; calm(): void; setSpeed(walk?: number, chase?: number): void;
}
interface Generator extends Entity { running: boolean; start(player?: Player): void; }
interface Exit extends Entity { active: boolean; escaped: Set<string>; activate(): void; }

interface Player {
  readonly id: string; readonly name: string; readonly isMe: boolean; readonly isHost: boolean;
  readonly pos: Vec; readonly yaw: number; readonly alive: boolean; readonly role: string; readonly team: string | null;
  /** 0..1: footsteps + real microphone volume. Monsters use this. */
  readonly noise: number;
  readonly crouching: boolean; readonly flashlight: boolean; readonly hidden: boolean; readonly speaking: number;
  readonly inventory: string[]; readonly data: Record<string, any>; readonly score: number; readonly connected: boolean;
  distanceTo(other: Vec | Player | Entity): number;
  has(item: string): boolean; count(item: string): number;
  // host only ↓
  give(item: string): Player; take(item: string): boolean;
  kill(reason?: string): Player; revive(): Player;
  setRole(role: string, opts?: { model?: string; speed?: number; voice?: 'none' | 'demon' | 'ghost' | 'robot'; vision?: 'thermal' | null; team?: string }): Player;
  set(patch: Record<string, any>): Player; setData(key: string, value: any): Player; addScore(n?: number): Player; setSpeed(mult: number): Player;
  // works from any script, delivered to that player ↓
  teleport(x: number | Vec, y?: number, z?: number, yaw?: number): Player;
  toast(text: string, seconds?: number, color?: string): Player;
  subtitle(text: string, seconds?: number, speaker?: string): Player;
  objective(text: string): Player;
  note(title: string, text: string): Player;
  jumpscare(model?: string, opts?: { sound?: string; duration?: number; color?: number }): Player;
  shake(amount?: number): Player; fade(to?: number, seconds?: number): Player; flash(color?: number, amount?: number): Player;
  sound(name: string, opts?: object): Player; freeze(on?: boolean): Player; rechargeFlashlight(amount?: number): Player;
  send(name: string, data?: any): Player; unhide(): Player;
}

declare const game: {
  readonly id: string; readonly title: string; readonly seed: number; readonly isHost: boolean; readonly time: number;
  readonly code: string | null; readonly mode: 'online' | 'solo'; readonly round: number; readonly draft: boolean; readonly ended: boolean;
  readonly script: string; readonly kind: 'shared' | 'host' | 'client';
  config(opts: Partial<{
    walkSpeed: number; sprintSpeed: number; crouchSpeed: number; jump: boolean; jumpSpeed: number; gravity: number; sprint: boolean; stamina: boolean; staminaSeconds: number;
    flashlight: boolean; flashlightPower: number; battery: boolean; batterySeconds: number; ghosts: boolean; ghostsVisible: boolean; ghostChat: boolean;
    voice: 'proximity' | 'global' | 'off'; voiceRange: number; nameTags: boolean; nameTagRange: number; micSensitivity: number;
    camera: 'first' | 'third' | 'topdown'; topdownHeight: number; fov: number; monsterFx: boolean; killY: number; speed: number;
  }>): Record<string, any>;
  end(opts: { title?: string; text?: string; win?: boolean }): void;
  endFor(player: Player, opts: { title?: string; text?: string; win?: boolean }): void;
  restart(): void;
  on: typeof on;
  state: { get(key: string): any; set(key: string, value: any): void; watch(key: string, fn: (value: any) => void): void; all(): Record<string, any> };
};

type SpawnOpts = { pos?: VecLike; rot?: VecLike; scale?: number | [number, number, number]; color?: number; texture?: string; texScale?: number; emissive?: number; opacity?: number; unlit?: boolean; solid?: boolean; visible?: boolean; prompt?: string; hold?: number; range?: number; tags?: string[]; local?: boolean; [k: string]: any };

declare const world: {
  box(o: SpawnOpts & { size?: [number, number, number] }): Entity;
  plane(o: SpawnOpts & { size?: [number, number]; vertical?: boolean }): Entity;
  cylinder(o: SpawnOpts & { radius?: number; height?: number }): Entity;
  sphere(o: SpawnOpts & { radius?: number }): Entity;
  model(name: 'humanoid' | 'stalker' | 'crawler' | 'grinner' | 'doll' | 'ghost' | 'key' | 'fuse' | 'battery' | 'radio' | 'note' | 'generator' | 'locker' | 'bed' | 'wheelchair' | 'desk' | 'chair' | 'shelf' | 'lamp' | 'bulb' | 'barrel' | 'crate' | 'tree' | 'gravestone' | 'cross' | 'fence' | 'candle' | 'tv' | 'toilet' | 'pillar' | string, o?: SpawnOpts): Entity;
  light(o?: SpawnOpts & { intensity?: number; range?: number; flicker?: number; fixture?: 'lamp' | 'bulb' | 'candle' | 'none'; on?: boolean }): Light;
  /** Pixeter art / an imported image as a camera-facing sprite. animation = a Pixeter tag name; ppm = pixels per metre (default 16). Use model: 'asset:name' anywhere a model name goes (monsters, player roles, jumpscares). */
  sprite(asset: string, o?: SpawnOpts & { animation?: string; ppm?: number }): Entity;
  /** Names of the art imported in the Studio's Assets panel. */
  readonly assets: string[];
  asset(name: string): { name: string; w: number; h: number; frames: number; tags: string[] } | null;
  text(text: string, o?: SpawnOpts & { billboard?: boolean; textColor?: string; fontSize?: number; font?: string }): Entity;
  zone(o?: SpawnOpts & { size?: [number, number, number] }): Entity;
  sound(name: string, o?: SpawnOpts & { volume?: number; range?: number; playing?: boolean }): Entity;
  door(o?: SpawnOpts & { width?: number; height?: number; open?: boolean }): Door;
  spawn(kind: string, o?: SpawnOpts): Entity;
  get(id: string): Entity | null;
  find(tag: string): Entity[];
  findOne(tag: string): Entity | null;
  all(): Entity[];
  remove(e: Entity): void;
  spawnPoint(x: number | { x: number; y?: number; z: number; yaw?: number }, y?: number, z?: number, yaw?: number): void;
  clearSpawnPoints(): void;
  raycast(from: VecLike, dir: VecLike, max?: number): { distance: number; point: Vec; entity: Entity } | null;
  lineOfSight(a: VecLike, b: VecLike): boolean;
  fog(color?: number, density?: number): void;
  ambient(intensity?: number, sky?: number, ground?: number): void;
  sky(color: number): void;
  /** Directional moonlight for outdoor levels. */
  moon(intensity?: number, color?: number): void;
  add(object3d: any): any;
  readonly scene: any;
  readonly models: string[];
  readonly textures: string[];
};

declare const build: {
  floor(o?: { x?: number; z?: number; w?: number; d?: number; y?: number; texture?: string; color?: number }): Entity;
  ceiling(o?: { x?: number; z?: number; w?: number; d?: number; y?: number; texture?: string; color?: number }): Entity;
  wall(x1: number, z1: number, x2: number, z2: number, o?: { height?: number; thickness?: number; y?: number; texture?: string; color?: number }): Entity;
  room(o: { x?: number; z?: number; w?: number; d?: number; h?: number; y?: number; wall?: string; floor?: string | false; ceiling?: string | false; wallColor?: number; doors?: { side: 'n' | 's' | 'e' | 'w'; at?: number; width?: number; height?: number; door?: boolean | object }[]; open?: ('n' | 's' | 'e' | 'w')[]; light?: boolean; lightColor?: number; lightIntensity?: number; lightRange?: number; flicker?: number; fixture?: string }): { x: number; z: number; w: number; d: number; doors: Door[]; walls: Entity[]; light?: Light; center: Vec; randomPoint(margin?: number): Vec };
  layout(rows: string[], o?: { cell?: number; height?: number; x?: number; z?: number; walls?: Record<string, string>; floor?: string | false; ceiling?: string | false; doors?: Record<string, object>; legend?: Record<string, (pos: Vec, cell: { c: number; r: number }) => void>; lightColor?: number; lightIntensity?: number; lightRange?: number; flicker?: number }): { pos(c: number, r: number): Vec; find(ch: string): Vec[]; random(ch?: string): Vec; doors: Door[]; lights: Light[] };
  maze(o?: { cols?: number; rows?: number; cell?: number; height?: number; x?: number; z?: number; wall?: string; floor?: string; ceiling?: string; loops?: number; lights?: boolean; lightEvery?: number; lightColor?: number; lightIntensity?: number; flickerChance?: number; deadChance?: number }): { cells: (Vec & { c: number; r: number })[]; deadEnds: (Vec & { c: number; r: number })[]; start: Vec; end: Vec; center(c: number, r: number): Vec; openYaw(c: number, r: number): number; random(): Vec; lights: Light[] };
  outdoor(o?: { size?: number; ground?: string; trees?: number; fence?: boolean; clear?: number }): { ground: Entity; trees: Entity[]; size: number };
  scatter(model: string, count: number, area?: { x?: number; z?: number; w?: number; d?: number; y?: number }, o?: { solid?: boolean; scale?: number; color?: number }): Entity[];
};

declare const prefab: {
  light(o?: SpawnOpts & { intensity?: number; range?: number; flicker?: number; fixture?: string; on?: boolean }): Light;
  candle(o?: SpawnOpts): Light;
  bulb(o?: SpawnOpts): Light;
  door(o?: { pos?: VecLike; rotY?: number; width?: number; height?: number; texture?: string; color?: number; open?: boolean; locked?: boolean; key?: string; consumeKey?: boolean; lockedText?: string; tags?: string[] }): Door;
  item(o?: { pos?: VecLike; name?: string; model?: string; prompt?: string; pickupText?: string; glow?: boolean; glowColor?: number; inventory?: boolean; onPickup?: (p: Player, e: Entity) => void | false }): Entity;
  key(o?: { pos?: VecLike; name?: string }): Entity;
  fuse(o?: { pos?: VecLike; name?: string }): Entity;
  radio(o?: { pos?: VecLike }): Entity;
  battery(o?: { pos?: VecLike; amount?: number }): Entity;
  note(o?: { pos?: VecLike; title?: string; text?: string; rotY?: number }): Entity;
  prop(model: string, o?: { pos?: VecLike; rotY?: number; scale?: number; color?: number; solid?: boolean }): Entity;
  locker(o?: { pos?: VecLike; rotY?: number; color?: number }): Entity;
  tv(o?: { pos?: VecLike; rotY?: number }): Entity;
  blood(o?: { pos?: VecLike; size?: number }): Entity;
  writing(text: string, o?: { pos?: VecLike; rotY?: number; color?: string; size?: number; font?: string }): Entity;
  trigger(o?: { pos?: VecLike; size?: [number, number, number]; once?: boolean; oncePerPlayer?: boolean; onEnter?: (p: Player, z: Entity) => void; onExit?: (p: Player, z: Entity) => void }): Entity;
  exit(o?: { pos?: VecLike; size?: [number, number, number]; active?: boolean; onEscape?: (p: Player, z: Exit) => void }): Exit;
  generator(o?: { pos?: VecLike; rotY?: number; hold?: number; noise?: number; needs?: string; prompt?: string; onRepaired?: (p: Player, g: Generator) => void }): Generator;
  monster(o?: { pos?: VecLike; model?: string; speed?: number; investigateSpeed?: number; chaseSpeed?: number; hearing?: number; sight?: number; fov?: number; catchRange?: number; giveUp?: number; killOnCatch?: boolean; jumpscare?: boolean; opensDoors?: boolean; screech?: boolean; ignoreHidden?: boolean; stunnedByLight?: boolean; lightTime?: number; stunTime?: number; steps?: string | null; patrol?: VecLike[]; scale?: number; color?: number; onCatch?: (p: Player, m: Monster) => void }): Monster;
};

declare const players: {
  all(): Player[]; list(): Player[]; alive(): Player[]; dead(): Player[];
  get(id: string): Player | null;
  readonly me: Player; readonly host: Player; readonly count: number;
  nearest(pos: VecLike | Vec, filter?: (p: Player) => boolean): Player | null;
  random(filter?: (p: Player) => boolean): Player | null;
  on: typeof on;
};

declare const me: {
  readonly player: Player; readonly pos: Vec; readonly yaw: number; readonly pitch: number; readonly forward: Vec; readonly noise: number;
  flashlight: boolean; battery: number; stamina: number; readonly alive: boolean; readonly hidden: boolean;
  makeNoise(amount: number): void; teleport(x: number | Vec, y?: number, z?: number, yaw?: number): void;
  lookAt(x?: number | Vec | null, y?: number, z?: number): void; freeze(on?: boolean): void; hide(locker: Entity): void; unhide(): void;
};

declare const input: { key(code: string): boolean; pressed(code: string): boolean; readonly mouse: { x: number; y: number; down: boolean }; mouseButton(b?: number): boolean; on: typeof on };
declare const ui: {
  objective(text: string): void; toast(text: string, seconds?: number, color?: string): void; subtitle(text: string, seconds?: number, speaker?: string): void;
  note(title: string, text: string): void; text(id: string, text: string, o?: { x?: number; y?: number; size?: number; color?: string; align?: 'left' | 'center' | 'right'; font?: string }): HTMLElement;
  progress(id: string, value: number, o?: { x?: number; y?: number; label?: string; color?: string }): void; remove(id: string): void;
  element(tag?: string): HTMLElement;
  /** Show imported art on the HUD (size = height in px). */
  image(id: string, asset: string, o?: { x?: number; y?: number; size?: number; frame?: number; opacity?: number }): HTMLElement | null;
  hideHud(hidden?: boolean): void; chat(name: string, text: string, color?: string): void;
};
type SoundName = 'step' | 'thud' | 'door' | 'slam' | 'locked' | 'pickup' | 'click' | 'screech' | 'jumpscare' | 'whisper' | 'heartbeat' | 'stinger' | 'static' | 'bell' | 'glitch' | 'drip' | 'knock' | 'scream' | 'beep' | 'giggle' | 'radio' | 'hit' | 'success' | 'fail' | 'swoosh' | 'thunder' | 'creak';
declare const audio: {
  play(name: SoundName, o?: { pos?: VecLike | Vec; volume?: number; pitch?: number; range?: number; everyone?: boolean }): { stop(): void } | null;
  loop(name: 'drone' | 'wind' | 'hum' | 'generator' | 'rain' | 'static' | 'heartbeat' | 'whispers' | 'clock', o?: { pos?: VecLike | Vec; volume?: number; range?: number }): { stop(): void; setPos(v: Vec): void; setVolume(v: number): void };
  music(name: 'chase' | 'tension' | 'calm' | null, volume?: number, o?: { everyone?: boolean }): void;
  volume(v: number): void; readonly context: AudioContext; readonly output: AudioNode; readonly names: { oneShots: string[]; loops: string[]; music: string[] };
};
declare const fx: { shake(a?: number): void; flash(color?: number, amount?: number): void; fade(to?: number, seconds?: number): void; glitch(a?: number): void; damage(a?: number): void; thermal(a?: number): void; jumpscare(model?: string, o?: object): void; everyone(o: { sound?: string; pos?: [number, number, number]; volume?: number; music?: string | null; flash?: number; amount?: number; shake?: number; glitch?: number }): void };
declare const camera: { mode(m: 'first' | 'third' | 'topdown'): void; readonly current: string; fov(f: number): void; readonly object: any };
declare const render: { style(name: 'retro' | 'vhs' | 'hd' | 'noir' | 'pixel', overrides?: object): void; readonly current: string; set(o: Partial<{ height: number; levels: number; dither: number; grain: number; chroma: number; scan: number; vignette: number; mono: number; contrast: number; tracking: number; snap: number; shadows: boolean; fog: number; exposure: number }>): void; readonly styles: string[]; readonly renderer: any };
declare const net: { send(name: string, data?: any): void; broadcast(name: string, data?: any): void; to(player: Player | string, name: string, data?: any): void; on(name: string, fn: (data: any, from: Player | null) => void): () => void };
declare const voice: { mix(fn: (speaker: Player, mix: { pos: number[]; gain: number; lowpass: number; radio: boolean; spatial: boolean }) => object | void): void; setEffect(player: Player, effect: 'none' | 'demon' | 'ghost' | 'robot'): void; mode(m: 'proximity' | 'global' | 'off'): void; readonly micLevel: number; readonly muted: boolean };
declare const nav: { path(from: VecLike | Vec, to: VecLike | Vec): Vec[] | null; randomPoint(near?: VecLike | Vec): Vec; walkable(x: number, z: number): boolean; rebuild(): void };
declare const vec: { dist(a: Vec, b: Vec): number; dist2d(a: Vec, b: Vec): number; lerp(a: number, b: number, t: number): number; clamp(v: number, lo: number, hi: number): number; v3(x?: number, y?: number, z?: number): any };
declare const rand: { (): number; range(a: number, b: number): number; int(a: number, b: number): number; pick<T>(arr: T[]): T; chance(p: number): boolean; shuffle<T>(arr: T[]): T[]; seed(n: number): void };
/** Same sequence on every player (use it in shared scripts). */
declare const sharedRand: typeof rand;
interface CutsceneActor {
  entity: Entity; readonly pos: Vec;
  moveTo(p: VecLike): CutsceneActor;
  face(target: VecLike | Entity, seconds?: number): Promise<void>;
  walkTo(p: VecLike, o?: { speed?: number }): Promise<void>;
  animate(tag: string): CutsceneActor;
  say(text: string, seconds?: number): Promise<void>;
  remove(): void;
}
interface Director {
  camera: {
    at(pos: VecLike, lookAt?: VecLike): any;
    moveTo(pos: VecLike, o?: { lookAt?: VecLike; duration?: number; ease?: 'linear' | 'in' | 'out' | 'inOut' }): Promise<void>;
    lookAt(target: VecLike, o?: { duration?: number; ease?: string }): Promise<void>;
    orbit(o?: { around?: VecLike; radius?: number; height?: number; from?: number; to?: number; duration?: number; ease?: string }): Promise<void>;
    follow(target: Entity | CutsceneActor | Player, o?: { offset?: VecLike; lookOffset?: VecLike }): any;
    fov(f: number, o?: { duration?: number; ease?: string }): Promise<any>;
    roll(radians: number, o?: { duration?: number; ease?: string }): Promise<any>;
    shake(amount?: number): void;
    /** Give the camera back to the player (optionally gliding back over `duration`). */
    player(o?: { duration?: number; ease?: string }): Promise<void>;
  };
  /** Spawn an actor for this cutscene (a model name, 'asset:name' for Pixeter art, or an existing entity). Removed when the cutscene ends unless keep:true. */
  actor(model: string | Entity, o?: { pos?: VecLike; rotY?: number; scale?: number; color?: number; animation?: string; ppm?: number; name?: string; keep?: boolean }): CutsceneActor;
  /** Subtitle with a speaker; types out, then waits (Space/click advances). */
  say(speaker: string | null, text?: string, seconds?: number): Promise<void>;
  wait(seconds: number): Promise<void>;
  title(text: string, sub?: string, seconds?: number): Promise<void>;
  bars(on?: boolean): void;
  fade(to?: number, seconds?: number): Promise<void>;
  flash(color?: number, amount?: number): void; shake(amount?: number): void; glitch(amount?: number): void;
  sound(name: SoundName, o?: { pos?: VecLike; volume?: number; pitch?: number }): any;
  music(name: 'chase' | 'tension' | 'calm' | null, volume?: number): void;
  jumpscare(model?: string, o?: object): Promise<void>;
  /** Ask the player to pick; resolves to the chosen index. */
  choice(question: string, options: string[]): Promise<number>;
  readonly time: number; readonly skipped: boolean;
}
declare const cutscene: {
  define(name: string, fn: (c: Director) => Promise<void> | void, opts?: { skippable?: boolean; bars?: boolean; hideHud?: boolean; freeze?: boolean }): void;
  /** Play for this player. Host scripts can pass { everyone: true } or { player } to play it on other machines. */
  play(nameOrFn: string | ((c: Director) => Promise<void> | void), opts?: { everyone?: boolean; player?: Player; skippable?: boolean; bars?: boolean }): Promise<void>;
  skip(): void;
  readonly playing: string | null;
  on: typeof on;
};
/** Record the game view, cutscene overlay and sound to a .webm video (downloads when stopped). */
declare const movie: { record(o?: { fps?: number; height?: number; name?: string }): void; stop(): void; readonly recording: boolean };
declare const THREE: any;
declare const isHost: boolean;
declare function log(...args: any[]): void;
declare function wait(seconds: number): Promise<void>;
declare function after(seconds: number, fn: () => void): () => void;
declare function every(seconds: number, fn: () => void): () => void;
/** Events: update(dt), start, begin, end, playerJoin, playerLeave, playerDeath(p, reason), noise(p, level), interact(p, entity), pickup(p, item, entity), catch(monster, p), spotted(monster, p), heard(monster, p), haunt(ghost, entity), attack(p), escape(p), repaired(p, gen), read(p, note), chat(p, text), keydown(code), keyup(code), mousedown(button), mouseup(button), step(loudness) */
declare function on(event: string, fn: (...args: any[]) => void): () => void;
