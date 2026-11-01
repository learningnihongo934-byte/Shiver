// Level-building helpers: floors, walls, rooms, ASCII layouts, mazes and outdoor areas.
// Use them from shared scripts so every player builds the same level (no network traffic needed).
export function builders(ctx) {
  const { spawn, sharedRand } = ctx;
  const prefab = () => ctx.prefab;
  const T = 0.2; // wall thickness

  const B = {};

  B.floor = (o = {}) => {
    const { x = 0, z = 0, w = 10, d = 10, y = 0, thickness = 0.2 } = o;
    return spawn('box', { pos: [x, y - thickness / 2, z], size: [w, thickness, d], texture: o.texture ?? 'concrete', color: o.color, texScale: o.texScale ?? 2, tags: ['floor'] });
  };

  B.ceiling = (o = {}) => {
    const { x = 0, z = 0, w = 10, d = 10, y = 3, thickness = 0.2 } = o;
    return spawn('box', { pos: [x, y + thickness / 2, z], size: [w, thickness, d], texture: o.texture ?? 'ceiling', color: o.color, texScale: o.texScale ?? 2, tags: ['ceiling'] });
  };

  // Axis-aligned wall from (x1,z1) to (x2,z2).
  B.wall = (x1, z1, x2, z2, o = {}) => {
    const h = o.height ?? 3, y = o.y ?? 0, t = o.thickness ?? T;
    const alongX = Math.abs(x2 - x1) >= Math.abs(z2 - z1);
    const len = alongX ? Math.abs(x2 - x1) : Math.abs(z2 - z1);
    const size = alongX ? [len + t, h, t] : [t, h, len + t];
    return spawn('box', { pos: [(x1 + x2) / 2, y + h / 2, (z1 + z2) / 2], size, texture: o.texture ?? 'plaster', color: o.color, texScale: o.texScale ?? 2, tags: ['wall'] });
  };

  // A box-shaped room with optional doorways (and doors) on any side.
  // doors: [{ side: 'n'|'s'|'e'|'w', at: 0 (offset from middle), width: 1.3, door: true | {locked, key} }]
  B.room = (o = {}) => {
    const { x = 0, z = 0, w = 8, d = 8, h = 3, y = 0 } = o;
    const out = { x, z, w, d, h, y, doors: [], walls: [], center: { x, y, z } };
    if (o.floor !== false) out.floor = B.floor({ x, z, w: w + T, d: d + T, y, texture: o.floor ?? 'tiles', color: o.floorColor });
    if (o.ceiling !== false) out.ceiling = B.ceiling({ x, z, w: w + T, d: d + T, y: y + h, texture: o.ceiling ?? 'ceiling', color: o.ceilingColor });
    const sides = { n: [x - w / 2, z - d / 2, x + w / 2, z - d / 2], s: [x - w / 2, z + d / 2, x + w / 2, z + d / 2], w: [x - w / 2, z - d / 2, x - w / 2, z + d / 2], e: [x + w / 2, z - d / 2, x + w / 2, z + d / 2] };
    const skip = new Set(o.open || []);
    for (const [side, [x1, z1, x2, z2]] of Object.entries(sides)) {
      if (skip.has(side)) continue;
      const alongX = side === 'n' || side === 's';
      const gaps = (o.doors || []).filter((g) => g.side === side).map((g) => ({ ...g, width: g.width ?? 1.3, height: g.height ?? 2.3 })).sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
      const mid = alongX ? x : z;
      let cur = alongX ? x1 : z1;
      const end = alongX ? x2 : z2;
      const seg = (a, b) => {
        if (b - a < 0.05) return;
        out.walls.push(alongX ? B.wall(a, z1, b, z1, { height: h, y, texture: o.wall, color: o.wallColor }) : B.wall(x1, a, x1, b, { height: h, y, texture: o.wall, color: o.wallColor }));
      };
      for (const g of gaps) {
        const c = mid + (g.at ?? 0), a = c - g.width / 2, b = c + g.width / 2;
        seg(cur, a);
        cur = b;
        // lintel above the doorway
        const lh = h - g.height;
        if (lh > 0.02) spawn('box', { pos: alongX ? [c, y + g.height + lh / 2, z1] : [x1, y + g.height + lh / 2, c], size: alongX ? [g.width, lh, T] : [T, lh, g.width], texture: o.wall ?? 'plaster', color: o.wallColor, tags: ['wall'] });
        if (g.door) {
          const opts = typeof g.door === 'object' ? g.door : {};
          const dd = alongX
            ? prefab().door({ pos: [a + 0.02, y, z1], rotY: 0, width: g.width - 0.04, height: g.height - 0.02, ...opts })
            : prefab().door({ pos: [x1, y, b - 0.02], rotY: Math.PI / 2, width: g.width - 0.04, height: g.height - 0.02, ...opts });
          out.doors.push(dd);
        }
      }
      seg(cur, end);
    }
    if (o.light !== false) out.light = prefab().light({ pos: [x, y + h - 0.03, z], flicker: o.flicker ?? 0, color: o.lightColor, intensity: o.lightIntensity, range: o.lightRange ?? Math.max(w, d) + 2, fixture: o.fixture });
    out.randomPoint = (margin = 0.8) => ({ x: x - w / 2 + margin + sharedRand() * (w - margin * 2), y, z: z - d / 2 + margin + sharedRand() * (d - margin * 2) });
    return out;
  };

  // Build a level from text. '#' (or any char in walls) = wall block, '.' = floor, ' ' = nothing.
  // 'D' = door, 'L' = ceiling light; any other char can be handled by legend: { K: (pos) => prefab.key({pos}) }.
  B.layout = (rows, o = {}) => {
    const cell = o.cell ?? 3, h = o.height ?? 3, y = o.y ?? 0;
    const x0 = o.x ?? 0, z0 = o.z ?? 0;
    const walls = o.walls ?? { '#': o.wall ?? 'plaster' };
    const H = rows.length, Wd = Math.max(...rows.map((r) => r.length));
    const at = (c, r) => (rows[r] && rows[r][c]) || ' ';
    const isWall = (c, r) => at(c, r) in walls;
    const pos = (c, r) => ({ x: x0 + (c + 0.5) * cell, y, z: z0 + (r + 0.5) * cell });
    const out = { cell, rows, pos, cells: {}, doors: [], lights: [] };
    const doorChars = o.doors ?? { D: o.door || {} };
    // merged wall boxes, one per horizontal run of the same wall char
    for (let r = 0; r < H; r++) {
      let c = 0;
      while (c < Wd) {
        const ch = at(c, r);
        if (!(ch in walls)) { c++; continue; }
        let e = c;
        while (e + 1 < Wd && at(e + 1, r) === ch) e++;
        const n = e - c + 1;
        spawn('box', { pos: [x0 + (c + n / 2) * cell, y + h / 2, z0 + (r + 0.5) * cell], size: [n * cell, h, cell], texture: walls[ch], color: o.wallColor, tags: ['wall'] });
        c = e + 1;
      }
    }
    // floor + ceiling over every non-space row run
    for (let r = 0; r < H; r++) {
      let c = 0;
      while (c < Wd) {
        if (at(c, r) === ' ') { c++; continue; }
        let e = c;
        while (e + 1 < Wd && at(e + 1, r) !== ' ') e++;
        const n = e - c + 1, cx = x0 + (c + n / 2) * cell, cz = z0 + (r + 0.5) * cell;
        if (o.floor !== false) spawn('box', { pos: [cx, y - 0.1, cz], size: [n * cell, 0.2, cell], texture: o.floor ?? 'concrete', color: o.floorColor, tags: ['floor'] });
        if (o.ceiling !== false) spawn('box', { pos: [cx, y + h + 0.1, cz], size: [n * cell, 0.2, cell], texture: o.ceiling ?? 'ceiling', color: o.ceilingColor, tags: ['ceiling'] });
        c = e + 1;
      }
    }
    for (let r = 0; r < H; r++) for (let c = 0; c < Wd; c++) {
      const ch = at(c, r);
      if (ch === ' ' || ch in walls) continue;
      const p = pos(c, r);
      (out.cells[ch] ||= []).push(p);
      if (doorChars[ch] && !o.legend?.[ch]) {
        // door between two walls; fill the rest of the cell around it
        const horizontal = isWall(c - 1, r) || isWall(c + 1, r);
        const dw = Math.min(o.doorWidth ?? 1.3, cell - 0.2), dh = Math.min(2.3, h - 0.1), side = (cell - dw) / 2, wt = o.doorWall ?? walls['#'] ?? 'plaster';
        const lh = h - dh;
        if (horizontal) {
          spawn('box', { pos: [p.x - cell / 2 + side / 2, y + h / 2, p.z], size: [side, h, T * 1.5], texture: wt, tags: ['wall'] });
          spawn('box', { pos: [p.x + cell / 2 - side / 2, y + h / 2, p.z], size: [side, h, T * 1.5], texture: wt, tags: ['wall'] });
          spawn('box', { pos: [p.x, y + dh + lh / 2, p.z], size: [dw, lh, T * 1.5], texture: wt, tags: ['wall'] });
          out.doors.push(prefab().door({ pos: [p.x - dw / 2, y, p.z], rotY: 0, width: dw, height: dh, ...doorChars[ch] }));
        } else {
          spawn('box', { pos: [p.x, y + h / 2, p.z - cell / 2 + side / 2], size: [T * 1.5, h, side], texture: wt, tags: ['wall'] });
          spawn('box', { pos: [p.x, y + h / 2, p.z + cell / 2 - side / 2], size: [T * 1.5, h, side], texture: wt, tags: ['wall'] });
          spawn('box', { pos: [p.x, y + dh + lh / 2, p.z], size: [T * 1.5, lh, dw], texture: wt, tags: ['wall'] });
          out.doors.push(prefab().door({ pos: [p.x, y, p.z + dw / 2], rotY: Math.PI / 2, width: dw, height: dh, ...doorChars[ch] }));
        }
      } else if (ch === 'L' && o.legend?.L === undefined) {
        out.lights.push(prefab().light({ pos: [p.x, y + h - 0.03, p.z], flicker: o.flicker ?? 0, color: o.lightColor, range: o.lightRange ?? cell * 3, intensity: o.lightIntensity }));
      } else if (o.legend?.[ch]) {
        o.legend[ch](p, { c, r });
      }
    }
    out.find = (ch) => out.cells[ch] || [];
    out.random = (ch = '.') => { const l = out.find(ch); return l[Math.floor(sharedRand() * l.length)]; };
    return out;
  };

  // Thin-walled maze. Returns cell centers, dead ends and the two farthest-apart cells.
  B.maze = (o = {}) => {
    const cols = o.cols ?? 10, rows = o.rows ?? 10, cell = o.cell ?? 4, h = o.height ?? 3, y = o.y ?? 0;
    const x0 = o.x ?? -(cols * cell) / 2, z0 = o.z ?? -(rows * cell) / 2;
    const rnd = o.rand ?? sharedRand;
    // walls: east[c][r], south[c][r]
    const E = Array.from({ length: cols }, () => Array(rows).fill(true));
    const S = Array.from({ length: cols }, () => Array(rows).fill(true));
    const seen = Array.from({ length: cols }, () => Array(rows).fill(false));
    const stack = [[0, 0]];
    seen[0][0] = true;
    while (stack.length) {
      const [c, r] = stack[stack.length - 1];
      const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dc, dr]) => [c + dc, r + dr, dc, dr]).filter(([nc, nr]) => nc >= 0 && nr >= 0 && nc < cols && nr < rows && !seen[nc][nr]);
      if (!nb.length) { stack.pop(); continue; }
      const [nc, nr, dc, dr] = nb[Math.floor(rnd() * nb.length)];
      if (dc === 1) E[c][r] = false; if (dc === -1) E[nc][nr] = false;
      if (dr === 1) S[c][r] = false; if (dr === -1) S[nc][nr] = false;
      seen[nc][nr] = true;
      stack.push([nc, nr]);
    }
    // knock out extra walls so it loops (better for running from things)
    const loops = o.loops ?? 0.12;
    for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
      if (c < cols - 1 && rnd() < loops) E[c][r] = false;
      if (r < rows - 1 && rnd() < loops) S[c][r] = false;
    }
    const tex = o.wall ?? 'wallpaper';
    const wallBox = (x, z, w, d) => spawn('box', { pos: [x, y + h / 2, z], size: [w, h, d], texture: tex, color: o.wallColor, tags: ['wall'] });
    // outer walls
    wallBox(x0 + (cols * cell) / 2, z0, cols * cell + T, T);
    wallBox(x0 + (cols * cell) / 2, z0 + rows * cell, cols * cell + T, T);
    wallBox(x0, z0 + (rows * cell) / 2, T, rows * cell + T);
    wallBox(x0 + cols * cell, z0 + (rows * cell) / 2, T, rows * cell + T);
    // inner walls, merged into runs
    for (let c = 0; c < cols - 1; c++) {
      let r = 0;
      while (r < rows) {
        if (!E[c][r]) { r++; continue; }
        let e = r;
        while (e + 1 < rows && E[c][e + 1]) e++;
        wallBox(x0 + (c + 1) * cell, z0 + ((r + e + 1) / 2) * cell, T, (e - r + 1) * cell + T);
        r = e + 1;
      }
    }
    for (let r = 0; r < rows - 1; r++) {
      let c = 0;
      while (c < cols) {
        if (!S[c][r]) { c++; continue; }
        let e = c;
        while (e + 1 < cols && S[e + 1][r]) e++;
        wallBox(x0 + ((c + e + 1) / 2) * cell, z0 + (r + 1) * cell, (e - c + 1) * cell + T, T);
        c = e + 1;
      }
    }
    if (o.floor !== false) B.floor({ x: x0 + (cols * cell) / 2, z: z0 + (rows * cell) / 2, w: cols * cell, d: rows * cell, y, texture: o.floor ?? 'carpet', color: o.floorColor });
    if (o.ceiling !== false) B.ceiling({ x: x0 + (cols * cell) / 2, z: z0 + (rows * cell) / 2, w: cols * cell, d: rows * cell, y: y + h, texture: o.ceiling ?? 'ceiling', color: o.ceilingColor });
    const center = (c, r) => ({ x: x0 + (c + 0.5) * cell, y, z: z0 + (r + 0.5) * cell });
    const open = (c, r) => [c > 0 && !E[c - 1][r], c < cols - 1 && !E[c][r], r > 0 && !S[c][r - 1], r < rows - 1 && !S[c][r]].filter(Boolean).length;
    const deadEnds = [];
    const all = [];
    for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) { all.push({ c, r, ...center(c, r) }); if (open(c, r) === 1) deadEnds.push({ c, r, ...center(c, r) }); }
    // lights on a fraction of cells
    const lights = [];
    const every = o.lightEvery ?? 2;
    if (o.lights !== false) for (let c = 0; c < cols; c += every) for (let r = 0; r < rows; r += every) {
      const p = center(c, r);
      lights.push(prefab().light({ pos: [p.x, y + h - 0.03, p.z], flicker: rnd() < (o.flickerChance ?? 0.15) ? 0.3 + rnd() * 0.5 : 0, range: cell * 2.4, intensity: o.lightIntensity ?? 1.4, color: o.lightColor, on: rnd() > (o.deadChance ?? 0.1) }));
    }
    // yaw that faces an open side of a cell (for spawn points)
    const openYaw = (c, r) => (c < cols - 1 && !E[c][r] ? -Math.PI / 2 : r < rows - 1 && !S[c][r] ? Math.PI : c > 0 && !E[c - 1][r] ? Math.PI / 2 : 0);
    return { cols, rows, cell, center, cells: all, deadEnds, lights, openYaw, start: center(0, 0), end: center(cols - 1, rows - 1), random: () => all[Math.floor(rnd() * all.length)] };
  };

  // Open ground with optional trees, fence and fog-friendly boundary.
  B.outdoor = (o = {}) => {
    const size = o.size ?? 60, y = o.y ?? 0;
    const ground = B.floor({ x: o.x ?? 0, z: o.z ?? 0, w: size, d: size, y, texture: o.ground ?? 'grass', texScale: 3 });
    const half = size / 2;
    for (const [x, z, w, d] of [[0, -half, size, 0.4], [0, half, size, 0.4], [-half, 0, 0.4, size], [half, 0, 0.4, size]]) {
      spawn('box', { pos: [x + (o.x ?? 0), y + 2, z + (o.z ?? 0)], size: [w, 4, d], visible: false, tags: ['boundary'] });
    }
    if (o.fence !== false) for (let i = -half + 1; i < half; i += 2) for (const [fx, fz, r] of [[i, -half + 0.4, 0], [i, half - 0.4, 0], [-half + 0.4, i, Math.PI / 2], [half - 0.4, i, Math.PI / 2]]) {
      spawn('model', { model: 'fence', pos: [fx + (o.x ?? 0), y, fz + (o.z ?? 0)], rot: [0, r, 0], solid: false });
    }
    const trees = [];
    for (let i = 0; i < (o.trees ?? 20); i++) {
      const tx = (sharedRand() - 0.5) * (size - 6), tz = (sharedRand() - 0.5) * (size - 6);
      if (o.clear && Math.hypot(tx, tz) < o.clear) continue;
      trees.push(spawn('model', { model: 'tree', pos: [tx + (o.x ?? 0), y, tz + (o.z ?? 0)], rot: [0, sharedRand() * 6, 0], scale: 0.8 + sharedRand() * 0.6, solid: true, tags: ['tree'] }));
    }
    return { ground, trees, size };
  };

  // Scatter props randomly inside an area: build.scatter('crate', 10, {x, z, w, d})
  B.scatter = (model, count, area = {}, o = {}) => {
    const out = [];
    const { x = 0, z = 0, w = 10, d = 10, y = 0 } = area;
    for (let i = 0; i < count; i++) out.push(spawn('model', { model, pos: [x + (sharedRand() - 0.5) * w, y, z + (sharedRand() - 0.5) * d], rot: [0, sharedRand() * 6.28, 0], solid: o.solid ?? true, scale: o.scale, color: o.color, tags: [model, ...(o.tags || [])] }));
    return out;
  };

  return B;
}
