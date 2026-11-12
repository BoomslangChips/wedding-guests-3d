/* atelier-cloth.js: cloth that moves (see atelier-core.js).
   A dress's skirt and long hair are pieces of cloth: a grid of points held together by threads (their neighbours
   along and across keep the cloth's size, the diagonals its shear, every second point its stiffness). A piece lives
   in its figure's own space but WITHOUT the figure's turn: the points the body holds turn with the body, the free
   ones follow through the threads. So a figure that is spun drags its skirt round, the hem lags, swings out and
   settles, as cloth does. The cloth cannot pass through the body (its own cross-sections, read from the tables in
   atelier-body.js), the legs (capsules) or the floor; a light air moves it when nothing else does.
   Also here: A.life, the vertex shader's LIFE in JavaScript (a breath, a shift of weight, the head's turn), for the
   points a piece is pinned to. */
(function () {
  'use strict';
  const A = window.WWAtelier; if (!A || !A.Mesh) return;
  const { clamp, mix, smooth } = A;

  // p (a point in the figure's own space) as the living figure has it: the vertex shader's life() line for line
  // (without the arms: no cloth hangs from them). L: { life: [breath, weight, twist, 1], lean: [x, z, ..], head: [turn,
  // nod, tilt], body: [hips, the neck's base, chin, the neck's axis z], body2: [knees, bust, shoulders, crown] };
  // head: the point belongs to the head (hair), and goes with its turn
  const NONE = new Float32Array(4);
  A.life = function (p, L, head) {
    const li = L.life, b = L.body; if (!li || li[3] < 0.5) return p;
    const b2 = L.body2, sw = L.lean || NONE, y = p[1], x0 = p[0];
    const h = smooth(0.05, b[0], y), up = smooth(b[0], b[1], y);
    p[0] += li[1] * (0.024 * h - 0.016 * up * up);
    p[1] += li[1] * x0 * (0.045 * smooth(b2[0], b[0] - 0.03, y) * (1 - smooth(b[0] + 0.04, b[0] + 0.22, y)) - 0.030 * smooth(b[0] + 0.16, b2[2], y) * (1 - smooth(b[1], b[2], y)));
    let a = li[2] * up, c = Math.cos(a), s = Math.sin(a), u = p[0], v = p[2] - b[3];
    p[0] = c * u + s * v; p[2] = -s * u + c * v + b[3];
    const k = y / b2[3];
    p[0] += sw[0] * k; p[2] += sw[1] * k;
    const ch = smooth(b[0] + 0.10, b2[1], y) * (1 - smooth(b2[2] - 0.02, b[1] + 0.01, y));
    p[2] += li[0] * 0.0075 * ch * smooth(-0.02, 0.06, p[2] - b[3]);
    p[0] += li[0] * 0.012 * ch * p[0];
    p[1] += li[0] * 0.0045 * smooth(b2[1] - 0.05, b2[2], y);
    const hd = L.head, hk = head && hd ? smooth(b[1] - 0.015, b[2] + 0.012, y) : 0;
    if (hk > 0) {
      const kn = b[1] / b2[3], ox = li[1] * 0.008 + sw[0] * kn, oy = b[1] + li[0] * 0.0045, oz = b[3] + sw[1] * kn;
      let qx = p[0] - ox, qy = p[1] - oy, qz = p[2] - oz;
      a = hd[1] * hk; c = Math.cos(a); s = Math.sin(a); u = c * qy - s * qz; v = s * qy + c * qz; qy = u; qz = v;
      a = hd[2] * hk; c = Math.cos(a); s = Math.sin(a); u = c * qx - s * qy; v = s * qx + c * qy; qx = u; qy = v;
      a = hd[0] * hk; c = Math.cos(a); s = Math.sin(a); u = c * qx + s * qz; v = -s * qx + c * qz; qx = u; qz = v;
      p[0] = ox + qx; p[1] = oy + qy; p[2] = oz + qz;
    }
    return p;
  };

  /* o: { cols, rows, wrap, rest (Float32Array, 3 a point, row after row), pin (Float32Array: 1 held by the body .. 0 free),
          k: { stretch, shear, bend, damp, gravity, thick, wind, iter, drag } } */
  function Cloth(o) {
    const cols = this.cols = o.cols, rows = this.rows = o.rows, n = this.n = cols * rows, wrap = this.wrap = !!o.wrap;
    this.rest = o.rest; this.pin = o.pin; this.sgn = o.flip ? -1 : 1; this.hair = !!o.hair;      // (hair goes with the head's turn)
    this.x = new Float32Array(o.rest); this.p = new Float32Array(o.rest); this.tgt = new Float32Array(n * 3); this.nrm = new Float32Array(n * 3);
    this.k = Object.assign({ stretch: 1, shear: 0.5, bend: 0.1, damp: 0.018, gravity: 9.8, thick: 0.006, wind: 1, iter: 5, drag: 0.35, turn: 4.4 }, o.k);
    const ca = [], cb = [], cl = [], ck = [], rest = o.rest, pin = o.pin;
    const at = (i, j) => j * cols + (wrap ? (i + cols) % cols : i);
    const add = (a, b, kind) => {
      if (pin[a] >= 1 && pin[b] >= 1) return;                               // both held: nothing to solve
      const dx = rest[b * 3] - rest[a * 3], dy = rest[b * 3 + 1] - rest[a * 3 + 1], dz = rest[b * 3 + 2] - rest[a * 3 + 2];
      ca.push(a); cb.push(b); cl.push(Math.hypot(dx, dy, dz)); ck.push(kind);
    };
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const right = wrap || i + 1 < cols, right2 = wrap || i + 2 < cols;
      if (right) add(at(i, j), at(i + 1, j), 0);
      if (j + 1 < rows) add(at(i, j), at(i, j + 1), 0);
      if (right && j + 1 < rows) { add(at(i, j), at(i + 1, j + 1), 1); add(at(i + 1, j), at(i, j + 1), 1); }
      if (right2) add(at(i, j), at(i + 2, j), 2);
      if (j + 2 < rows) add(at(i, j), at(i, j + 2), 2);
    }
    this.ca = n > 65535 ? new Uint32Array(ca) : new Uint16Array(ca); this.cb = n > 65535 ? new Uint32Array(cb) : new Uint16Array(cb);
    this.cl = new Float32Array(cl); this.ck = new Uint8Array(ck);
    this.w = new Float32Array(n); for (let i = 0; i < n; i++) this.w[i] = pin[i] >= 1 ? 0 : 1;      // what moves (0: the body holds it)
    // tethers: a free point can never be further from the held point at the head of its column than the cloth
    // between them is long (threads alone give under the cloth's own weight: a skirt would grow by a hand)
    const ta = this.ta = new Int32Array(n).fill(-1), tl = this.tl = new Float32Array(n), slack = this.k.slack == null ? 1.012 : this.k.slack;
    const seg = (a, b) => Math.hypot(rest[b * 3] - rest[a * 3], rest[b * 3 + 1] - rest[a * 3 + 1], rest[b * 3 + 2] - rest[a * 3 + 2]);
    for (let i = 0; i < cols; i++) {
      const up = pin[(rows - 1) * cols + i] >= 1, down = pin[i] >= 1; if (!up && !down) continue;
      // (held at its last row: a skirt; at its first: hair)
      let j = up ? rows - 1 : 0; const dj = up ? -1 : 1;
      while (j + dj >= 0 && j + dj < rows && pin[(j + dj) * cols + i] >= 1) j += dj;
      const anchor = j * cols + i; let len = 0;
      for (let q = j + dj; q >= 0 && q < rows; q += dj) { len += seg((q - dj) * cols + i, q * cols + i); ta[q * cols + i] = anchor; tl[q * cols + i] = len * slack; }
    }
    // how much of the way to where the body has it a half-held point goes in one pass (so that after all the passes of a step it has gone `pin` of it)
    this.ph = new Float32Array(n); for (let i = 0; i < n; i++) this.ph[i] = pin[i] > 0 && pin[i] < 1 ? 1 - Math.pow(1 - pin[i], 1 / this.k.iter) : 0;
    this.still = 0; this.t = 0; this.yaw0 = null;
  }
  // put the whole piece where the body has it now (no swing left in it)
  Cloth.prototype.reset = function (f) {
    const n = this.n, x = this.x, p = this.p, rest = this.rest, cy = Math.cos(f.yaw), sy = Math.sin(f.yaw), q = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const a = i * 3; q[0] = rest[a]; q[1] = rest[a + 1]; q[2] = rest[a + 2]; A.life(q, f.L, this.hair);
      x[a] = p[a] = cy * q[0] + sy * q[2]; x[a + 1] = p[a + 1] = q[1]; x[a + 2] = p[a + 2] = -sy * q[0] + cy * q[2];
    }
    this.yaw0 = f.yaw;
  };
  /* one step of dt seconds. f: { yaw, L (the figure's life), col: { torso (a Table), y0, y1 (the heights it is used between), skull (a Table, or none),
     caps: [[ax, ay, az, bx, by, bz, ra, rb], ...] (in the body's own space), floor }, air (0..1: how much the air moves it) } */
  Cloth.prototype.step = function (dt, f) {
    const n = this.n, x = this.x, p = this.p, pin = this.pin, w = this.w, k = this.k, rest = this.rest, tgt = this.tgt, col = f.col, ta = this.ta, tl = this.tl, ph = this.ph;
    const cy = Math.cos(f.yaw), sy = Math.sin(f.yaw), q = [0, 0, 0], L = f.L, li = L.life, lb = L.body;
    this.t += dt; const t = this.t;
    // the body's turn since the last step: what of it is faster than the cloth can live with carries the cloth round
    let turned = this.yaw0 == null ? 0 : f.yaw - this.yaw0; this.yaw0 = f.yaw;
    turned -= Math.round(turned / (Math.PI * 2)) * Math.PI * 2;
    const carry = turned - clamp(turned, -k.turn * dt, k.turn * dt);
    if (carry !== 0) {
      const cc = Math.cos(carry), sc = Math.sin(carry);
      for (let i = 0; i < n; i++) { if (w[i] === 0) continue; const a = i * 3, x0 = x[a], z0 = x[a + 2], p0 = p[a], q0 = p[a + 2]; x[a] = cc * x0 + sc * z0; x[a + 2] = -sc * x0 + cc * z0; p[a] = cc * p0 + sc * q0; p[a + 2] = -sc * p0 + cc * q0; }
    }
    for (let i = 0; i < n; i++) {
      if (pin[i] <= 0) continue;
      const a = i * 3; q[0] = rest[a]; q[1] = rest[a + 1]; q[2] = rest[a + 2]; A.life(q, L, this.hair);
      tgt[a] = cy * q[0] + sy * q[2]; tgt[a + 1] = q[1]; tgt[a + 2] = -sy * q[0] + cy * q[2];
    }
    // each point goes on as it was going (a little slowed by the air), falls, and is moved by the air
    const g = k.gravity * dt * dt, keep = 1 - k.damp, air = (f.air == null ? 1 : f.air) * k.wind * dt * dt, vmax = 0.09;
    const gx = air * (0.55 * Math.sin(t * 0.83) + 0.45 * Math.sin(t * 0.31 + 1.7)), gz = air * (0.5 * Math.sin(t * 0.67 + 0.9) + 0.4 * Math.sin(t * 0.23));
    for (let i = 0; i < n; i++) {
      const a = i * 3;
      if (w[i] === 0) { p[a] = x[a]; p[a + 1] = x[a + 1]; p[a + 2] = x[a + 2]; x[a] = tgt[a]; x[a + 1] = tgt[a + 1]; x[a + 2] = tgt[a + 2]; continue; }
      let vx = (x[a] - p[a]) * keep, vy = (x[a + 1] - p[a + 1]) * keep, vz = (x[a + 2] - p[a + 2]) * keep;
      const v2 = vx * vx + vy * vy + vz * vz;
      if (v2 > vmax * vmax) { const s = vmax / Math.sqrt(v2); vx *= s; vy *= s; vz *= s; }
      p[a] = x[a]; p[a + 1] = x[a + 1]; p[a + 2] = x[a + 2];
      const ripple = air * 0.6 * Math.sin(t * 1.9 + x[a + 1] * 7.0 + x[a] * 5.0 + x[a + 2] * 4.0);
      x[a] += vx + gx + ripple * 0.7; x[a + 1] += vy - g; x[a + 2] += vz + gz + ripple;
    }
    const ca = this.ca, cb = this.cb, cl = this.cl, ck = this.ck, nc = ca.length, ks = [k.stretch, k.shear, k.bend];
    const torso = col && col.torso, skull = col && col.skull, caps = col && col.caps, floor = col ? col.floor : -1e9, thick = k.thick, drag = k.drag;
    // the capsules, turned with the body
    let cw = null;
    if (caps) { cw = this.cw || (this.cw = caps.map(() => new Float32Array(8)));
      for (let c = 0; c < caps.length; c++) {
        const s = caps[c], o = cw[c];
        q[0] = s[0]; q[1] = s[1]; q[2] = s[2]; A.life(q, L); o[0] = cy * q[0] + sy * q[2]; o[1] = q[1]; o[2] = -sy * q[0] + cy * q[2];
        q[0] = s[3]; q[1] = s[4]; q[2] = s[5]; A.life(q, L); o[3] = cy * q[0] + sy * q[2]; o[4] = q[1]; o[5] = -sy * q[0] + cy * q[2];
        o[6] = s[6]; o[7] = s[7];
      } }
    // where the living body's own axis is, at 33 heights (it leans and shifts; so does what the cloth lies on), and how far its head is turned
    const off = this.off || (this.off = new Float32Array(66)), oTop = lb && L.body2 ? L.body2[3] : 2, turn = L.head ? L.head[0] : 0;
    if (li && li[3] > 0.5 && L.body2) for (let j = 0; j <= 32; j++) { q[0] = 0; q[1] = oTop * j / 32; q[2] = lb[3]; A.life(q, L); off[j * 2] = q[0]; off[j * 2 + 1] = q[2] - lb[3]; } else off.fill(0);
    for (let it = 0; it < k.iter; it++) {
      // the threads
      for (let c = 0; c < nc; c++) {
        const a = ca[c] * 3, b = cb[c] * 3, wa = w[ca[c]], wb = w[cb[c]], ws = wa + wb; if (ws === 0) continue;
        const dx = x[b] - x[a], dy = x[b + 1] - x[a + 1], dz = x[b + 2] - x[a + 2], d = Math.sqrt(dx * dx + dy * dy + dz * dz); if (d < 1e-7) continue;
        const kind = ck[c]; let s = (d - cl[c]) / d;
        if (kind === 2) { if (s > 0) continue; s *= ks[2]; }                // a stiffness only: it pushes a fold open, never pulls
        else s *= ks[kind] * (s < 0 ? 0.6 : 1);                             // cloth gives a little when pressed together
        const fa = s * wa / ws, fb = s * wb / ws;
        x[a] += dx * fa; x[a + 1] += dy * fa; x[a + 2] += dz * fa; x[b] -= dx * fb; x[b + 1] -= dy * fb; x[b + 2] -= dz * fb;
      }
      // the tethers
      for (let i = 0; i < n; i++) {
        const t = ta[i]; if (t < 0) continue;
        const a = i * 3, b = t * 3, dx = x[a] - x[b], dy = x[a + 1] - x[b + 1], dz = x[a + 2] - x[b + 2], d2 = dx * dx + dy * dy + dz * dz, l = tl[i];
        if (d2 > l * l) { const s = l / Math.sqrt(d2); x[a] = x[b] + dx * s; x[a + 1] = x[b + 1] + dy * s; x[a + 2] = x[b + 2] + dz * s; }
      }
      // what the body half holds
      for (let i = 0; i < n; i++) { const h = ph[i]; if (h > 0) { const a = i * 3; x[a] += (tgt[a] - x[a]) * h; x[a + 1] += (tgt[a + 1] - x[a + 1]) * h; x[a + 2] += (tgt[a + 2] - x[a + 2]) * h; } }
      if (it < k.iter - 3 || !col) continue;
      // the body, the legs, the floor
      for (let i = 0; i < n; i++) {
        if (w[i] === 0 || pin[i] > 0.6) continue;
        const a = i * 3; let hit = false; const y = x[a + 1], yb = y - (col.lift || 0);           // (the tables are the barefoot body's)
        const tab = skull && yb > skull.t.y0 ? skull : torso && y > col.y0 && y < col.y1 ? torso : null;
        if (tab) {
          // (in the body's own space: turned back, and shifted as its weight is)
          const fj = clamp(y / oTop, 0, 1) * 32, j = Math.min(31, Math.floor(fj)), fo = fj - j, ox = off[j * 2] + (off[j * 2 + 2] - off[j * 2]) * fo, oz = off[j * 2 + 1] + (off[j * 2 + 3] - off[j * 2 + 1]) * fo;
          const bx = cy * x[a] - sy * x[a + 2] - ox, cz = tab.cz(yb) + oz, bz = sy * x[a] + cy * x[a + 2] - cz, r = Math.sqrt(bx * bx + bz * bz);
          const rmin = tab.rad(yb, Math.atan2(bx, bz) - (tab === skull ? turn : 0)) + thick;
          if (r < rmin && r > 1e-6) { const s = rmin / r, nx = bx * s + ox, nz = bz * s + cz; x[a] = cy * nx + sy * nz; x[a + 2] = -sy * nx + cy * nz; hit = true; }
        }
        if (cw) for (let c = 0; c < cw.length; c++) {
          const o = cw[c]; if (y > Math.max(o[1], o[4]) + 0.12 || y < Math.min(o[1], o[4]) - 0.12) continue;
          const ex = o[3] - o[0], ey = o[4] - o[1], ez = o[5] - o[2], px = x[a] - o[0], py = x[a + 1] - o[1], pz = x[a + 2] - o[2];
          const u = clamp((px * ex + py * ey + pz * ez) / (ex * ex + ey * ey + ez * ez), 0, 1), dx = px - ex * u, dy = py - ey * u, dz = pz - ez * u, rr = o[6] + (o[7] - o[6]) * u + thick, d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < rr * rr && d2 > 1e-12) { const s = rr / Math.sqrt(d2); x[a] = o[0] + ex * u + dx * s; x[a + 1] = o[1] + ey * u + dy * s; x[a + 2] = o[2] + ez * u + dz * s; hit = true; }
        }
        if (x[a + 1] < floor) { x[a + 1] = floor; hit = true; }
        if (hit) { p[a] += (x[a] - p[a]) * drag; p[a + 1] += (x[a + 1] - p[a + 1]) * drag; p[a + 2] += (x[a + 2] - p[a + 2]) * drag; }     // it rubs: some of its speed is lost
      }
    }
    // how far the furthest free point really went in this step (squared); a piece that has hardly moved for a while is still
    let moved = 0;
    for (let i = 0; i < n; i++) { if (pin[i] > 0) continue; const a = i * 3, dx = x[a] - p[a], dy = x[a + 1] - p[a + 1], dz = x[a + 2] - p[a + 2], d2 = dx * dx + dy * dy + dz * dz; if (d2 > moved) moved = d2; }
    this.moved = moved; this.still = moved < 4e-9 ? this.still + 1 : 0;
  };
  // the piece's points and the way each faces, into its buffer (12 numbers a point: place 3, facing 3, the rest stays)
  Cloth.prototype.write = function (buf) {
    const cols = this.cols, rows = this.rows, wrap = this.wrap, x = this.x, sg = this.sgn, rc = wrap ? cols + 1 : cols;      // (drawn with a seam's points twice)
    for (let j = 0; j < rows; j++) for (let ii = 0; ii < rc; ii++) {
      const i = ii % cols;
      const il = wrap ? (i + cols - 1) % cols : Math.max(0, i - 1), ir = wrap ? (i + 1) % cols : Math.min(cols - 1, i + 1), jd = Math.max(0, j - 1), ju = Math.min(rows - 1, j + 1);
      const l = (j * cols + il) * 3, r = (j * cols + ir) * 3, d = (jd * cols + i) * 3, u = (ju * cols + i) * 3;
      const ux = x[r] - x[l], uy = x[r + 1] - x[l + 1], uz = x[r + 2] - x[l + 2], vx = x[u] - x[d], vy = x[u + 1] - x[d + 1], vz = x[u + 2] - x[d + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, len = (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1) * sg;
      const a = (j * cols + i) * 3, o = (j * rc + ii) * 12;
      buf[o] = x[a]; buf[o + 1] = x[a + 1]; buf[o + 2] = x[a + 2]; buf[o + 3] = nx / len; buf[o + 4] = ny / len; buf[o + 5] = nz / len;
    }
  };
  A.Cloth = Cloth;
})();
