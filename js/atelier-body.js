/* atelier-body.js: the real bodies of the dress code's figures (see atelier-core.js).
   w/3d/body.json holds a human body, head and hands (the MakeHuman base mesh, CC0) in three shapes: a young lady, a
   young gent, an older gent, with the skeleton they are posed by. This file unpacks it, poses a body (arms by a
   two-bone solve to where a look wants the hands, the legs brought together, each point carried by its four bones)
   and answers the questions the clothes ask: where is the body's surface at this height and angle, where is the
   skull, how thick is this limb. */
(function () {
  'use strict';
  const A = window.WWAtelier; if (!A || !A.Mesh) return;
  const { clamp, mix, smooth, V } = A;
  const PI = Math.PI, TAU = PI * 2;
  const bytes = (s) => { const b = atob(s), a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; };
  const u16 = (s) => { const a = bytes(s); return new Uint16Array(a.buffer, 0, a.length >> 1); };

  A.parseBody = function (j) {
    const n = j.counts.body + j.counts.lash, q = j.q;
    const wi = bytes(j.wi), wb = bytes(j.ww), ww = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { const s = wb[i * 4] + wb[i * 4 + 1] + wb[i * 4 + 2] + wb[i * 4 + 3] || 1; for (let k = 0; k < 4; k++) ww[i * 4 + k] = wb[i * 4 + k] / s; }
    const bi = {}; j.bones.forEach((b, i) => { bi[b] = i; });
    const B = { bones: j.bones, parents: j.parents, bi, n, nb: j.counts.body, tris: u16(j.tris), ltris: u16(j.ltris), lashv: bytes(j.lashv), wi, ww, region: bytes(j.region), variants: {} };
    Object.keys(j.variants).forEach((key) => {
      const v = j.variants[key], p = u16(v.pos), pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { pos[i * 3] = p[i * 3] / 65535 * 2 * q.x - q.x; pos[i * 3 + 1] = p[i * 3 + 1] / 65535 * q.y; pos[i * 3 + 2] = p[i * 3 + 2] / 65535 * 2 * q.z - q.z; }
      const tab = (t) => { const r = u16(t.r), f = new Float32Array(r.length); for (let i = 0; i < r.length; i++) f[i] = r[i] / 20000; return { y0: t.y0, y1: t.y1, na: t.na, nl: t.nl, r: f, cz: t.cz }; };
      B.variants[key] = { key, pos, heads: Float32Array.from(v.heads), tails: Float32Array.from(v.tails), torso: tab(v.torso), skull: tab(v.skull), dim: v.dim };
    });
    A.BODY = B; return B;
  };
  A.loadBody = (url) => (A.BODY ? Promise.resolve(A.BODY) : fetch(url).then((r) => { if (!r.ok) throw new Error('body ' + r.status); return r.json(); }).then(A.parseBody));

  // A body between two of the shapes that came: every point, joint, measure and table a part of the way from a to b
  // (they are the same body, point for point). Kept under its own name, which is returned.
  A.blendBody = function (a, b, k) {
    const B = A.BODY, key = a + '~' + b + '~' + k; if (B.variants[key]) return key;
    const va = B.variants[a], vb = B.variants[b];
    const arr = (x, y) => { const o = new Float32Array(x.length); for (let i = 0; i < x.length; i++) o[i] = x[i] + (y[i] - x[i]) * k; return o; };
    const val = (x, y) => (typeof x === 'number' ? x + (y - x) * k : Array.isArray(x) || ArrayBuffer.isView(x) ? Array.from(x, (v, i) => v + (y[i] - v) * k) : x);
    const tab = (x, y) => ({ y0: val(x.y0, y.y0), y1: val(x.y1, y.y1), na: x.na, nl: x.nl, r: arr(x.r, y.r), cz: val(x.cz, y.cz) });
    const dim = {}; Object.keys(va.dim).forEach((n) => { dim[n] = val(va.dim[n], vb.dim[n]); });
    B.variants[key] = { key, pos: arr(va.pos, vb.pos), heads: arr(va.heads, vb.heads), tails: arr(va.tails, vb.tails), torso: tab(va.torso, vb.torso), skull: tab(va.skull, vb.skull), dim };
    return key;
  };

  // a table of radii by height and angle (0 = the front, round by +x), read smoothly
  function Table(t) { this.t = t; }
  Table.prototype.rad = function (y, th) {
    const t = this.t, fy = clamp((y - t.y0) / (t.y1 - t.y0), 0, 1) * (t.nl - 1), i0 = Math.min(t.nl - 2, Math.floor(fy)), ty = fy - i0;
    let fa = (th / TAU) % 1; if (fa < 0) fa += 1; fa *= t.na;
    const a0 = Math.floor(fa) % t.na, a1 = (a0 + 1) % t.na, ta = fa - Math.floor(fa), r = t.r;
    return mix(mix(r[i0 * t.na + a0], r[i0 * t.na + a1], ta), mix(r[(i0 + 1) * t.na + a0], r[(i0 + 1) * t.na + a1], ta), ty);
  };
  Table.prototype.cz = function (y) {
    const t = this.t; if (typeof t.cz === 'number') return t.cz;
    const fy = clamp((y - t.y0) / (t.y1 - t.y0), 0, 1) * (t.nl - 1), i0 = Math.min(t.nl - 2, Math.floor(fy));
    return mix(t.cz[i0], t.cz[i0 + 1], fy - i0);
  };
  A.Table = Table;

  // 3 x 3 rotations (row-major arrays of 9)
  const mul3 = (a, b) => [a[0] * b[0] + a[1] * b[3] + a[2] * b[6], a[0] * b[1] + a[1] * b[4] + a[2] * b[7], a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
    a[3] * b[0] + a[4] * b[3] + a[5] * b[6], a[3] * b[1] + a[4] * b[4] + a[5] * b[7], a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
    a[6] * b[0] + a[7] * b[3] + a[8] * b[6], a[6] * b[1] + a[7] * b[4] + a[8] * b[7], a[6] * b[2] + a[7] * b[5] + a[8] * b[8]];
  const app3 = (m, p) => [m[0] * p[0] + m[1] * p[1] + m[2] * p[2], m[3] * p[0] + m[4] * p[1] + m[5] * p[2], m[6] * p[0] + m[7] * p[1] + m[8] * p[2]];
  const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  // the rotation about `axis` (a unit vector) by `ang`
  const axis3 = (ax, ang) => { const c = Math.cos(ang), s = Math.sin(ang), t = 1 - c, [x, y, z] = ax; return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c]; };
  // the shortest turn that takes direction a to direction b
  const arc3 = (a, b) => { a = V.norm(a); b = V.norm(b); const c = V.cross(a, b), s = V.len(c), d = V.dot(a, b); if (s < 1e-7) return d > 0 ? I3 : axis3(V.norm(V.cross(a, Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])), PI); return axis3(V.mul(c, 1 / s), Math.atan2(s, d)); };
  A.rot = { mul3, app3, axis3, arc3, I3 };

  /* a body in a pose. spec: { arms: [right, left] each { wrist: [x, y, z], pole: [x, y, z], turn (the forearm about
     its own length), hand (a rotation of the hand at the wrist) } (world, before the heels'
     lift), stance: half the distance between the ankles, head: [yaw, nod, tilt], heel: how far the balls of the feet
     are below where they are barefoot (a body in heels) }
     Returns the posed points, the posed joints by bone name, and each bone's turn and shift. */
  A.poseBody = function (variant, spec) {
    const B = A.BODY, v = B.variants[variant], nb = B.bones.length, heads = v.heads;
    const R = new Array(nb), T = new Array(nb), own = {};
    const head = (name) => { const i = B.bi[name] * 3; return [heads[i], heads[i + 1], heads[i + 2]]; };
    const world = (i, p) => V.add(app3(R[i], p), T[i]);
    // 1. the legs come together (the body was made standing astride); the feet stay level
    const st = spec.stance == null ? 0.085 : spec.stance;
    ['L', 'R'].forEach((S) => {
      const s = S === 'L' ? 1 : -1, hip = head('upperleg01.' + S), ank = head('foot.' + S);
      const len = Math.hypot(ank[0] - hip[0], ank[1] - hip[1]), a0 = Math.atan2(s * (ank[0] - hip[0]), hip[1] - ank[1]), a1 = Math.asin(clamp((st - s * hip[0]) / len, -0.5, 0.5));
      own['upperleg01.' + S] = axis3([0, 0, 1], s * (a1 - a0)); own['foot.' + S] = axis3([0, 0, 1], -s * (a1 - a0));
    });
    // 1b. in heels: each foot tips forward about its ankle until its ball is `heel` lower, and the toes stay level
    let tip = 0;
    if (spec.heel > 0) ['L', 'R'].forEach((S) => {
      const ank = head('foot.' + S), ball = head('toe1-1.' + S), by = ball[1] - ank[1], bz = ball[2] - ank[2];
      let lo = 0, hi = 1.1; for (let i = 0; i < 30; i++) { const th = (lo + hi) / 2; if (Math.cos(th) * by - Math.sin(th) * bz > by - spec.heel) lo = th; else hi = th; }
      tip = (lo + hi) / 2;
      own['foot.' + S] = mul3(axis3([1, 0, 0], tip), own['foot.' + S]);
      for (let k = 1; k <= 5; k++) own['toe' + k + '-1.' + S] = axis3([1, 0, 0], -tip);
    });
    // 2. the head
    if (spec.head) own.neck03 = mul3(axis3([0, 1, 0], spec.head[0] || 0), mul3(axis3([1, 0, 0], spec.head[1] || 0), axis3([0, 0, 1], spec.head[2] || 0)));
    // 2b. the fingers: curled towards the palm (spec.curl: [right, left], 0 as the hand is stored .. 1 a loose fist),
    // each joint about the line that lies across the palm at right angles to its own bone, and brought together (the
    // stored hand's are spread); the thumb laid down beside the forefinger (the stored hand's stands out of the palm,
    // as a hand that holds a glass: such a hand cannot LIE on anything). spec.grip: [right, left]: a hand that holds
    // something keeps the thumb in towards the palm
    const fingers = {};
    if (spec.curl) ['R', 'L'].forEach((S, k) => {
      const c = spec.curl[k]; if (!c) return;
      const tl = (name) => { const i = B.bi[name] * 3; return [v.tails[i], v.tails[i + 1], v.tails[i + 2]]; };
      const w = head('wrist.' + S), a = V.sub(head('finger2-1.' + S), w), b = V.sub(head('finger5-1.' + S), w);
      const palm = V.norm(V.mul(V.cross(a, b), S === 'L' ? -1 : 1));      // out of the palm
      const BEND = spec.bend || [0.42, 0.62, 0.36], MORE = { 2: 0.80, 3: 0.95, 4: 1.08, 5: 1.22 }, TH = spec.thumb || [0.75, 0.4, 0.1, 0.15], grip = spec.grip && spec.grip[k], IN = spec.close || { 2: 0.12, 4: 0.10, 5: 0.17 };      // (radians at each joint of a finger for a loose fist; the little finger curls most)
      for (let f = 2; f <= 5; f++) for (let j = 1; j <= 3; j++) {
        const name = 'finger' + f + '-' + j + '.' + S, dir = V.norm(V.sub(tl(name), head(name)));
        fingers[name] = { axis: V.norm(V.cross(dir, palm)), ang: c * BEND[j - 1] * MORE[f] };
        // (the fingers lie together, as a hand at rest has them: the stored hand's are spread)
        if (j === 1 && !grip && IN[f]) { fingers[name].axis2 = palm; fingers[name].ang2 = (f === 2 ? -1 : 1) * (S === 'L' ? 1 : -1) * IN[f]; }
      }
      // the thumb: at its root laid down towards the palm's plane and brought in towards the forefinger; bent a little at its two joints
      const t1 = 'finger1-1.' + S, d1 = V.norm(V.sub(tl(t1), head(t1))), across = V.norm(V.sub(b, a));
      const along = V.norm(V.sub(V.mix(head('finger3-1.' + S), head('finger4-1.' + S), 0.5), w)), sg = S === 'L' ? 1 : -1;
      fingers[t1] = grip ? { axis: V.norm(V.cross(d1, palm)), ang: c * 0.30, axis2: V.norm(V.cross(d1, across)), ang2: c * 0.22 }      // (a hand that holds something: in towards the palm)
        : { axis: along, ang: -sg * TH[0], axis2: palm, ang2: -sg * TH[1] };
      for (const j of [2, 3]) { const name = 'finger1-' + j + '.' + S, dir = V.norm(V.sub(tl(name), head(name))); fingers[name] = { axis: V.norm(V.cross(dir, across)), ang: grip ? c * (j === 2 ? 0.20 : 0.34) : j === 2 ? TH[2] : TH[3] }; }
    });
    // 3. every bone after its parent; an arm's two long bones are solved when their turn comes
    const arms = {};
    ['R', 'L'].forEach((S, k) => { if (spec.arms && spec.arms[k]) arms['upperarm01.' + S] = { S, t: spec.arms[k] }; });
    const solved = {};
    for (let i = 0; i < nb; i++) {
      const name = B.bones[i], p = B.parents[i], Rp = p < 0 ? I3 : R[p], Tp = p < 0 ? [0, 0, 0] : T[p], h = [heads[i * 3], heads[i * 3 + 1], heads[i * 3 + 2]];
      const at = V.add(app3(Rp, h), Tp);                              // where this bone's joint is now
      let G = null;
      if (arms[name]) {
        const S = arms[name].S, t = arms[name].t, e0 = head('lowerarm01.' + S), w0 = head('wrist.' + S);
        const L1 = V.len(V.sub(e0, h)), L2 = V.len(V.sub(w0, e0));
        let to = V.sub(t.wrist, at), dist = V.len(to); const reach = (L1 + L2) * 0.995;
        if (dist > reach) { to = V.mul(to, reach / dist); dist = reach; }
        const dir = V.mul(to, 1 / dist), a = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist), hgt = Math.sqrt(Math.max(0, L1 * L1 - a * a));
        let pole = V.sub(t.pole, V.mul(dir, V.dot(t.pole, dir))); pole = V.len(pole) < 1e-6 ? [0, 0, -1] : V.norm(pole);
        const elbow = V.add(at, V.add(V.mul(dir, a), V.mul(pole, hgt))), wrist = V.add(at, to);
        G = arc3(app3(Rp, V.sub(e0, h)), V.sub(elbow, at));           // the upper arm
        const Ru = mul3(G, Rp);
        solved['lowerarm01.' + S] = { G: arc3(app3(Ru, V.sub(w0, e0)), V.sub(wrist, elbow)), turn: t.turn || 0, axis: V.norm(V.sub(wrist, elbow)) };
        if (t.hand) own['wrist.' + S] = t.hand;                         // (the hand, turned at the wrist: a rotation in the room's own directions)
      } else if (solved[name]) {
        G = solved[name].G;
        if (solved[name].turn) G = mul3(axis3(solved[name].axis, solved[name].turn), G);
      } else if (own[name]) {
        G = own[name];
      } else if (fingers[name]) {
        const f = fingers[name]; G = axis3(V.norm(app3(Rp, f.axis)), f.ang);      // (its own axis, as its parent now holds it)
        if (f.ang2) G = mul3(axis3(V.norm(app3(Rp, f.axis2)), f.ang2), G);
      }
      R[i] = G ? mul3(G, Rp) : Rp;
      T[i] = V.sub(at, app3(R[i], h));
    }
    // 4. the points, each by its four bones
    const n = B.n, P = new Float32Array(n * 3), pos = v.pos, wi = B.wi, ww = B.ww;
    for (let i = 0; i < n; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2]; let ox = 0, oy = 0, oz = 0;
      for (let k = 0; k < 4; k++) {
        const w = ww[i * 4 + k]; if (!w) continue;
        const r = R[wi[i * 4 + k]], t = T[wi[i * 4 + k]];
        ox += w * (r[0] * x + r[1] * y + r[2] * z + t[0]); oy += w * (r[3] * x + r[4] * y + r[5] * z + t[1]); oz += w * (r[6] * x + r[7] * y + r[8] * z + t[2]);
      }
      P[i * 3] = ox; P[i * 3 + 1] = oy; P[i * 3 + 2] = oz;
    }
    const joint = (name) => { const i = B.bi[name]; return world(i, [heads[i * 3], heads[i * 3 + 1], heads[i * 3 + 2]]); };
    const tail = (name) => { const i = B.bi[name]; return world(i, [v.tails[i * 3], v.tails[i * 3 + 1], v.tails[i * 3 + 2]]); };
    return { P, joint, tail, R, T, variant: v, tip };
  };
})();
