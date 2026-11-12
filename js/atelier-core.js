/* atelier-core.js: the dress code in the round (What to Wear, since v16).
   A small renderer of our own, no library: it is only fetched when a guest comes near the chapter (app.js), it draws
   a frame only when something moved, and it sleeps while the stage is off screen. Three files share window.WWAtelier:
     atelier-core.js     the maths, the mesh builder (lofted rings, tubes, patches) and the WebGL renderer
     atelier-figure.js   the figures: a body, hair, and the clothes of each look, built from those shapes
     atelier-stage.js    the stage: camera, lights, turning a figure with a finger, the days, the labels
   Everything a guest sees is geometry made here from numbers: no pictures, no models to download. */
(function () {
  'use strict';
  const A = window.WWAtelier = window.WWAtelier || {};
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const mix = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const V = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    mul: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    len: (a) => Math.hypot(a[0], a[1], a[2]),
    norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
    mix: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
  };
  // 4 x 4 matrices, column-major (as WebGL wants them)
  const M4 = {
    mul(a, b) { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]; return o; },
    persp(fovy, aspect, near, far) { const f = 1 / Math.tan(fovy / 2), o = new Float32Array(16); o[0] = f / aspect; o[5] = f; o[10] = (far + near) / (near - far); o[11] = -1; o[14] = 2 * far * near / (near - far); return o; },
    look(eye, at, up) {
      const z = V.norm(V.sub(eye, at)), x = V.norm(V.cross(up, z)), y = V.cross(z, x), o = new Float32Array(16);
      o[0] = x[0]; o[4] = x[1]; o[8] = x[2]; o[12] = -V.dot(x, eye);
      o[1] = y[0]; o[5] = y[1]; o[9] = y[2]; o[13] = -V.dot(y, eye);
      o[2] = z[0]; o[6] = z[1]; o[10] = z[2]; o[14] = -V.dot(z, eye); o[15] = 1; return o;
    },
    // the light's own view: a box, not a cone
    ortho(l, r, b, t, n, f) { const o = new Float32Array(16); o[0] = 2 / (r - l); o[5] = 2 / (t - b); o[10] = -2 / (f - n); o[12] = -(r + l) / (r - l); o[13] = -(t + b) / (t - b); o[14] = -(f + n) / (f - n); o[15] = 1; return o; },
    // a figure's place: turned about its own upright axis, then set down at (x, 0, z); sc: its build ([girth, height]: no two people are the same size)
    place(x, z, yaw, lean, sc) { const c = Math.cos(yaw), s = Math.sin(yaw), o = new Float32Array(16), g = sc ? sc[0] : 1, h = sc ? sc[1] : 1; o[0] = c * g; o[2] = -s * g; o[5] = h; o[8] = s * g; o[10] = c * g; o[12] = x; o[14] = z; o[15] = 1; if (lean) { o[4] = lean; } return o; },
    apply(m, p) { const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15]; return [(m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]) / w, (m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]) / w, (m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]) / w]; },
  };
  // a smooth curve through points (Catmull-Rom); t runs 0 .. points - 1
  const curve = (P, t) => {
    const n = P.length - 1, i = clamp(Math.floor(t), 0, n - 1), f = t - i;
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(n, i + 2)], o = [];
    for (let k = 0; k < p1.length; k++) o.push(0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * f + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * f * f + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * f * f * f));
    return o;
  };

  /* ---------------- the mesh builder ----------------
     Everything is a patch: nu x nv points from a function of (u, v). Each point carries the colour it takes from the
     figure's palette (slot), the cloth it is made of (mat), a tint and two numbers for the shader (uv). Normals are
     summed from the faces, so a patch is smooth in itself and has a crisp edge where it meets another. */
  // (rig: what the points made next belong to: 0 the body and its clothes, 1 / 2 an arm that hangs (left / right), 3 the head and what it carries; kept with the slot as slot + 16 * rig)
  function Mesh() { this.p = []; this.s = []; this.m = []; this.uv = []; this.tint = []; this.part = []; this.idx = []; this.count = 0; this.balls = []; this.parts = 0; this.rig = 0; }
  Mesh.prototype.patch = function (nu, nv, fn, o) {
    o = o || {};
    const base = this.count, cols = o.wrap ? nu : nu + 1, part = o.part != null ? o.part : this.parts++;
    for (let j = 0; j <= nv; j++) for (let i = 0; i < cols; i++) {
      const u = i / nu, v = j / nv, q = fn(u, v);
      this.p.push(q[0], q[1], q[2]);
      this.s.push((typeof o.slot === 'function' ? o.slot(u, v, q) : (o.slot || 0)) + 16 * this.rig);
      this.m.push(typeof o.mat === 'function' ? o.mat(u, v, q) : (o.mat || 0));
      const t = o.uv ? o.uv(u, v, q) : [u, v]; this.uv.push(t[0], t[1]);
      this.tint.push(o.tint ? o.tint(u, v, q) : 1); this.part.push(part);
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = base + j * cols + i, b = base + j * cols + (o.wrap ? (i + 1) % cols : i + 1), c = a + cols, d = b + cols;
      if (o.flip) this.idx.push(a, c, b, b, c, d); else this.idx.push(a, b, c, b, d, c);
    }
    this.count += (nv + 1) * cols;
    return part;
  };
  // a ring's outline at angle th (0 = the front, +z): a superellipse, with its own depth in front and behind
  const ringPoint = (R, th) => {
    const s = Math.sin(th), c = Math.cos(th), rz = R[4] * (c > 0 ? R[6] : R[7]), n = R[5];
    const r = 1 / Math.pow(Math.pow(Math.abs(s / R[3]), n) + Math.pow(Math.abs(c / rz), n), 1 / n);
    return [R[0] + r * s, R[1], R[2] + r * c];
  };
  // rings: { y, x, z, rx, rz, n (2 = an ellipse, more = squarer), f, b (depth in front / behind) }, bottom to top
  const ringArr = (r) => [r.x || 0, r.y, r.z || 0, r.rx, r.rz == null ? r.rx : r.rz, r.n || 2, r.f == null ? 1 : r.f, r.b == null ? 1 : r.b];
  Mesh.prototype.loft = function (rings, o) {
    o = o || {};
    const R = rings.map(ringArr), last = R.length - 1, nu = o.nu || 24, nv = (o.sub || 3) * last;
    const open = o.open, mod = o.mod;
    const part = this.patch(nu, nv, (u, v) => {
      const t = v * last, ring = curve(R, t);
      ring[3] = Math.max(ring[3], 1e-4); ring[4] = Math.max(ring[4], 1e-4);
      const al = open ? open(v, ring) : 0;
      const th = open ? al + u * (TAU - 2 * al) : Math.PI + u * TAU;       // closed: the seam is at the back
      let q = ringPoint(ring, th);
      if (mod) q = mod(q, th, v, ring) || q;
      return q;
    }, { slot: o.slot, mat: o.mat, wrap: !open, uv: o.uv || ((u, v) => [u, v]), tint: o.tint, flip: o.flip, part: o.part });
    if (o.ball !== false) for (let i = 0; i <= last; i += 1) this.balls.push([R[i][0], R[i][1], R[i][2], Math.min(R[i][3], R[i][4]) * (o.ballk || 0.92), part]);
    return part;
  };
  // a tube along a smooth path: P = [[x, y, z, rx, rz?], ...]; round ends on request; flat = its cross-section's lean
  Mesh.prototype.tube = function (P, o) {
    o = o || {};
    P = P.map((q) => [q[0], q[1], q[2], q[3], q[4] == null ? q[3] : q[4]]);
    const last = P.length - 1, sub = o.sub || 4, nv = sub * last, nu = o.nu || 12, K = [];
    for (let j = 0; j <= nv; j++) { const q = curve(P, j / sub); K.push(q); }
    // frames carried along the path, so the tube never twists
    const T = K.map((q, j) => V.norm(V.sub(K[Math.min(nv, j + 1)], K[Math.max(0, j - 1)])));
    let N = V.norm(V.cross(T[0], Math.abs(T[0][0]) > 0.9 ? [0, 0, 1] : [1, 0, 0])), B;
    N = V.norm(V.cross(N, T[0]));
    if (o.side) N = V.norm(V.sub(o.side, V.mul(T[0], V.dot(o.side, T[0]))));
    const F = [];
    for (let j = 0; j <= nv; j++) { N = V.norm(V.sub(N, V.mul(T[j], V.dot(N, T[j])))); B = V.cross(T[j], N); F.push([N, B]); }
    const cap0 = o.round0 ? 3 : 0, cap1 = o.round1 ? 3 : 0, rows = nv + cap0 + cap1;
    const part = this.patch(nu, rows, (u, v) => {
      let j = v * rows - cap0, k = 1, push = 0;
      if (j < 0) { const a = (-j / cap0) * Math.PI / 2; k = Math.cos(a); push = -Math.sin(a); j = 0; }
      else if (j > nv) { const a = ((j - nv) / cap1) * Math.PI / 2; k = Math.cos(a); push = Math.sin(a); j = nv; }
      const i = Math.min(nv - 1, Math.floor(j)), f = j - i, q = V.mix(K[i], K[i + 1], f), fr = F[Math.round(j)];
      const rx = mix(K[i][3], K[i + 1][3], f), rz = mix(K[i][4] == null ? K[i][3] : K[i][4], K[i + 1][4] == null ? K[i + 1][3] : K[i + 1][4], f);
      const a = u * TAU, cx = Math.cos(a) * rx * k, cz = Math.sin(a) * rz * k, t = T[Math.round(j)], pr = push * Math.min(rx, rz);
      return [q[0] + fr[0][0] * cx + fr[1][0] * cz + t[0] * pr, q[1] + fr[0][1] * cx + fr[1][1] * cz + t[1] * pr, q[2] + fr[0][2] * cx + fr[1][2] * cz + t[2] * pr];
    }, { slot: o.slot, mat: o.mat, wrap: true, uv: o.uv, tint: o.tint, part: o.part });
    if (o.ball !== false) for (let j = 0; j <= nv; j += Math.max(1, Math.round(sub / 2))) this.balls.push([K[j][0], K[j][1], K[j][2], Math.min(K[j][3], K[j][4] == null ? K[j][3] : K[j][4]) * 0.95, part]);
    return part;
  };
  // an egg: centre c, radii r; squash and lean it with a matrix-free "mod"
  Mesh.prototype.egg = function (c, r, o) {
    o = o || {};
    const part = this.patch(o.nu || 14, o.nv || 10, (u, v) => {
      const th = u * TAU, ph = v * Math.PI, s = Math.sin(ph);
      let q = [c[0] + r[0] * s * Math.sin(th), c[1] - r[1] * Math.cos(ph), c[2] + r[2] * s * Math.cos(th)];
      if (o.mod) q = o.mod(q, th, v) || q;
      return q;
    }, { slot: o.slot, mat: o.mat, wrap: true, uv: o.uv, tint: o.tint, part: o.part });
    if (o.ball !== false) this.balls.push([c[0], c[1], c[2], Math.min(r[0], r[1], r[2]) * 0.9, part]);
    return part;
  };
  // normals from the faces; then the soft shade a body casts on itself: each part is a string of balls, and a point
  // loses light to the balls of the other parts that sit in front of it (and to the floor it stands on)
  Mesh.prototype.finish = function () {
    const n = this.count, p = this.p, nor = new Float32Array(n * 3), idx = this.idx;
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      nor[a] += nx; nor[a + 1] += ny; nor[a + 2] += nz; nor[b] += nx; nor[b + 1] += ny; nor[b + 2] += nz; nor[c] += nx; nor[c + 1] += ny; nor[c + 2] += nz;
    }
    const ao = new Float32Array(n), balls = this.balls;
    for (let i = 0; i < n; i++) {
      const a = i * 3, l = Math.hypot(nor[a], nor[a + 1], nor[a + 2]) || 1;
      nor[a] /= l; nor[a + 1] /= l; nor[a + 2] /= l;
      let light = 1;
      for (let k = 0; k < balls.length; k++) {
        const b = balls[k]; if (b[4] === this.part[i]) continue;
        const dx = b[0] - p[a], dy = b[1] - p[a + 1], dz = b[2] - p[a + 2], d2 = dx * dx + dy * dy + dz * dz, r2 = b[3] * b[3];
        if (d2 > r2 * 30) continue;
        const d = Math.sqrt(d2), facing = (nor[a] * dx + nor[a + 1] * dy + nor[a + 2] * dz) / d;
        if (facing <= -0.2) continue;
        light *= 1 - clamp(r2 / Math.max(d2, r2 * 0.8), 0, 1) * clamp(facing + 0.2, 0, 1) * 0.55;
      }
      const floor = nor[a + 1] < 0.3 ? mix(0.62, 1, smooth(0, 0.3, p[a + 1])) : 1;
      ao[i] = clamp(light * floor, 0.25, 1);
    }
    // the data, packed for the GPU: position 3, normal 3, uv 2, then slot, cloth, shade, tint
    const buf = new Float32Array(n * 12);
    for (let i = 0; i < n; i++) {
      const o = i * 12, a = i * 3;
      buf[o] = p[a]; buf[o + 1] = p[a + 1]; buf[o + 2] = p[a + 2]; buf[o + 3] = nor[a]; buf[o + 4] = nor[a + 1]; buf[o + 5] = nor[a + 2];
      buf[o + 6] = this.uv[i * 2]; buf[o + 7] = this.uv[i * 2 + 1]; buf[o + 8] = this.s[i]; buf[o + 9] = this.m[i]; buf[o + 10] = ao[i]; buf[o + 11] = this.tint[i];
    }
    let top = 0; for (let i = 1; i < p.length; i += 3) top = Math.max(top, p[i]);
    return { buf, idx: n > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), count: idx.length, verts: n, top };
  };

  /* ---------------- the renderer ----------------
     One program draws the figures: cloth, skin and hair differ by a number each point carries, a real face gets its
     make-up from where the point sits on the head, eyes look where they are told and blink, and every surface
     mirrors the room a little (the sky, the floor, the key light as a soft box). A figure is alive before it is
     placed: it breathes, shifts its weight and turns its head (LIFE, in the vertex shader; atelier-cloth.js does
     the same sums for the points cloth is pinned to). The key light throws real shadows (a depth picture from the
     light, read softly) on the figures and on the floor; under each figure lies a soft pool of shade, and the floor
     shows a faint reflection. Where a device cannot do the fine parts, or falls behind, they are left out. */
  const HEAD = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n';
  const LIFE = `
uniform vec4 uLife;    // a breath (0 out .. 1 in), the weight (-1 on the right leg .. 1 on the left), the shoulders' turn on the hips (radians); w: 1 = a figure, 0 = cloth that is already where it should be
uniform vec4 uSway;    // how far the crown is off the ankles (x, z: metres); how far each hanging arm is lifted off the side (radians: left, right)
uniform vec4 uHead;    // the head's turn, nod and tilt (radians)
uniform vec4 uBody;    // heights: the hips, the base of the neck, the chin; and the neck's axis (z)
uniform vec4 uBody2;   // heights: the knees, the bust, the shoulders, the crown
uniform vec4 uArm[2];  // a hanging arm's shoulder (x, y, z) and its swing (radians): left, right
uniform vec4 uArmE[2]; // its elbow as it hangs (x, y, z); w: the forearm's turn about itself at the wrist (radians)
uniform vec4 uArmW[2]; // its wrist as it hangs
uniform vec4 uArmQ[6]; // how its upper arm, its forearm and its hand are turned from where they hang (quaternions): left 0 .. 2, right 3 .. 5
vec3 qrot(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
vec3 about(vec3 ax, float ang, vec3 v) { float c = cos(ang), s = sin(ang); return v * c + cross(ax, v) * s + ax * dot(ax, v) * (1.0 - c); }
vec3 life(vec3 p, inout vec3 n, float rig) {
  if (uLife.w < 0.5) return p;
  float a, c, s;
  if (rig > 0.5 && rig < 2.5) {                         // an arm that hangs swings a little about its shoulder, and lifts off the side
    vec4 J = rig < 1.5 ? uArm[0] : uArm[1];
    {
      // an arm that is held: the upper arm turns about the shoulder, the forearm about the elbow (and about itself,
      // more towards the wrist), the hand about the wrist. Where a point lies along the arm says how much of each.
      vec4 JE = rig < 1.5 ? uArmE[0] : uArmE[1], JW = rig < 1.5 ? uArmW[0] : uArmW[1];
      vec4 Qu = rig < 1.5 ? uArmQ[0] : uArmQ[3], Qf = rig < 1.5 ? uArmQ[1] : uArmQ[4], Qh = rig < 1.5 ? uArmQ[2] : uArmQ[5];
      vec3 S = J.xyz, E = JE.xyz, W = JW.xyz, ua = normalize(E - S), fa = normalize(W - E);
      float wS = smoothstep(0.015, 0.105, length(p - S));
      float wE = smoothstep(-0.032, 0.032, dot(p - E, normalize(ua + fa)));
      float wW = smoothstep(-0.020, 0.022, dot(p - W, fa));
      float tt = clamp(dot(p - E, fa) / length(W - E), 0.0, 1.0);
      vec3 Ep = S + qrot(Qu, E - S), Wp = Ep + qrot(Qf, W - E);
      vec3 pu = S + qrot(Qu, p - S);
      vec3 pf = Ep + qrot(Qf, about(fa, JE.w * tt, p - E));
      vec3 ph = Wp + qrot(Qh, about(fa, JE.w, p - W));
      vec3 nf = about(fa, JE.w * tt, n);
      vec3 pa = mix(mix(pu, pf, wE), ph, wW);
      vec3 na = mix(mix(qrot(Qu, n), qrot(Qf, nf), wE), qrot(Qh, about(fa, JE.w, n)), wW);
      p = mix(p, pa, wS); n = normalize(mix(n, na, wS));
    }
    vec3 q = p - J.xyz; float w = smoothstep(0.03, 0.17, length(q));
    a = J.w * w; c = cos(a); s = sin(a);
    q.yz = vec2(c * q.y - s * q.z, s * q.y + c * q.z); n.yz = vec2(c * n.y - s * n.z, s * n.y + c * n.z);
    a = (rig < 1.5 ? uSway.z : -uSway.w) * w; c = cos(a); s = sin(a);
    q.xy = vec2(c * q.x - s * q.y, s * q.x + c * q.y); n.xy = vec2(c * n.x - s * n.y, s * n.x + c * n.y);
    p = J.xyz + q;
  }
  float y = p.y, x0 = p.x;
  float h = smoothstep(0.05, uBody.x, y), up = smoothstep(uBody.x, uBody.y, y);
  // the weight on one leg: the hips go over it and the body above them comes back; that leg's hip is the higher, its shoulder the lower; the head stays level
  p.x += uLife.y * (0.024 * h - 0.016 * up * up);
  p.y += uLife.y * x0 * (0.045 * smoothstep(uBody2.x, uBody.x - 0.03, y) * (1.0 - smoothstep(uBody.x + 0.04, uBody.x + 0.22, y))
    - 0.030 * smoothstep(uBody.x + 0.16, uBody2.z, y) * (1.0 - smoothstep(uBody.y, uBody.z, y)));
  // the shoulders turn a little on the hips
  a = uLife.z * up; c = cos(a); s = sin(a);
  vec2 t = vec2(p.x, p.z - uBody.w);
  p.x = c * t.x + s * t.y; p.z = -s * t.x + c * t.y + uBody.w;
  n.xz = vec2(c * n.x + s * n.z, -s * n.x + c * n.z);
  // nobody stands quite still
  float k = y / uBody2.w;
  p.x += uSway.x * k; p.z += uSway.y * k;
  // a breath: the chest comes forward and widens, the shoulders rise and take the head with them
  float ch = smoothstep(uBody.x + 0.10, uBody2.y, y) * (1.0 - smoothstep(uBody2.z - 0.02, uBody.y + 0.01, y));
  p.z += uLife.x * 0.0075 * ch * smoothstep(-0.02, 0.06, p.z - uBody.w);
  p.x += uLife.x * 0.012 * ch * p.x;
  p.y += uLife.x * 0.0045 * smoothstep(uBody2.y - 0.05, uBody2.z, y);
  // the head on its neck: it nods, tilts and turns (the neck takes it up from its base to the chin)
  float hk = rig > 2.5 ? smoothstep(uBody.y - 0.015, uBody.z + 0.012, y) : 0.0;
  if (hk > 0.0) {
    float kn = uBody.y / uBody2.w;
    vec3 o = vec3(uLife.y * 0.008 + uSway.x * kn, uBody.y + uLife.x * 0.0045, uBody.w + uSway.y * kn);
    vec3 q = p - o;
    a = uHead.y * hk; c = cos(a); s = sin(a);
    q.yz = vec2(c * q.y - s * q.z, s * q.y + c * q.z); n.yz = vec2(c * n.y - s * n.z, s * n.y + c * n.z);
    a = uHead.z * hk; c = cos(a); s = sin(a);
    q.xy = vec2(c * q.x - s * q.y, s * q.x + c * q.y); n.xy = vec2(c * n.x - s * n.y, s * n.x + c * n.y);
    a = uHead.x * hk; c = cos(a); s = sin(a);
    q.xz = vec2(c * q.x + s * q.z, -s * q.x + c * q.z); n.xz = vec2(c * n.x + s * n.z, -s * n.x + c * n.z);
    p = o + q;
  }
  return p;
}`;
  const VS = 'attribute vec3 aP; attribute vec3 aN; attribute vec2 aUV; attribute vec4 aD;\nuniform mat4 uVP; uniform mat4 uM; uniform float uSmile;\nvarying vec3 vN; varying vec3 vW; varying vec2 vUV; varying vec4 vD; varying vec4 vL; varying vec3 vM;' + LIFE + `
void main() {
  float rig = floor((aD.x + 0.5) / 16.0);
  vec3 p0 = aP;
  // a smile: the corners of the mouth go up and out, the cheeks rise and round (on the face's own skin only: its
  // points carry where they lie on the face: x 0 the middle, the eyes at .41; y the eyes' line .5, the lips' .2)
  if (uSmile > 0.0 && ((aD.y > 0.55 && aD.y < 0.85) || (aD.y > 1.25 && aD.y < 1.5)) && aUV.y > -0.05 && aUV.y < 0.5 && abs(aUV.x) < 1.2) {
    float ax = abs(aUV.x);
    float corner = smoothstep(0.12, 0.30, ax) * (1.0 - smoothstep(0.42, 0.75, ax)) * (1.0 - smoothstep(0.06, 0.20, abs(aUV.y - 0.21)));
    float cheek = smoothstep(0.25, 0.5, ax) * (1.0 - smoothstep(0.75, 1.1, ax)) * smoothstep(0.18, 0.30, aUV.y) * (1.0 - smoothstep(0.36, 0.48, aUV.y));
    p0.y += uSmile * (0.0070 * corner + 0.0032 * cheek);
    p0.x += uSmile * 0.0038 * corner * sign(aUV.x);
    p0.z += uSmile * (0.0032 * cheek - 0.0018 * corner);
  }
  vec3 n = aN; vec3 p = life(p0, n, rig);
  vec4 w = uM * vec4(p, 1.0);
  vec3 wn = (uM * vec4(n, 0.0)).xyz;
  vW = w.xyz; vN = wn; vUV = aUV; vD = vec4(aD.x - 16.0 * rig, aD.yzw); vL = vec4(aP, uLife.w); vM = n;
  gl_Position = uVP * w;
}`;
  // the depth picture from the light
  const VSD = 'attribute vec3 aP; attribute vec3 aN; attribute vec4 aD;\nuniform mat4 uM; uniform mat4 uLVP;' + LIFE + '\nvoid main() { vec3 n = aN; gl_Position = uLVP * (uM * vec4(life(aP, n, floor((aD.x + 0.5) / 16.0)), 1.0)); }';
  const FSD = HEAD + 'void main() { gl_FragColor = vec4(1.0); }';
  // reading it softly: taps on a small disc, turned differently at every pixel
  const SHADE = `
uniform sampler2D uSh; uniform vec4 uShP;   // 1 / the picture's size, how dark (0 = no picture), the disc's radius in its pixels, a bias
float tap(vec3 c, vec2 o) { return step(c.z - uShP.w, texture2D(uSh, c.xy + o).r); }
float shade(vec4 sc, vec2 px, float wide) {
  if (uShP.y <= 0.0) return 1.0;
  vec3 c = sc.xyz / sc.w * 0.5 + 0.5;
  if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0) return 1.0;
  float a = fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715)))) * 6.2832, r = uShP.x * uShP.z * wide;
  mat2 m = mat2(cos(a), sin(a), -sin(a), cos(a)) * r;
  float s = tap(c, m * vec2(0.22, 0.0)) + tap(c, m * vec2(-0.29, 0.26)) + tap(c, m * vec2(0.04, -0.50)) + tap(c, m * vec2(0.36, 0.47)) + tap(c, m * vec2(-0.66, -0.12))
    + tap(c, m * vec2(0.62, -0.40)) + tap(c, m * vec2(-0.20, 0.78)) + tap(c, m * vec2(-0.43, -0.75)) + tap(c, m * vec2(0.89, 0.24)) + tap(c, m * vec2(-0.86, 0.45));
  return s / 10.0;
}`;
  const FS = `
#define BROW_X 0.46
#define BROW_W 0.32
#define BROW_Y 0.566
#define BROW_ARCH 0.020
#define BROW_T 0.019
#define EYE_X 0.425
#define EYE_W 0.205
#define EYE_Y 0.5
#define EYE_H 0.027
#define LIP_W 0.31
#define LIP_Y 0.2
#define LIP_UP 0.040
#define LIP_DN 0.056
varying vec3 vN; varying vec3 vW; varying vec2 vUV; varying vec4 vD; varying vec4 vL; varying vec3 vM;
uniform mat4 uLVP;
uniform vec3 uPal[8]; uniform vec3 uEye; uniform vec3 uKey; uniform vec3 uKeyC; uniform vec3 uSky; uniform vec3 uGround; uniform vec4 uFog; uniform vec2 uGhost;
uniform vec4 uFace;   // where the eyes look (right, up), how far the lids are shut (0..1), a smile (0..1)
uniform vec4 uLook;   // a face's own: its beard (0 none .. 1 a full short one), its eyes' colour (0 blue, .5 green, 1 brown; below 0: by its hair), its brows (-1 fine .. 1 heavy), its lips' colour (0 bare .. 1 full)
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }` + SHADE + `
// the room, as a mirror would see it: the sky above, the floor below, the key light as a soft box and a strip at the other side
vec3 room(vec3 r) {
  vec3 c = mix(uGround * 0.8, uSky * 1.5, smoothstep(-0.1, 0.8, r.y));
  vec3 k = normalize(uKey);
  c += uKeyC * (pow(max(dot(r, k), 0.0), 14.0) * 2.4 + pow(max(dot(r, normalize(vec3(-k.x * 1.2, 0.3, 0.5))), 0.0), 48.0) * 0.8);
  return c;
}
// a grain that lies ON a surface and is about a pixel fine at any distance (0 .. 1, evenly spread): what is sifted
// through it neither turns to a film from afar nor crawls as the surface moves
float grain(vec2 q, float seed) {
  float lod = 0.0;
#ifdef DERIV
  lod = log2(1.0 / max(max(length(dFdx(q)), length(dFdy(q))), 0.0001));
#endif
  vec2 sc = vec2(exp2(floor(lod)), exp2(ceil(lod)));
  vec2 hs = vec2(hash(floor(q * sc.x) + seed), hash(floor(q * sc.y) + seed + 5.0));
  float lf = fract(lod), hx = mix(hs.x, hs.y, lf), ha = min(lf, 1.0 - lf);
  float g = hx < 1.0 - ha ? (hx < ha ? hx * hx / max(2.0 * ha * (1.0 - ha), 0.0001) : (hx - 0.5 * ha) / (1.0 - ha)) : 1.0 - (1.0 - hx) * (1.0 - hx) / max(2.0 * ha * (1.0 - ha), 0.0001);
  return clamp(g, 0.0, 1.0);
}
// where a beard grows on a face (0 .. 1), by the face's own co-ordinates: under the cheek's line (it falls from the
// sideburn to the corner of the mouth), over the lip, on the chin and the jaw, a little way under the jaw
float beardAt(vec2 f) {
  float ax = abs(f.x);
  float cl = 0.250 + 0.250 * pow(smoothstep(0.38, 0.98, ax), 2.1);
  float g = smoothstep(cl + 0.035, cl - 0.035, f.y);
  g = max(g, smoothstep(0.328, 0.298, f.y) * (1.0 - smoothstep(0.36, 0.47, ax)) * (0.72 + 0.28 * smoothstep(0.0, 0.05, ax)));      // the moustache, parted a little under the nose
  g *= smoothstep(-0.105, -0.025, f.y);                                   // the neck's line
  g *= smoothstep(1.25, 0.95, ax);                                        // it ends behind the jaw's angle
  g *= 1.0 - smoothstep(0.98, 1.06, ax) * smoothstep(0.27, 0.33, f.y);    // the ear stays clean
  g *= 1.0 - 0.30 * smoothstep(0.16, 0.24, ax) * (1.0 - smoothstep(0.30, 0.40, ax)) * smoothstep(0.075, 0.105, f.y) * (1.0 - smoothstep(0.135, 0.165, f.y));      // thinner beside the chin's patch
  return g;
}
// the lips (and what a smile opens between them): no hair there
float lipZone(vec2 f, float S) { return 1.0 - smoothstep(0.80, 1.02, length(vec2(f.x / (LIP_W * 1.06), (f.y - LIP_Y + 0.008) / (0.050 + 0.016 * S)))); }
void main() {
  // (in the floor's reflection the figure is drawn upside down: what the device calls a front face is a back one
  // there, and the light must fall on it as it falls on the figure itself; only its outer faces are drawn, for
  // two layers of a see-through picture would show as bands)
  vec3 N = normalize(vN);
  if (uGhost.x > 0.5) { if (gl_FrontFacing) discard; N.y = -N.y; } else if (!gl_FrontFacing) N = -N;
  vec3 Vd = normalize(uEye - vW);
  int slot = int(vD.x + 0.5); float mat = vD.y; float ao = vD.z;
  vec3 base = vec3(0.5);
  for (int i = 0; i < 8; i++) if (i == slot) base = uPal[i];
  // (colours that are no figure's own: silver, gold, black, tortoiseshell: what jewellery, watches and glasses are made of)
  if (slot == 8) base = vec3(0.80, 0.80, 0.83); else if (slot == 9) base = vec3(0.88, 0.68, 0.33); else if (slot == 10) base = vec3(0.035, 0.035, 0.042); else if (slot == 11) base = vec3(0.27, 0.15, 0.08);
  base *= vD.w;
  if (mat > 1.5 && mat < 6.7) base = min(base, vec3(0.925));      // (cloth is never quite paper white: a white shirt keeps its form)
  float glint = 0.0, cover = 1.0, fur = 0.0, furT = 0.5;
  if (mat > 0.55 && mat < 0.85) {                        // a real face: its make-up (x: the eyes at -.41 and +.41; y: the eyes' line .5, the lips' .2)
    vec2 f = vUV; float ax = abs(f.x); float lady = step(mat, 0.65); float S = uFace.w;
    // the cheeks: they colour with a smile
    base = mix(base, base * vec3(1.03, 0.80, 0.78), (mix(0.14, 0.30, lady) + 0.14 * S) * smoothstep(0.34, 0.0, length(vec2((ax - 0.62) * 0.8, (f.y - 0.32 - 0.02 * S) * 1.5))));
    // the brows (they lift a little with a smile)
    float bx = (ax - BROW_X) / BROW_W, by = BROW_Y + 0.006 + 0.008 * S + (BROW_ARCH + 0.006) * (1.0 - bx * bx) - 0.012 * max(bx, 0.0);
    float bt = BROW_T * (1.0 + 0.45 * uLook.z);
    float brow = smoothstep(bt * (1.0 - 0.5 * max(bx, 0.0)), 0.006, abs(f.y - by)) * step(abs(bx), 1.0) * (0.70 + 0.30 * noise(vec2(f.x * 260.0, f.y * 40.0)));
    base = mix(base, uPal[1] * 0.46, brow * clamp(mix(0.70, 0.72, lady) + 0.14 * uLook.z, 0.0, 1.0));
    vec2 e = vec2((ax - EYE_X) / EYE_W, (f.y - EYE_Y) / EYE_H);
    float ring = length(e);
    base = mix(base, base * vec3(0.80, 0.72, 0.72), smoothstep(1.9, 1.0, ring) * 0.35);                                   // the socket's own shade
    float lid = smoothstep(1.30, 1.12, ring) * smoothstep(0.86, 1.02, ring);
    base = mix(base, vec3(0.07, 0.05, 0.045), lid * smoothstep(-0.25, 0.25, e.y) * mix(0.42, 0.90, lady) * (0.7 + 0.3 * smoothstep(-0.2, 0.9, e.x)));
    base = mix(base, base * vec3(0.72, 0.62, 0.60), lid * smoothstep(0.1, -0.5, e.y) * 0.55);
    // the mouth: a smile is wider and its corners rise; a broad one parts the lips, and the teeth show
    // (the mesh lifts the corners itself: the paint only follows the lips it lies on; the lower lip stays, the upper
    // lip lifts off it and the upper teeth show in the mouth's own line)
    float mx = f.x / (LIP_W * (1.0 + 0.03 * S)), my = f.y - LIP_Y - S * 0.006 * mx * mx;
    float open = smoothstep(0.42, 0.95, S) * 0.024 * pow(max(1.0 - mx * mx, 0.0), 0.6);
    float top = LIP_UP * (1.0 - 0.30 * S) * pow(max(1.0 - mx * mx, 0.0), 0.55) * (1.0 - 0.25 * exp(-mx * mx / 0.012));
    float bot = -LIP_DN * (1.0 - 0.08 * S) * pow(max(1.0 - mx * mx * 1.1, 0.0), 0.7);
    float inx = step(abs(mx), 1.0);
    float upper = smoothstep(-0.008, 0.008, top + open - my) * smoothstep(-0.004, 0.004, my - open);
    float lower = smoothstep(-0.003, 0.003, -my) * smoothstep(-0.008, 0.008, my - bot);
    float lips = clamp(upper + lower, 0.0, 1.0) * inx;
    vec3 lipC = mix(base * vec3(0.92, 0.68, 0.66), vec3(0.74, 0.36, 0.40), lady * uLook.w);
    // the folds a smile draws from the nose to the corners of the mouth
    base *= 1.0 - 0.07 * smoothstep(0.45, 0.9, S) * smoothstep(0.045, 0.0, abs((ax - 0.27) - (0.37 - f.y) * 0.62)) * smoothstep(0.12, 0.17, f.y) * (1.0 - smoothstep(0.30, 0.38, f.y));
    // a beard's ground: the skin under it is shaded and takes the hair's colour, most where the beard is fullest (its
    // hairs are layers of their own, above the skin); a shaven face keeps a faint shadow
    float grow = beardAt(f) * (1.0 - lips) * (1.0 - lady);
    float fullB = smoothstep(0.08, 1.0, uLook.x);
    float stub = 0.62 + 0.76 * grain(f * vec2(340.0, 250.0), 3.0);      // (a stubble is this shade alone: each hair too short to stand off the skin)
    base = mix(base, uPal[1] * 0.50 + base * 0.14, clamp(grow * (0.06 + 0.66 * fullB) * mix(stub, 1.0, 0.7 * fullB), 0.0, 1.0));
    base = mix(base, lipC, lips * mix(0.55, mix(0.45, 0.92, uLook.w), lady));
    float teeth = inx * smoothstep(0.0015, 0.007, open) * smoothstep(-0.002, 0.002, my) * smoothstep(0.0, 0.004, open - my);
    base = mix(base, mix(vec3(0.34, 0.15, 0.14), vec3(0.96, 0.94, 0.90), smoothstep(1.0, 0.62, abs(mx))) * (0.80 + 0.20 * clamp((open - my) / max(open * 0.65, 0.0001), 0.0, 1.0)), teeth);      // (a little shade under the upper lip; no division by nothing where the mouth is shut)
    ao = mix(ao, 1.0, teeth * 0.85);                     // (teeth stand in the mouth's own crease: its shade is not theirs)
#ifdef GRID
    float gx = abs(fract(f.x * 10.0 + 0.5) - 0.5), gy = abs(fract(f.y * 10.0 + 0.5) - 0.5);
    if (gx < 0.035) base = mix(base, vec3(1.0, 0.0, 0.0), 0.8);
    if (gy < 0.035) base = mix(base, vec3(0.0, 0.2, 1.0), 0.8);
    if (abs(f.y - 0.5) < 0.004 || abs(f.y - 0.2) < 0.004) base = vec3(0.0, 0.7, 0.0);
#endif
  }
  if (mat > 8.5 && mat < 9.5) {                          // an eye: the white, the iris with its fibres and dark rim, the pupil; it looks where uFace says, and its lid comes down over it
    float g = vUV.x, t = vUV.y * 6.2832;
    vec3 dir = vec3(sin(g) * cos(t), sin(g) * sin(t), cos(g));
    float rr = acos(clamp(dot(dir, normalize(vec3(uFace.x, uFace.y, 1.0))), -1.0, 1.0)) / 0.40;
    float fair = smoothstep(0.32, 0.70, dot(uPal[1], vec3(0.333)));
    vec3 irisC = mix(vec3(0.36, 0.22, 0.11), vec3(0.30, 0.48, 0.64), fair);
    if (uLook.y >= 0.0) irisC = uLook.y < 0.5 ? mix(vec3(0.30, 0.48, 0.64), vec3(0.34, 0.43, 0.25), uLook.y * 2.0) : mix(vec3(0.34, 0.43, 0.25), vec3(0.36, 0.22, 0.11), uLook.y * 2.0 - 1.0);
    vec3 c = vec3(0.93, 0.91, 0.89) * (1.0 - 0.22 * smoothstep(0.5, 1.4, g));
    c = mix(c, irisC * (0.55 + 0.75 * smoothstep(1.0, 0.25, rr)) * (0.86 + 0.28 * noise(vec2(t * 9.5, rr * 3.0))), smoothstep(1.0, 0.92, rr));
    c = mix(c, irisC * 0.22, smoothstep(0.80, 0.98, rr) * smoothstep(1.08, 0.98, rr) * 0.85);
    c = mix(c, vec3(0.015), smoothstep(0.42, 0.35, rr));
    base = c * (1.0 - 0.38 * smoothstep(0.02, 0.55, dir.y));
    glint = 1.0;
    float shut = max(smoothstep(-0.05, 0.05, dir.y - mix(0.75, -0.55, uFace.z)), smoothstep(0.05, -0.05, dir.y + mix(0.84, 0.56, uFace.w)));      // (the upper lid; and the lower one, which a smile brings up)
    if (shut > 0.0) { base = mix(base, uPal[0] * vec3(0.90, 0.80, 0.78), shut); glint = 1.0 - shut; mat = mix(mat, 0.0, step(0.5, shut)); }
  }
  base = pow(base, vec3(2.2));
  float gloss = 12.0, spec = 0.04, sheen = 0.0, wrap = 0.25, aniso = 0.0, mirror = 0.0;
  vec3 sheenC = vec3(1.0);
  if (mat < 0.9) { spec = 0.16; gloss = 22.0; wrap = 0.42; sheen = 0.10; sheenC = vec3(1.0, 0.82, 0.76); mirror = 0.035 + glint * 0.5; }   // skin
  else if (mat < 1.5) {                                                                                                                   // hair: strands, their sheen, wisps at the ends
    spec = 0.0; aniso = 0.55; wrap = 0.35; sheen = 0.12; mirror = 0.03;
    if (mat > 1.25) {
      // a beard's hairs: this layer lies lv of the way out along them. Each hair is a small cell on the face with a
      // length of its own; a cell that covers less than a pixel cannot be told from its neighbours, and the layer
      // shows the hairs' share of the surface instead
      float lv = clamp((mat - 1.30) / 0.19, 0.0, 1.0);
      vec2 bf = vUV;
      float reach = beardAt(bf) * (1.0 - lipZone(bf, uFace.w)) * (0.58 + 0.42 * noise(bf * vec2(23.0, 31.0)));
      vec2 bq = vec2(bf.x * 340.0 + 0.7 * sin(bf.y * 90.0), (bf.y - 0.006 * lv) * 250.0);
      vec2 bid = floor(bq), bo = fract(bq) - 0.5;
      float h1 = hash(bid), h2 = hash(bid + 17.0);
      float one = step(lv, reach * (0.35 + 0.65 * h2)) * smoothstep(0.40 - 0.22 * lv, 0.12 - 0.06 * lv, length(bo - (vec2(h1, h2) - 0.5) * 0.55));
      float share = reach * (0.92 - 0.72 * lv) * step(lv * 0.9, reach);
      // (which of a layer's points are hair is sifted through a pattern that lies ON the face and is about a pixel
      // fine at any distance: no see-through film, nothing that crawls as the head moves)
      float near = 0.0;
#ifdef DERIV
      near = clamp(1.6 - 1.3 * max(length(dFdx(bq)), length(dFdy(bq))), 0.0, 1.0);          // (a hair's cell over more than a pixel: the hairs can be told apart)
#endif
      furT = clamp(grain(bq, 37.0 * lv), 0.02, 0.98);
      cover = min(0.999, mix(share, one, near) * mix(0.55, 1.0, smoothstep(0.08, 1.0, uLook.x)));
      base = uPal[1] * vec3(0.90, 0.84, 0.80) * (0.50 + 0.36 * lv) * mix(1.0, 0.80 + 0.40 * h1, near);      // (a beard is a shade darker and warmer than the hair of the head)
      aniso = 0.3; sheen = 0.06; fur = 1.0;
    } else {
    float strand = noise(vec2(vUV.x * 260.0, vUV.y * 5.0));
    base *= 0.72 + 0.5 * strand;
    float fray = smoothstep(0.80, 1.0, vUV.y);
    cover = 1.0 - fray * smoothstep(0.25, 0.75, noise(vec2(vUV.x * 190.0, vUV.y * 4.0)) + fray * 0.35);
    if (mat > 1.1) { base = vec3(0.004); cover = smoothstep(0.0, 0.25, noise(vec2(vUV.x * 3.0, 0.5)) - vUV.y * 0.75 + 0.2) * (1.0 - smoothstep(0.3, 0.6, uFace.z)); }   // lashes
    }
  }
  else if (mat < 2.5) { spec = 0.035; gloss = 9.0; sheen = 0.20; base *= (0.93 + 0.14 * noise(vL.xy * 900.0 + vL.z * 700.0)) * (0.950 + 0.10 * grain(vec2(vL.x + vL.z * 0.7, vL.y) * 520.0, 1.0)); }             // wool, crepe, cotton: a weave's grain
  else if (mat < 3.5) { spec = 0.26; gloss = 30.0; aniso = 0.8; sheen = 0.32; wrap = 0.2; mirror = 0.20; }                                  // satin
  else if (mat < 4.5) { spec = 0.10; gloss = 14.0; aniso = 0.25; sheen = 0.55; wrap = 0.5; mirror = 0.05; }                                // chiffon
  else if (mat < 5.5) { spec = 0.02; sheen = 0.32; float rib = sin(vUV.x * 380.0); base *= (0.93 + 0.07 * rib) * (0.945 + 0.11 * grain(vec2(vUV.x * 190.0, vL.y * 430.0), 2.0)); N = normalize(N + 0.08 * rib * cross(N, vec3(0.0, 1.0, 0.0))); }   // knit
  else if (mat < 6.65) {                                                                                                                 // denim: its twill; a leg's seams and hem top-stitched in gold thread
    spec = 0.03; sheen = 0.12; float w = noise(vec2(vL.x + vL.z, vL.y * 0.4) * 1500.0); base *= (0.84 + 0.26 * w) * (0.93 + 0.14 * grain(vec2(vL.x + vL.z * 0.7, vL.y) * 560.0, 3.0));
    if (mat > 6.5) {
      float du = min(abs(fract(vUV.x + 0.5) - 0.5), abs(fract(vUV.x) - 0.5));
      float st = smoothstep(0.0048, 0.0022, abs(du - 0.015)) + smoothstep(0.0038, 0.0018, abs(vUV.y - 0.972));
      base = mix(base, vec3(0.80, 0.58, 0.30), 0.72 * clamp(st, 0.0, 1.0));
    }
  }
  else if (mat < 7.5) { spec = 0.30; gloss = 46.0; sheen = 0.08; mirror = 0.22; }                                                          // leather
  else if (mat < 8.5) { spec = 0.9; gloss = 60.0; mirror = 0.7; }                                                                          // metal
  else if (mat < 9.5) { spec = 0.7; gloss = 120.0; wrap = 0.3; mirror = 0.22; }                                                           // the wet of an eye
  // Soft folds in cloth. How much: the part of its cloth's number after the point (0 .. .4). The surface leans to one
  // side and the other along the level direction, by a pattern that belongs to the cloth: laid out over a still
  // garment's own place, or (a piece that moves) over the grid it was cut on, so the folds go with the cloth.
  float fold = mat > 1.5 && mat < 6.49 ? fract(mat + 0.001) * 2.5 : 0.0;
  if (fold > 0.02) {
    vec3 T = cross(vec3(0.0, 1.0, 0.0), N); float tl = length(T);
    if (tl > 0.25) {
      vec3 q, tm;
      if (vL.w > 0.5) { q = vL.xyz; tm = cross(vec3(0.0, 1.0, 0.0), normalize(vM)); if (uGhost.x < 0.5 && !gl_FrontFacing) tm = -tm; }
      else { float th = 3.14159 + vUV.x * 6.28318; q = vec3(sin(th) * 0.34, vUV.y * 0.9, cos(th) * 0.34); tm = vec3(cos(th), 0.0, -sin(th)); }
      float fa = q.x * 0.8 + q.z * 0.6, fb = q.z * 0.8 - q.x * 0.6, ta = tm.x * 0.8 + tm.z * 0.6, tb = tm.z * 0.8 - tm.x * 0.6;
      float lean = ta * (cos(fa * 41.0 + q.y * 3.1 + 1.7 * sin(q.y * 5.3)) + 0.6 * cos(fa * 67.0 - q.y * 4.7 + 0.5))
        + tb * (cos(fb * 37.0 - q.y * 2.6 + 1.3 * sin(q.y * 4.1 + 2.0)) + 0.6 * cos(fb * 73.0 + q.y * 5.9 + 1.1));
      N = normalize(N + T / tl * lean * fold * 0.17);
    }
  }
  vec3 L = normalize(uKey), Lf = normalize(vec3(-uKey.x * 1.2, 0.25, 0.7)), Lr = normalize(vec3(-uKey.x * 0.6, 0.5, -1.0));
  float nl = dot(N, L), d = clamp((nl + wrap) / (1.0 + wrap), 0.0, 1.0), df = clamp(dot(N, Lf) * 0.5 + 0.5, 0.0, 1.0);
  // the key light's shadow: only where the surface faces the light (where it turns away the soft fall-off does the work)
  // (looked up a little off the surface, on the side that is seen: no shade of a surface on itself)
  float sh = 1.0;
  if (uGhost.x < 0.5 && uShP.y > 0.0 && nl > 0.0) sh = mix(1.0, mix(1.0 - uShP.y, 1.0, shade(uLVP * vec4(vW + N * 0.011, 1.0), gl_FragCoord.xy, 1.0)), smoothstep(0.0, 0.2, nl));
  vec3 amb = mix(uGround, uSky, N.y * 0.5 + 0.5) * (0.45 + 0.55 * ao);
  vec3 lit = base * (uKeyC * d * sh * (0.55 + 0.45 * ao) + uSky * vec3(0.42, 0.48, 0.58) * df * df * ao + amb);
  if (mat < 0.9) lit += base * vec3(0.55, 0.12, 0.08) * uKeyC * smoothstep(-0.25, 0.1, nl) * (1.0 - smoothstep(0.1, 0.55, nl)) * 0.5 * (0.4 + 0.6 * sh);   // light through skin
  vec3 H = normalize(L + Vd);
  float s = pow(max(dot(N, H), 0.0), gloss) * spec;
  if (aniso > 0.0) {                                    // the long highlights of satin and hair run across the weave
    vec3 T = normalize(cross(N, cross(vec3(0.0, 1.0, 0.0), N)) + vec3(0.0, 0.0001, 0.0));
    float th = dot(T, H), band = sqrt(max(1.0 - th * th, 0.0));
    float streak = mat < 1.5 ? 0.6 + 0.4 * noise(vec2(vUV.x * 240.0, vUV.y * 6.0)) : 1.0;
    s = mix(s, pow(band, mat < 1.5 ? 70.0 : 40.0) * (mat < 1.5 ? 0.42 : 0.34) * max(nl * 0.6 + 0.4, 0.0) * streak, aniso);
  }
  float fres = pow(1.0 - max(dot(N, Vd), 0.0), 3.0);
  lit += uKeyC * s * ao * sh + sheenC * base * sheen * fres * (uSky * 2.0 + uKeyC * 0.4);
  lit += room(reflect(-Vd, N)) * mirror * (0.35 + 0.65 * fres) * (0.4 + 0.6 * ao);
  lit += uKeyC * pow(max(dot(N, Lr), 0.0), 2.0) * fres * 1.1 * ao;                          // the light from behind: an edge of light
  lit = 1.0 - exp(-lit * 1.32);                         // a soft shoulder: bright cloth keeps its colour instead of burning out
  vec3 c = pow(lit, vec3(1.0 / 2.2));
  c = mix(c, uFog.rgb, uFog.a);
  float a = 1.0;
  if (uGhost.x > 0.5) a = 0.30 * (1.0 - smoothstep(0.0, 1.0, -vW.y)) * (1.0 - uFog.a);      // the reflection in the floor: faint, fading with depth
  if (cover < 1.0) { if (fur > 0.5) { if (cover < furT) discard; } else if (uGhost.y > 0.5) a *= cover; else if (cover < 0.5) discard; }        // a beard's layers (sifted, never see-through); hair's wispy ends
#ifdef BACKS
  if (!gl_FrontFacing && uGhost.x < 0.5) c = mix(c, vec3(1.0, 0.0, 0.0), 0.75);
#endif
  gl_FragColor = vec4(c * a, a);
}`;
  // the soft round shadow of the simplest kind (for devices where the fine parts are switched off)
  const VS2 = `attribute vec2 aP; uniform mat4 uVP; uniform vec4 uAt; varying vec2 vQ; void main() { vQ = aP; gl_Position = uVP * vec4(uAt.x + aP.x * uAt.z, 0.002, uAt.y + aP.y * uAt.w, 1.0); }`;
  const FS2 = HEAD + `varying vec2 vQ; uniform vec4 uC; void main() { float d = length(vQ); float a = smoothstep(1.0, 0.0, d); gl_FragColor = vec4(uC.rgb, 1.0) * (a * a * uC.a); }`;
  // the pool of shade under a figure: the figure as seen from above (fainter the higher the point), into a picture of the floor, blurred close and wide
  const VS3 = 'attribute vec3 aP; attribute vec3 aN; attribute vec4 aD;\nuniform mat4 uM; uniform vec4 uBox; uniform vec2 uL; varying float vH;' + LIFE + '\nvoid main() { vec3 n = aN; vec4 w = uM * vec4(life(aP, n, floor((aD.x + 0.5) / 16.0)), 1.0); vH = w.y; vec2 f = vec2(w.x - uL.x * w.y, w.z - uL.y * w.y); gl_Position = vec4((f - uBox.xy) / uBox.zw, 0.0, 1.0); }';
  const FS3 = HEAD + `varying float vH; void main() { float k = 1.0 - 0.72 * smoothstep(0.0, 1.9, vH); gl_FragColor = vec4(k, k, k, 1.0); }`;
  const VS4 = `attribute vec2 aP; varying vec2 vT; void main() { vT = aP * 0.5 + 0.5; gl_Position = vec4(aP, 0.0, 1.0); }`;
  const FS4 = HEAD + `varying vec2 vT; uniform sampler2D uT; uniform vec2 uD; void main() { float s = texture2D(uT, vT).r * 0.227 + (texture2D(uT, vT + uD * 1.385).r + texture2D(uT, vT - uD * 1.385).r) * 0.316 + (texture2D(uT, vT + uD * 3.231).r + texture2D(uT, vT - uD * 3.231).r) * 0.0703; gl_FragColor = vec4(s, s, s, 1.0); }`;
  // the floor: the pool of shade (uT close, uT2 wide) and, where there is a depth picture, the key light's shadows on it
  const VS5 = `attribute vec2 aP; uniform mat4 uVP; uniform mat4 uLVP; uniform vec4 uBox; varying vec2 vT; varying vec4 vS; void main() { vT = aP * 0.5 + 0.5; vec4 w = vec4(uBox.x + aP.x * uBox.z, 0.003, uBox.y + aP.y * uBox.w, 1.0); vS = uLVP * w; gl_Position = uVP * w; }`;
  const FS5 = HEAD + 'varying vec2 vT; varying vec4 vS; uniform sampler2D uT; uniform sampler2D uT2; uniform vec4 uC; uniform vec2 uK;' + SHADE + `
void main() {
  float pool = min(1.0, texture2D(uT, vT).r * 0.62 + texture2D(uT2, vT).r * 0.55) * uK.x;
  float thrown = (1.0 - shade(vS, gl_FragCoord.xy, 2.6)) * uK.y;
  vec2 e = smoothstep(vec2(0.0), vec2(0.07), vT) * smoothstep(vec2(0.0), vec2(0.07), 1.0 - vT);
  float a = (1.0 - (1.0 - pool) * (1.0 - thrown)) * uC.a * e.x * e.y;
  gl_FragColor = vec4(uC.rgb * a, a);
}`;

  function Renderer(canvas) {
    const opts = { alpha: true, antialias: true, premultipliedAlpha: true, powerPreference: 'low-power', preserveDrawingBuffer: false };
    const gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
    if (!gl) throw new Error('no webgl');
    this.gl = gl; this.canvas = canvas;
    this.u32 = !!gl.getExtension('OES_element_index_uint');
    this.msaa = !!(gl.getContextAttributes() || {}).antialias;
    this.fine = true;                                   // the reflection, the pool of shade and the cast shadows (the stage switches them off on a slow device)
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s)); return s; };
    const prog = (vs, fs, attrs) => { const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); attrs.forEach((a, i) => gl.bindAttribLocation(p, i, a)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p)); return p; };
    const U = (p, names) => { const o = {}; names.forEach((n) => { o[n] = gl.getUniformLocation(p, n); }); return o; };
    const LIFEU = ['uLife', 'uSway', 'uHead', 'uBody', 'uBody2', 'uArm', 'uArmE', 'uArmW', 'uArmQ'];
    const der = !!gl.getExtension('OES_standard_derivatives');
    this.fig = prog(VS, (der ? '#extension GL_OES_standard_derivatives : enable\n' : '') + HEAD + (der ? '#define DERIV\n' : '') + (A.DEBUG_GRID ? '#define GRID\n' : '') + (A.DEBUG_BACKS ? '#define BACKS\n' : '') + FS, ['aP', 'aN', 'aUV', 'aD']);
    this.uf = U(this.fig, ['uVP', 'uM', 'uLVP', 'uPal', 'uEye', 'uKey', 'uKeyC', 'uSky', 'uGround', 'uFog', 'uGhost', 'uFace', 'uLook', 'uSmile', 'uSh', 'uShP'].concat(LIFEU));
    this.sha = prog(VS2, FS2, ['aP']); this.us = U(this.sha, ['uVP', 'uAt', 'uC']);
    this.quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const target = (w, h) => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('framebuffer');
      return { t, f }; };
    // the pool of shade needs four small pictures to draw into; without them round shadows stay
    try {
      this.cast = prog(VS3, FS3, ['aP', 'aN', 'aUV', 'aD']); this.uc = U(this.cast, ['uM', 'uBox', 'uL'].concat(LIFEU));
      this.blur = prog(VS4, FS4, ['aP']); this.ub = U(this.blur, ['uT', 'uD']);
      this.lay = prog(VS5, FS5, ['aP']); this.ul = U(this.lay, ['uVP', 'uLVP', 'uBox', 'uT', 'uT2', 'uC', 'uK', 'uSh', 'uShP']);
      this.sw = 256; this.sh = 128;
      this.tex = [0, 1, 2, 3].map(() => target(this.sw, this.sh));
      this.shaped = true;
    } catch (e) { this.shaped = false; this.why = String(e && e.message || e); }
    // the key light's own shadows need a depth picture (an extension nearly every device has); without it they are left out
    this.deep = null;
    try {
      const hp = gl.getShaderPrecisionFormat && gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);      // (depths are compared in the fragment shader: that needs its full precision)
      if (this.shaped && hp && hp.precision > 0 && gl.getExtension('WEBGL_depth_texture')) {
        const S = 1024, t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT, S, S, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const f = gl.createFramebuffer(), rb = gl.createRenderbuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, t, 0);
        gl.bindRenderbuffer(gl.RENDERBUFFER, rb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA4, S, S); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('depth framebuffer');
        this.dep = prog(VSD, FSD, ['aP', 'aN', 'aUV', 'aD']); this.ud = U(this.dep, ['uM', 'uLVP'].concat(LIFEU));
        this.deep = { t, f, S };
      }
    } catch (e) { this.deep = null; this.why = String(e && e.message || e); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.enable(gl.DEPTH_TEST); gl.clearColor(0, 0, 0, 0);
  }
  Renderer.prototype.upload = function (mesh, moving) {
    const gl = this.gl, vb = gl.createBuffer(), ib = gl.createBuffer();
    if (mesh.idx instanceof Uint32Array && !this.u32) throw new Error('mesh too large for this device');
    gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, mesh.buf, moving ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.idx, gl.STATIC_DRAW);
    return { vb, ib, count: mesh.count, type: mesh.idx instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT };
  };
  // the points of a piece that moves, sent again
  Renderer.prototype.update = function (g, buf) { const gl = this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, g.vb); gl.bufferSubData(gl.ARRAY_BUFFER, 0, buf); };
  Renderer.prototype.free = function (g) { this.gl.deleteBuffer(g.vb); this.gl.deleteBuffer(g.ib); };
  Renderer.prototype.size = function (w, h, dpr) {
    const c = this.canvas, W = Math.max(2, Math.round(w * dpr)), H = Math.max(2, Math.round(h * dpr));
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    this.W = W; this.H = H;
  };
  const STILL = new Float32Array([0, 0, 0, 0]), NOFACE = new Float32Array([0, 0, 0, 0]), LOOK0 = new Float32Array([0.1, -1, 0, 0.85]), ARMS = new Float32Array(8), I4 = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const ARME = new Float32Array([0.2, 1.1, 0, 0, -0.2, 1.1, 0, 0]), ARMW = new Float32Array([0.2, 0.85, 0.03, 0, -0.2, 0.85, 0.03, 0]), ARMQ = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);      // (an arm with nothing said about it: it hangs)
  // scene: { vp, eye, light: { key, keyC, sky, ground, fog, shadow }, floor: [centre x, half width], lvp (the light's own view of the stage), strength (of its shadows),
  //          items: [{ geo, model, pal (24 floats), dim, at: [x, z], life (4), lean (4), head (4), body (4), body2 (4), arm (8), face (4), look (4: a face's own) }] }
  Renderer.prototype.draw = function (scene) {
    const gl = this.gl, L = scene.light, items = scene.items, fine = this.fine;
    const bind = (it, pos) => { gl.bindBuffer(gl.ARRAY_BUFFER, it.geo.vb); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, it.geo.ib); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 48, 0); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 48, 12); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 48, 32); if (!pos) gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 48, 24); };
    const two = () => { gl.enableVertexAttribArray(0); gl.enableVertexAttribArray(1); gl.disableVertexAttribArray(2); gl.enableVertexAttribArray(3); };      // (the place, the facing, and what the point belongs to)
    const one = () => { gl.enableVertexAttribArray(0); gl.disableVertexAttribArray(1); gl.disableVertexAttribArray(2); gl.disableVertexAttribArray(3); };
    const alive = (u, it) => { gl.uniform4fv(u.uLife, it.life || STILL); gl.uniform4fv(u.uSway, it.lean || STILL); gl.uniform4fv(u.uHead, it.head || STILL); gl.uniform4fv(u.uBody, it.body || STILL); gl.uniform4fv(u.uBody2, it.body2 || STILL); gl.uniform4fv(u.uArm, it.arm || ARMS); gl.uniform4fv(u.uArmE, it.armE || ARME); gl.uniform4fv(u.uArmW, it.armW || ARMW); gl.uniform4fv(u.uArmQ, it.armQ || ARMQ); };
    const pool = fine && this.shaped && items.length, deep = pool && this.deep && scene.lvp ? this.deep : null;
    const fl = scene.floor || [0, 3], box = [fl[0] + 0.1, -0.2, fl[1] + 0.9, 1.5];
    if (deep) {
      // 1. the stage as the key light sees it: only how far each point is
      gl.bindFramebuffer(gl.FRAMEBUFFER, deep.f); gl.viewport(0, 0, deep.S, deep.S);
      gl.enable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.colorMask(false, false, false, false); gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1.5, 3.0);
      gl.useProgram(this.dep); two(); gl.uniformMatrix4fv(this.ud.uLVP, false, scene.lvp);
      items.forEach((it) => { if (it.dim > 0.6) return; bind(it, true); gl.uniformMatrix4fv(this.ud.uM, false, it.model); alive(this.ud, it); gl.drawElements(gl.TRIANGLES, it.geo.count, it.geo.type, 0); });
      gl.disable(gl.POLYGON_OFFSET_FILL); gl.colorMask(true, true, true, true);
    }
    if (pool) {
      // 2. the figures from above into a picture of the floor, blurred close (0 -> 1 -> 2) and wide (2 -> 1 -> 3)
      const T = this.tex, k = [L.key[0] * 0.25, L.key[1] + 1.1, L.key[2] * 0.25], uL = [k[0] / k[1], k[2] / k[1]];
      gl.viewport(0, 0, this.sw, this.sh); gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, T[0].f); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(this.cast); two(); gl.uniform4fv(this.uc.uBox, box); gl.uniform2fv(this.uc.uL, uL);
      items.forEach((it) => { if (it.dim > 0.25) return; bind(it, true); gl.uniformMatrix4fv(this.uc.uM, false, it.model); alive(this.uc, it); gl.drawElements(gl.TRIANGLES, it.geo.count, it.geo.type, 0); });
      gl.disable(gl.BLEND); gl.useProgram(this.blur); one(); gl.bindBuffer(gl.ARRAY_BUFFER, this.quad); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.activeTexture(gl.TEXTURE0); gl.uniform1i(this.ub.uT, 0);
      const pass = (from, to, dx, dy) => { gl.bindFramebuffer(gl.FRAMEBUFFER, T[to].f); gl.bindTexture(gl.TEXTURE_2D, T[from].t); gl.uniform2f(this.ub.uD, dx / this.sw, dy / this.sh); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); };
      pass(0, 1, 0.9, 0); pass(1, 2, 0, 0.9); pass(2, 1, 3.2, 0); pass(1, 3, 0, 3.2);
      gl.clearColor(0, 0, 0, 0);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.W, this.H);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const u = this.uf, strength = deep ? (scene.strength == null ? 0.8 : scene.strength) : 0;
    const shadowU = (uu, unit) => { if (deep) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, deep.t); gl.activeTexture(gl.TEXTURE0); } gl.uniform1i(uu.uSh, unit); gl.uniform4f(uu.uShP, deep ? 1 / deep.S : 0, strength, 2.2, 0.0016); };
    const figures = (ghost) => {
      gl.useProgram(this.fig);
      gl.uniformMatrix4fv(u.uVP, false, scene.vp); gl.uniformMatrix4fv(u.uLVP, false, scene.lvp || I4); gl.uniform3fv(u.uEye, scene.eye);
      gl.uniform3fv(u.uKey, L.key); gl.uniform3fv(u.uKeyC, L.keyC); gl.uniform3fv(u.uSky, L.sky); gl.uniform3fv(u.uGround, L.ground);
      gl.uniform2f(u.uGhost, ghost ? 1 : 0, this.msaa && !ghost ? 1 : 0);
      shadowU(u, 2);
      for (let i = 0; i < 4; i++) gl.enableVertexAttribArray(i);
      items.forEach((it) => {
        bind(it);
        let m = it.model;
        if (ghost) { m = new Float32Array(m); m[4] = -m[4]; m[5] = -m[5]; m[6] = -m[6]; }           // the figure, upside down under the floor
        gl.uniformMatrix4fv(u.uM, false, m); gl.uniform3fv(u.uPal, it.pal); gl.uniform4f(u.uFog, L.fog[0], L.fog[1], L.fog[2], it.dim); alive(u, it); gl.uniform4fv(u.uFace, it.face || NOFACE); gl.uniform4fv(u.uLook, it.look || LOOK0); gl.uniform1f(u.uSmile, it.face ? it.face[3] : 0);
        gl.drawElements(gl.TRIANGLES, it.geo.count, it.geo.type, 0);
      });
    };
    // 3. the reflection in the floor
    gl.enable(gl.DEPTH_TEST);
    if (fine) { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); figures(true); gl.clear(gl.DEPTH_BUFFER_BIT); }
    // 4. the shade on the floor
    gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad); one(); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    if (pool) {
      gl.useProgram(this.lay); gl.uniformMatrix4fv(this.ul.uVP, false, scene.vp); gl.uniformMatrix4fv(this.ul.uLVP, false, scene.lvp || I4); gl.uniform4fv(this.ul.uBox, box);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex[2].t); gl.uniform1i(this.ul.uT, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.tex[3].t); gl.uniform1i(this.ul.uT2, 1); gl.activeTexture(gl.TEXTURE0);
      shadowU(this.ul, 2);
      gl.uniform2f(this.ul.uK, deep ? 0.62 : 1, deep ? 0.5 : 0);
      gl.uniform4f(this.ul.uC, L.shadow[0], L.shadow[1], L.shadow[2], 0.50); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    } else {
      gl.useProgram(this.sha); gl.uniformMatrix4fv(this.us.uVP, false, scene.vp);
      items.forEach((it) => {
        if (!it.at) return;
        const k = 1 - it.dim;
        gl.uniform4f(this.us.uC, L.shadow[0], L.shadow[1], L.shadow[2], 0.34 * k); gl.uniform4f(this.us.uAt, it.at[0] - L.key[0] * 0.10, it.at[1] - 0.02, 0.50, 0.30); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.uniform4f(this.us.uC, L.shadow[0], L.shadow[1], L.shadow[2], 0.42 * k); gl.uniform4f(this.us.uAt, it.at[0], it.at[1], 0.24, 0.16); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      });
    }
    // 5. the figures themselves
    gl.disable(gl.BLEND); gl.enable(gl.DEPTH_TEST);
    if (this.msaa) gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    figures(false);
    if (this.msaa) gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
  };

  // points and triangles made elsewhere (a real body): pts is a Float32Array of n x 3; tris index into it. Only the
  // triangles whose three points are kept (o.keep: one byte a point, or none for all) are taken, with their points.
  // o.slot / o.mat / o.tint: a number, or a function of the point's index; o.uv: a function of the index -> [u, v];
  // o.rig: a function of the index -> the point's rig
  Mesh.prototype.raw = function (pts, tris, o) {
    o = o || {};
    const part = o.part != null ? o.part : this.parts++, keep = o.keep, map = new Int32Array(pts.length / 3).fill(-1);
    const val = (v, i, d) => (typeof v === 'function' ? v(i) : v == null ? d : v);
    const take = (i) => {
      if (map[i] >= 0) return map[i];
      this.p.push(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
      this.s.push(val(o.slot, i, 0) + 16 * (o.rig ? o.rig(i) : this.rig)); this.m.push(val(o.mat, i, 0));
      const uv = o.uv ? o.uv(i) : [0, 0]; this.uv.push(uv[0], uv[1]);
      this.tint.push(val(o.tint, i, 1)); this.part.push(part);
      return (map[i] = this.count++);
    };
    for (let k = 0; k < tris.length; k += 3) {
      const a = tris[k], b = tris[k + 1], c = tris[k + 2];
      if (keep && !(keep[a] && keep[b] && keep[c])) continue;
      this.idx.push(take(a), take(b), take(c));
    }
    return part;
  };
  // every point made so far goes up by dy (a figure in heels is built barefoot, lifted, then given its shoes)
  Mesh.prototype.lift = function (dy) { for (let i = 1; i < this.p.length; i += 3) this.p[i] += dy; this.balls.forEach((b) => { b[1] += dy; }); };
  A.TAU = TAU; A.clamp = clamp; A.mix = mix; A.smooth = smooth; A.V = V; A.M4 = M4; A.curve = curve; A.Mesh = Mesh; A.Renderer = Renderer; A.ringPoint = ringPoint; A.ringArr = ringArr;
  A.hex = (h) => { const n = parseInt(String(h).replace('#', ''), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
})();
