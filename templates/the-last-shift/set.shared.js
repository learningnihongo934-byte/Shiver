// THE LAST SHIFT — the set. A security office and the hallway outside.
world.fog(0x050505, 0.06);
world.ambient(0.22);

build.room({ x: 0, z: 0, w: 9, d: 7, h: 3, wall: 'plaster', floor: 'wood', doors: [{ side: 'w', at: -1, width: 1.4 }], flicker: 0.15, lightColor: 0xfff0d8 });
build.room({ x: -8.5, z: 0, w: 8, d: 4, h: 3, wall: 'concrete', floor: 'tiles', open: ['e'], flicker: 0.6, lightIntensity: 0.8 });

prefab.prop('desk', { pos: [2.6, 0, -2.6] });
prefab.prop('chair', { pos: [2.6, 0, -1.8], rotY: Math.PI });
prefab.tv({ pos: [2.2, 0.78, -2.7] });
prefab.prop('shelf', { pos: [-3.9, 0, 2.6], rotY: Math.PI });
prefab.prop('locker', { pos: [4.1, 0, 1.6], rotY: -Math.PI / 2 });
prefab.blood({ pos: [-7, 0.02, 0.6] });

world.spawnPoint(0, 0.1, 2.5);
