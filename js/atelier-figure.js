/* atelier-figure.js: the figures of the dress code (see atelier-core.js).
   A figure is a real body (atelier-body.js) in a pose, with the clothes of its look made over it here: shells,
   skirts, ribbons and tubes cut over the body's own surface; hair on its skull; make-up the shader paints. A look
   is a short description (LOOKS at the foot of this file); its colours come from the wedding's palette by name, so
   a colour the couple changes in the dashboard changes here too. */
(function () {
  'use strict';
  const A = window.WWAtelier; if (!A || !A.Mesh || !A.Cloth) return;
  const { Mesh, TAU, clamp, mix, smooth, V, curve } = A;
  const PI = Math.PI;
  const SLOT = { skin: 0, hair: 1, main: 2, second: 3, shirt: 4, accent: 5, shoe: 6, extra: 7, silver: 8, gold: 9, black: 10, tortoise: 11 };
  const MAT = { skin: 0, real: 0.6, realM: 0.7, hair: 1, cloth: 2, satin: 3, chiffon: 4, knit: 5, denim: 6, leather: 7, metal: 8, eye: 9 };
  const wrapA = (th) => { let a = (th + PI) % TAU; if (a < 0) a += TAU; return a - PI; };      // -PI .. PI, 0 = the front
  const folds = (mat, k) => mat + 0.4 * clamp(k, 0, 1);              // a cloth with soft folds in it (the fragment shader reads how much after the point)
  const fnOf = (v) => (typeof v === 'function' ? v : () => v);

  /* ---------------- the body ----------------
     A real one (atelier-body.js: the MakeHuman base mesh), posed for the look and measured for its clothes. */
  // (which way an elbow points: back more than out, so that no elbow stands in a neighbour's arm)
  const POLE = { rest: [0.3, 0, -1], easy: [0.3, 0, -1], pocket: [0.5, 0, -1], clutch: [1, -0.2, -0.3] };
  function Body(look) {
    // (look.body: one of the shapes that came, or a body between two of them: ['m', 'mo', .5])
    const key = Array.isArray(look.body) ? A.blendBody(look.body[0], look.body[1], look.body[2]) : look.body || look.sex, v = A.BODY.variants[key], dm = v.dim, k = dm.H / 1.7;
    const torso = this.torso = new A.Table(v.torso); this.skull = new A.Table(v.skull);
    const rest = (name) => { const i = A.BODY.bi[name] * 3; return [v.heads[i], v.heads[i + 1], v.heads[i + 2]]; };
    const d = this.d = { sex: look.sex, H: dm.H, ankle: dm.ankle, knee: dm.knee, crotch: dm.crotch, hip: dm.hip, waist: dm.waist, bust: dm.bust, under: dm.bust - (look.sex === 'f' ? 0.07 : 0.09) * k,
      pit: dm.pit, sho: dm.sho, neck: dm.neck, chin: dm.chin, hipX: dm.hipX, waistX: dm.waistX, bustX: dm.bustX, hipZ: (torso.rad(dm.hip, 0) + torso.rad(dm.hip, PI)) / 2,
      legX: dm.legX, foot: dm.foot, armUp: [dm.arm[0], dm.arm[2]], armLo: [dm.arm[3], dm.arm[5]], thigh: [dm.leg[0], dm.leg[2]], calf: [dm.leg[3], dm.leg[5]],
      shoX: rest('upperarm01.L')[0] + dm.arm[0] * 0.78 };
    // the pose: the hands where the look wants them, the feet under the hips
    const pose = this.pose = look.pose || ['rest', 'rest'], dressed = look.wear.kind === 'dress';
    const out = dressed && look.wear.cut !== 'slip' ? 0.028 : 0;      // (arms that hang beside a wide skirt hang a little off it)
    const coat = !!look.wear.over && typeof look.wear.over === 'object';      // (under a jacket a hand goes into the jacket's own pocket, at its side: the sleeve stays outside the jacket)
    const arms = [-1, 1].map((s, i) => {
      const S = rest('upperarm01.' + (s < 0 ? 'R' : 'L')), E = rest('lowerarm01.' + (s < 0 ? 'R' : 'L')), W = rest('wrist.' + (s < 0 ? 'R' : 'L')), L = V.len(V.sub(E, S)) + V.len(V.sub(W, E)), p = POLE[pose[i]] ? pose[i] : 'rest';
      const wrist = p === 'pocket' ? (coat ? [s * (torso.rad(d.hip + 0.05, s * 1.25) * Math.sin(1.25) + 0.030), d.hip + 0.075, torso.cz(d.hip + 0.05) + torso.rad(d.hip + 0.05, s * 1.25) * Math.cos(1.25) + 0.012] : [s * (d.hipX - 0.012), d.hip + 0.045, torso.cz(d.hip) + 0.06])
        : p === 'clutch' ? [s * 0.042, d.hip + 0.045, torso.cz(d.hip) + d.hipZ + 0.055]
          : p === 'easy' ? [S[0] + s * (0.065 + out), S[1] - L * 0.945, S[2] + 0.155]                 // held easy: a little bent, the hand a little forward
            : [S[0] + s * (0.05 + out), S[1] - L * 0.985, S[2] + 0.07];
      return { wrist, pole: [s * POLE[p][0], POLE[p][1], POLE[p][2]] };
    });
    this.stance = look.stance || (dressed ? 0.066 : look.sex === 'm' ? 0.098 : 0.088);
    // its shoes: how far they lift it; a pump or a flat leaves the foot to be seen, and the foot then stands as the shoe holds it
    const sh = look.shoes || {};
    this.lift = sh.lift == null ? (sh.kind === 'heel' ? 0.065 : look.sex === 'm' ? 0.02 : 0.012) : sh.lift;
    this.bare = sh.kind === 'heel' || sh.kind === 'flat'; this.sole = sh.kind === 'heel' ? 0.005 : 0.006;
    // (the hands: their fingers curled a little, as a hand at rest has them; a hand that holds a clutch a little more)
    const curl = pose.map((p) => (look.curl == null ? (p === 'clutch' ? 0.75 : 0.30) : look.curl));
    const posed = this.posed = A.poseBody(key, { arms, curl, grip: pose.map((p) => p === 'clutch'), thumb: look.thumb, bend: look.bend, stance: this.stance, head: look.head, heel: this.bare ? Math.max(0, this.lift - this.sole) : 0 });
    this.arm = {}; this.leg = {};
    for (const s of [-1, 1]) {
      const S = s < 0 ? 'R' : 'L';
      this.arm[s] = { S: posed.joint('upperarm01.' + S), E: posed.joint('lowerarm01.' + S), W: posed.joint('wrist.' + S) };
      // its hand, as it hangs: the knuckles, the fingers' middle joints and ends, the thumb's end; which way the palm
      // faces (out of it), and the line across it (from the forefinger's side to the little finger's)
      { const A2 = this.arm[s], kn = [2, 3, 4, 5].map((f) => posed.joint('finger' + f + '-1.' + S)), pip = [2, 3, 4, 5].map((f) => posed.joint('finger' + f + '-2.' + S)), mid = [2, 3, 4, 5].map((f) => posed.joint('finger' + f + '-3.' + S)), tip = [2, 3, 4, 5].map((f) => posed.tail('finger' + f + '-3.' + S));
        const a = V.sub(kn[0], A2.W), b = V.sub(kn[3], A2.W);
        A2.hand = { kn, pip, mid, tip, thumb: [posed.joint('finger1-2.' + S), posed.joint('finger1-3.' + S), posed.tail('finger1-3.' + S)], palm: V.norm(V.mul(V.cross(a, b), s > 0 ? -1 : 1)), across: V.norm(V.sub(kn[3], kn[0])), mid0: V.mix(kn[1], kn[2], 0.5) }; }
      this.leg[s] = { H: posed.joint('upperleg01.' + S), K: posed.joint('lowerleg01.' + S), A: posed.joint('foot.' + S) };
    }
    d.upper = V.len(V.sub(this.arm[1].E, this.arm[1].S)); d.lower = V.len(V.sub(this.arm[1].W, this.arm[1].E));
    d.belt = d.waist - (look.sex === 'm' ? 0.048 : 0);                // where trousers sit: a gent's a hand below his natural waist
    // the head's own measures: for the hair, and for the paint on the face (the eyes' line at .5, the lips' at .2)
    const eye = dm.eye, sk = this.skull;
    this.H = { y0: d.chin, hh: d.H - d.chin, hw: (sk.rad(eye[1] + 0.02, PI / 2) + sk.rad(eye[1] + 0.02, -PI / 2)) / 2, hd: (sk.rad(eye[1] + 0.04, 0) + sk.rad(eye[1] + 0.04, PI)) / 2, zc: v.skull.cz, man: look.sex === 'm', eye, eyeR: dm.eyeR, mouth: dm.mouth };
    d.headX = this.H.hw; d.headZ = this.H.hd; d.neckR = (torso.rad(d.neck + 0.03, PI / 2) + torso.rad(d.neck + 0.03, -PI / 2)) / 2;
    // the base of the neck lies in a tilted plane: the pit of the throat in front, the nape behind
    d.neckF = rest('clavicle.L')[1] + 0.006; d.neckB = d.neck + 0.004; this.nk = d.neck + 0.018;
    d.neckS = Math.min(d.neckB - 0.004, this.ridge(d.neckR + 0.016));
  }
  // what an arm's points belong to: an arm that hangs free swings a little (1 the left, 2 the right); one that holds something goes with the body (0)
  Body.prototype.rigOf = function (s) { const p = this.pose[s < 0 ? 0 : 1] || 'rest'; return p === 'rest' || p === 'easy' ? (s > 0 ? 1 : 2) : 0; };
  // a point on the body at height y and angle th (0 = the front), `ease` outside the skin; below `hang` the cloth
  // hangs straight down from there instead of following the body
  Body.prototype.surf = function (y, th, ease, hang) {
    const T = this.torso, yy = hang != null && y < hang ? hang : y;
    let r = T.rad(yy, th);
    if (hang != null && y < hang) {
      r += (hang - y) * 0.10;
      if (this.under) { const u = this.under(y, th); if (u > 0) r = Math.max(r, u + (T.cz(Math.max(y, T.t.y0)) - T.cz(yy)) * Math.cos(th) - 0.004); }
    }
    r += ease || 0;
    const q = [Math.sin(th) * r, y, T.cz(yy) + Math.cos(th) * r];
    // on the shoulders a layer lies ON the one below it (a sideways gap is no gap where the cloth runs almost level)
    if (ease && y > this.d.pit) q[1] += ease * 0.7 * smooth(this.d.pit + 0.02, this.d.sho - 0.015, y);
    return q;
  };
  // the height of the neck's base at an angle from the front
  // (high behind and at the sides, where the neck meets the shoulders; dipping to the pit of the throat in front)
  Body.prototype.nb = function (a) { const x = Math.abs(wrapA(a)), d = this.d; return x < PI / 2 ? mix(d.neckF, d.neckS, Math.pow(Math.sin(x), 1.5)) : mix(d.neckS, d.neckB, (x - PI / 2) / (PI / 2)); };
  // a point on the neck's own column, carried straight down below where the neck ends (a collar stands around it);
  // lie: where the shoulders are wider than the column, the cloth lies on them
  Body.prototype.neck = function (y, th, ease, lie) {
    const T = this.torso, yn = Math.max(y, this.nk); let r = T.rad(yn, th), cz = T.cz(yn);
    if (lie) { const rb = T.rad(y, th), w = smooth(-0.004, 0.004, rb - r); r = mix(r, rb, w); cz = mix(cz, T.cz(y), w); }
    return [Math.sin(th) * (r + (ease || 0)), y, cz + Math.cos(th) * (r + (ease || 0))];
  };
  // the height of the shoulder's ridge at the distance x from the middle
  Body.prototype.ridge = function (x) {
    let lo = this.d.sho - 0.03, hi = this.d.neck + 0.03;
    for (let i = 0; i < 22; i++) { const m = (lo + hi) / 2; if (this.torso.rad(m, PI / 2) > x) lo = m; else hi = m; }
    return (lo + hi) / 2;
  };
  // the way the body faces at a point (outwards)
  Body.prototype.normal = function (y, th, ease, hang) {
    const p = this.surf(y, th, ease, hang), a = this.surf(y, th + 0.03, ease, hang), b = this.surf(y + 0.006, th, ease, hang);
    return V.norm(V.cross(V.sub(a, p), V.sub(b, p)));
  };
  // the trunk as a string of balls: what it shades (the insides of the arms, a hand held before it)
  Body.prototype.balls = function (m) {
    const d = this.d, T = this.torso;
    for (let y = d.crotch + 0.03; y < d.neck; y += 0.07) m.balls.push([0, y, T.cz(y), Math.min(T.rad(y, PI / 2), (T.rad(y, 0) + T.rad(y, PI)) / 2) * 0.9, -1]);
  };
  // a height given as a number, or as [a landmark of the body, an offset]: ['hip', -0.03]
  const at = (B, v, dflt) => (v == null ? dflt : Array.isArray(v) ? B.d[v[0]] + v[1] : v);

  // a shell of cloth (or skin) over the body, from y0 up to y1 (numbers, or functions of the angle from the front);
  // open: a function of the height giving half the opening in front, in radians
  function shell(m, B, o) {
    const nu = o.nu || 30, nv = o.nv || 20, open = o.open, y0 = fnOf(o.y0), y1 = fnOf(o.y1), ease = fnOf(o.ease || 0);
    return m.patch(nu, nv, (u, v) => {
      let th = PI + u * TAU;
      if (open) { const al = open(mix(y0(0), y1(0), v), v); th = al + u * (TAU - 2 * al); }
      const a = wrapA(th), y = mix(y0(a), y1(a), v);
      let q = B.surf(y, th, ease(y, a, v), o.hang);
      if (o.mod) q = o.mod(q, a, v, y) || q;
      return q;
    }, { slot: o.slot, mat: o.mat, wrap: !open, uv: o.uv || ((u, v) => [u, v]), tint: o.tint, part: o.part });
  }
  // A piece of cloth that moves (atelier-cloth.js): a grid like a patch, but kept as its own small mesh (shaded by the
  // figure's balls). o.pin(u, v, point) says how firmly the body holds each point: 1 = it is on the body, 0 = free.
  function piece(m, nu, nv, fn, o) {
    const pm = new Mesh(); pm.balls = m.balls; pm.parts = 1e6; pm.rig = o.kind === 'hair' ? 3 : 0;
    // (drawn as nu + 1 columns even where it goes all the way round: the seam's points are there twice; the cloth itself has them once)
    pm.patch(nu, nv, fn, { slot: o.slot, mat: o.mat, uv: o.uv, tint: o.tint, flip: o.flip });
    const cols = o.wrap ? nu : nu + 1, rows = nv + 1, pin = new Float32Array(cols * rows);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const a = (j * (nu + 1) + i) * 3; pin[j * cols + i] = clamp(o.pin(i / nu, j / nv, [pm.p[a], pm.p[a + 1], pm.p[a + 2]]), 0, 1); }
    (m.pieces || (m.pieces = [])).push({ mesh: pm, cols, rows, wrap: !!o.wrap, flip: !!o.flip, pin, k: o.k || {}, hair: o.kind === 'hair' });
  }
  // a ribbon laid on the body along a path of [height, angle] points: straps, ties, lapels, collars, belts
  function ribbon(m, B, pts, o) {
    const n = o.n || 16, last = pts.length - 1, W = fnOf(o.w), E = fnOf(o.ease || 0.004), C = [];
    for (let j = 0; j <= n; j++) { const t = j / n, q = curve(pts, t * last); C.push({ p: B.surf(q[0], q[1], E(t), o.hang), out: B.normal(q[0], q[1], E(t), o.hang), y: q[0], t }); }
    return m.patch(o.nu || 2, n, (u, v) => {
      const j = Math.round(v * n), c = C[j], a = C[Math.max(0, j - 1)].p, b = C[Math.min(n, j + 1)].p;
      const dir = V.norm(V.sub(b, a)), out = c.out;
      const side = V.norm(V.cross(dir, out)), k = (u - 0.5) * W(c.t), crown = (o.crown || 0) * (1 - Math.abs(u - 0.5) * 2) + (o.liftEdge || 0) * (u - 0.5);
      return [c.p[0] + side[0] * k + out[0] * crown, c.p[1] + side[1] * k + out[1] * crown, c.p[2] + side[2] * k + out[2] * crown];
    }, { slot: o.slot, mat: o.mat, tint: o.tint ? () => o.tint : null });
  }

  /* ---------------- the skin that shows, the eyes, the hair ---------------- */
  // what of the body shows: show(region, x, y, z) for each point (regions: 0 head, 1 neck, 2 trunk, 3 / 4 upper arm
  // left / right, 5 / 6 forearm, 7 / 8 hand, 9 / 10 thigh, 11 / 12 shin, 13 / 14 foot). Then the eyelashes and the eyes.
  function skin(m, B, look, show) {
    const D = A.BODY, P = B.posed.P, reg = D.region, n = D.n, keep = new Uint8Array(n), H = B.H;
    for (let i = 0; i < n; i++) keep[i] = show(reg[i], P[i * 3], P[i * 3 + 1], P[i * 3 + 2]) ? 1 : 0;
    const fx = H.eye[0] / 0.41, ey = H.eye[1], my = H.mouth[0], face = H.man ? MAT.realM : MAT.real;
    const part = m.raw(P, D.tris, { keep, slot: SLOT.skin, mat: face, rig: (i) => (reg[i] <= 2 ? 3 : reg[i] <= 8 ? B.rigOf(reg[i] % 2 ? 1 : -1) : 0),
      // (across the face: 0 its middle, the eyes at .41; behind the middle of the head it runs on, growing fast: nothing
      // of a face is painted there, and nothing ends in a step)
      uv: (i) => { if (reg[i] > 1) return [9, -9]; const x = P[i * 3], z = P[i * 3 + 2]; return [z > H.zc ? x / fx : (x < 0 ? -1 : 1) * (Math.abs(x) + 2 * (H.zc - z)) / fx, 0.5 + 0.3 * (P[i * 3 + 1] - ey) / (ey - my)]; } });
    m.raw(P, D.ltris, { slot: SLOT.hair, mat: 1.2, rig: () => 3, uv: (i) => [P[i * 3] * 400, D.lashv[i - D.nb] / 255] });
    // a beard: layers of hair that stand off the face (the shader says which hairs reach each layer)
    if (H.man && (look.beard || 0) >= 0.6) {      // (a full beard; a stubble is the skin's own shade)
      const faceUV = (i) => { const x = P[i * 3], z = P[i * 3 + 2]; return [z > H.zc ? x / fx : (x < 0 ? -1 : 1) * (Math.abs(x) + 2 * (H.zc - z)) / fx, 0.5 + 0.3 * (P[i * 3 + 1] - ey) / (ey - my)]; };
      const w = new Float32Array(n), long = new Float32Array(n), nr = new Float32Array(n * 3), kp = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        if (reg[i] > 1 || !keep[i]) continue;
        const f = faceUV(i), ax = Math.abs(f[0]);
        w[i] = beardAt(f[0], f[1]) * (1 - (1 - smooth(0.80, 1.02, Math.hypot(f[0] / (0.31 * 1.06), (f[1] - 0.2 + 0.008) / 0.050))));
        long[i] = (0.62 + 0.38 * smooth(0.16, 0.06, f[1]) * smooth(0.55, 0.2, ax)) * (1 - 0.3 * smooth(0.22, 0.27, f[1]));      // longest on the chin, shorter over the lip
        kp[i] = w[i] > 0.02 ? 1 : 0;
      }
      // (which way is out: from the head's own triangles)
      const T = D.tris, c0 = [0, H.y0 + 0.5 * H.hh, H.zc];
      for (let k = 0; k < T.length; k += 3) {
        const a = T[k], b = T[k + 1], c = T[k + 2]; if (!(kp[a] || kp[b] || kp[c])) continue;
        const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2], vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        if (nx * (P[a * 3] - c0[0]) + ny * (P[a * 3 + 1] - c0[1]) + nz * (P[a * 3 + 2] - c0[2]) < 0) { nx = -nx; ny = -ny; nz = -nz; }
        for (const q of [a, b, c]) { nr[q * 3] += nx; nr[q * 3 + 1] += ny; nr[q * 3 + 2] += nz; }
      }
      const full = smooth(0.08, 1, look.beard), layers = 5, len = mix(0.0012, 0.0078, full);
      for (let L = 1; L <= layers; L++) {
        const lv = L / layers, Q = new Float32Array(P.length);
        for (let i = 0; i < n; i++) {
          if (!kp[i]) continue;
          const l = Math.hypot(nr[i * 3], nr[i * 3 + 1], nr[i * 3 + 2]) || 1, o = (0.0004 + len * lv * long[i] * (0.3 + 0.7 * w[i])) / l;
          Q[i * 3] = P[i * 3] + nr[i * 3] * o; Q[i * 3 + 1] = P[i * 3 + 1] + nr[i * 3 + 1] * o; Q[i * 3 + 2] = P[i * 3 + 2] + nr[i * 3 + 2] * o;
        }
        m.raw(Q, T, { keep: kp, slot: SLOT.hair, mat: 1.30 + 0.19 * lv, rig: () => 3, uv: faceUV });
      }
    }
    m.rig = 3;
    // the eyes: the front of a ball each; the shader paints the iris by the angle from where the eye looks
    for (const s of [-1, 1]) {
      const c = [s * H.eye[0], H.eye[1], H.eye[2]], r = H.eyeR * 0.985;
      m.patch(16, 8, (u, v) => { const g = v * 1.75, a = u * TAU; return [c[0] + r * Math.sin(g) * Math.cos(a), c[1] + r * Math.sin(g) * Math.sin(a), c[2] + r * Math.cos(g)]; },
        { wrap: true, flip: true, slot: SLOT.shirt, mat: MAT.eye, uv: (u, v) => [v * 1.75, u] });
    }
    m.rig = 0;
    B.balls(m);
    m.balls.push([0, H.y0 + H.hh * 0.5, H.zc, H.hw * 0.95, part]);
    return part;
  }
  /* ---------------- arms that are held ---------------- */
  // quaternions [x, y, z, w]
  const Q = {
    id: () => [0, 0, 0, 1],
    mul: (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]],
    axis: (ax, ang) => { const s = Math.sin(ang / 2); return [ax[0] * s, ax[1] * s, ax[2] * s, Math.cos(ang / 2)]; },
    rot: (q, v) => { const u = [q[0], q[1], q[2]], c = V.add(V.cross(u, v), V.mul(v, q[3])), d = V.cross(u, c); return [v[0] + 2 * d[0], v[1] + 2 * d[1], v[2] + 2 * d[2]]; },
    // the turn that takes the frame (x0, y0, x0 x y0) to (x1, y1, x1 x y1): both pairs at right angles, of length one
    frames: (x0, y0, x1, y1) => {
      const z0 = V.cross(x0, y0), z1 = V.cross(x1, y1), A0 = [x0, y0, z0], A1 = [x1, y1, z1], m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) m[i][j] += A1[k][i] * A0[k][j];
      const tr = m[0][0] + m[1][1] + m[2][2]; let q;
      if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q = [(m[2][1] - m[1][2]) / s, (m[0][2] - m[2][0]) / s, (m[1][0] - m[0][1]) / s, s / 4]; }
      else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) { const s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2; q = [s / 4, (m[0][1] + m[1][0]) / s, (m[0][2] + m[2][0]) / s, (m[2][1] - m[1][2]) / s]; }
      else if (m[1][1] > m[2][2]) { const s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2; q = [(m[0][1] + m[1][0]) / s, s / 4, (m[1][2] + m[2][1]) / s, (m[0][2] - m[2][0]) / s]; }
      else { const s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2; q = [(m[0][2] + m[2][0]) / s, (m[1][2] + m[2][1]) / s, s / 4, (m[1][0] - m[0][1]) / s]; }
      const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
    },
    slerp: (a, b, k) => {
      let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]; const sg = d < 0 ? -1 : 1; d = Math.min(1, Math.abs(d));
      if (d > 0.9995) { const o = [0, 0, 0, 0]; for (let i = 0; i < 4; i++) o[i] = a[i] + (sg * b[i] - a[i]) * k; const l = Math.hypot(o[0], o[1], o[2], o[3]) || 1; return o.map((v) => v / l); }
      const th = Math.acos(d), s = Math.sin(th), ka = Math.sin((1 - k) * th) / s, kb = sg * Math.sin(k * th) / s;
      return [a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb, a[3] * ka + b[3] * kb];
    },
  };
  A.Q = Q;
  // between two ways of holding an arm (k 0 .. 1)
  A.armMix = (a, b, k) => ({ qu: Q.slerp(a.qu, b.qu, k), qf: Q.slerp(a.qf, b.qf, k), qh: Q.slerp(a.qh, b.qh, k), tw: a.tw + (b.tw - a.tw) * k });
  const perp = (v, ax) => V.norm(V.sub(v, V.mul(ax, V.dot(v, ax))));
  Q.conj = (q) => [-q[0], -q[1], -q[2], q[3]];
  // how far a turn q goes round the direction ax (its twist about ax: radians, -PI .. PI)
  const twistOf = (q, ax) => { const a = 2 * Math.atan2(q[0] * ax[0] + q[1] * ax[1] + q[2] * ax[2], q[3]); return a > PI ? a - TAU : a < -PI ? a + TAU : a; };
  /* One arm (s: 1 the left, -1 the right) brought from where it hangs to a pose. o:
       W + pole: where the wrist goes and the way the elbow points (two bones, solved); or E + W: where the elbow goes
       (the wrist then as near W as the forearm reaches);
       point + palm: the way the hand points (from the wrist to the knuckles) and the way its palm faces: the hand is
       turned so; the forearm takes what it can of that turn about its own length, the wrist the rest, and never more
       than a wrist bends (o.bend: its limit, radians);
       or, the older way: palm alone (the forearm is turned until the palm faces so), flex (the wrist bent towards
       the palm), dev (the hand turned sideways in its own plane).
     -> { qu, qf, qh: the turns of the upper arm, the forearm and the hand; tw: the forearm's turn about itself; E, W } */
  function armPose(B, s, o) {
    const J = B.arm[s], S = J.S, L1 = V.len(V.sub(J.E, S)), L2 = V.len(V.sub(J.W, J.E));
    const u0 = V.norm(V.sub(J.E, S)), f0 = V.norm(V.sub(J.W, J.E));
    let h0 = V.cross(u0, f0); h0 = V.len(h0) > 0.02 ? V.norm(h0) : perp([s, 0, 0], u0);      // the elbow's own hinge, as the arm hangs
    let E, W;
    if (o.E) { E = V.add(S, V.mul(V.norm(V.sub(o.E, S)), L1)); W = V.add(E, V.mul(V.norm(V.sub(o.W, E)), L2)); }
    else {
      const D = V.sub(o.W, S), dist = V.len(D), dd = clamp(dist, Math.abs(L1 - L2) + 0.02, (L1 + L2) * 0.992), dir = V.mul(D, 1 / (dist || 1));
      const ca = clamp((L1 * L1 + dd * dd - L2 * L2) / (2 * L1 * dd), -1, 1), sa = Math.sqrt(1 - ca * ca), pl = perp(o.pole, dir);
      E = V.add(S, V.add(V.mul(dir, L1 * ca), V.mul(pl, L1 * sa))); W = V.add(S, V.mul(dir, dd));
    }
    const u1 = V.norm(V.sub(E, S)), f1 = V.norm(V.sub(W, E));
    const h1 = V.norm(V.cross(u1, f1)), hu0 = perp(h0, u0), hf0 = perp(h0, f0);
    const qu = Q.frames(u0, hu0, u1, perp(h1, u1)), qf = Q.frames(f0, hf0, f1, perp(h1, f1));
    const H = J.hand, pn0 = perp(H.palm, f0);                             // out of the palm, as the arm hangs
    let tw = 0, qh = qf, bent = 0;
    if (o.point) {
      const ha0 = V.norm(V.sub(H.mid0, J.W));
      let qT = Q.frames(ha0, perp(H.palm, ha0), V.norm(o.point), perp(o.palm, V.norm(o.point)));      // the hand's whole turn
      tw = clamp(twistOf(Q.mul(Q.conj(qf), qT), f0), -1.75, 1.75);
      const straight = Q.mul(qf, Q.axis(f0, tw)), bend = Math.acos(clamp(V.dot(Q.rot(qT, ha0), Q.rot(straight, ha0)), -1, 1)), most = o.bend || 1.05;
      if (bend > most) qT = Q.slerp(straight, qT, most / bend);
      bent = Math.min(bend, most);
      qh = Q.mul(qT, Q.axis(f0, -tw));
    } else {
      if (o.palm) { const n1 = perp(Q.rot(qf, pn0), f1), want = perp(o.palm, f1); tw = clamp(Math.atan2(V.dot(f1, V.cross(n1, want)), V.dot(n1, want)), -1.75, 1.75); }
      const tq = Q.axis(f0, tw);
      if (o.dev) qh = Q.mul(qh, Q.axis(Q.rot(tq, pn0), o.dev));
      if (o.flex) qh = Q.mul(qh, Q.axis(Q.rot(tq, V.norm(V.cross(f0, pn0))), o.flex));
    }
    return { qu, qf, qh, tw, E, W, bent };
  }
  // What an arm is made of, for the question "does it lie in something?": balls on the upper arm near the elbow (u),
  // along the forearm (f) and on the hand (h), as the arm hangs. sl: how thick what is worn on the arm is.
  function armBalls(B, s, sl) {
    const J = B.arm[s], H = J.hand, d = B.d, o = [];
    o.push(['u', V.mix(J.S, J.E, 0.72), d.armUp[1] + sl]);
    for (let k = 0; k <= 4; k++) o.push(['f', V.mix(J.E, J.W, k / 4), mix(d.armLo[0], d.armLo[1], k / 4) + sl * (k < 4 ? 1 : 0.5)]);
    // (the fourth number: how much the ball counts when the hand is laid on something: the palm most)
    o.push(['h', V.mix(J.W, H.mid0, 0.5), 0.015, 5], ['h', V.mix(J.W, H.mid0, 0.92), 0.013, 3]);
    H.kn.forEach((q) => o.push(['h', q, 0.010, 1])); H.pip.forEach((q) => o.push(['h', q, 0.008, 0.6])); H.mid.forEach((q) => o.push(['h', q, 0.006, 0.6])); H.tip.forEach((q) => o.push(['h', q, 0.003, 1]));      // (cloth gives a little under the ends of the fingers)
    H.thumb.forEach((q, i) => o.push(['h', q, i < 2 ? 0.0105 : 0.0085, i < 2 ? 0 : 0.4]));
    return o;
  }
  // where those balls are when the arm is in the pose po
  function armAt(B, s, balls, po) {
    const J = B.arm[s], f0 = V.norm(V.sub(J.W, J.E)), E1 = V.add(J.S, Q.rot(po.qu, V.sub(J.E, J.S))), W1 = V.add(E1, Q.rot(po.qf, V.sub(J.W, J.E))), tq = Q.axis(f0, po.tw);
    return balls.map(([part, p, r, w]) => [part, part === 'u' ? V.add(J.S, Q.rot(po.qu, V.sub(p, J.S))) : part === 'f' ? V.add(E1, Q.rot(po.qf, V.sub(p, J.E))) : V.add(W1, Q.rot(po.qh, Q.rot(tq, V.sub(p, J.W)))), r, w]);
  }
  /* The poses a figure's arms can take, on its own body, each placed so that the arm and the hand lie IN nothing (not
     in the trunk, not in what is worn on it, not in the other arm) and the hand lies ON what it is laid on: the pose
     is moved off until all is clear, then the hand is leaned and the elbow swung to where the palm, the knuckles and
     the fingers' ends stand off least. A pose is worked out when it is first asked for (some milliseconds each).
       o.thick: how far what it wears on its trunk stands off it; o.sleeve: how thick what is on its arms is;
       o.give: how far a forearm in a sleeve may press into what is worn on the trunk (cloth on cloth);
       o.hem, o.under: the height where what is worn over the trunk ends, and how thick what is under it is;
       o.hang: the height below which what it wears hangs straight down (a jacket, a cardigan: 0 = nothing does);
       o.flare: how fast a skirt stands off the body below the waist (metres a metre); o.lady;
       o.clasp: how far above the hips the wrists of folded hands are (metres)
     -> { name: { 1: the left arm's pose, -1: the right's } }, and pathOf(s, from, to): the way an arm goes from one
     named pose to another (a function of k, 0 .. 1) without passing through the body. "rest" is the arm as it hangs. */
  function gestures(B, o) {
    const d = B.d, T = B.torso, thick = o.thick, lady = o.lady, S1 = B.arm[1].S, sx = Math.abs(S1[0]);
    const balls = { 1: armBalls(B, 1, o.sleeve), [-1]: armBalls(B, -1, o.sleeve) };
    const rs = d.armLo[0] + o.sleeve;                                     // a forearm with what is on it
    const give = o.give || 0;                                             // how far a forearm may press into what is worn on the trunk
    const on = (y, a, off) => { const r = T.rad(y, a) + off; return [Math.sin(a) * r, y, T.cz(y) + Math.cos(a) * r]; };
    const yLow = T.t.y0 + 0.002;
    // how deep a ball lies in the trunk and what is worn on it (metres; below nought: clear of it)
    const inBody = (c, r) => {
      const y = c[1]; if (y > d.neck + 0.02 || y < d.crotch - 0.04) return -1;
      const below = o.hem && y < o.hem - 0.012;                           // (below what is worn over the trunk: the trunk itself, and what is on the legs)
      const yq = Math.max(!below && o.hang && y < o.hang ? o.hang : y, yLow), cz = T.cz(yq), ang = Math.atan2(c[0], c[2] - cz);
      const th = o.hem ? mix(o.under == null ? thick : o.under, thick, smooth(o.hem - 0.012, o.hem + 0.012, y)) : thick;
      return T.rad(yq, ang) + th + (o.flare || 0) * Math.max(0, d.waist - 0.02 - y) + r - Math.hypot(c[0], c[2] - cz);
    };
    const deepest = (at, other, touch) => {
      let worst = -1; const tc = touch || 0;
      for (let i = 0; i < at.length; i++) {
        const b = at[i], part = b[0]; if (part === 'u') continue;
        const c = b[1], r = b[2], pen = inBody(c, r) - (part === 'f' ? give : 0); if (pen > worst) worst = pen;      // (a forearm may press a little into what is worn)
        if (other) for (let k = 0; k < other.length; k++) {
          const q = other[k], c2 = q[1], dx = c[0] - c2[0], dy = c[1] - c2[1], dz = c[2] - c2[2], lim = r + q[2] - worst; if (lim <= 0) continue;
          const d2 = dx * dx + dy * dy + dz * dz; if (d2 >= lim * lim) continue;
          const p2 = r + q[2] - Math.sqrt(d2) - (part === 'h' || q[0] === 'h' ? tc : 0); if (p2 > worst) worst = p2;
        }
      }
      return worst;
    };
    // a hand leaned: the way it points and the way its palm faces turned by `al` about the line across the palm (its
    // fingers towards what the palm faces) and by `be` about the hand's own length (its thumb's side towards it)
    const lean = (q, al, be) => {
      if (!q.point || (!al && !be)) return q;
      const p = V.norm(q.point), n = perp(q.palm, p), ca = Math.cos(al), sa = Math.sin(al);
      const p2 = V.add(V.mul(p, ca), V.mul(n, sa)), n2 = V.sub(V.mul(n, ca), V.mul(p, sa)), c2 = V.cross(p2, n2);
      return Object.assign({}, q, { point: p2, palm: V.add(V.mul(n2, Math.cos(be)), V.mul(c2, Math.sin(be))) });
    };
    // how far a hand is from LYING on something: the squares of how far its palm, its knuckles and its fingers' ends
    // stand off the nearest thing (the trunk and what is worn; the other arm), each for what it counts
    const standOff = (at, other) => {
      let sum = 0;
      for (let i = 0; i < at.length; i++) {
        const b = at[i], w = b[3]; if (b[0] !== 'h' || !w) continue;
        const c = b[1], r = b[2]; let gap = Math.min(0.06, -inBody(c, r));
        if (other) for (let k = 0; k < other.length; k++) { const q = other[k], c2 = q[1], dx = c[0] - c2[0], dy = c[1] - c2[1], dz = c[2] - c2[2], g = Math.sqrt(dx * dx + dy * dy + dz * dz) - r - q[2]; if (g < gap) gap = g; }
        if (gap > 0) sum += w * gap * gap;
      }
      return sum;
    };
    // the pose mk(out), with `out` grown until the arm lies in nothing (other: the other arm's balls where IT is;
    // touch: how far a hand may sink into what it rests on); seat: the hand is then leaned to where it lies best
    const solve = (s, mk, other, touch, seat) => {
      const S0 = B.arm[s].S, swing = !!mk(0).pole, sr = (seat && seat.swing) || [-0.4, 1.3];      // (how far the elbow may be swung back and forward)
      const swung = (q, sw) => (sw && q.pole ? Object.assign({}, q, { pole: Q.rot(Q.axis(V.norm(V.sub(q.W, S0)), s * sw), q.pole) }) : q);
      // (al, be: the hand's lean; sw: the elbow swung about the line from the shoulder to the wrist)
      const fit = (al, be, sw) => {
        let out = 0, po = null;
        for (let it = 0; it < 12; it++) {
          po = armPose(B, s, swung(lean(mk(out), al, be), sw)); po.at = armAt(B, s, balls[s], po);
          const w = deepest(po.at, other, touch); if (w < 0.0015) break; out += w + (it < 4 ? 0.0006 : 0.003);
        }
        po.out = out; po.lean = [al, be, sw]; po.cost = standOff(po.at, other) + 3e-5 * (al * al + be * be) + 1.5e-5 * sw * sw + 2e-5 * po.bent * po.bent;
        return po;
      };
      let best = fit(0, 0, 0);
      if (seat) {
        const tryAt = (al, be, sw) => { const po = fit(al, be, sw); if (po.cost < best.cost - 1e-7) best = po; };
        // a first look round (the hand's lean each way, the elbow swung forward), then from the best of that nearer and nearer
        for (const sw of swing ? [0, 0.5, 1.0].filter((v) => v <= sr[1]) : [0]) for (const al of [-0.35, 0, 0.35]) for (const be of [-0.3, 0, 0.3]) if (al || be || sw) tryAt(al, be, sw);
        const steps = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]].concat(swing ? [[0, 0, 1], [0, 0, -1]] : []);
        for (const st of [0.18, 0.09, 0.045]) for (let pass = 0; pass < 2; pass++) {
          const b0 = best.lean, was = best;
          for (const [da, db, ds] of steps) tryAt(clamp(b0[0] + da * st, -0.8, 0.8), clamp(b0[1] + db * st, -0.8, 0.8), clamp(b0[2] + ds * st * 1.4, sr[0], sr[1]));
          if (best === was) break;
        }
      }
      // (the same, a little way off what it lies on: where an arm that comes to lie on the other arrives from, and leaves to)
      best.off = armPose(B, s, swung(lean(mk(best.out + 0.04), best.lean[0], best.lean[1]), best.lean[2]));
      return best;
    };
    const both = (f) => ({ 1: f(1), [-1]: f(-1) });
    // (a pose is worked out when it is first asked for: lazyArm: each arm by itself; lazyPair: the two arms together)
    const lazyArm = (mk) => { const q = {}, c = {}; [1, -1].forEach((s) => Object.defineProperty(q, s, { enumerable: true, get: () => c[s] || (c[s] = mk(s)) })); return q; };
    const lazyPair = (mk) => { const q = {}; let c = null; [1, -1].forEach((s) => Object.defineProperty(q, s, { enumerable: true, get: () => (c || (c = mk()))[s] })); return q; };
    const restOf = (s) => ({ qu: Q.id(), qf: Q.id(), qh: Q.id(), tw: 0, at: balls[s] });
    const G = { rest: { 1: restOf(1), [-1]: restOf(-1) } };
    const yE = S1[1] - d.upper * 0.93;                                    // the elbows' height when the upper arms hang
    const handLen = V.len(V.sub(B.arm[1].hand.tip[1], B.arm[1].W));
    // hands folded in front, low: the left hand lies on the belly, pointing down and to the right; the right hand lies
    // on its back, pointing down and to the left: its palm on the left hand's, its fingers over the left hand's edge
    const yc = d.hip + (o.clasp == null ? 0.075 : o.clasp);
    G.clasp = lazyPair(() => { const dn = 0.70, L = solve(1, (out) => ({ W: on(yc, 0.22, thick + 0.012 + out), pole: [1, -0.1, -0.6], point: [-dn, -dn, -0.08], palm: [0.1, 0.15, -1] }), null, 0, true);
      const Lc = L.at.filter((b) => b[0] === 'h')[0][1];                  // (the middle of the left hand)
      const R = solve(-1, (out) => ({ W: [Lc[0] - 0.047 * dn, Lc[1] + 0.047 * dn + 0.004, Lc[2] + 0.026 + out], pole: [-1, -0.1, -0.6], point: [dn, -dn, -0.08], palm: [-0.1, 0.15, -1] }), L.at, 0.004, true);
      return { 1: L, [-1]: R }; });
    // a hand on the hip: the heel of the hand on the side of the hip below the waist, the fingers forward and down over
    // the front of the hip, the elbow out and a little back
    { const yh = mix(d.waist, d.hip, 0.36), ah = 1.42, dn = 0.62;
      G.hip = lazyArm((s) => solve(s, (out) => ({ W: on(yh, s * 1.74, thick + 0.012 + out), pole: [s * 0.95, 0.05, -0.75],
        point: [-s * Math.cos(ah) * Math.cos(dn), -Math.sin(dn), Math.sin(ah) * Math.cos(dn)], palm: [-s * Math.sin(ah), 0, -Math.cos(ah)], bend: 1.25 }), null, 0, { swing: [-0.35, 0.2] })); }
    // a forearm laid across the body at the height hy: the elbow comes forward of where it hangs and a little out; the
    // hand lies along the body towards the other side. reach: how far past the middle the wrist goes
    const zf = (y, x) => T.cz(y) + Math.sqrt(Math.max(0, Math.pow(T.rad(y, Math.atan2(x, 0.1)), 2) - x * x));      // (about how far forward the trunk reaches at (x, y))
    const across = (s, hy, reach, drop) => (out) => {
      const z = Math.max(zf(hy, 0), zf(hy, 0.08), zf(hy, -0.08)) + thick + rs + out;
      return { E: [s * (sx + 0.036), hy - 0.006, z - 0.060], W: [-s * reach, hy, z], point: [-s, drop, -0.30], palm: [s * 0.15, 0.1, -1], bend: 0.9 };
    };
    // one forearm across the waist (its hand on the other side of the waist)
    G.cross = lazyArm((s) => solve(s, across(s, lady ? d.waist + 0.005 : d.waist + 0.03, 0.02, -0.12), null, 0, true));
    // arms folded: the right forearm across the body under the chest, its hand's ends short of the left arm; the left
    // forearm on it, its hand on the right forearm
    G.fold = lazyPair(() => { const yFold = yE + (lady ? 0.046 : 0.042), inner = sx - d.armUp[1] - 0.012;      // (the inside of the other upper arm)
      const R = solve(-1, across(-1, yFold, Math.max(-0.03, inner - handLen * 0.93), -0.05), null, 0, true);
      const L = solve(1, across(1, yFold + 0.040, 0.035, -0.22), R.at, 0.003, true);
      return { 1: L, [-1]: R }; });
    // a loose arm, a little forward and out: what an arm passes near on its way from one held pose to another; and a wider one
    G.loose = both((s) => armPose(B, s, { W: V.add(B.arm[s].W, [s * 0.06, 0.085, 0.12]), pole: [s * 0.6, 0, -1], palm: [-s, 0, 0.3] }));
    const wide = both((s) => armPose(B, s, { W: V.add(B.arm[s].W, [s * 0.13, 0.15, 0.24]), pole: [s * 0.9, 0, -0.8], palm: [-s, 0, 0.3] }));
    // The way an arm goes from one named pose to another: straight if that is clear of the body all the way, else in a
    // curve by the loose arm, else by the wider one (whichever passes least deep). What was found is kept.
    const ways = {}, TOP = { fold: 1, clasp: -1 };                        // (which arm lies on top in a pose of both arms)
    const curve = (a, c, b) => (k) => A.armMix(A.armMix(a, c, k), A.armMix(c, b, k), k);
    const depth = (s, fn) => { let w = -1; for (let k = 0.1; k < 0.95; k += 0.1) { const pen = deepest(armAt(B, s, balls[s], fn(k))); if (pen > w) w = pen; } return w; };
    G.pathOf = (s, an, bn, front) => {      // (front: by the wider way, forwards, if that is clear: for an arm that comes to lie on the other, or leaves it)
      const key = s + an + '>' + bn + (front ? '^' : ''); if (ways[key]) return ways[key];
      const a = (G[an] || G.rest)[s], b = (G[bn] || G.rest)[s];
      // (an arm that comes to lie on the other arrives from straight off it; one that leaves it lifts straight off first)
      const land = (fn, off) => (k) => (k < 0.78 ? fn(k / 0.78) : A.armMix(off, b, (k - 0.78) / 0.22));      // (over to just off it, then down onto it)
      const lift = (fn, off) => (k) => (k < 0.22 ? A.armMix(a, off, k / 0.22) : fn((k - 0.22) / 0.78));      // (up off it, then away)
      const cand = front ? (b.off && TOP[bn] === s ? [land(curve(a, wide[s], b.off), b.off), land(curve(a, G.loose[s], b.off), b.off)] : a.off && TOP[an] === s ? [lift(curve(a.off, wide[s], b), a.off), lift(curve(a.off, G.loose[s], b), a.off)] : []).concat([curve(a, wide[s], b), curve(a, G.loose[s], b), (k) => A.armMix(a, b, k)])
        : [(k) => A.armMix(a, b, k), curve(a, G.loose[s], b), curve(a, wide[s], b)];
      let best = cand[0], bw = 1e9;
      for (const fn of cand) { const w = depth(s, fn); if (w < bw) { bw = w; best = fn; } if (w < 0.004) break; }
      return (ways[key] = best);
    };
    G.d = d; G.inBody = inBody;                                          // (for the tests: its measures; how deep a ball lies in it)
    G.depthOf = (s, name) => deepest((G[name] || G.rest)[s].at || []);      // (for the tests: how deep a pose lies in the body; below nought: clear)
    G.wayDepth = (s, an, bn) => depth(s, G.pathOf(s, an, bn));                 // (and how deep the way from one pose to another passes)
    // How both arms go from one pair of poses to another: each by its own way; when both move, the arm that will lie
    // on top (arms folded: the left; hands folded: the right) sets out later and comes in from the front, and the arm
    // that lay on top leaves first. -> { path: [left, right] (null: that arm stays), lag: [left, right] (how much later
    // each sets out, as a share of the way's length) }
    G.planOf = (aL, aR, bL, bR) => {
      const mv = [aL !== bL, aR !== bR], lag = [0, 0], front = [false, false];
      if (mv[0] && mv[1]) {
        const into = bL === bR && TOP[bL] ? TOP[bL] : 0, outOf = aL === aR && TOP[aL] ? TOP[aL] : 0;
        if (into) { const i = into > 0 ? 0 : 1; lag[i] = 0.45; front[i] = true; }
        else if (outOf) { const i = outOf > 0 ? 0 : 1; lag[1 - i] = 0.35; front[i] = true; }
        else lag[Math.random() < 0.5 ? 0 : 1] = 0.14;
      }
      return { path: [mv[0] ? G.pathOf(1, aL, bL, front[0]) : null, mv[1] ? G.pathOf(-1, aR, bR, front[1]) : null], lag };
    };
    // (for the tests: how deep the two arms pass into each other on such a way)
    G.armsDepth = (aL, aR, bL, bR) => {
      const pl = G.planOf(aL, aR, bL, bR), e = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2); let w = -1;
      const pL = pl.path[0] || (() => (G[aL] || G.rest)[1]), pR = pl.path[1] || (() => (G[aR] || G.rest)[-1]);
      for (let u = 0.04; u < 0.97 + Math.max(pl.lag[0], pl.lag[1]); u += 0.04) {
        const L = armAt(B, 1, balls[1], pL(e(clamp(u - pl.lag[0], 0, 1)))), R = armAt(B, -1, balls[-1], pR(e(clamp(u - pl.lag[1], 0, 1))));
        for (const [, c, r] of L) for (const [, c2, r2] of R) { const pen = r + r2 - V.len(V.sub(c, c2)); if (pen > w) w = pen; }
      }
      return w;
    };
    return G;
  }
  // where a beard grows on a face (0 .. 1), by the face's own co-ordinates: the shader's beardAt, line for line
  const beardAt = (x, y) => {
    const ax = Math.abs(x), cl = 0.250 + 0.250 * Math.pow(smooth(0.38, 0.98, ax), 2.1);
    let g = smooth(cl + 0.035, cl - 0.035, y);
    g = Math.max(g, smooth(0.328, 0.298, y) * (1 - smooth(0.36, 0.47, ax)) * (0.72 + 0.28 * smooth(0, 0.05, ax)));
    g *= smooth(-0.105, -0.025, y) * smooth(1.25, 0.95, ax);
    g *= 1 - smooth(0.98, 1.06, ax) * smooth(0.27, 0.33, y);
    g *= 1 - 0.30 * smooth(0.16, 0.24, ax) * (1 - smooth(0.30, 0.40, ax)) * smooth(0.075, 0.105, y) * (1 - smooth(0.135, 0.165, y));
    return g;
  };
  // a point on the skull at the height t (0 the chin .. 1 the crown) and the angle th, lifted off it by `puff`
  const skullSurf = (B) => (t, th, puff, back) => {
    const H = B.H, y = H.y0 + clamp(t, 0, 1) * H.hh, r = B.skull.rad(y, th) * (1 + puff) + puff * H.hw * 0.5 * smooth(0.8, 0.93, t) * (1 - smooth(0.93, 1, t));
    return [Math.sin(th) * r, y + puff * H.hh * 0.35 * smooth(0.75, 1, t), B.skull.cz(y) - (back || 0) + Math.cos(th) * r];
  };
  const keyed = (keys) => (a) => { const x = Math.abs(a); for (let i = 1; i < keys.length; i++) if (x <= keys[i][0]) return mix(keys[i - 1][1], keys[i][1], smooth(keys[i - 1][0], keys[i][0], x)); return keys[keys.length - 1][1]; };
  // clear: how far off the body long hair lies below the neck (what is worn there is so thick)
  function hair(m, B, style, clear) {
    const d = B.d, H = B.H, hs = skullSurf(B), { y0, hh, hw, hd, zc } = H, o = { slot: SLOT.hair, mat: MAT.hair };
    const man = d.sex === 'm';
    // the hairline, as a height on the head by the angle from the front: over the brow, round the temple, over the
    // ear, down to the nape
    const line = keyed(man ? [[0, 0.80], [0.6, 0.77], [1.1, 0.64], [1.5, 0.64], [1.85, 0.58], [2.2, 0.30], [PI, 0.16]] : [[0, 0.80], [0.6, 0.76], [1.1, 0.62], [1.5, 0.60], [1.85, 0.48], [2.2, 0.22], [PI, 0.08]]);
    // the cap of hair: from the hairline up over the crown
    const cap = (puff, c) => m.patch(34, 12, (u, v) => {
      const th = PI + u * TAU, a = wrapA(th), l0 = c && c.line ? c.line(a) : line(a), t = mix(l0, c && c.top ? Math.max(l0, c.top) : 1, v);
      return hs(t, th, puff(a, t, v), 0.004);
    }, Object.assign({ wrap: true, uv: (u, v) => [u, Math.max(0.05, 1 - v * 2.6)] }, o, c && c.tint ? { tint: () => c.tint } : null));
    if (style === 'crop' || style === 'grey') cap((a, t, v) => 0.07 + 0.07 * smooth(0.55, 1, t) + 0.07 * Math.exp(-a * a / 0.7) * smooth(0.0, 0.4, v) * (1 - smooth(0.85, 1, v)) + 0.012 * Math.sin(a * 9 + t * 7));
    // a buzz cut: close to the skull
    else if (style === 'buzz') cap((a, t) => 0.036 + 0.012 * smooth(0.6, 1, t), { tint: 1.12 });
    // a quiff: short at the sides, standing up over the brow
    else if (style === 'quiff') cap((a, t, v) => 0.062 + 0.07 * smooth(0.55, 1, t) + 0.21 * Math.exp(-a * a / 0.32) * smooth(0, 0.3, v) * (1 - smooth(0.55, 1, v)) + 0.01 * Math.sin(a * 8 + t * 6));
    // swept back: longer on top and behind
    else if (style === 'swept') cap((a, t, v) => 0.105 + 0.075 * smooth(0.5, 1, t) + 0.05 * Math.exp(-a * a / 1.2) * smooth(0, 0.4, v) + 0.016 * Math.sin(a * 6 + t * 9), { line: keyed([[0, 0.81], [0.6, 0.78], [1.1, 0.64], [1.5, 0.62], [1.85, 0.52], [2.2, 0.24], [PI, 0.10]]) });
    // thinning: hair at the sides and behind, the crown bare
    else if (style === 'thin') cap((a, t) => 0.05 + 0.02 * Math.sin(a * 7 + t * 5), { line: keyed([[0, 0.99], [0.95, 0.96], [1.25, 0.74], [1.6, 0.62], [1.9, 0.56], [2.2, 0.30], [PI, 0.16]]), top: 0.84 });
    else if (style === 'side') cap((a, t, v) => 0.075 + 0.08 * smooth(0.55, 1, t) + 0.12 * Math.exp(-(a - 0.35) * (a - 0.35) / 0.5) * smooth(0, 0.4, v) * (1 - smooth(0.85, 1, v)) + 0.02 * Math.sin(a * 2) + 0.01 * Math.sin(a * 8 + t * 6));
    else if (style === 'bun') {
      cap((a, t, v) => 0.075 + 0.055 * smooth(0.5, 1, t) + 0.035 * Math.exp(-a * a / 0.9) * smooth(0, 0.4, v) + 0.008 * Math.sin(a * 11 + t * 9));
      m.egg([0, y0 + 0.70 * hh, zc - hd * 1.03], [0.050, 0.046, 0.050], Object.assign({ nu: 16, nv: 12, uv: (u) => [u * 3, 0.4] }, o));
    } else {
      // long, a bob or a ponytail: the cap, then hair falling behind the shoulders and beside the face
      const end = style === 'bob' ? d.chin - 0.035 : style === 'pony' ? d.chin + 0.02 : d.sho - (style === 'wavy' ? 0.16 : 0.11);
      const wav = style === 'wavy' ? 0.05 : 0.02;
      cap((a, t, v) => 0.085 + 0.055 * smooth(0.5, 1, t) + 0.04 * Math.exp(-a * a / 0.8) * smooth(0, 0.4, v) + 0.008 * Math.sin(a * 11 + t * 9));
      if (style === 'bob') {
        // a bob: cut at the jaw, short enough to go with the head: fuller towards the jaw, turned in at its ends,
        // open round the face
        const y2 = d.chin - 0.006;
        m.patch(40, 12, (u, v) => {
          const a0 = mix(0.92, 0.70, smooth(0.0, 0.5, v)), th = a0 + u * (TAU - 2 * a0), c = Math.cos(th);
          const top = hs(0.80, th, 0.134, 0.004);                      // (it starts on the cap of hair itself: no ledge under the crown)
          const full = 1.25 - 0.13 * smooth(0.70, 1, v) + 0.006 * Math.sin(th * 9 + v * 5), k = smooth(0, 0.45, v);
          const y = mix(top[1], y2, v) + 0.004 * Math.sin(th * 7) * smooth(0.8, 1, v) - 0.010 * smooth(0.6, 1, v) * Math.max(0, -c);      // (a little longer behind)
          return [mix(top[0], Math.sin(th) * hw * full, k), y, mix(top[2], zc - 0.010 - 0.014 * v + c * hd * full * (c > 0 ? 0.90 : 1.04), k)];
        }, Object.assign({ flip: true, uv: (u, v) => [u, v * 0.86] }, o));
      } else if (style !== 'pony') {
        const y1 = y0 + 0.76 * hh, front = 1.02;
        piece(m, 36, 20, (u, v) => {
          const th = front + u * (TAU - 2 * front), s = v, y = mix(y1, end, s);
          const spread = style === 'bob' ? 0.10 : smooth(0.38, 0.9, s);
          const off = style === 'bob' ? 0 : Math.max(0, (clear || 0.011) - 0.011) * smooth(d.neck + 0.05, d.neck - 0.03, y);      // (long hair, below the neck: outside what is worn)
          const rx = hw * (1.06 + 0.23 * smooth(0.03, 0.45, s)) + (style === 'bob' ? 0.012 * s : (d.shoX * 0.80 - hw * 1.29) * spread) + off;
          const rz = hd * (1.06 + 0.13 * smooth(0.03, 0.45, s)) + (style === 'bob' ? 0 : (0.105 - hd * 1.19) * spread) + off;
          const k = 1 + wav * Math.sin(th * 8 + s * 13) * smooth(0.25, 0.7, s) - 0.5 * smooth(0.9, 1, s) * 0.12;
          const cz = zc - 0.012 - 0.035 * s;
          // (no hair through the shoulders: behind the neck it hangs behind them)
          const back = Math.cos(th) < 0 ? 1 : 1 - 0.25 * smooth(0.5, 1, s);
          // a lock on each side comes forward over the shoulder as it falls
          const lock = style === 'bob' ? 0 : 0.05 * smooth(0.45, 0.95, s) * Math.exp(-Math.pow((Math.abs(wrapA(th)) - 1.25) / 0.3, 2));
          return [Math.sin(th) * rx * k * back, y, cz + lock + Math.cos(th) * rz * k * (Math.cos(th) > 0 ? 0.92 : 1.1)];
        }, Object.assign({ flip: true, kind: 'hair', uv: (u, v) => [u, v], pin: (u, v) => 1 - smooth(0.14, 0.34, v),
          k: { shear: 0.9, bend: 0.5, damp: 0.05, wind: 0.4, thick: clear || 0.011, iter: 4, drag: 0.5, turn: 3.2 } }, o));
      } else {
        m.tube([[0, y0 + 0.74 * hh, zc - hd * 1.0, 0.032], [0, y0 + 0.62 * hh, zc - hd * 1.42, 0.030], [0, d.chin - 0.03, zc - hd * 1.5, 0.026], [0.006, d.sho - 0.07, zc - hd * 1.30, 0.012]], Object.assign({ nu: 12, sub: 5, round0: true, round1: true, uv: (u, v) => [u * 2, v] }, o));
      }
    }
  }

  /* ---------------- limbs ---------------- */
  // Where a garment's shoulder ends and its sleeve is set in: at `out` beyond the arm's joint. The garment's shell is
  // cut off there (the body's own shoulder runs on to a thin ridge), and the sleeve's head is a ball of radius r
  // whose crown passes just over the shell's last point. ease: the shell's ease at the shoulders.
  const shoulderOf = (B, ease, out, r) => { const x = Math.abs(B.arm[1].S[0]) + out, y = B.ridge(x - ease) + ease * 0.7; return { x, r, y: y - r + 0.004 }; };
  // a sleeve along the arm (the arm itself is the body's): to the wrist, rolled to the elbow (.5) or short (.22)
  function arm(m, B, side, pose, o) {
    o = o || {};
    const d = B.d, J = B.arm[side], e = o.ease || 0, u = d.armUp, l = d.armLo, len = o.len == null ? 1 : o.len;
    if (len <= 0) return J;
    m.rig = B.rigOf(side);
    // (head: a jacket's sleeve begins as wide as the shoulder it is set into)
    const top = o.head ? [side * (o.head.x - 0.012), o.head.y, J.S[2], o.head.r] : [J.S[0] - side * 0.012, J.S[1] - 0.012, J.S[2], u[0] * 0.80 + e * 0.6];
    const mid = [...V.mix(J.S, J.E, 0.5), mix(u[0], u[1], 0.45) + e], elb = [J.E[0], J.E[1], J.E[2], u[1] + e + 0.003];
    const opt = { slot: o.slot, mat: o.mat, nu: 14, sub: 4, round0: true };
    if (len >= 1) m.tube([top, mid, elb, [...V.mix(J.E, J.W, 0.5), mix(l[0], l[1], 0.45) + e], [...V.mix(J.E, J.W, 0.955), l[1] + e + 0.005]], opt);
    else if (len >= 0.5) m.tube([top, mid, [elb[0], elb[1], elb[2], elb[3] + 0.006], [...V.mix(J.E, J.W, 0.12), l[0] + e + 0.014]], opt);
    else {
      const p1 = [...V.mix(J.S, J.E, len * 1.1), mix(u[0], u[1], len) + e], p2 = [...V.mix(J.S, J.E, len * 2.2), mix(u[0], u[1], len * 2) + e + 0.002];
      m.tube([top, p1, p2], opt);
      // a short sleeve's hem: a narrow band, turned up
      m.tube([[...V.mix(J.S, J.E, len * 2.2 - 0.07), p2[3] + 0.0012], [p2[0], p2[1], p2[2], p2[3] + 0.0016]], { slot: o.slot, mat: o.mat, nu: 14, sub: 2, ball: false, tint: () => 0.95 });
    }
    if (o.cuff != null && len >= 1) m.tube([[...V.mix(J.E, J.W, 0.925), l[1] + e * 0.6 + 0.003], [...V.mix(J.E, J.W, 0.995), l[1] + e * 0.6 + 0.004]], { slot: o.cuff, mat: MAT.cloth, nu: 14, sub: 2, ball: false });
    // the seam where the sleeve is set in: a fine dark line round the arm near its top
    if (o.seam && len >= 0.3) {
      const at2 = (k) => [mix(top[0], mid[0], k), mix(top[1], mid[1], k), mix(top[2], mid[2], k), mix(top[3], mid[3], k) + 0.0012];
      m.tube([at2(0.055), at2(0.078)], { slot: o.slot, mat: o.mat, nu: 14, sub: 1, ball: false, tint: () => 0.76 });
    }
    // a cuff: a shirt's, with its seam and its button; a jumper's ribbed band
    if (o.band && len >= 1) {
      const rc = l[1] + e + 0.0060, band = (k0, k1, dr, tint) => m.tube([[...V.mix(J.E, J.W, k0), rc + dr], [...V.mix(J.E, J.W, k1), rc + dr + 0.0004]], { slot: o.slot, mat: o.mat, nu: 14, sub: 2, ball: false, tint: () => tint });
      if (o.band === 'rib') band(0.885, 0.958, -0.0004, 0.88); else if (o.cuff == null) band(0.895, 0.958, 0, 0.96);
      band(o.band === 'rib' ? 0.879 : 0.889, o.band === 'rib' ? 0.886 : 0.896, 0.0008, 0.66);
      if (o.band === 'cuff') { const ax = V.norm(V.sub(J.W, J.E)), out = V.norm(V.sub([side, 0, 0.25], V.mul(ax, V.dot([side, 0, 0.25], ax)))), c = V.mix(J.E, J.W, 0.93);
        m.egg([c[0] + out[0] * (rc + 0.0012), c[1] + out[1] * (rc + 0.0012), c[2] + out[2] * (rc + 0.0012)], [0.0042, 0.0042, 0.0042], { slot: o.slot, mat: MAT.leather, tint: () => 0.80, nu: 6, nv: 4, ball: false }); }
    }
    if (o.buttons && len >= 1) {
      // a jacket's sleeve buttons: three in a row above the cuff, at the back of the arm
      const ax = V.norm(V.sub(J.W, J.E)), back = V.norm(V.sub([side * 0.35, 0, -1], V.mul(ax, V.dot([side * 0.35, 0, -1], ax))));
      for (const k of [0.905, 0.928, 0.951]) { const c = V.mix(J.E, J.W, k), r = l[1] + e + 0.006; m.egg([c[0] + back[0] * r, c[1] + back[1] * r, c[2] + back[2] * r], [0.0048, 0.0048, 0.0048], { slot: o.slot, mat: MAT.leather, tint: () => 0.5, nu: 6, nv: 4, ball: false }); }
    }
    m.rig = 0;
    return J;
  }
  // the outline of a slice (radii at even angles round a point inside it) as cloth drawn tight round it has it
  const hullRadii = (U) => {
    const n = U.length, P = [], H = [], R = new Float32Array(n); let start = 0;
    for (let i = 0; i < n; i++) { const th = i / n * TAU; P.push([Math.sin(th) * U[i], Math.cos(th) * U[i]]); if (U[i] > U[start]) start = i; }
    for (let k = 0; k <= n; k++) {
      const c = P[(start + k) % n];
      while (H.length >= 2) { const a = P[H[H.length - 2] % n], b = P[H[H.length - 1] % n]; if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) >= 0) H.pop(); else break; }
      H.push(start + k);
    }
    for (let e = 0; e + 1 < H.length; e++) {
      const a = P[H[e] % n], b = P[H[e + 1] % n], ex = b[0] - a[0], ez = b[1] - a[1], num = a[0] * ez - a[1] * ex;
      for (let k = H[e]; k <= H[e + 1]; k++) { const i = k % n, th = i / n * TAU, den = Math.sin(th) * ez - Math.cos(th) * ex; R[i] = Math.max(U[i], Math.abs(den) > 1e-9 ? num / den : U[i]); }
    }
    return R;
  };
  // where a pair of shorts ends (o.short: true, or a height as [a landmark, an offset])
  const shortHem = (B, v) => at(B, v === true ? null : v, B.d.knee + 0.10);
  // The cut of a pair of trousers over this body: the two legs' rings from the hips down, and the seat's outline
  // (by height and angle) from where the legs part up to the waistband. Kept on the body (B.under), so that what
  // hangs over the hips can clear it.
  function cutTrousers(B, o) {
    const d = B.d, e = o.ease || 0.012, w = o.wide || 0, es = Math.min(e, 0.009), czh = B.torso.cz(d.hip), path = {};
    const short = o.short ? shortHem(B, o.short) : 0;
    for (const s of [-1, 1]) {
      const L = B.leg[s], hx = s * (d.hipX + e * 0.7) / 2, r2 = mix(d.thigh[0], d.thigh[1], 0.5) + e + w * 0.5 + 0.004, rk = d.thigh[1] + e + w + 0.004;
      const rc = Math.max(mix(d.calf[0], d.calf[1], 0.4) + e + w + 0.004, (d.thigh[1] + e + w) * 0.92), ra = Math.max(d.calf[1] + e + w + 0.012, (d.thigh[1] + e + w) * 0.86);
      // a leg's path: its first ring is inside the seat, its second is where the leg is itself; then the thigh, the knee, the calf, the hem
      path[s] = [[hx, d.hip - 0.005, czh - 0.004, Math.abs(hx) - 0.012, d.hipZ * 0.74 + e * 0.6], [mix(hx, L.K[0], 0.22), d.crotch + 0.045, mix(czh, L.K[2], 0.2), d.hipX * 0.5 + e * 0.7, d.thigh[0] + e + 0.012],
        [...V.mix(L.H, L.K, 0.55), r2, r2], [L.K[0], L.K[1], L.K[2], rk, rk], [...V.mix(L.K, L.A, 0.5), rc, rc], [L.A[0], at(B, o.hem, d.ankle + 0.012), L.A[2] + 0.004, ra, ra]];
      // shorts: the leg ends above the knee, a little wider than the thigh in it
      // (the thigh's flesh lies in front of the line between its joints: the leg of a pair of shorts goes round the flesh itself)
      if (short) {
        const tt = clamp((L.H[1] - short) / (L.H[1] - L.K[1]), 0.62, 0.97), th = legCaps(B, s)[0];
        const on = (u) => { const k = clamp((u - 0.30) / 0.67, 0, 1), r = mix(th[6], th[7], k) + e - 0.002; return [mix(th[0], th[3], k), mix(th[1], th[4], k), mix(th[2], th[5], k), r, r]; };
        path[s] = [path[s][0], path[s][1], on(0.55), on(tt)];
      }
    }
    // a leg's ring at the height y (on the very curve the leg is drawn along), from the hips to the middle of the thigh
    const memo = { '-1': new Map(), 1: new Map() };
    const ringAt = (s, y) => {
      const M = memo[s]; let c = M.get(y); if (c) return c;
      const P = path[s]; let lo = 0, hi = 2;
      for (let i = 0; i < 22; i++) { const m = (lo + hi) / 2; if (curve(P, m)[1] > y) lo = m; else hi = m; }
      c = curve(P, (lo + hi) / 2); if (M.size < 400) M.set(y, c);
      return c;
    };
    // how far the legs reach from the trunk's middle at the height y, towards th (0: no leg that way)
    const reach = (y, th) => {
      const oz = B.torso.cz(Math.max(y, B.torso.t.y0)), dx = Math.sin(th), dz = Math.cos(th); let far = 0;
      for (const s of [-1, 1]) {
        const c = ringAt(s, y), px = -c[0] / c[3], pz = (oz - c[2]) / c[4], qx = dx / c[3], qz = dz / c[4], qq = qx * qx + qz * qz, pq = px * qx + pz * qz, disc = pq * pq - qq * (px * px + pz * pz - 1);
        if (disc > 0) far = Math.max(far, (-pq + Math.sqrt(disc)) / qq);
      }
      return far;
    };
    const NA = 96, NV = 18, y0 = d.crotch + 0.014, y1 = at(B, o.top, d.belt + 0.015), rows = [];
    for (let j = 0; j <= NV; j++) {
      const y = mix(y0, y1, j / NV), legs = y < d.hip + 0.014, U = new Float32Array(NA), G = new Float32Array(NA);
      const gap = mix(0.0025, 0.007, smooth(d.crotch + 0.06, d.hip - 0.02, y));      // (well clear of the legs' tops, which are hidden)
      const k2 = smooth(d.hip - 0.01, d.crotch + 0.055, y), kh = smooth(d.hip + 0.04, d.hip - 0.02, y), dip = smooth(d.crotch + 0.06, y0, y);
      for (let i = 0; i < NA; i++) {
        const th = i / NA * TAU, tb = B.torso.rad(y, th) + es, lg = legs ? reach(y, th) : 0;
        G[i] = lg; U[i] = legs ? Math.max(lg + gap, mix(tb, lg > 0 ? lg + gap : tb - 0.02, k2)) : tb;
      }
      const Hh = kh > 0 ? hullRadii(U) : U, R = new Float32Array(NA);
      // (at its foot the seat lies ON the legs, a hair outside them, and between them it turns in)
      for (let i = 0; i < NA; i++) R[i] = mix(mix(U[i], Hh[i], kh), G[i] > 0 ? G[i] + 0.0012 : U[i] - 0.004, dip);
      rows.push(R);
    }
    const seat = (y, th) => {
      const fj = clamp((y - y0) / (y1 - y0), 0, 1) * NV, j = Math.min(NV - 1, Math.floor(fj)), fi = ((th % TAU) + TAU) % TAU / TAU * NA, i = Math.floor(fi) % NA, i2 = (i + 1) % NA, g = fi - Math.floor(fi);
      return mix(mix(rows[j][i], rows[j][i2], g), mix(rows[j + 1][i], rows[j + 1][i2], g), fj - j);
    };
    return { path, short, reach, seat, y0, y1, NV, es, under: (y, th) => (y >= y1 ? 0 : y >= y0 + 0.03 ? seat(y, th) : Math.max(reach(y, th), y >= y0 ? seat(y, th) : 0)) };
  }
  // trousers: the seat, a leg each; `wide` opens the leg, `hem` is where it ends
  function trousers(m, B, o, C) {
    const d = B.d, e = o.ease || 0.012, part = m.parts++;          // one part: the waist and the legs cast no shade on each other
    C = C || cutTrousers(B, o);
    shell(m, B, { y0: C.y0, y1: C.y1, ease: C.es, slot: o.slot, mat: o.mat, nv: C.NV, nu: 48, part,
      mod: (q, a, v, y) => { const cz = B.torso.cz(y), r = C.seat(y, a); q[0] = Math.sin(a) * r; q[2] = cz + Math.cos(a) * r; return q; } });
    for (const s of [-1, 1]) {
      m.tube(C.path[s], { slot: o.slot, mat: o.mat === MAT.denim && !C.short ? 6.55 : o.mat, nu: 24, sub: 4, part,      // (denim legs: 6.55 = top-stitched)
        tint: o.mat === MAT.denim ? (u) => 1 - 0.16 * Math.exp(-Math.pow((((u + 0.5) % 1) - 0.5) / 0.012, 2)) - 0.16 * Math.exp(-Math.pow((u - 0.5) / 0.012, 2))
          : (u, v) => 1 - 0.10 * Math.exp(-Math.pow((u - 0.25) / 0.014, 2)) * smooth(0.12, 0.3, v) + 0.07 * Math.exp(-Math.pow((u - 0.275) / 0.014, 2)) * smooth(0.12, 0.3, v) });
    }
    // shorts: a turned-up hem
    if (C.short) for (const s of [-1, 1]) { const P = C.path[s], a = P[P.length - 2], b = P[P.length - 1], k = 0.82; m.tube([[mix(a[0], b[0], k), mix(a[1], b[1], k), mix(a[2], b[2], k), b[3] + 0.0016], [b[0], b[1] - 0.001, b[2], b[3] + 0.0022]], { slot: o.slot, mat: o.mat, nu: 24, sub: 2, ball: false, part, tint: () => 0.92 }); }
    // seams, as fine dark lines on the seat: a slant pocket at each side, the fly, two welts behind; without a belt a waistband and its button
    const onSeat = (y, th, r) => { const cz = B.torso.cz(Math.max(y, B.torso.t.y0)), rr = C.seat(y, th) + 0.0011; return [Math.sin(th) * rr, y, cz + Math.cos(th) * rr, r]; };
    const jean = o.mat === MAT.denim;                                     // (jeans: their seams in gold thread)
    const seam = (pts, r) => m.tube(pts.map((q) => onSeat(q[0], q[1], r || (jean ? 0.0016 : 0.0013))), { slot: jean ? SLOT.gold : o.slot, mat: jean ? MAT.cloth : o.mat, nu: 5, sub: 4, ball: false, part, tint: () => (jean ? 0.86 : 0.55) });
    const wt = C.y1 - 0.034;                                             // (under the waistband, or the belt)
    if (o.seams !== false) for (const s of [-1, 1]) { seam([[wt, s * 0.74], [wt - 0.045, s * 1.08], [wt - 0.10, s * 1.36]]); seam([[wt - 0.045, s * (PI - 0.60)], [wt - 0.047, s * (PI - 0.20)]]); }
    if (o.seams !== false) seam([[wt + 0.004, 0.045], [Math.max(wt - 0.11, d.hip + 0.014), 0.036]]);
    if (o.belt == null && o.seams !== false) {
      ribbon(m, B, [[C.y1 - 0.015, 0.02], [C.y1 - 0.015, PI * 0.5], [C.y1 - 0.015, PI], [C.y1 - 0.015, PI * 1.5], [C.y1 - 0.015, TAU - 0.02]], { w: 0.030, ease: C.es + 0.0018, slot: o.slot, mat: o.mat, tint: 0.93, n: 40 });
      m.egg(B.surf(C.y1 - 0.015, 0.02, C.es + 0.0014), [0.0065, 0.0065, 0.0012], { slot: o.slot, mat: MAT.metal, tint: () => 0.8, nu: 8, nv: 5, ball: false });
    }
    // between the legs, where they meet
    m.egg([0, d.crotch + 0.075, B.torso.cz(d.hip) - 0.012], [d.hipX * 0.34, 0.085, d.hipZ * 0.66 + e * 0.5], { slot: o.slot, mat: o.mat, nu: 12, nv: 8, part, ball: false });
    if (o.belt != null) {
      const by = d.belt + 0.002, be = C.es + 0.0028;
      ribbon(m, B, [[by, 0.02], [by, PI * 0.5], [by, PI], [by, PI * 1.5], [by, TAU - 0.02]], { w: 0.030, ease: be, slot: o.belt, mat: MAT.leather, n: 40 });
      for (const a of [0.62, -0.62, 1.95, -1.95, PI]) ribbon(m, B, [[by - 0.019, a], [by + 0.019, a]], { w: 0.010, ease: be + 0.0022, slot: o.slot, mat: o.mat, tint: 0.94, n: 3 });
      // the buckle: a frame of metal, its prong across it, and the belt's end through the first loop
      const R = Math.max(B.torso.rad(by, 0), 0.06), hw = 0.019 / R, hh = 0.0185, fr = (a, y) => [...B.surf(by + y, a, be + 0.0032), 0.0023];
      m.tube([fr(-hw, -hh), fr(0, -hh), fr(hw, -hh), fr(hw * 1.06, 0), fr(hw, hh), fr(0, hh), fr(-hw, hh), fr(-hw * 1.06, 0), fr(-hw, -hh)], { slot: SLOT.extra, mat: MAT.metal, tint: () => 0.86, nu: 6, sub: 3, ball: false });
      m.tube([[...B.surf(by, -hw, be + 0.0042), 0.0016], [...B.surf(by, hw * 0.9, be + 0.0046), 0.0014]], { slot: SLOT.extra, mat: MAT.metal, tint: () => 0.86, nu: 5, sub: 1, ball: false });
      ribbon(m, B, [[by, 0.0], [by, 0.34]], { w: 0.027, ease: be + 0.0018, slot: o.belt, mat: MAT.leather, tint: 0.92, n: 5 });
    }
  }
  /* ---------------- shoes ----------------
     Built on the floor after the figure has been lifted onto its heels. A shoe is one skin over stations from the
     heel's back to the toe: at each a rounded box (flat below, round above) of a width and a height, open above where
     the foot goes in, its sole's edge darker. A closed shoe's stations come from a last; a pump's or a flat's are
     measured on the lady's own posed foot, which shows. */
  // st: [[z, x, a (half its width), y0 (its underside), y1 (its top), open (0 = closed over the top, else the angle from the top where the rim is)], ...]
  function shoeSkin(m, st, o) {
    const n = st.length - 1, at = (v) => curve(st, clamp(v, 0, 1) * n), et = 2 / (o.round || 2.4), eb = 2 / (o.boxy || 8);
    m.patch(o.nu || 20, n * (o.sub || 2), (u, v) => {
      const q = at(v), a = Math.max(q[2], 0.0006), b = Math.max((q[4] - q[3]) / 2, 0.0006), ph = Math.max(q[5], 0) + u * (TAU - 2 * Math.max(q[5], 0)), s = Math.sin(ph), c = Math.cos(ph), e = c < 0 ? eb : et;
      return [q[1] + a * Math.sign(s) * Math.pow(Math.abs(s), e), q[3] + b + b * Math.sign(c) * Math.pow(Math.abs(c), e), q[0]];
    }, { slot: o.slot, mat: o.mat, flip: true, tint: o.tint });
    return at;
  }
  // a shoe's sole: a thin slab under its stations, a little proud of the upper (thick: a number, or a function of how far along)
  const shoeSole = (m, st, thick, o) => shoeSkin(m, st.map((q, i) => { const th = typeof thick === 'function' ? thick(i / (st.length - 1)) : thick; return [q[0], q[1], q[2] + 0.0018, q[3] - 0.0006, q[3] + th, 0]; }), Object.assign({ round: 6, boxy: 8, sub: 1 }, o));
  // the angle from the top at which a rounded box of half height b, centred at yc, is as high as y
  const rimAngle = (y, yc, b) => { const k = clamp((y - yc) / b, -1, 1); return Math.acos(k >= 0 ? Math.pow(k, 1.2) : -Math.pow(-k, 4)); };
  // a posed foot (side s), measured in slices from its heel to its toes: [z, x0, x1, y0, y1] each, already lifted
  function footSlices(B, s, lift, N) {
    const D = A.BODY, P = B.posed.P, reg = D.region, r0 = s > 0 ? 13 : 14, ids = []; let z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < D.n; i++) if (reg[i] === r0) { ids.push(i); const z = P[i * 3 + 2]; if (z < z0) z0 = z; if (z > z1) z1 = z; }
    const bins = []; for (let k = 0; k < N; k++) bins.push([1e9, -1e9, 1e9, -1e9]);
    ids.forEach((i) => { const k = Math.min(N - 1, Math.floor((P[i * 3 + 2] - z0) / (z1 - z0) * N)), b = bins[k], x = P[i * 3], y = P[i * 3 + 1] + lift; if (x < b[0]) b[0] = x; if (x > b[1]) b[1] = x; if (y < b[2]) b[2] = y; if (y > b[3]) b[3] = y; });
    for (let k = 1; k < N; k++) if (bins[k][0] > bins[k][1]) bins[k] = bins[k - 1].slice();
    for (let k = N - 2; k >= 0; k--) if (bins[k][0] > bins[k][1]) bins[k] = bins[k + 1].slice();
    // (each slice also holds what its neighbours hold: nothing of the foot is outside the shoe between two slices)
    const wide = bins.map((b, k) => { const p = bins[Math.max(0, k - 1)], q = bins[Math.min(N - 1, k + 1)]; return [z0 + (k + 0.5) / N * (z1 - z0), Math.min(b[0], p[0], q[0]), Math.max(b[1], p[1], q[1]), Math.min(b[2], p[2], q[2]), Math.max(b[3], p[3], q[3])]; });
    // ... and they are evened out along the foot (a shoe's lines are smooth)
    return wide.map((b, k) => { const p = wide[Math.max(0, k - 1)], q = wide[Math.min(N - 1, k + 1)]; return [b[0], (p[1] + 2 * b[1] + q[1]) / 4, (p[2] + 2 * b[2] + q[2]) / 4, (p[3] + 2 * b[3] + q[3]) / 4, (p[4] + 2 * b[4] + q[4]) / 4]; });
  }
  // lasts: [how far along (0 the heel's back .. 1 the toe), half the width (of the last's widest), the upper's height (m)]
  const LAST = {
    oxford: { len: 1.07, wide: 0.104, sole: 0.009, heel: 0.022, waist: 0.011, toe: 0.80, pts: [[0, 0.20, 0.046], [0.04, 0.50, 0.058], [0.14, 0.63, 0.074], [0.30, 0.69, 0.084], [0.46, 0.80, 0.070], [0.62, 0.98, 0.052], [0.74, 1.0, 0.043], [0.86, 0.86, 0.036], [0.95, 0.56, 0.030], [1.0, 0.10, 0.020]] },
    boot: { len: 1.05, wide: 0.100, sole: 0.010, heel: 0.022, waist: 0.010, toe: 0, pts: [[0, 0.22, 0.060], [0.04, 0.54, 0.078], [0.14, 0.66, 0.100], [0.30, 0.72, 0.110], [0.46, 0.82, 0.078], [0.62, 0.98, 0.058], [0.74, 1.0, 0.048], [0.86, 0.88, 0.041], [0.95, 0.60, 0.034], [1.0, 0.12, 0.022]] },
    loafer: { len: 1.05, wide: 0.102, sole: 0.007, heel: 0.016, waist: 0.008, toe: 0, pts: [[0, 0.20, 0.040], [0.04, 0.50, 0.050], [0.14, 0.63, 0.058], [0.30, 0.69, 0.060], [0.46, 0.80, 0.054], [0.62, 0.98, 0.046], [0.74, 1.0, 0.040], [0.86, 0.88, 0.034], [0.95, 0.58, 0.028], [1.0, 0.10, 0.018]] },
    sneaker: { len: 1.06, wide: 0.100, sole: 0.024, heel: 0, waist: 0, toe: 0, pts: [[0, 0.30, 0.060], [0.04, 0.62, 0.074], [0.14, 0.74, 0.088], [0.30, 0.80, 0.092], [0.46, 0.88, 0.078], [0.62, 1.0, 0.064], [0.76, 1.0, 0.055], [0.88, 0.90, 0.048], [0.96, 0.66, 0.042], [1.0, 0.16, 0.030]] },
  };
  function shoes(m, B, o, lift) {
    const d = B.d, kind = o.kind, man = d.sex === 'm', skin = B.H.man ? MAT.realM : MAT.real;
    for (const s of [-1, 1]) {
      const Aj = B.leg[s].A, x = Aj[0];
      if (B.bare) {
        // a pump or a flat, round the lady's own foot: a cup for the heel, low sides, the toes covered
        const sl = footSlices(B, s, lift, 22), N = sl.length, pump = kind === 'heel', gap = 0.0065, ts = B.sole, st = [];
        const z0 = sl[0][0] - 0.5 * (sl[1][0] - sl[0][0]), z1 = sl[N - 1][0] + 0.5 * (sl[1][0] - sl[0][0]);
        sl.forEach((b, k) => {
          const t = (k + 0.5) / N, y0 = b[3] - ts;
          // how high the shoe's edge stands above its sole here, and where it closes over the toes
          const rim = pump ? mix(mix(0.056, 0.027, smooth(0.04, 0.26, t)), 0.030, smooth(0.40, 0.60, t)) : mix(mix(0.040, 0.021, smooth(0.04, 0.24, t)), 0.024, smooth(0.45, 0.66, t));
          const shut = smooth(pump ? 0.58 : 0.66, pump ? 0.70 : 0.76, t);
          // (where it is open the shoe's own box is twice as tall as its edge, so the edge runs along its widest line; over the toes it is as tall as the foot)
          const y1 = mix(y0 + 2 * rim, b[4] + gap, shut), yc = (y0 + y1) / 2, hb = (y1 - y0) / 2;
          st.push([b[0], (b[1] + b[2]) / 2, (b[2] - b[1]) / 2 + gap, y0, y1, Math.sqrt(1 - shut * shut) * rimAngle(y0 + rim, yc, hb)]);      // (the throat's end is round, not a point)
        });
        // (the skin ends in a point behind the heel and before the toes)
        const f = st[0], l = st[N - 1];
        // (the skin closes in a line behind the heel, and in a point before the toes)
        st.unshift([z0 - 0.002, f[1], f[2] * 0.72, f[3] + 0.001, f[4], f[5]]); st.unshift([z0 - 0.0065, f[1], f[2] * 0.36, f[3] + 0.002, f[4], f[5]]); st.unshift([z0 - 0.008, f[1], 0.0008, f[3] + 0.004, f[4], f[5]]);
        st.push([z1 + 0.005, l[1], l[2] * 0.62, l[3], l[4] - 0.003, 0]); st.push([z1 + 0.011, l[1], 0.0008, l[3] + 0.002, l[3] + 0.014, 0]);
        shoeSkin(m, st, { slot: SLOT.shoe, mat: MAT.leather, nu: 24, sub: 3 });
        shoeSole(m, st, ts + 0.003, { slot: SLOT.shoe, mat: MAT.leather, nu: 20, tint: () => 0.5 });
        if (pump) {
          // a block heel under the heel (kinder than a stiletto on the lawn), and a strap round the ankle with its buckle
          const hz = sl[1][0] + 0.004, hy = sl[2][3] - ts + 0.004, hx = (sl[1][1] + sl[1][2]) / 2;
          m.loft([{ y: 0.0005, x: hx, z: hz - 0.004, rx: 0.019, rz: 0.021, n: 4 }, { y: hy * 0.5, x: hx, z: hz - 0.003, rx: 0.020, rz: 0.022, n: 4 }, { y: hy, x: hx, z: hz, rx: 0.024, rz: 0.026, n: 4 }], { slot: SLOT.shoe, mat: MAT.leather, nu: 16, sub: 2, ball: false, tint: () => 0.8 });
          const ay = Aj[1] + lift + 0.036, ar = d.calf[1] + 0.006, ring = [];
          for (let i = 0; i <= 14; i++) { const a = i / 14 * TAU; ring.push([x + Math.sin(a) * ar, ay + 0.004 * Math.cos(a), Aj[2] - 0.004 + Math.cos(a) * ar * 1.12, 0.0034]); }
          m.tube(ring, { slot: SLOT.shoe, mat: MAT.leather, nu: 6, sub: 2, ball: false });
          m.egg([x + s * (ar + 0.002), ay, Aj[2] - 0.004], [0.004, 0.0055, 0.0055], { slot: SLOT.extra, mat: MAT.metal, tint: () => 0.9, nu: 6, nv: 4, ball: false });
        }
        continue;
      }
      // a closed shoe, from its last
      const Lk = LAST[kind === 'boot' ? 'boot' : kind === 'sneaker' ? 'sneaker' : kind === 'loafer' ? 'loafer' : 'oxford'], len = d.foot * Lk.len, z0 = Aj[2] - 0.066, wide = Lk.wide * (man ? 1 : 0.86) / 2, hh = Math.max(Lk.heel, kind === 'sneaker' ? 0 : lift), st = [];
      const P = Lk.pts, lastAt = (t) => { let i = 0; while (i < P.length - 2 && t > P[i + 1][0]) i++; const k = clamp((t - P[i][0]) / (P[i + 1][0] - P[i][0]), 0, 1); return [mix(P[i][1], P[i + 1][1], k), mix(P[i][2], P[i + 1][2], k)]; };
      for (let k = 0; k <= 26; k++) {
        const t = k / 26, q = lastAt(t);
        // its underside: the heel on the floor, the waist between heel and ball off it, the toe a little sprung
        const under = Lk.heel ? hh * (1 - smooth(0.25, 0.62, t)) + 0.004 * smooth(0.86, 1, t) : 0.003 * smooth(0.86, 1, t);      // (on its heel's block behind, down to the floor at the ball)
        st.push([z0 + t * len, x + s * 0.004 * smooth(0.5, 1, t), wide * q[0], under, under + q[1] * (man ? 1 : 0.92), 0]);
      }
      { const f = st[0], l = st[st.length - 1]; st.unshift([f[0] - 0.004, f[1], 0.0008, f[3] + 0.012, f[3] + 0.03, 0]); st.push([l[0] + 0.004, l[1], 0.0008, l[3] + 0.003, l[3] + 0.009, 0]); }      // (it ends in a point behind and before)
      const leather = kind === 'sneaker' ? MAT.cloth : MAT.leather;
      const at = shoeSkin(m, st, { slot: SLOT.shoe, mat: leather, nu: 22, sub: 1, boxy: 5 });
      // its sole (a sneaker's is thick and pale), a little proud of the upper
      shoeSole(m, st, Lk.sole, { slot: SLOT.shoe, mat: leather, nu: 20, tint: () => (kind === 'sneaker' ? 0.9 : 0.4) });
      // the heel's block shows as a step under the shoe (leather shoes)
      if (Lk.heel) m.loft([{ y: 0.0005, x, z: z0 + len * 0.14, rx: wide * 0.66, rz: len * 0.135, n: 4 }, { y: hh + 0.002, x, z: z0 + len * 0.14, rx: wide * 0.70, rz: len * 0.14, n: 4 }], { slot: SLOT.shoe, mat: MAT.leather, nu: 16, sub: 1, ball: false, tint: () => 0.36 });
      // across a point of the shoe's top at `v` along it: a seam, a lace
      const across = (v, half, r, slot, tint, up) => { const q = at(v), b = (q[4] - q[3]) / 2, pts = []; for (let i = 0; i <= 8; i++) { const ph = (i / 8 - 0.5) * 2 * half, sn = Math.sin(ph), c = Math.cos(ph); pts.push([q[1] + q[2] * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / 2.4), q[3] + b + b * Math.pow(c, 2 / 2.4) + (up || 0.0008), q[0], r]); } m.tube(pts, { slot, mat: leather, nu: 5, sub: 2, ball: false, tint: () => tint }); };
      if (kind === 'sneaker') {
        for (const v of [0.40, 0.47, 0.54, 0.61]) across(v, 0.42, 0.0022, SLOT.shirt, 1.0, 0.0012);                  // laces
        across(0.86, 1.25, 0.0030, SLOT.shoe, 0.9);                                                                  // the toe's bumper
      } else if (kind === 'loafer') {
        across(0.50, 1.05, 0.0032, SLOT.shoe, 0.74, 0.0006); across(0.66, 1.2, 0.0012, SLOT.shoe, 0.5);                 // the strap across it, the apron's seam
      } else if (kind !== 'boot' || man) {
        if (Lk.toe) across(Lk.toe, 1.3, 0.0013, SLOT.shoe, 0.45);                                                     // the toe cap's seam
        for (const v of [0.42, 0.48, 0.54]) across(v, 0.36, 0.0016, SLOT.shoe, 0.5, 0.001);                           // laces
      }
      // bare ankles (shorts): the leg runs on into the shoe
      if (o.ankle) m.tube([[Aj[0], Aj[1] + lift + 0.035, Aj[2], d.calf[1] + 0.002], [Aj[0], Aj[1] + lift - 0.012, Aj[2] + 0.004, d.calf[1] + 0.004], [Aj[0], hh + 0.022, Aj[2] + 0.012, d.calf[1] + 0.006]], { slot: SLOT.skin, mat: skin, uv: () => [9, -9], nu: 12, sub: 2, ball: false });
      if (kind === 'boot') {
        // an ankle boot's shaft, from the foot up over the ankle (a trouser leg hides most of a man's)
        const top = lift + d.ankle + (man ? 0.07 : 0.10), r = d.calf[1] + 0.010;
        m.tube([[x, hh + 0.035, z0 + 0.085, wide * 0.62, 0.052], [x, hh + 0.085, z0 + 0.072, r + 0.007, r + 0.017], [x, lift + d.ankle + 0.045, z0 + 0.066, r + 0.006, r + 0.009]].concat(o.bare ? [[x, top - 0.02, z0 + 0.062, r + 0.011, r + 0.014], [x, top, z0 + 0.061, r + 0.013, r + 0.016]] : [[x, top, z0 + 0.064, r + 0.007, r + 0.009]]), { slot: SLOT.shoe, mat: MAT.leather, nu: 14, sub: 3, ball: false });
      }
    }
  }
  // a small free ribbon through three points in space (a shoe's strap)
  function ribbonFree(m, P, w, slot, mat) {
    m.patch(1, 8, (u, v) => { const q = curve(P, v * (P.length - 1)); return [q[0], q[1] + (u - 0.5) * w * 0.4, q[2] + (u - 0.5) * w]; }, { slot, mat });
  }

  /* ---------------- clothes ---------------- */
  // a skirt from the waist to its hem: it follows the hips, then flares to `flare` [half-width, half-depth] in folds
  function skirt(m, B, o) {
    const d = B.d, k = o.folds || 9, ph = o.phase || 0.7, amp = o.amp == null ? 0.05 : o.amp;
    const tier = o.tiers || 0, hz = B.torso.cz(d.hip), ease = (y) => mix(0.008, 0.0055, smooth(d.hip + 0.02, o.y1, y));
    // (on the body down to the hips, where the body holds it; below, free cloth: a piece that moves)
    piece(m, o.nu || 56, o.nv || 32, (u, v) => {
      const th = PI + u * TAU, y = mix(o.y0, o.y1, v);
      if (y >= d.hip) return B.surf(y, th, ease(y));
      const s = Math.pow((d.hip - y) / (d.hip - o.y0), o.pow || 1);
      // from the body's own outline at the hips to the hem's oval
      const h = B.surf(d.hip, th, 0.008), cz = mix(hz, hz + (o.back || -0.004), s), r = [0, y, cz];
      const q = [mix(h[0], Math.sin(th) * o.flare[0], s), y, mix(h[2], cz + Math.cos(th) * o.flare[1], s)];
      let g = 1 + amp * Math.pow(s, 1.2) * (0.62 * Math.sin(k * th + ph + s * 1.4) + 0.38 * Math.sin((k + 4) * th * 1.31 + ph * 3.1));
      if (tier) g += 0.035 * Math.pow(Math.abs(Math.sin(s * PI * tier)), 0.5) * (s > 0.08 ? 1 : 0);          // gathered tiers
      q[0] *= g; q[2] = (q[2] - r[2]) * g + r[2];
      q[1] += (o.wave == null ? 0.006 : o.wave) * Math.sin(k * th + ph) * s * s;
      return q;
    }, { slot: o.slot, mat: o.mat, wrap: true, uv: (u, v) => [u, v], pin: (u, v, q) => smooth(d.hip - 0.12, d.hip - 0.005, q[1]), k: o.k });
    m.balls.push([0, Math.max(o.y0, 0.2) + 0.12, 0, Math.min(o.flare[0], o.flare[1]) * 0.9, -2]);
  }
  // A strap over the shoulder: from the bodice's edge in front (the height y0 at the angle a0) straight up, over the
  // shoulder at the distance x from the middle, and down the back to (y1, a1). It lies on the body across its whole
  // width (each edge has its own way over the shoulder's slope).
  function strap(m, B, s, o) {
    const T = B.torso, e = o.ease || 0.005, n = o.n || 26;
    const xf = Math.sin(o.a0) * T.rad(o.y0, s * o.a0), xb = Math.sin(o.a1) * T.rad(o.y1, s * o.a1);
    // the angle at which the body's outline at the height y is the distance x from the middle (in front, or behind)
    const angle = (y, x, back) => { let lo = back ? PI : 0, hi = PI / 2; for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (Math.sin(mid) * T.rad(y, s * mid) < x) lo = mid; else hi = mid; } return (lo + hi) / 2; };
    m.patch(2, n, (u, v) => {
      const back = v >= 0.5, f = back ? (1 - v) * 2 : v * 2;                                  // f: 0 at the bodice .. 1 on the shoulder
      const x = Math.max(0.012, mix(back ? xb : xf, o.x, Math.pow(f, 0.8)) + (u - 0.5) * o.w), yt = B.ridge(x) - 0.0005;
      const y = Math.min(mix(back ? o.y1 : o.y0, yt, Math.sin(f * PI / 2)), yt);
      return B.surf(y, s * angle(y, x, back), e + 0.008 * smooth(0.05, 0.4, f));
    }, { slot: o.slot, mat: o.mat, flip: s < 0 });
  }
  // necklines, as heights by the angle from the front
  const neckline = (cut, d) => ({
    slip: (a) => { const x = Math.abs(a); return x < 1.1 ? d.bust + 0.036 + 0.026 * (x / 1.1) * (x / 1.1) : mix(d.bust + 0.062, d.under + 0.06, smooth(1.1, 2.5, x)); },
    aline: (a) => { const x = Math.abs(a); return x < 0.95 ? d.bust + 0.052 : mix(d.bust + 0.052, d.bust + 0.01, smooth(0.95, 2.4, x)); },
    vneck: (a) => { const x = Math.abs(a); return x < 0.62 ? mix(d.bust - 0.045, d.pit + 0.035, Math.pow(x / 0.62, 1.15)) : mix(d.pit + 0.035, d.bust + 0.03, smooth(0.62, 2.4, x)); },
    day: (a) => { const x = Math.abs(a); return x < 0.6 ? mix(d.pit - 0.005, d.pit + 0.045, Math.pow(x / 0.6, 2)) : mix(d.pit + 0.045, d.bust + 0.035, smooth(0.9, 2.3, x)); },
  }[cut] || neckline('aline', d));
  const hemOf = (w, d, lift) => (w.len === 'floor' ? 0.030 - (lift || 0) : w.len === 'tea' ? d.knee - 0.14 : w.len === 'midi' ? d.knee - 0.20 : d.knee + 0.02);
  // a dress: the bodice up to its neckline, straps, the skirt (the shoulders, arms and legs are the body's own)
  function dress(m, B, o) {
    const d = B.d, slot = SLOT.main, mat = folds(MAT[o.mat || 'cloth'], 0.10), matS = folds(MAT[o.mat || 'cloth'], o.mat === 'satin' ? 0.5 : 0.62);      // (the bodice lies close; the skirt falls in folds)
    const cut = o.cut || 'aline';
    const top = neckline(cut, d);
    shell(m, B, { y0: d.waist - 0.036, y1: top, ease: 0.008, slot, mat, nv: 16, nu: 40 });    ribbon(m, B, [[d.waist - 0.032, 0.02], [d.waist - 0.032, PI * 0.5], [d.waist - 0.032, PI], [d.waist - 0.032, PI * 1.5], [d.waist - 0.032, TAU - 0.02]], { w: 0.011, ease: 0.0092, slot, mat, tint: 0.9, n: 40 });
    { const pts = []; for (let i = 0; i <= 16; i++) { const a = 0.02 + (TAU - 0.04) * i / 16; pts.push([top(wrapA(a)) - 0.0035, a]); } ribbon(m, B, pts, { w: 0.0075, ease: 0.0094, slot, mat, tint: 0.84, n: 64 }); }      // (its neckline is bound)
    const strapW = cut === 'slip' ? 0.009 : cut === 'vneck' ? 0.050 : cut === 'day' ? 0.058 : 0.027, sx = cut === 'vneck' ? 0.66 : cut === 'slip' ? 0.52 : cut === 'day' ? 0.60 : 0.74;
    const xs = (cut === 'day' ? 0.092 : cut === 'vneck' ? 0.088 : cut === 'slip' ? 0.082 : 0.088) * d.H / 1.7, bk = top(PI - 0.72);
    for (const s of [-1, 1]) strap(m, B, s, { y0: top(sx) - 0.006, a0: sx, y1: bk - 0.006, a1: PI - 0.72, x: xs, w: strapW, ease: 0.005, slot, mat });
    if (o.waistband) ribbon(m, B, [[d.waist + 0.012, 0.02], [d.waist + 0.012, PI * 0.5], [d.waist + 0.012, PI], [d.waist + 0.012, PI * 1.5], [d.waist + 0.012, TAU - 0.02]], { w: 0.03, ease: 0.011, slot: SLOT.accent, mat: MAT.satin, n: 40 });
    const hem = hemOf(o, d, o.lift);
    const F = { slip: [[0.215, 0.20], 1.9, 7, 0.035], aline: [[0.40, 0.36], 0.92, 10, 0.075], vneck: [[0.46, 0.43], 1.0, 14, 0.07], day: [[0.27, 0.24], 0.95, 9, 0.05] }[cut];
    const fl = o.len === 'floor' ? F[0] : [mix(d.hipX, F[0][0], 0.72), mix(d.hipZ, F[0][1], 0.72)];
    const K = { slip: { bend: 0.05, shear: 0.4, damp: 0.012, wind: 1.1 }, aline: { bend: 0.16, shear: 0.5, damp: 0.016, wind: 1 }, vneck: { bend: 0.1, damp: 0.014 }, day: { bend: 0.12, damp: 0.018, wind: 0.9 } }[cut];
    skirt(m, B, { y0: hem, y1: d.waist - 0.012, flare: fl, pow: F[1], folds: F[2], amp: F[3], slot, mat: matS, tiers: o.tiers, wave: o.len === 'floor' ? 0.002 : 0.007, k: K });
    if (cut === 'day' && o.sleeve) for (const s of [-1, 1]) arm(m, B, s, o.pose && o.pose[s < 0 ? 0 : 1], { len: o.sleeve, ease: 0.008, slot, mat });
  }
  // a shirt, blouse or jumper: a shell from its hem to the neck, sleeves, a collar
  function top(m, B, o) {
    const d = B.d, slot = o.slot, knit = o.mat === 'knit', mat = folds(MAT[o.mat || 'cloth'], knit ? 0 : 0.5), e = o.ease == null ? 0.006 : o.ease;
    const y0 = at(B, o.hem, d.belt - 0.03);
    const nk = Array.isArray(o.neck) ? o.neck[1] : 0.008;
    // (tucked in: close at the waistband, and a little full just above it, as a shirt sits over a belt)
    const tucked = o.hem == null, ez = (y) => (tucked ? mix(Math.min(e, 0.0055), e, smooth(d.belt + 0.014, d.belt + 0.07, y)) + (o.under ? 0 : 0.007 * Math.exp(-Math.pow((y - d.belt - 0.05) / 0.028, 2))) : e);
    const sleeved = (o.sleeve == null ? 1 : o.sleeve) > 0;
    const sh = sleeved ? shoulderOf(B, ez(d.sho) + (knit ? 0.002 : 0), 0.010, d.armUp[0] * 0.86 + Math.min(e, 0.011) + 0.003) : o.under ? { x: Math.abs(B.arm[1].S[0]) - 0.004 } : null;      // (sleeveless under a jacket: it ends inside the jacket's shoulders)
    shell(m, B, { y0, y1: (a) => B.nb(a) + nk, ease: (y) => ez(y) + (knit ? 0.006 * (1 - smooth(y0, y0 + 0.05, y)) : 0), slot, mat, nv: 22, hang: d.hip + 0.01,
      uv: (u, v) => [u, v], mod: sh ? (q, a, v, y) => { if (y > d.pit && Math.abs(q[0]) > sh.x) q[0] = Math.sign(q[0]) * sh.x; return q; } : null });
    for (const s of [-1, 1]) arm(m, B, s, o.pose && o.pose[s < 0 ? 0 : 1], { len: o.sleeve == null ? 1 : o.sleeve, ease: Math.min(e, 0.011) + 0.003, slot, mat, cuff: o.cuff, head: sh, seam: !o.under, band: o.under ? null : knit ? 'rib' : 'cuff' });
    if (o.collar === 'crew') m.tube(ringPath(B, (a) => B.nb(a) + nk + 0.002, e + 0.004, 0.011), { slot, mat, nu: 8, sub: 3, ball: false, uv: (u, v) => [v * 3, u] });
    if (o.collar === 'shirt' || o.collar === 'open') shirtCollar(m, B, o.collarSlot == null ? slot : o.collarSlot, o.collar === 'open', e, o.under);
    if (o.placket) {
      const pl = [[d.neckF - 0.012, 0], [d.bust, 0], [tucked ? d.belt + 0.018 : y0 + 0.01, 0]];
      ribbon(m, B, pl, { w: 0.026, ease: (tt) => ez(curve(pl, tt * 2)[0]) + 0.0025, slot, mat: MAT.cloth, tint: 0.93, n: 14 });
      for (let yb = d.neckF - 0.06; yb > (tucked ? d.belt + 0.03 : y0 + 0.03); yb -= 0.085) m.egg(B.surf(yb, 0, ez(yb) + 0.004, d.hip + 0.01), [0.0052, 0.0052, 0.0022], { slot, mat: MAT.leather, tint: () => 0.82, nu: 6, nv: 4, ball: false });
    }
  }
  // a closed ring of points around the body at height y, as a tube's path
  const ringPath = (B, y, ease, r) => { const P = [], yf = fnOf(y); for (let i = 0; i <= 20; i++) { const a = i / 20 * TAU, q = B.surf(yf(wrapA(a)), a, ease); P.push([q[0], q[1], q[2], r]); } return P; };
  // a shirt's collar: a stand round the neck, and a leaf on each side that folds down from it to a point in front;
  // open = the top button undone (the leaves lie wider, a little skin shows between them)
  function shirtCollar(m, B, slot, open, e, tuck) {
    const d = B.d, gap = open ? (tuck ? 0.30 : 0.40) : 0.06, o = { slot, mat: MAT.cloth };
    // the stand: a band around the neck, 3.4 cm tall
    m.patch(32, 4, (u, v) => { const th = gap + u * (TAU - 2 * gap), a = wrapA(th); return B.neck(B.nb(a) - 0.004 + v * 0.034, th, 0.0055 + 0.002 * v); }, Object.assign({ tint: () => 0.97 }, o));
    // the leaves: folded down from the stand's top, lying out over the shoulders, to a point in front
    const leaf = (s, grow, lift, tint) => m.patch(14, 6, (u, v) => {
      const a = s * mix(gap + (open ? 0.22 : 0.12) * v - grow * 2.2 * v, PI, u), deep = mix(open ? 0.080 : 0.070, tuck ? 0.026 : 0.036, smooth(0, 0.55, u)) + grow;
      return B.neck(B.nb(a) + 0.030 - v * deep, a, 0.009 + lift + (tuck ? 0.005 : 0.010) * Math.sin(v * PI * 0.5), true);
    }, Object.assign({ flip: s > 0 }, o, tint == null ? null : { tint: () => tint }));
    for (const s of [-1, 1]) { leaf(s, 0.0045, -0.0028, 0.70); leaf(s, 0, 0, null); }      // (its shade, a little larger and lower; then the leaf)
    // an open collar: the hollow of the throat between the leaves
    if (open) m.patch(6, 6, (u, v) => { const yy = mix(d.neckF + 0.024, d.neckF - 0.075, v), half = 0.26 * Math.pow(1 - v, 1.4); return B.surf(yy, (u - 0.5) * 2 * half, e + 0.0016); }, { flip: true, slot: SLOT.skin, mat: d.sex === 'm' ? MAT.realM : MAT.real, uv: () => [9, -9] });
  }
  // a jacket, blazer, cardigan or denim jacket: a shell open in front, lapels, sleeves
  function jacket(m, B, o) {
    const d = B.d, slot = o.slot, mat0 = MAT[o.mat || 'cloth'], mat = folds(mat0, mat0 === MAT.knit ? 0 : 0.16), e = o.ease || 0.016;
    const hem = at(B, o.hem, d.crotch + 0.005), yb = at(B, o.button, d.waist + 0.05), yt = d.neckF + 0.018;
    const closed = !o.openFront, tailored = mat0 === MAT.cloth && o.lapel !== false;              // a suit's jacket, a blazer
    // half the opening in front, in radians, by height (buttoned: a V down to the button, and the quarters curve away under it)
    const al = closed
      ? (y) => (y <= yb ? 0.075 * Math.pow(smooth(yb - 0.03, hem, y), 1.3) : 0.40 * Math.pow((y - yb) / (yt - yb), 0.92))
      : (y) => mix(o.gap || 0.42, 0.50, smooth(d.waist, yt, y)) * (1 - 0.25 * smooth(hem + 0.12, hem, y));
    // its ease: room at the shoulders; a tailored one is taken in at the waist
    const ez = (y) => e + 0.012 * smooth(d.pit - 0.02, d.sho - 0.02, y) * (1 - 0.35 * smooth(d.sho - 0.01, d.neck, y)) - (tailored && closed ? 0.0055 * Math.exp(-Math.pow((y - d.waist) / 0.09, 2)) : 0);
    // the shoulder ends where the sleeve's head begins (the body's own shoulder runs out to a ridge there)
    const sh = shoulderOf(B, ez(d.sho), 0.012, tailored ? 0.060 : mat0 === MAT.knit ? 0.056 : 0.058), sx = sh.x;
    const gorge = tailored && !closed ? 0.07 : 0;                      // (an open blazer's fronts are cut away below the neck)
    shell(m, B, { y0: hem, y1: (a) => B.nb(a) + 0.004 - gorge * (1 - smooth(0.5, 1.1, Math.abs(a))), ease: ez, open: al, slot, mat, nv: 26, nu: 36, hang: d.hip + 0.01,
      mod: (q, a, v, y) => { if (y > d.pit && Math.abs(q[0]) > sx) q[0] = Math.sign(q[0]) * sx; return q; } });
    for (const s of [-1, 1]) arm(m, B, s, o.pose && o.pose[s < 0 ? 0 : 1], { len: o.sleeve == null ? 1 : o.sleeve, ease: tailored ? 0.009 : e * 0.6 + 0.003, slot, mat: folds(mat0, mat0 === MAT.knit ? 0 : 0.3), cuff: o.cuff, head: sh, buttons: tailored, seam: true, band: mat0 === MAT.knit ? 'rib' : null });
    const R = (y) => Math.max(B.torso.rad(y, 0.6), 0.08), hang = d.hip + 0.01;
    if (tailored) {
      // Notch lapels: each is folded back along the opening from the button up to the notch, widest at the top, its
      // point a little higher than its fold. Under each lies its shade (a darker copy, a little wider). Above the
      // notch the collar's end runs up the opening to the neck, its lower edge rising outward.
      const yg = d.neckF - 0.055, y0 = closed ? yb + 0.012 : d.waist + 0.06, lw = typeof o.lapel === 'number' ? o.lapel : closed ? 0.076 : 0.062;
      for (const s of [-1, 1]) {
        const lapel = (grow, ease, tint) => m.patch(4, 14, (u, v) => {
          const yv = mix(y0, yg, v), y = yv + 0.004 * u * smooth(0.6, 1, v), w = 0.012 + (lw - 0.012) * Math.pow(v, 0.7) + grow;
          return B.surf(y, s * (al(yv) - 0.004 / R(yv) + u * w / R(y)), ease + 0.0035 * Math.sin(u * PI), hang);
        }, { slot, mat, tint: () => tint, flip: s < 0 });
        lapel(0.007, e + 0.0035, 0.64); lapel(0, e + 0.0075, 1.06);
        const end = (grow, ease, tint) => m.patch(3, 8, (u, v) => {
          const yv = mix(yg, yt, v), w = mix(0.050, 0.046, v) + grow, a = al(yv) - 0.004 / R(yv) + u * w / R(yv);
          return B.surf(mix(yg + 0.001 + 0.026 * u, B.nb(a) + 0.016, v), s * a, ease + 0.003 * Math.sin(u * PI));      // (its lower edge rises outward from the lapel's top: the notch)
        }, { slot, mat, tint: () => tint, flip: s < 0 });
        if (closed) { end(0.006, e + 0.004, 0.64); end(0, e + 0.0085, 1.03); }
      }
    } else if (o.lapel !== false) {
      // a soft jacket's fronts: a facing along each edge
      const lw = o.lapel || 0.072, y0 = closed ? yb + 0.01 : hem + 0.04;
      for (const s of [-1, 1]) {
        const edge = (t) => { const y = mix(y0, yt - 0.02, t); return [y, s * (al(y) + (lw * 0.75) / (2 * Math.max(B.torso.rad(y, PI / 2), 0.08)) + 0.012)]; };
        const pts = []; for (let i = 0; i <= 6; i++) pts.push(edge(i / 6));
        ribbon(m, B, pts, { w: lw * 0.75 + 0.004, ease: e + 0.007, slot, mat, tint: 1.07, n: 18, liftEdge: s * 0.004, hang });
      }
    }
    if (o.lapel !== false) {
      // the collar, round the back of the neck: a finger's width up the neck behind; from there it lies down on the
      // shoulders (its width is measured along the body, not in height)
      const ends = tailored && closed, a0 = ends ? al(yt) + 0.38 : gorge ? al(yt) + 0.03 : al(yt) + 0.17, W = 0.043;      // (a buttoned jacket's collar ends are made above: this is the part behind them)
      const down = (th, top, len, ease) => {
        let p = B.neck(top, th, ease, true), y = top, left = len;
        for (let i = 0; i < 40 && left > 1e-5; i++) { y -= 0.003; const q = B.neck(y, th, ease, true), sg = V.len(V.sub(q, p)); if (sg >= left) return V.mix(p, q, left / sg); left -= sg; p = q; }
        return p;
      };
      m.patch(44, 4, (u, v) => {
        const th = a0 + u * (TAU - 2 * a0), a = wrapA(th), front = ends ? 0 : 1 - smooth(a0, 1.05, Math.abs(a));
        return down(th, B.nb(a) + 0.019 - (gorge ? gorge + 0.004 : 0.030) * front, v * W * (1 - 0.22 * front), e + 0.011 + 0.004 * Math.sin(v * PI));
      }, { slot, mat, tint: () => 1.05, flip: true });
    }
    if (closed && o.buttons !== false) for (const by of [yb - 0.012, yb - 0.085]) m.egg(B.surf(by, 0.05, e + 0.005, hang), [0.0085, 0.0085, 0.0036], { slot, mat: MAT.leather, tint: () => 0.5, nu: 8, nv: 6, ball: false });
    if (!closed && o.buttons !== false) {
      // worn open: its buttons along one front edge (a blazer's two; a cardigan's five on its band; a denim jacket's of metal)
      const knitJ = mat0 === MAT.knit, den = mat0 === MAT.denim, yTop = knitJ ? d.bust - 0.01 : den ? d.bust + 0.03 : yb + 0.004, yBot = knitJ ? hem + 0.07 : den ? hem + 0.035 : yb - 0.075, nb = knitJ ? 5 : den ? 4 : 2;
      const edgeA = (y, inset) => al(y) + inset / Math.max(B.torso.rad(y, 0.6), 0.08);
      if (knitJ) for (const s of [-1, 1]) { const pts = []; for (let i = 0; i <= 7; i++) { const y = mix(hem + 0.012, yt - 0.035, i / 7); pts.push([y, s * edgeA(y, 0.013)]); } ribbon(m, B, pts, { w: 0.024, ease: e + 0.0035, slot, mat, tint: 0.88, n: 22, hang }); }
      for (let i = 0; i < nb; i++) { const y = mix(yTop, yBot, nb > 1 ? i / (nb - 1) : 0);
        m.egg(B.surf(y, -edgeA(y, knitJ ? 0.013 : 0.022), e + (knitJ ? 0.0075 : 0.006), hang), den ? [0.0072, 0.0072, 0.0030] : [0.0080, 0.0080, 0.0034], { slot: den ? SLOT.silver : slot, mat: den ? MAT.metal : MAT.leather, tint: () => (den ? 0.9 : knitJ ? 0.62 : 0.5), nu: 8, nv: 6, ball: false }); }
    }
    if (o.pockets !== false && mat0 !== MAT.knit) {
      const py = Math.max(hem + 0.10, d.hip + 0.045);
      for (const s of [-1, 1]) {
        const flap = [[py, s * 0.62], [py - 0.006, s * 1.02], [py - 0.016, s * 1.36]];
        ribbon(m, B, flap.map((q) => [q[0] - 0.004, q[1]]), { w: 0.050, ease: e + 0.004, slot, mat, tint: 0.66, n: 8, hang });      // its shade
        ribbon(m, B, flap, { w: 0.046, ease: e + 0.0065, slot, mat, tint: 0.97, n: 8, hang });
      }
      ribbon(m, B, [[d.bust + 0.012, 0.80], [d.bust + 0.018, 1.06]], { w: 0.009, ease: e + 0.0045, slot, mat, tint: 0.72, n: 5 });
    }
    if (tailored) ribbon(m, B, [[hem + 0.004, PI], [hem + 0.19, PI]], { w: 0.0045, ease: e + 0.002, slot, mat, tint: 0.62, n: 6, hang });      // the vent at the back
    if (o.square != null) ribbon(m, B, [[d.bust + 0.027, 0.83], [d.bust + 0.033, 1.03]], { w: 0.022, ease: e + 0.009, slot: o.square, mat: MAT.satin, n: 5, crown: 0.003 });
  }
  // a tie on the shirt front
  function tie(m, B, slot, yb, under) {
    const d = B.d, e = under ? 0.0105 : 0.014;
    ribbon(m, B, [[d.neckF + 0.016, 0], [d.neckF - 0.028, 0], [d.bust, 0], [yb + 0.03, 0]], { w: (t) => (t < 0.09 ? 0.036 : mix(0.026, 0.058, smooth(0.09, 1, t))), ease: (t) => e + 0.006 * (t < 0.09 ? 1 : 0), slot, mat: MAT.satin, n: 22, crown: 0.003 });
  }
  // a wrap: over the shoulders and the tops of the arms, open in front
  function wrap(m, B, slot) {
    const d = B.d, o = { slot, mat: MAT.knit };
    shell(m, B, Object.assign({ y0: (a) => d.pit - 0.11 - 0.05 * smooth(1.2, 0.5, Math.abs(a)), y1: (a) => B.nb(a) - 0.014, ease: (y) => 0.016 + 0.01 * smooth(d.sho, d.pit, y), open: (y) => 0.30 + 0.16 * smooth(d.pit, d.neck, y), nv: 14, nu: 44, uv: (u, v) => [u, v] }, o));
    for (const s of [-1, 1]) {
      const J = B.arm[s]; m.rig = B.rigOf(s);
      // (wide enough at its top for the shoulder itself, however the arm is held: no skin between it and the wrap's body)
      m.tube([[J.S[0] - s * 0.006, J.S[1] - 0.004, J.S[2], d.armUp[0] * 0.90 + 0.025], [...V.mix(J.S, J.E, 0.30), mix(d.armUp[0], d.armUp[1], 0.3) + 0.025], [...V.mix(J.S, J.E, 0.62), mix(d.armUp[0], d.armUp[1], 0.6) + 0.026]], Object.assign({ nu: 14, sub: 4, round0: true, uv: (u, v) => [u, v] }, o));
    }
    m.rig = 0;      // (what is made after the wrap is not the arm's: her boots had gone with her left arm, a few centimetres off her legs whenever it swung)
  }

  // The legs as the cloth knows them: a capsule along the real thigh and one along the real shin. The flesh does not
  // sit evenly round the line between the joints (the thigh lies in front of it, the calf behind), so each end of a
  // capsule is put in the middle of the skin there, as wide as the skin is.
  function legCaps(B, s) {
    const D = A.BODY, P = B.posed.P, reg = D.region, L = B.leg[s], out = [];
    for (const [a, b, r0, lo, hi, u0, u1] of [[L.H, L.K, 9, 0.42, 0.90, 0.30, 0.97], [L.K, L.A, 11, 0.20, 0.86, 0.04, 0.95]]) {
      const e = V.sub(b, a), ee = V.dot(e, e), W = [[1e9, -1e9, 1e9, -1e9], [1e9, -1e9, 1e9, -1e9]];
      for (let i = 0; i < D.n; i++) {
        if (reg[i] !== r0 && reg[i] !== r0 + 1) continue;
        const px = P[i * 3] - a[0], py = P[i * 3 + 1] - a[1], pz = P[i * 3 + 2] - a[2]; if (P[i * 3] * s < 0) continue;
        const u = (px * e[0] + py * e[1] + pz * e[2]) / ee, k = Math.abs(u - lo) < 0.09 ? 0 : Math.abs(u - hi) < 0.09 ? 1 : -1; if (k < 0) continue;
        const qx = px - e[0] * u, qz = pz - e[2] * u, w = W[k];
        if (qx < w[0]) w[0] = qx; if (qx > w[1]) w[1] = qx; if (qz < w[2]) w[2] = qz; if (qz > w[3]) w[3] = qz;
      }
      if (W[0][0] > W[0][1] || W[1][0] > W[1][1]) { out.push([...a, ...b, 0.09, 0.07]); continue; }       // (no skin found: a plain one)
      const end = (u, w) => [a[0] + e[0] * u + (w[0] + w[1]) / 2, a[1] + e[1] * u, a[2] + e[2] * u + (w[2] + w[3]) / 2, Math.max(w[1] - w[0], w[3] - w[2]) / 2 + 0.009];
      const A0 = end(u0, W[0]), A1 = end(u1, W[1]);
      out.push([A0[0], A0[1], A0[2], A1[0], A1[1], A1[2], A0[3], A1[3]]);
    }
    return out;
  }

  // A lady's jewellery: a fine chain round the base of the neck that dips to a pearl, and a pearl at each ear (the
  // lobe is found on her own posed head: the lowest of the points that stand furthest out).
  function jewels(m, B) {
    const d = B.d, o = { slot: SLOT.extra, mat: MAT.metal, ball: false }, og = Object.assign({}, o, { slot: SLOT.gold });
    const dip = (a) => 0.05 * Math.pow(Math.max(Math.cos(a), 0), 2.4);
    const P = []; for (let i = 0; i <= 28; i++) { const a = i / 28 * TAU, q = B.surf(B.nb(wrapA(a)) - 0.006 - dip(wrapA(a)), a, 0.0028); P.push([q[0], q[1], q[2], 0.0011]); }
    m.tube(P, Object.assign({ nu: 5, sub: 2, tint: () => 0.95 }, og));
    m.egg(B.surf(B.nb(0) - 0.006 - dip(0) - 0.006, 0, 0.0052), [0.0048, 0.0058, 0.0042], Object.assign({ nu: 8, nv: 6, tint: () => 1.15 }, o));
    const D = A.BODY, Pp = B.posed.P, reg = D.region; let far = 0;
    for (let i = 0; i < D.n; i++) if (reg[i] === 0 && Math.abs(Pp[i * 3]) > far) far = Math.abs(Pp[i * 3]);
    m.rig = 3;
    for (const s of [-1, 1]) {
      let lobe = null;
      for (let i = 0; i < D.n; i++) { if (reg[i] !== 0 || Pp[i * 3] * s < far * 0.86) continue; if (!lobe || Pp[i * 3 + 1] < lobe[1]) lobe = [Pp[i * 3], Pp[i * 3 + 1], Pp[i * 3 + 2]]; }
      if (lobe) m.egg([lobe[0] + s * 0.001, lobe[1] - 0.0045, lobe[2]], [0.0042, 0.0048, 0.0042], Object.assign({ nu: 8, nv: 6, tint: () => 1.15 }, o));
    }
    m.rig = 0;
  }

  // Sunglasses (dark lenses) or spectacles (none): two rims, a bridge, the temples back over the ears. up: pushed up
  // into the hair. Everything goes with the head.
  function glasses(m, B, o) {
    const H = B.H, ex = H.eye[0] + 0.003, ey = H.eye[1] - 0.001, zl = H.eye[2] + H.eyeR + 0.011, hw = o.wide || 0.027, hh = o.tall || 0.0205;
    const frame = o.frame == null ? SLOT.black : o.frame, fmat = frame === SLOT.gold || frame === SLOT.silver ? MAT.metal : MAT.leather, fr = o.thin ? 0.0012 : 0.0019;
    // pushed up: turned up about the ears, and set out to lie on the hair
    const py = ey + 0.004, pz = H.zc - 0.012, ang = o.up ? -0.86 : 0, c = Math.cos(ang), s = Math.sin(ang), k = o.up ? 1.27 : 1;
    const put = (p) => { const y = p[1] - py, z = p[2] - pz; return [p[0] * (o.up ? 1.06 : 1), py + (c * y - s * z) * k + (o.up ? 0.006 : 0), pz + (s * y + c * z) * k]; };
    const pw = (x, e) => Math.sign(x) * Math.pow(Math.abs(x), e);
    // a lens's own shape (flatter above, rounder below), and how it wraps back towards the temple
    const lens = (sd, lx, ly) => put([sd * (ex + lx * hw), ey + ly * hh * (ly > 0 ? 0.86 : 1), zl - 0.011 * Math.pow(Math.max(0, lx + 0.25) / 1.25, 2)]);
    m.rig = 3;
    for (const sd of [-1, 1]) {
      const rim = (a) => lens(sd, pw(Math.cos(a), 0.7), pw(Math.sin(a), 0.7));
      if (o.dark) m.patch(18, 3, (u, v) => { const a = u * TAU, q = lens(sd, v * pw(Math.cos(a), 0.7), v * pw(Math.sin(a), 0.7)); return q; }, { wrap: true, flip: sd > 0, slot: o.lens == null ? SLOT.black : o.lens, mat: MAT.metal, tint: () => 0.55 });
      const R = []; for (let i = 0; i <= 20; i++) { const q = rim(i / 20 * TAU); R.push([q[0], q[1], q[2], fr]); }
      m.tube(R, { slot: frame, mat: fmat, nu: 6, sub: 1, ball: false });
      // the temple: from the rim's outer corner back along the head to behind the ear (pushed up, the arms end in the hair)
      const T = [lens(sd, 1, 0.45)];
      for (const th of (o.up ? [0.95, 1.22] : [0.95, 1.3, 1.62, 1.86])) { const y = ey + 0.005 - 0.004 * (th - 0.95) - (th > 1.8 ? 0.012 : 0), r = B.skull.rad(y, sd * th) + 0.0035; T.push(put([Math.sin(sd * th) * r, y, B.skull.cz(y) + Math.cos(th) * r])); }
      m.tube(T.map((q) => [q[0], q[1], q[2], fr * 0.9]), { slot: frame, mat: fmat, nu: 5, sub: 3, ball: false });
    }
    const b0 = lens(-1, -0.9, 0.3), b1 = put([0, ey + hh * 0.42, zl + 0.0025]), b2 = lens(1, -0.9, 0.3);
    m.tube([[...b0, fr], [...b1, fr], [...b2, fr]], { slot: frame, mat: fmat, nu: 5, sub: 3, ball: false });
    m.rig = 0;
  }
  // A chain round the neck, lying on what is worn there (o.ease); it dips in front (o.drop); o.arc: how far round it is made (the rest is under a collar)
  function chain(m, B, o) {
    const dip = (a) => (o.drop || 0.07) * Math.pow(Math.max(Math.cos(a), 0), 2.2), lim = o.arc || 1.3, P = [];
    for (let i = 0; i <= 26; i++) { const a = -lim + 2 * lim * i / 26, q = B.surf(B.nb(a) - 0.004 - dip(a), a, o.ease || 0.003); P.push([q[0], q[1], q[2], o.r || 0.0019]); }
    m.tube(P, { slot: o.slot == null ? SLOT.gold : o.slot, mat: MAT.metal, nu: 6, sub: 2, ball: false, tint: (u, v) => 0.88 + 0.2 * (Math.floor(v * 110) % 2) });
  }
  // A watch (o.face) or a bangle on the wrist of an arm that hangs
  function wristband(m, B, s, o) {
    const J = B.arm[s], ax = V.norm(V.sub(J.W, J.E)), c = V.mix(J.E, J.W, o.at || 0.94), r = B.d.armLo[1] + (o.loose || 0.0055);
    const side = V.norm(V.sub([s, 0, 0], V.mul(ax, V.dot([s, 0, 0], ax)))), fwd = V.cross(ax, side), ring = [];
    for (let i = 0; i <= 14; i++) { const a = i / 14 * TAU, ca = Math.cos(a), sa = Math.sin(a); ring.push([c[0] + (side[0] * ca + fwd[0] * sa) * r, c[1] + (side[1] * ca + fwd[1] * sa) * r, c[2] + (side[2] * ca + fwd[2] * sa) * r, o.band || 0.0038]); }
    m.rig = B.rigOf(s);
    m.tube(ring, { slot: o.slot == null ? SLOT.tortoise : o.slot, mat: o.face ? MAT.leather : MAT.metal, nu: 6, sub: 2, ball: false });
    if (o.face) m.egg([c[0] + side[0] * (r + 0.0015), c[1] + side[1] * (r + 0.0015), c[2] + side[2] * (r + 0.0015)], [0.0048, 0.0155, 0.0155], { slot: SLOT.silver, mat: MAT.metal, nu: 10, nv: 6, ball: false, tint: (u, v) => (Math.abs(v - 0.5) < 0.2 ? 1.1 : 0.8) });
    m.rig = 0;
  }
  // A head of its own: every point the head carries is moved a little (fz: w the face's width, jaw, cheek, temple; d its
  // depth; long its length; chin (m) and chinZ (m, forward); nose (m); brow (m)): no two people have one head.
  function headWarp(B, fz) {
    const H = B.H, d = B.d, yc = H.y0, yt = d.H, zc = H.zc, hgt = yt - yc;
    return (p) => {
      const w = smooth(d.neck + 0.012, yc + 0.012, p[1]); if (w <= 0) return;
      const t = clamp((p[1] - yc) / hgt, -0.3, 1), front = smooth(-0.02, 0.05, p[2] - zc);
      const sx = 1 + (fz.w || 0) + (fz.jaw || 0) * (1 - smooth(0.04, 0.40, t)) + (fz.cheek || 0) * Math.exp(-Math.pow((t - 0.40) / 0.15, 2)) + (fz.temple || 0) * smooth(0.55, 0.85, t);
      p[0] *= mix(1, sx, w); p[2] = zc + (p[2] - zc) * mix(1, 1 + (fz.d || 0), w);
      if (fz.long) p[1] += w * fz.long * (t - 0.47) * hgt;
      if (fz.chin) p[1] -= w * fz.chin * (1 - smooth(-0.05, 0.20, t)) * front;
      if (fz.chinZ) p[2] += w * fz.chinZ * (1 - smooth(0.0, 0.20, t)) * front;
      if (fz.nose) p[2] += w * fz.nose * Math.exp(-Math.pow(p[0] / 0.020, 2)) * Math.exp(-Math.pow((t - 0.35) / 0.075, 2)) * smooth(0.055, 0.095, p[2] - zc);
      if (fz.brow) p[2] += w * fz.brow * Math.exp(-Math.pow((t - 0.585) / 0.045, 2)) * front;
    };
  }

  /* ---------------- a figure from its look ---------------- */
  function build(look, colour) {
    const m = new Mesh(), B = new Body(look), d = B.d, w = look.wear, pose = look.pose || ['rest', 'rest'];
    const lift = B.lift;
    const dressed = w.kind === 'dress';
    // what of the body shows: the head and the neck always; the rest where the look leaves it bare
    const sleeve = dressed ? (w.over === 'denim' ? 1 : w.cut === 'day' && w.sleeve ? w.sleeve : 0)
      : Math.max(w.top && w.top.sleeve != null ? w.top.sleeve : (w.over ? 0 : 1), w.over ? (w.over.sleeve == null ? 1 : w.over.sleeve) : 0);
    const neck = dressed ? neckline(w.cut || 'aline', d) : null, hem = dressed ? hemOf(w, d, lift) : 0;
    const shortY = !dressed && w.legs && w.legs.short ? shortHem(B, w.legs.short) : 0, acc = look.acc || {};
    const bootLeg = look.shoes.kind === 'boot' && (dressed || !!shortY);
    const lowNk = !dressed && w.top && Array.isArray(w.top.neck) ? Math.min(0, w.top.neck[1]) : 0;
    skin(m, B, look, (r, x, y, z) => {
      if (r <= 1) return true;
      if (r === 2) { const a = Math.atan2(x, z - B.torso.cz(y)); return dressed ? y > neck(a) - 0.075 : y > B.nb(a) - 0.03 + lowNk * 3 && Math.hypot(x, z - B.torso.cz(B.nk)) < B.torso.rad(B.nk, a) + 0.014 - lowNk * 2.5; }      // (lowNk: a neckline below the neck's base, as a negative height)
      if (r <= 4) return sleeve < 0.3;
      if (r <= 6) return sleeve < 0.9 || (r >= 5 && Math.hypot(x - B.arm[r % 2 ? 1 : -1].W[0], y - B.arm[r % 2 ? 1 : -1].W[1], z - B.arm[r % 2 ? 1 : -1].W[2]) < 0.055);      // (a sleeved forearm: only by the wrist, inside the cuff)
      if (r <= 8) return pose[r === 7 ? 1 : 0] !== 'pocket';
      // the feet: seen in a pump or a flat, else inside their shoes; a bare leg goes on down INTO an ankle boot (the
      // mesh's "foot" begins well above the ankle: hidden there, the shin ended in a cut that showed in the boot's open top)
      if (r >= 13) return B.bare || (bootLeg && y > d.ankle - 0.012);
      if (shortY) return y < shortY + 0.035;                           // the legs below a pair of shorts
      return dressed && (w.len !== 'floor' || y < d.ankle + 0.17);     // the legs under a dress: all of them (a skirt swings up when its guest is turned); under a long one, what a lifted hem can show
    });
    // (how thick what is worn over the shoulders is: long hair lies on it, not in it)
    const clear = w.over === 'wrap' ? 0.034 : w.over === 'denim' ? 0.040 : w.over ? (w.over.ease || 0.016) + 0.022 : dressed ? 0.014 : w.top ? (w.top.ease == null ? 0.006 : w.top.ease) + (w.top.mat === 'knit' ? 0.014 : 0.008) : 0.011;
    m.rig = 3; hair(m, B, look.hair.style, clear); m.rig = 0;
    if (acc.shades) glasses(m, B, Object.assign({ dark: true, up: acc.shades === 'up' }, acc.frames));
    if (acc.specs) glasses(m, B, Object.assign({ thin: true, frame: SLOT.tortoise }, acc.frames));
    if (dressed) {
      dress(m, B, Object.assign({ pose, lift }, w));
      if (look.jewels !== false) jewels(m, B);
      if (acc.bangle) wristband(m, B, acc.bangle === 'L' ? 1 : -1, { slot: SLOT.gold, band: 0.0022, loose: 0.011, at: 0.95 });
      if (w.over === 'wrap') wrap(m, B, SLOT.extra);
      if (w.over === 'denim') jacket(m, B, { slot: SLOT.extra, mat: 'denim', openFront: true, hem: d.waist - 0.015, gap: 0.5, lapel: 0.05, ease: 0.014, pose });
    } else {
      // a top (shirt, blouse, jumper), what is worn over it, trousers (cut first: what hangs over the hips must clear them)
      const buttoned = !!w.over && !w.over.openFront;
      const legs = Object.assign({ slot: SLOT.second, mat: MAT.cloth }, w.legs, { mat: MAT[(w.legs && w.legs.mat) || 'cloth'] }, buttoned ? { belt: null } : {}, { seams: !w.top || w.top.hem == null });      // (seams: only where the top is tucked in; a top that hangs over them hides them)
      const C = cutTrousers(B, legs); B.under = C.under;
      if (w.top) top(m, B, Object.assign({ pose, slot: SLOT.shirt, under: !!w.over }, w.top, w.over ? { sleeve: w.top.sleeve === undefined && w.over.sleeve == null ? 0 : w.top.sleeve } : {}));
      if (w.tie) tie(m, B, SLOT.accent, buttoned ? at(B, w.over.button, d.waist + 0.05) - 0.02 : d.belt - 0.022, buttoned);
      if (w.over) jacket(m, B, Object.assign({ pose, slot: SLOT.main }, w.over));
      trousers(m, B, legs, C);
      // a chain: on the skin where a collar is open (it shows in the opening), else on what is worn
      if (acc.chain) { const open = w.top && w.top.collar === 'open', te = w.top ? (w.top.ease == null ? 0.006 : w.top.ease) + (w.top.mat === 'knit' ? 0.008 : 0.003) : 0.003;
        chain(m, B, { ease: open ? 0.0032 : te + 0.003, drop: open ? 0.05 : 0.085, arc: open ? 0.9 : 1.35, r: acc.chain === 'heavy' ? 0.0026 : 0.0017, slot: acc.metal === 'silver' ? SLOT.silver : SLOT.gold }); }
      if (acc.watch) wristband(m, B, acc.watch === 'L' ? 1 : -1, { face: true, slot: acc.strap === 'black' ? SLOT.black : SLOT.tortoise });
    }
    if (pose[0] === 'clutch' && pose[1] === 'clutch') m.egg([0, d.hip - 0.014, B.torso.cz(d.hip) + d.hipZ + 0.127], [0.118, 0.064, 0.016], { slot: SLOT.accent, mat: MAT.satin, nu: 14, nv: 8, mod: (q) => { q[1] = d.hip - 0.014 + clamp(q[1] - d.hip + 0.014, -0.058, 0.058); return q; } });      // (a clutch, held IN FRONT of both hands: the fingers lie behind it, none through it)
    // a head of its own (everything the head carries: the face, the hair, what is worn on it)
    const warp = look.face ? headWarp(B, look.face) : null;
    const warpAll = (ms) => { const q = [0, 0, 0]; for (let i = 0; i < ms.count; i++) { if (Math.floor(ms.s[i] / 16) !== 3) continue; q[0] = ms.p[i * 3]; q[1] = ms.p[i * 3 + 1]; q[2] = ms.p[i * 3 + 2]; warp(q); ms.p[i * 3] = q[0]; ms.p[i * 3 + 1] = q[1]; ms.p[i * 3 + 2] = q[2]; } };
    if (warp) { warpAll(m); (m.pieces || []).forEach((pc) => { if (pc.hair) warpAll(pc.mesh); }); }
    m.lift(lift);
    shoes(m, B, Object.assign({ ankle: !!shortY, bare: bootLeg }, look.shoes), lift);
    const geo = m.finish();
    // the pieces that move, as the cloth they are; what they must not pass through; the body's heights for its life
    const cloth = (m.pieces || []).map((pc) => {
      const pm = pc.mesh; for (let i = 1; i < pm.p.length; i += 3) pm.p[i] += lift;
      // the cloth's own points: the drawn ones without the second copy of a seam
      const rc = pc.wrap ? pc.cols + 1 : pc.cols, rest = new Float32Array(pc.cols * pc.rows * 3);
      for (let j = 0; j < pc.rows; j++) for (let i = 0; i < pc.cols; i++) for (let k = 0; k < 3; k++) rest[(j * pc.cols + i) * 3 + k] = pm.p[(j * rc + i) * 3 + k];
      return { geo: pm.finish(), cols: pc.cols, rows: pc.rows, wrap: pc.wrap, flip: pc.flip, rest, pin: pc.pin, k: pc.k, hair: pc.hair };
    });
    const up = (p) => [p[0], p[1] + lift, p[2]];
    const handCap = {};
    const col = { torso: B.torso, skull: B.skull, lift, y0: d.crotch - 0.03 + lift, y1: d.neck + 0.06 + lift, floor: 0.012, handCap,
      caps: [-1, 1].reduce((a, s) => {
        const L = B.leg[s]; legCaps(B, s).forEach((c) => a.push([c[0], c[1] + lift, c[2], c[3], c[4] + lift, c[5], c[6], c[7]]));
        // an arm that hangs beside a skirt: the cloth goes round its hand, not through it
        if (dressed && pose[s < 0 ? 0 : 1] !== 'clutch') { const J = B.arm[s], ax = V.norm(V.sub(J.W, J.E)), h0 = V.mix(J.E, J.W, 0.72), h1 = V.add(J.W, V.mul(ax, 0.13)); handCap[s] = a.length; a.push([h0[0], h0[1] + lift, h0[2], h1[0], h1[1] + lift, h1[2], 0.030, 0.034]); }      // (the stage moves it with the hand)
        if (dressed && w.len === 'floor') {
          const heel = look.shoes.kind === 'heel', x = L.A[0], z0 = L.A[2] - 0.062, len = d.foot * (heel ? 0.90 : 0.96);
          a.push([x, lift + 0.034, z0 + 0.05, x, 0.026, z0 + len - 0.035, 0.040, 0.030]);
          if (heel) a.push([x, lift, z0 + 0.022, x, 0.012, z0 + 0.022, 0.026, 0.020]);
        }
        return a;
      }, []) };
    // long hair lies on the shoulders, not in them: the ridge from the neck to the shoulder, and the top of the arm
    // (the body's width at each height keeps cloth off sideways only: on a slope that is no distance at all)
    if (cloth.some((c) => c.hair)) for (const s of [-1, 1]) {
      const S = B.arm[s].S, q = V.mix(S, B.arm[s].E, 0.45);
      col.caps.push([S[0] * 0.42, S[1] + 0.565 * (d.neck - S[1]) + lift, S[2] - 0.010, S[0] - s * 0.016, S[1] + lift, S[2], 0.045, 0.050]);
      col.caps.push([S[0], S[1] + lift, S[2], q[0], q[1] + lift, q[2], d.armUp[0] + 0.004, mix(d.armUp[0], d.armUp[1], 0.45) + 0.004]);
      // (and the shoulder blade: what is worn stands off the back there, a jacket's sleeve head, a strap that goes straight down)
      const ya = S[1] - 0.045, aa = 2.32, zb = B.torso.cz(ya) + B.torso.rad(ya, aa) * Math.cos(aa), xb = B.torso.rad(ya, aa) * Math.sin(aa);
      col.caps.push([s * xb * 0.92, S[1] + 0.045 + lift, zb + 0.054, s * xb, S[1] - 0.105 + lift, zb + 0.038, 0.050, 0.050]);
    }
    // for its life: heights (the hips, the base of the neck, the chin; the knees, the bust, the shoulders, the crown), the neck's axis, the shoulders of the arms that hang
    const body = [d.hip + lift, d.neck + 0.005 + lift, d.chin + lift, B.torso.cz(d.neck + 0.02)], body2 = [d.knee + lift, d.bust + lift, d.sho + lift, d.H + lift];
    const arm = [1, -1].reduce((a, s) => a.concat([B.arm[s].S[0], B.arm[s].S[1] + lift, B.arm[s].S[2], 0]), []);
    const armE = [1, -1].reduce((a, s) => a.concat([B.arm[s].E[0], B.arm[s].E[1] + lift, B.arm[s].E[2], 0]), []), armW = [1, -1].reduce((a, s) => a.concat([B.arm[s].W[0], B.arm[s].W[1] + lift, B.arm[s].W[2], 0]), []);
    // the poses its arms can take (an arm that is built into a pose of its own, as one that holds a clutch, takes none)
    const coatOn = !!w.over && typeof w.over === 'object';
    // (how far what is worn stands off the trunk where a hand comes to lie: at the waist a jacket is taken in)
    const thick = coatOn ? (w.over.ease || 0.016) + (w.over.mat === 'knit' ? 0.006 : 0.001) : w.over === 'denim' ? 0.018 : dressed ? 0.010 : w.top ? (w.top.ease == null ? 0.006 : w.top.ease) + (w.top.mat === 'knit' ? 0.006 : 0.003) : 0.004;
    const long = (o2) => !!o2 && (o2.sleeve == null ? 1 : o2.sleeve) >= 1;
    const sleeveT = coatOn && long(w.over) ? (w.over.mat === 'knit' ? 0.017 : 0.014) : w.over === 'denim' ? 0.015 : !dressed && long(w.top) ? (w.top.mat === 'knit' ? 0.013 : 0.009) : 0.002;
    const give = sleeveT > 0.005 ? clamp(thick * 0.7, 0.005, 0.02) : 0.004;      // (a sleeve on a coat or a jumper presses in; a bare arm hardly)
    const hemY = dressed ? 0 : coatOn ? at(B, w.over.hem, d.crotch + 0.005) : w.top && w.top.hem != null ? at(B, w.top.hem, 0) : 0;      // (where what is worn over the trunk ends)
    const gest = B.rigOf(1) && B.rigOf(-1) ? gestures(B, { thick, sleeve: sleeveT, give, clasp: look.claspY, hem: hemY, under: ((w.legs && w.legs.ease) || 0.012) + 0.004, hang: coatOn || (w.top && w.top.hem != null) ? d.hip + 0.01 : 0,
      flare: dressed ? ({ aline: 0.22, vneck: 0.24, day: 0.12, slip: 0.04 }[w.cut || 'aline'] || 0.15) : 0, lady: d.sex === 'f' }) : null;
    // the face's own (its beard, its eyes' colour, its brows, its lips' colour), and the figure's build (girth, height)
    const lk = [look.beard == null ? (d.sex === 'm' ? 0.1 : 0) : look.beard, look.eyes == null ? -1 : look.eyes, look.brows || 0, look.lips == null ? 0.85 : look.lips];
    return { geo, cloth, col, body, body2, arm, armE, armW, gest, look: lk, scale: look.build || [1, 1], eye: d.H + lift - (d.H - B.H.eye[1]), height: d.H + lift, verts: geo.verts + cloth.reduce((n, c) => n + c.geo.verts, 0), tris: geo.count / 3 };
  }
  // the figure's eight colours, as 24 numbers: skin, hair, main, second, shirt, accent, shoes, extra
  function palette(look, colour) {
    const c = look.c || {}, pick = (v, dflt) => A.hex(colour(v == null ? dflt : v));
    const out = new Float32Array(24);
    [pick(look.skin, '#F0D0BC'), pick(look.hair.c, '#6B4A32'), pick(c.main, '#888888'), pick(c.second == null ? c.main : c.second, '#888888'), pick(c.shirt, '#FFFFFF'), pick(c.accent, '#B48A93'), pick(look.shoes.c, '#5A3E2B'), pick(c.extra, '#EFE6DA')]
      .forEach((rgb, i) => out.set(rgb, i * 3));
    return out;
  }
  A.buildFigure = build; A.figurePalette = palette; A.SLOT = SLOT;

  /* ---------------- the looks ----------------
     Four guests for each day, twelve different people. `c` names the colours (a palette name, or a hex); `swap` says
     which of them a guest may try in the palette's other colours (Saturday). What makes each one a person of their
     own: `body` (a shape, or one between two), `build` ([girth, height]), `face` (the head's own shape: see
     headWarp), `beard`, `eyes` (0 blue, .5 green, 1 brown), `brows`, `lips`, `cheer` (how readily they smile), the
     hair; and what they carry (`acc`: shades 'on' or 'up' in the hair, specs, a chain, a watch, a bangle). Friday
     and Sunday are the relaxed days: that is where the sunglasses, the chains and the shorts are. */
  const AVIATOR = { frame: SLOT.gold, thin: true, lens: SLOT.tortoise, tall: 0.0225 }, ROUND = { wide: 0.0245, tall: 0.0215 };
  A.LOOKS = {
    fri: [
      { sex: 'f', skin: '#EDC6AE', hair: { style: 'wavy', c: '#8A6242' }, pose: ['rest', 'rest'], home: 'clasp', moves: ['clasp', 'rest', 'rest/hip', 'cross/rest'], label: 'A day dress, a warm wrap and ankle boots',
        build: [0.97, 0.985], face: { w: -0.02, jaw: -0.035, chin: 0.003 }, eyes: 1, lips: 0.8, cheer: 0.55, acc: { shades: 'up', bangle: 'L' },
        wear: { kind: 'dress', cut: 'day', len: 'knee', mat: 'cloth', over: 'wrap' }, c: { main: 'Dusk Rose', extra: '#EFE3D3' }, shoes: { kind: 'boot', c: '#8A6A4E', lift: 0.035 } },
      { sex: 'm', skin: '#E2B79C', hair: { style: 'quiff', c: '#3A2A1E' }, pose: ['rest', 'rest'], home: 'rest', moves: ['rest', 'fold', 'clasp', 'rest/hip'], label: 'Chinos, a collared shirt and a blazer',
        build: [1.03, 1.0], face: { jaw: 0.05, w: 0.015, brow: 0.002, nose: 0.003 }, beard: 0.5, brows: 0.5, cheer: 0.45, acc: { shades: 'on', frames: AVIATOR },
        wear: { kind: 'sep', top: { mat: 'cloth', collar: 'open', placket: true }, over: { mat: 'cloth', openFront: true, hem: ['crotch', 0.04], gap: 0.40, cuff: 4 }, legs: { belt: 6 } }, c: { main: 'Night Sage', second: 'Stone Sand', shirt: '#F5F3EE' }, shoes: { kind: 'oxford', c: '#6A4A33' } },
      { sex: 'f', skin: '#F2D2BF', hair: { style: 'bob', c: '#C9A56B' }, pose: ['rest', 'rest'], home: 'hip/rest', moves: ['hip/rest', 'rest', 'fold', 'clasp'], label: 'Smart jeans, a pretty blouse and a long cardigan',
        build: [1.045, 0.965], face: { w: 0.03, cheek: 0.03, long: -0.03 }, eyes: 0, lips: 0.6, brows: -0.4, cheer: 0.6, acc: { chain: 'fine' },
        wear: { kind: 'sep', top: { mat: 'satin', ease: 0.012, hem: ['hip', 0.08], neck: ['neck', -0.012], sleeve: 0 }, over: { mat: 'knit', openFront: true, hem: ['crotch', -0.10], gap: 0.52, lapel: false, ease: 0.02 }, legs: { mat: 'denim', ease: 0.008 } }, c: { main: '#EDE2D2', second: '#33435C', shirt: 'Blush' }, shoes: { kind: 'boot', c: '#3A2C24', lift: 0.04 } },
      { sex: 'm', body: ['m', 'mo', 0.6], skin: '#E8BFA5', hair: { style: 'thin', c: '#7A736B' }, pose: ['rest', 'rest'], home: 'fold', moves: ['fold', 'rest', 'clasp', 'hip/rest'], label: 'A knit over a collared shirt, with trousers',
        build: [1.09, 0.965], face: { w: 0.045, jaw: 0.03, long: -0.02, nose: 0.004 }, beard: 0.05, eyes: 1, cheer: 0.5, acc: { specs: true },
        wear: { kind: 'sep', top: { mat: 'knit', ease: 0.018, hem: ['hip', -0.03], collar: 'shirt', collarSlot: 7, slot: 2, cuff: 7 }, legs: {} }, c: { main: 'Slate Eucalyptus', second: '#3B3F45', extra: '#FFFFFF' }, shoes: { kind: 'oxford', c: '#5A3E2B' } },
    ],
    sat: [
      { sex: 'f', skin: '#F0CDB8', hair: { style: 'bun', c: '#D8B87E' }, pose: ['clutch', 'clutch'], label: 'Floor-length satin', noun: 'Floor-length satin in', swap: 'main',
        build: [0.965, 1.02], face: { jaw: -0.03, long: 0.02 }, eyes: 0, lips: 0.95, cheer: 0.5,
        wear: { kind: 'dress', cut: 'slip', len: 'floor', mat: 'satin' }, c: { main: 'Blush', accent: '#EADBC8' }, shoes: { kind: 'heel', c: '#E7CDBD' } },
      { sex: 'm', skin: '#E8BFA5', hair: { style: 'side', c: '#3E2C20' }, pose: ['rest', 'rest'], home: 'clasp', moves: ['clasp', 'rest', 'rest/hip', 'cross/rest'], label: 'A suit with a tie', noun: 'A suit in', swap: 'main',
        build: [1.0, 1.0], face: { jaw: 0.02, chinZ: 0.002 }, beard: 0.04, eyes: 0.5, cheer: 0.48,
        wear: { kind: 'sep', top: { mat: 'cloth', collar: 'shirt', cuff: 4 }, tie: true, over: { mat: 'cloth', square: 5, cuff: 4 }, legs: { slot: 2, belt: 6 } }, c: { main: 'Slate Eucalyptus', shirt: '#FFFFFF', accent: 'Blush' }, shoes: { kind: 'oxford', c: '#4A3324' } },
      { sex: 'f', skin: '#EDC6AE', hair: { style: 'long', c: '#7A4A2E' }, pose: ['rest', 'rest'], home: 'rest', moves: ['rest', 'clasp', 'hip/rest', 'cross/rest'], label: 'Tea-length, block heels', noun: 'Tea-length in', swap: 'main',
        build: [1.02, 0.985], face: { w: 0.02, cheek: 0.025 }, eyes: 1, lips: 0.85, cheer: 0.58, acc: { bangle: 'R' },
        wear: { kind: 'dress', cut: 'aline', len: 'tea', mat: 'cloth' }, c: { main: 'Dusk Rose' }, shoes: { kind: 'heel', c: '#C9A28F' } },
      { sex: 'm', body: 'mo', skin: '#E4B99E', hair: { style: 'grey', c: '#A9A6A0' }, pose: ['rest', 'rest'], home: 'fold', moves: ['fold', 'rest', 'hip/rest', 'clasp'], label: 'A shirt, a belt and smart trousers: no jacket needed', noun: 'A shirt, a belt and trousers in', tail: ': no jacket needed', swap: 'main',
        build: [1.05, 0.99], face: { w: 0.02, jaw: 0.025 }, beard: 0.05, eyes: 0, cheer: 0.52,
        wear: { kind: 'sep', top: { mat: 'cloth', collar: 'open', placket: true, cuff: 4 }, legs: { slot: 2, belt: 6 } }, c: { main: 'Midnight Navy', shirt: '#FFFFFF' }, shoes: { kind: 'oxford', c: '#7A5236' } },
    ],
    sun: [
      { sex: 'f', skin: '#E8BFA5', hair: { style: 'pony', c: '#D2B079' }, pose: ['rest', 'rest'], home: 'rest/hip', moves: ['rest/hip', 'fold', 'rest', 'clasp'], label: 'Jeans, sneakers and a soft knit',
        build: [1.0, 0.99], face: { w: -0.01, jaw: -0.02, long: 0.01 }, lips: 0.7, cheer: 0.55, acc: { shades: 'on' },
        wear: { kind: 'sep', top: { mat: 'knit', ease: 0.022, hem: ['hip', 0.05], collar: 'crew', slot: 2 }, legs: { mat: 'denim', ease: 0.008 } }, c: { main: '#F1E7D8', second: '#6F8FB3', shirt: '#FFFFFF' }, shoes: { kind: 'sneaker', c: '#F7F5F0' } },
      { sex: 'm', skin: '#EDC6AE', hair: { style: 'swept', c: '#8E6B45' }, pose: ['rest', 'rest'], home: 'clasp', moves: ['clasp', 'rest', 'hip', 'rest/hip'], label: 'A jumper, jeans and boots',
        build: [1.07, 1.02], face: { w: 0.03, jaw: 0.045, brow: 0.002 }, beard: 0.88, eyes: 0, brows: 0.6, cheer: 0.5, acc: { chain: 'heavy' },
        wear: { kind: 'sep', top: { mat: 'knit', ease: 0.02, hem: ['hip', -0.02], collar: 'crew', slot: 2 }, legs: { mat: 'denim' } }, c: { main: 'Night Sage', second: '#3F5A80' }, shoes: { kind: 'boot', c: '#6A4A33' } },
      { sex: 'f', skin: '#DFB194', hair: { style: 'wavy', c: '#4A3024' }, pose: ['rest', 'rest'], home: 'rest', moves: ['rest', 'clasp', 'rest/hip', 'fold'], label: 'A relaxed dress with a denim jacket',
        build: [0.99, 1.0], face: { cheek: 0.02, chin: 0.002 }, eyes: 1, lips: 0.9, cheer: 0.6, acc: { shades: 'up', frames: ROUND },
        wear: { kind: 'dress', cut: 'day', len: 'midi', mat: 'cloth', tiers: 3, over: 'denim' }, c: { main: 'Heather Mauve', extra: '#7E9CC0' }, shoes: { kind: 'flat', c: '#D8C2A8', lift: 0.012 } },
      { sex: 'm', body: ['m', 'mo', 0.25], skin: '#DFB194', hair: { style: 'crop', c: '#2A201A' }, pose: ['rest', 'rest'], home: 'hip/rest', moves: ['hip/rest', 'rest', 'fold', 'clasp'], label: 'A linen shirt, shorts and loafers',
        build: [0.98, 1.01], face: { long: 0.02, jaw: -0.01, chin: 0.002 }, beard: 0.08, eyes: 1, cheer: 0.55, acc: { shades: 'on', watch: 'L', chain: 'fine' },
        wear: { kind: 'sep', top: { mat: 'cloth', ease: 0.012, collar: 'open', placket: true, sleeve: 0.5 }, legs: { belt: 6, short: true } }, c: { main: '#FFFFFF', second: 'Stone Sand', shirt: '#FBFAF6' }, shoes: { kind: 'loafer', c: '#8A6242' } },
    ],
  };
})();
