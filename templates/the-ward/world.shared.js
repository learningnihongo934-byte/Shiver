// THE WARD — level geometry, decoration and lore notes. Runs on every player.
world.fog(0x050303, 0.1);
world.ambient(0.05, 0x806060, 0x100808);

// 2.5m cells. # wall, . floor, D door, X elevator door, L ceiling light, E elevator
const MAP = [
  '###########################',
  '#......#.......#..........#',
  '#..L...#...L...D....L.....#',
  '#......#.......#..........#',
  '#......#.......#..........#',
  '####D######D#######D#######',
  '#.L......L......L......L..#',
  '####D######D#######D###X###',
  '#......#.......#......#...#',
  '#..L...D...L...#...L..#.E.#',
  '#......#.......#......#...#',
  '#......#.......#......#...#',
  '###########################',
];
const map = build.layout(MAP, {
  cell: 2.5, height: 3, x: -33.75, z: -16.25,
  walls: { '#': 'tiles' }, floor: 'floortiles', ceiling: 'ceiling',
  doors: {
    D: {},
    X: { locked: true, key: 'Elevator power', tags: ['elevator'], lockedText: 'The elevator has no power.', texture: 'metal', color: 0x9aa4a8 },
  },
  lightColor: 0xff2a18, lightIntensity: 0.9, flicker: 0.25, lightRange: 7,
});

const P = (c, r, dx = 0, dz = 0) => [map.pos(c, r).x + dx, 0, map.pos(c, r).z + dz];

// spawn in the west end of the corridor, facing east
for (let i = 0; i < 6; i++) world.spawnPoint(-31.5 + (i % 3) * 1.1, 0.1, map.pos(1, 6).z + (i < 3 ? -0.6 : 0.6), -Math.PI / 2);

// ward beds and junk
for (const [c, r] of [[2, 1], [5, 1], [9, 1], [13, 1], [17, 1], [21, 1], [24, 1]]) prefab.prop('bed', { pos: P(c, r, 0, 0.2) });
for (const [c, r] of [[2, 11], [5, 11], [9, 11], [12, 11], [18, 11]]) prefab.prop('bed', { pos: P(c, r, 0, -0.2), rotY: Math.PI });
prefab.prop('wheelchair', { pos: P(6, 3), rotY: 2.2 });
prefab.prop('wheelchair', { pos: P(20, 10), rotY: -0.7 });
prefab.prop('shelf', { pos: P(14, 4, 0, 0.6), rotY: Math.PI });
prefab.prop('desk', { pos: P(21, 4, 0, 0.4), rotY: Math.PI });
prefab.prop('chair', { pos: P(21, 3, 0, 0.4) });
prefab.prop('toilet', { pos: P(16, 11, 0, 0.3), rotY: Math.PI });
prefab.prop('barrel', { pos: P(25, 6, 0, 0.5) });
prefab.tv({ pos: P(1, 9, -0.4), rotY: Math.PI / 2 });

// places to hide
prefab.locker({ pos: P(1, 1, -0.5, -0.4), rotY: Math.PI / 2 });
prefab.locker({ pos: P(14, 1, 0.6, -0.4), rotY: -Math.PI / 2 });
prefab.locker({ pos: P(25, 4, 0.6, 0.4), rotY: -Math.PI / 2 });
prefab.locker({ pos: P(8, 11, -0.5, 0.4), rotY: Math.PI / 2 });
prefab.locker({ pos: P(21, 8, 0.5, -0.5), rotY: -Math.PI / 2 });

// decals
for (const [c, r] of [[3, 2], [10, 6], [18, 6], [12, 9], [23, 6], [4, 10]]) prefab.blood({ pos: [map.pos(c, r).x + sharedRand.range(-0.8, 0.8), 0.02, map.pos(c, r).z + sharedRand.range(-0.8, 0.8)] });
prefab.writing('SHE HEARS\nYOU', { pos: [map.pos(12, 6).x, 1.7, map.pos(12, 6).z - 1.12], size: 0.35 });
prefab.writing("DON'T\nTALK", { pos: [map.pos(20, 1).x, 1.6, map.pos(20, 1).z - 1.1], size: 0.4 });

// lore
prefab.note({ pos: P(3, 3, 0.4), title: 'Night shift log — Ward 4', text: '02:40  Patient in bed 117 asked me to stop talking. Said the "lady in the hall" doesn\'t like voices.\n03:05  Something walking on the ceiling tiles. Maintenance says no.\n03:11  I can hear her breathing outside the door. I am going to stay very, very quiet.' });
prefab.note({ pos: P(10, 9), title: 'Maintenance', text: 'Main fuses pulled for the rewire. Spares were left in the wards.\nPut them in the FUSE BOX in the hallway and the elevator will come back up.' });
prefab.note({ pos: P(22, 2), title: '(torn page)', text: 'it cant see well in the dark\nbut it hears EVERYTHING\nif it sees you RUN. if you hear the heartbeat HIDE\nlockers work. dont breathe' });
