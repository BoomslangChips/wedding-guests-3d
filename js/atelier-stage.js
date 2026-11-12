/* atelier-stage.js: the stage of the dress code (see atelier-core.js).
   Four guests stand for each day. A guest of the site can turn any of them with a finger (or the arrow keys), tap
   one to step closer, change the day (the camera walks along the row), and on Saturday try the palette's colours
   on a dress or a suit. It draws only when something moves: an idle sway while it is on screen (never with reduced
   motion), nothing at all while it is off screen or the tab is hidden. The guests are alive: they breathe, shift
   their weight and look at whoever looks at them, and their skirts and long hair are cloth (atelier-cloth.js) that
   swings when they are turned. All of it is paced to the device (see `tier` below). */
(function () {
  'use strict';
  const A = window.WWAtelier; if (!A || !A.Renderer || !A.buildFigure || !A.Cloth) return;
  const { clamp, mix, smooth, M4 } = A;
  const STEP = 1 / 60;                                                // the cloth's own clock
  const REST = 180000;                                                // left alone this long (ms), the stage rests
  const wrapA = (a) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };
  const GROUP = 7;                                                    // metres between the days' groups
  const LIGHT = {
    fri: { key: [-0.50, 0.50, 0.70], keyC: [1.30, 0.92, 0.66], sky: [0.30, 0.31, 0.42], ground: [0.32, 0.21, 0.15], fog: [0.93, 0.89, 0.90], shadow: [0.20, 0.13, 0.14] },
    sat: { key: [-0.52, 0.70, 0.56], keyC: [1.26, 1.13, 0.98], sky: [0.44, 0.45, 0.50], ground: [0.30, 0.26, 0.24], fog: [0.98, 0.95, 0.94], shadow: [0.25, 0.17, 0.17] },
    sun: { key: [-0.40, 0.80, 0.52], keyC: [1.16, 1.13, 1.08], sky: [0.54, 0.56, 0.60], ground: [0.32, 0.30, 0.27], fog: [0.96, 0.97, 0.96], shadow: [0.20, 0.20, 0.19] },
  };
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // host: an empty element; opts: { days: [{ id, name }], start, colour(name) -> hex, palette: [{ name, hex, wear }], onDay(id) }
  A.mount = function (host, opts) {
    const days = opts.days.filter((d) => A.LOOKS[d.id]), colour = opts.colour || ((v) => v);
    if (!days.length) throw new Error('no looks');
    const still = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    host.innerHTML = '';
    const canvas = el('canvas', 'dc-stage__canvas'); canvas.setAttribute('aria-hidden', 'true');
    const dayName = el('p', 'dc-stage__day'); dayName.setAttribute('aria-hidden', 'true');
    const tabs = el('div', 'dc-stage__tabs'); tabs.setAttribute('role', 'group'); tabs.setAttribute('aria-label', 'The looks, day by day');
    tabs.innerHTML = days.map((d) => `<button type="button" class="dc-stage__tab" data-day="${d.id}">${esc(d.name.slice(0, 3))}<span>${esc(d.name.slice(3))}</span></button>`).join('');
    const marks = el('ol', 'dc-stage__marks'); marks.setAttribute('aria-label', 'The four looks, left to right');
    const card = el('div', 'dc-stage__card'); card.hidden = true;
    const hint = el('p', 'dc-stage__hint', 'Drag a guest to turn them <span aria-hidden="true">&middot;</span> tap one to step closer');
    // the view (the canvas and what lies on it) and, under it on a phone or on it on a wide screen, the card
    const view = el('div', 'dc-stage__view'); view.append(canvas, dayName, tabs, marks);
    host.append(view, hint, card);
    const R = new A.Renderer(canvas);

    /* ---- the cast: built a day at a time (the open day first, the others when the browser is idle) */
    const cast = {};                                                   // id -> [{ look, geo, pal, x, z, yaw, vel, rest, main }]
    const one = (id, i) => {
      const list = cast[id] || (cast[id] = []); if (list[i]) return list[i];
      const gi = days.findIndex((d) => d.id === id), look = A.LOOKS[id][i], f = A.buildFigure(look, colour);
      const fig = { look, geo: R.upload(f.geo), height: f.height * f.scale[1], sc: f.scale, look4: new Float32Array(f.look), pal: A.figurePalette(look, colour), gx: gi * GROUP, i, day: id, yaw: 0, vel: 0, rest: (i - 1.5) * -0.07, main: look.c.main, dim: 0, dimTo: 0,
        // its life, as the renderer and the cloth take it: a breath, the weight, the shoulders' turn (and 1: it is a figure); how it leans and how far its arms are off its sides;
        // the head's turn, nod and tilt; where the eyes look, how far they are shut, a smile; the body's heights; the shoulders of its hanging arms and their swing
        life: new Float32Array([0, 0, 0, 1]), lean: new Float32Array(4), head: new Float32Array(4), face: new Float32Array(4), body: new Float32Array(f.body), body2: new Float32Array(f.body2), arm: new Float32Array(f.arm), eye: f.eye * f.scale[1],
        col: f.col, acc: 0, sway: 0 };
      fig.m = mindOf(fig); fig.face[1] = 0.03; fig.face[3] = fig.m.smile;      // (it smiles from the first picture: also where nothing moves)
      // its arms: where their joints are as they hang, how their bones are turned now, the ways it can hold them
      fig.armE = new Float32Array(f.armE); fig.armW = new Float32Array(f.armW); fig.armQ = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
      fig.gest = f.gest; fig.up = [0, 0]; fig.gq = [];      // (up: how far each arm is from hanging, 0 .. 1)
      if (fig.gest) { fig.gName = look.home && !elbows(fig, look.home) ? look.home : 'rest'; fig.gNow = poseOf(fig, fig.gName); putArms(fig, fig.gNow); handCaps(fig); fig.m.gAt = S.t + rnd(6, 12) + i * rnd(2, 4); }
      // its cloth: each piece is stepped in the figure's own space without its turn, and sent again when it has moved
      // (with reduced motion a piece simply stays as it was cut, and turns with the figure)
      const stiff = still || S.tier > 0;
      fig.cloth = f.cloth.map((c) => ({ sim: stiff ? null : new A.Cloth(c), buf: c.geo.buf, cut: stiff ? null : Float32Array.from(c.geo.buf), geo: R.upload(c.geo, !stiff) }));      // (cut: the piece as it was made)
      fig.hung = stiff || !fig.cloth.length;
      return (list[i] = fig);
    };
    // let a figure's cloth hang (a job of its own: it takes as long as making the figure)
    const hang = (fig) => {
      if (fig.hung) return; fig.hung = true;
      const fr = { yaw: 0, L: fig, col: fig.col, air: 0 };
      fig.cloth.forEach((c) => { c.sim.reset(fr); for (let s = 0; s < 26; s++) c.sim.step(STEP, fr); c.sim.write(c.buf); R.update(c.geo, c.buf); });
    };
    // the cloth gives up its own movement: every piece back as it was cut, to go with the body from now on
    const stiffen = () => { Object.keys(cast).forEach((id) => cast[id].forEach((f) => { f.cloth.forEach((c) => { if (c.sim) { c.sim = null; c.buf.set(c.cut); R.update(c.geo, c.buf); } }); f.hung = true; })); S.dirty = true; };
    const build = (id) => { A.LOOKS[id].forEach((l, i) => hang(one(id, i))); return cast[id]; };
    // (tier: 0 = everything; 1 = on a device that cannot afford it the cloth no longer moves by itself: its pieces go with the body as they were cut, the guests stay alive;
    //  2 = and if that is not enough, nothing moves until the stage is touched)
    const S = { day: Math.max(0, days.findIndex((d) => d.id === opts.start)), focus: -1, w: 2, h: 2, dpr: 1, on: false, seen: false, t: 0, dirty: true, last: 0, alive: true, tier: 0, over: 0, cost: 0, gNext: 0, woke: performance.now() };
    const cam = { x: S.day * GROUP, y: 1.0, dist: 6, look: 0.95, from: null, to: null, t0: 0, dur: 0 };
    const figs = () => cast[days[S.day].id] || [];
    // where the figures of a group stand: closer together on a narrow stage, the gents half a step back
    const layout = () => {
      const narrow = S.w / S.h < 1.25, gap = clamp(0.30 + 0.24 * (S.w / S.h), 0.52, 0.86);
      Object.keys(cast).forEach((id) => cast[id].forEach((f) => { f.x = f.gx + (f.i - 1.5) * gap; f.z = narrow && f.look.sex === 'm' ? -0.16 : 0; }));
      S.gap = gap;
    };
    // the camera for the open day (all four) or for one figure
    const FOV = 23 * Math.PI / 180, TAN = Math.tan(FOV / 2);
    const frame = () => {
      const asp = S.w / S.h, f = S.focus >= 0 ? figs()[S.focus] : null;
      if (f) {
        // close: the figure fills the view (the card lies under the view on a phone, at the left of it on a wide screen)
        const phone = asp < 1.6, tall = phone ? f.height / 0.77 : f.height + 0.12, dist = Math.max(tall / 2 / TAN, 0.84 / 2 / (TAN * asp)), mid = phone ? 0.465 * tall : f.height * 0.5 + 0.01;
        return { x: f.x - (asp >= 1.6 ? Math.min(0.62, dist * TAN * asp * 0.34) : 0), y: mid, look: mid, dist };
      }
      const wide = S.gap * 3 + 0.74, tall = 2.34;
      return { x: S.day * GROUP, y: 1.06, look: 1.01, dist: Math.max(tall / 2 / TAN, wide / 2 / (TAN * asp)) };
    };
    const go = (ms) => { const to = frame(); if (still || !ms) { Object.assign(cam, to); cam.to = null; } else { cam.from = { x: cam.x, y: cam.y, look: cam.look, dist: cam.dist }; cam.to = to; cam.t0 = performance.now(); cam.dur = ms; } S.dirty = true; wake(); };
    const vpOf = () => { const eye = [cam.x, cam.y, cam.dist]; return { eye, vp: M4.mul(M4.persp(FOV, S.w / S.h, 0.3, 80), M4.look(eye, [cam.x, cam.look, 0], [0, 1, 0])) }; };
    const light = () => { const a = LIGHT[days[S.day].id] || LIGHT.sat; return a; };

    /* ---- the life of a guest
       What the renderer needs each frame (a breath, the weight, the head's angles, the eyes) comes from a small mind:
       it holds what the guest looks at and until when, where its weight is, how it breathes. All clocks are S.t
       (seconds of the stage's own life: it stands still while the stage rests). */
    const rnd = (a, b) => a + Math.random() * (b - a);
    const mindOf = (f) => ({ kind: 'you', who: null, until: rnd(1.2, 4), delay: 0, pending: null, after: null, ay: 0, ap: 0, tilt: 0,
      hy: 0, hp: 0, hr: 0, vy: 0, vp: 0, vr: 0, hyT: 0, hpT: 0, hrT: 0, ey: 0, ep: 0,
      w: f.i % 2 ? -0.75 : 0.75, wT: f.i % 2 ? -0.75 : 0.75, wv: 0, wUntil: rnd(2, 10), tw: 0, twv: 0, twT: 0,
      bp: Math.random(), bDur: rnd(3.7, 4.8), bAmp: 1, blinkAt: rnd(0.4, 3), b0: -9, again: 0, joy: 0, lady: f.look.sex === 'f',
      cheer: f.look.cheer == null ? 0.45 : f.look.cheer, smile: f.look.cheer == null ? 0.45 : f.look.cheer,      // (how readily it smiles: happy to be here)
      ph: [rnd(0, 6.3), rnd(0, 6.3), rnd(0, 6.3), rnd(0, 6.3), rnd(0, 6.3), rnd(0, 6.3)] });
    // look at something for a while: 'you' (whoever looks at the stage), 'peer' (another guest), 'down' (what it wears), 'away' (into the room)
    const lookAt = (f, kind, secs, who) => {
      const m = f.m; m.kind = kind; m.who = who || null; m.until = S.t + secs; m.delay = S.t + rnd(0.07, 0.17); m.tilt = rnd(-0.05, 0.05);
      if (kind === 'away') { m.ay = (Math.random() < 0.5 ? -1 : 1) * rnd(0.3, 0.8); m.ap = rnd(-0.05, 0.12); }
      if (kind === 'down') { m.ay = rnd(-0.16, 0.16); m.ap = rnd(-0.52, -0.38); }
      if (Math.random() < 0.7) m.blinkAt = S.t;                          // a new look often comes with a blink
    };
    const choose = (f) => {
      const m = f.m, open = figs(), close = S.focus >= 0 && open[S.focus] === f, r = Math.random();
      if (m.after) { const a = m.after; m.after = null; if (a.joy) m.joy = a.joy; return lookAt(f, a.kind, a.secs, a.who); }
      if (close) return r < 0.72 ? lookAt(f, 'you', rnd(3, 7)) : r < 0.87 ? lookAt(f, 'down', rnd(0.9, 1.6)) : lookAt(f, 'away', rnd(1.0, 2.2));
      if (m.kind !== 'you' && r < 0.5) return lookAt(f, 'you', rnd(2.5, 6));
      const peers = open.indexOf(f) >= 0 ? open.filter((g) => g !== f && g.hung) : [];
      if (r < 0.38) return lookAt(f, 'you', rnd(2.5, 6));
      if (r < 0.62 && peers.length) {
        const near = peers.filter((g) => Math.abs(g.i - f.i) === 1), from = near.length ? near : peers, who = from[Math.floor(Math.random() * from.length)], secs = rnd(1.6, 3.4);
        // (often the other looks back, and the two share a laugh)
        if (Math.random() < 0.55 && who.m && !who.m.pending) { m.joy = Math.max(m.joy, 0.9); who.m.pending = { at: S.t + rnd(0.25, 0.7), kind: 'peer', secs: secs - 0.3, who: f, joy: 0.9 }; }
        return lookAt(f, 'peer', secs, who);
      }
      if (r < 0.82) return lookAt(f, 'away', rnd(1.5, 3.5));
      return lookAt(f, 'down', rnd(0.9, 1.8));
    };
    // something happens to a guest (it is turned, stepped up to): it looks at whoever did it, and the others glance over
    const stir = (f, others) => {
      if (still || !f || !f.m) return;
      if (f.m.kind !== 'you') lookAt(f, 'you', rnd(3, 6)); else f.m.until = Math.max(f.m.until, S.t + 2.5);
      f.m.joy = Math.max(f.m.joy, 0.6);
      if (others) figs().forEach((g) => { if (g !== f && g.m && !g.m.pending && Math.random() < others) g.m.pending = { at: S.t + rnd(0.15, 0.7), kind: 'peer', secs: rnd(1.2, 2.6), who: f }; });
    };
    const spring = (m, x, v, to, w, z, dt) => { m[v] += (w * w * (to - m[x]) - 2 * z * w * m[v]) * dt; m[x] += m[v] * dt; };
    // ---- the arms: a way of holding them is named "clasp" (both arms), or "hip/rest" (the left / the right)
    const namesOf = (name) => (String(name).indexOf('/') >= 0 ? String(name).split('/') : [name, name]);
    const poseOf = (f, name) => { const G = f.gest, lr = namesOf(name); return [(G[lr[0]] || G.rest)[1], (G[lr[1]] || G.rest)[-1]]; };
    const putArms = (f, P) => { for (let i = 0; i < 2; i++) { const po = P[i]; f.armQ.set(po.qu, i * 12); f.armQ.set(po.qf, i * 12 + 4); f.armQ.set(po.qh, i * 12 + 8); f.armE[i * 4 + 3] = po.tw; f.up[i] = clamp((1 - Math.abs(po.qu[3])) * 30 + (1 - Math.abs(po.qf[3])) * 30, 0, 1); } };
    // from where its arms are to the pose `name`, in `secs`: an arm that goes from one held pose to another goes round
    // (by way of a loose arm); when both arms move, one starts a moment after the other
    const hold = (f, name, secs) => {
      const a = namesOf(f.gName), b = namesOf(name), plan = f.gest.planOf(a[0], a[1], b[0], b[1]);      // (each arm by its own way, found clear of the body and of the other arm)
      f.ga = { path: plan.path.map((fn, i) => fn || ((po) => () => po)(f.gNow[i])), t0: S.t, dur: secs, lag: [plan.lag[0] * secs, plan.lag[1] * secs] };
      f.gName = name;
    };
    // would the pose `name` put an elbow of f out towards a guest beside it whose own elbow is out on that side?
    // (a guest's left arm is on the side of the next guest in the row, its right arm on the side of the one before)
    // (on a narrow stage the guests stand shoulder to shoulder: there no elbow goes out towards a neighbour at all)
    const WIDE = { hip: 1 };
    const elbows = (f, name) => { const fl = cast[f.day] || figs(), i = f.i, n = namesOf(name), nx = fl[i + 1], pv = fl[i - 1], tight = S.gap < 0.6;
      return !!((WIDE[n[0]] && (nx || (tight && i < 3)) && (tight || (nx.gest && WIDE[namesOf(nx.gName)[1]]))) || (WIDE[n[1]] && (pv || (tight && i > 0)) && (tight || (pv.gest && WIDE[namesOf(pv.gName)[0]])))); };
    // its arms at once where they were going (a day that comes into view stands settled); and no new move before `wait` seconds
    const calm = (secs) => { S.gNext = Math.max(S.gNext, S.t + secs); };      // (no arm sets out for so long: after a day or a guest was switched)
    const settle = (f, wait) => { if (!f.gest) return; if (f.ga) { f.gNow = poseOf(f, f.gName); putArms(f, f.gNow); f.ga = null; handCaps(f); } f.gq.length = 0; if (f.m) f.m.gAt = Math.max(f.m.gAt || 0, S.t + wait); };
    // where its hands are, for what cloth must not pass through (a skirt gives way to a hand that comes to lie on it)
    const handCaps = (f) => {
      const hc = f.col && f.col.handCap; if (!hc || !f.gest) return;
      [1, -1].forEach((s, i) => {
        const k = hc[s]; if (k == null) return;
        const po = f.gNow[i], S0 = [f.arm[i * 4], f.arm[i * 4 + 1], f.arm[i * 4 + 2]], E0 = [f.armE[i * 4], f.armE[i * 4 + 1], f.armE[i * 4 + 2]], W0 = [f.armW[i * 4], f.armW[i * 4 + 1], f.armW[i * 4 + 2]];
        const E1 = A.V.add(S0, A.Q.rot(po.qu, A.V.sub(E0, S0))), W1 = A.V.add(E1, A.Q.rot(po.qf, A.V.sub(W0, E0))), ax = A.Q.rot(po.qh, A.V.norm(A.V.sub(W0, E0)));
        const c = f.col.caps[k], h0 = A.V.mix(E1, W1, 0.72);
        c[0] = h0[0]; c[1] = h0[1]; c[2] = h0[2]; c[3] = W1[0] + ax[0] * 0.13; c[4] = W1[1] + ax[1] * 0.13; c[5] = W1[2] + ax[2] * 0.13;
      });
    };
    // what its arms are to do, one thing after another: [[pose, seconds], ..]
    const say = (f, list) => { if (f.gest) f.gq = list.slice(); };
    const MOVES = ['rest', 'clasp'], BOTH = { fold: 1, clasp: 1 };
    function live(f, dt, close) {
      const m = f.m, t = S.t, body = f.yaw + f.sway;
      if (m.pending && t >= m.pending.at) { const q = m.pending; m.pending = null; if (q.after) m.after = q.after; if (q.joy) m.joy = Math.max(m.joy, q.joy); lookAt(f, q.kind, q.secs, q.who); }
      else if (t >= m.until) choose(f);
      // where what it looks at is, seen from its own shoulders: so far round, so far up
      let yT, pT;
      if (m.kind === 'down') { yT = m.ay; pT = m.ap; }
      else {
        const peer = m.kind === 'peer' && m.who && m.who.hung ? m.who : null;
        const tx = peer ? peer.x : cam.x, ty = peer ? peer.eye : cam.y + 0.04, tz = peer ? peer.z + 0.06 : cam.dist;
        const dx = tx - f.x, dz = tz - f.z;
        yT = wrapA(Math.atan2(dx, dz) - body); pT = Math.atan2(ty - f.eye, Math.hypot(dx, dz));
        if (m.kind === 'away') { yT = wrapA(yT + m.ay); pT = m.ap; }
        if (Math.abs(yT) > 1.75) { yT = 0; pT = 0; }                      // behind it: it looks ahead
      }
      // the eyes are there at once; the head follows a moment later and goes most of the way; the shoulders give a little
      if (t >= m.delay) { m.hyT = clamp(yT * 0.62, -0.48, 0.48); m.hpT = clamp(pT * 0.6, -0.30, 0.2); m.hrT = clamp(-m.hyT * 0.12 + m.tilt, -0.11, 0.11); m.twT = clamp(yT * 0.2, -0.15, 0.15); }
      spring(m, 'hy', 'vy', m.hyT, 7.2, 0.86, dt); spring(m, 'hp', 'vp', m.hpT, 7.2, 0.9, dt); spring(m, 'hr', 'vr', m.hrT, 5.5, 1, dt);
      spring(m, 'tw', 'twv', m.twT + 0.012 * Math.sin(t * 0.23 + m.ph[4]), 3.2, 1, dt);
      const k = Math.min(1, dt * 24);
      m.ey += (clamp(yT - m.tw - m.hy, -0.44, 0.44) - m.ey) * k; m.ep += (clamp(pT - m.hp, -0.3, 0.22) - m.ep) * k;
      // the weight goes from one leg to the other now and then
      if (t >= m.wUntil) { m.wT = Math.random() < 0.8 ? (m.wT >= 0 ? -1 : 1) * rnd(0.5, 1) : m.wT * rnd(0.4, 0.8); m.wUntil = t + rnd(5, 13); }
      spring(m, 'w', 'wv', m.wT, 2.6, 1, dt);
      // a breath: in a little faster than out; now and then a deeper one
      m.bp += dt / m.bDur; if (m.bp >= 1) { m.bp -= 1; m.bDur = rnd(3.6, 4.9); m.bAmp = Math.random() < 0.07 ? 1.7 : rnd(0.85, 1.15); }
      const breath = (m.bp < 0.4 ? 0.5 - 0.5 * Math.cos(Math.PI * m.bp / 0.4) : 0.5 + 0.5 * Math.cos(Math.PI * (m.bp - 0.4) / 0.6)) * m.bAmp;
      // a blink: shut in a twelfth of a second, open in a sixth; sometimes two
      if (t >= m.blinkAt) { m.b0 = t; m.blinkAt = t + rnd(2.2, 6.5); if (m.again <= 0 && Math.random() < 0.14) { m.blinkAt = t + 0.3; m.again = 1; } else m.again = 0; }
      const bt = t - m.b0, blink = bt < 0.08 ? bt / 0.08 : bt < 0.24 ? 1 - (bt - 0.08) / 0.16 : 0;
      // a smile for whoever stands before it, and a wider one for a moment when it is given something
      m.joy = Math.max(0, m.joy - dt * 0.28);
      const glad = m.cheer + (m.kind === 'you' ? (close ? 0.36 : 0.10) : m.kind === 'peer' ? 0.08 : m.kind === 'down' ? -0.12 : 0) + 0.5 * Math.min(1, m.joy);
      m.smile += (clamp(glad, 0.2, 1) - m.smile) * Math.min(1, dt * 3);
      // into the numbers
      f.life[0] = breath; f.life[1] = m.w; f.life[2] = m.tw;
      f.lean[0] = 0.006 * Math.sin(t * 0.33 + m.ph[0]) + 0.004 * Math.sin(t * 0.57 + m.ph[1]); f.lean[1] = 0.009 * Math.sin(t * 0.29 + m.ph[2]) + 0.005 * Math.sin(t * 0.49 + m.ph[3]);
      // its arms: now and then another way of holding them
      let arms = false;
      if (f.gest) {
        if (!f.ga && !f.gq.length && t >= m.gAt) {
          // (one guest at a time: while another's arms are on their way, or have only just come to rest, this one waits)
          if (t < S.gNext) m.gAt = S.gNext + rnd(0.4, 3);
          else {
            // (another of its ways, but none that puts an elbow out towards a neighbour whose elbow is out there too)
            const mv = (f.look.moves || MOVES).filter((n) => n !== f.gName && !elbows(f, n));
            if (mv.length) { const nx = mv[Math.floor(Math.random() * mv.length)]; if (BOTH[f.gName] && BOTH[nx]) f.gq.push(['rest', rnd(1.1, 1.4)], [nx, rnd(1.2, 1.6)]); else f.gq.push([nx, rnd(1.15, 1.6)]);      // (from one pose of both arms to another: by way of hanging arms)
              S.gNext = t + f.gq.reduce((a, q) => a + q[1] * 1.5, 0) + rnd(2.2, 5); }
            m.gAt = t + rnd(12, 24);
          }
        }
        if (!f.ga && f.gq.length) { const q = f.gq.shift(); if (q[0] !== f.gName) hold(f, q[0], q[1]); }
        const g = f.ga;
        if (g) { let done = true; f.gNow = [0, 1].map((i) => { const k = clamp((t - g.t0 - g.lag[i]) / g.dur, 0, 1); if (k < 1) done = false; return g.path[i](ease(k)); }); putArms(f, f.gNow); handCaps(f); if (done) f.ga = null; arms = true; }
      }
      f.lean[2] = (0.008 + 0.03 * Math.max(0, m.w)) * (1 - f.up[0]); f.lean[3] = (0.008 + 0.03 * Math.max(0, -m.w)) * (1 - f.up[1]);
      f.arm[3] = clamp(0.02 * Math.sin(t * 0.83 + m.ph[5]) + 0.3 * m.twv - 0.05 * m.wv, -0.08, 0.08) * (1 - 0.85 * f.up[0]); f.arm[7] = clamp(0.02 * Math.sin(t * 0.71 + m.ph[5] + 2) - 0.3 * m.twv + 0.05 * m.wv, -0.08, 0.08) * (1 - 0.85 * f.up[1]);
      f.head[0] = m.hy; f.head[1] = -m.hp + 0.03 - 0.012 * breath; f.head[2] = m.hr;
      f.face[0] = Math.tan(m.ey) * 0.9; f.face[1] = Math.tan(m.ep) * 0.9 + 0.03; f.face[2] = Math.max(blink, clamp(-m.ep * 1.1, 0, 0.26)); f.face[3] = m.smile;
      f.sway = 0.02 * Math.sin(t * 0.55 + f.i * 1.9 + f.gx);
      return arms || Math.abs(m.vy) > 0.25 || Math.abs(m.vp) > 0.25;                            // (arms on their way, a head in the middle of a turn: every frame is drawn)
    }

    /* ---- drawing */
    let raf = 0, pace = 0;
    const kick = () => { if (!raf && S.alive && S.on) raf = requestAnimationFrame(tick); };
    // is the stage where it can be seen? Asked of the page itself: what the observer said last can be out of date (a
    // stage that believed it was out of sight stood still for good, whatever was pressed, until the page was loaded again)
    const seen = () => { const r = host.getBoundingClientRect(), h = window.innerHeight || document.documentElement.clientHeight; return r.width > 0 && r.bottom > -80 && r.top < h + 80; };
    const wake = () => { S.woke = performance.now(); if (!S.on && seen()) { S.on = true; S.last = 0; S.dirty = true; } kick(); };      // a hand on the stage, or the stage come into view
    const soon = () => { if (!pace) pace = setTimeout(() => { pace = 0; kick(); }, 30); };       // (one timer: an idle stage draws about twenty times a second)
    function tick(now) {
      raf = 0;
      if (!S.alive || !S.on || document.hidden) return;
      const dt = Math.min(0.05, (now - (S.last || now)) / 1000), began = performance.now(); S.last = now;
      let moving = false;
      if (cam.to) {
        const k = clamp((now - cam.t0) / cam.dur, 0, 1), e = ease(k);
        ['x', 'y', 'look', 'dist'].forEach((p) => { cam[p] = mix(cam.from[p], cam.to[p], e); });
        if (k >= 1) cam.to = null; else moving = true;
        S.dirty = true;
      }
      let turning = false, lively = false;
      const alive = S.tier < 2 && now - S.woke < REST;                // (a device that cannot afford it, or a stage left alone for a while: the guests stand still)
      const list = [], open = figs(), reach = cam.to ? cam.dist * 0.9 + 2 : cam.dist * TAN * (S.w / S.h) + 0.7;      // (what is in view; while the camera walks, what it will pass)
      Object.keys(cast).forEach((id) => cast[id].forEach((f) => {
        if (Math.abs(f.x - cam.x) > reach || !f.hung) return;
        const close = S.focus >= 0 && open[S.focus] === f;
        if (!f.held) {
          if (Math.abs(f.vel) > 0.01) { f.yaw += f.vel * dt; f.vel *= Math.pow(0.04, dt); moving = true; f.idle = now; }
          else if (!still && close && alive && now - (f.idle || 0) > 2600) {
            // close up it presents itself: back to the front, then a slow turn to one side and the other (its dress follows)
            if (f.idle == null) f.idle = now - 2600;                       // (never turned by hand: its own turn begins now)
            const d = wrapA(0.52 * Math.sin((now - f.idle - 2600) * 0.00062) - f.yaw); f.yaw += d * Math.min(1, dt * 1.5); turning = true;
          }
          else if (!still && !close && now - (f.idle || 0) > 3200) { const d = wrapA(f.rest - f.yaw); if (Math.abs(d) > 0.004) { f.yaw += d * Math.min(1, dt * 2.2); moving = true; } }
        }
        if (!(f.yaw === f.yaw)) { f.yaw = f.rest; f.vel = 0; }             // (an angle that is not a number would leave nothing to draw: never)
        if (Math.abs(f.dim - f.dimTo) > 0.004) { f.dim += (f.dimTo - f.dim) * Math.min(1, dt * 7); moving = true; }
        if (!still) {
          if (alive && live(f, dt, close)) lively = true;
          // its cloth
          // (touched or still swinging: up to two steps a frame; idle: one step a frame, moved by the air, on a device that can afford it)
          const sims = f.cloth.length > 0 && !!f.cloth[0].sim;
          const breeze = alive, act = f.held || Math.abs(f.vel) > 0.01 || now - (f.lively || 0) < 500, unsettled = sims && now - (f.idle || 0) < 4000 && f.cloth.some((c) => c.sim.still < 45);
          if (sims && (act || breeze || unsettled)) {
            const fr = { yaw: f.yaw + f.sway, L: f, col: f.col, air: breeze ? 0.08 : 0 };
            f.acc = Math.min(f.acc + dt, S.tier === 0 ? 0.05 : STEP);        // (a slow device steps once a frame: its cloth moves slower, its frames do not)
            let stepped = false;
            while (f.acc >= STEP - 1e-6) { for (let c = 0; c < f.cloth.length; c++) f.cloth[c].sim.step(STEP, fr); f.acc -= STEP; stepped = true; }
            if (stepped) f.cloth.forEach((c) => { c.sim.write(c.buf); R.update(c.geo, c.buf); if (c.sim.moved > (now - (f.lively || 0) < 600 ? 1.1e-6 : 4e-6)) f.lively = now; });      // (swinging: from 2 mm a step, until under 1 mm)
            if (!breeze && (act || unsettled)) moving = true;
          }
        }
        list.push(f);
      }));
      if (!still && alive) { S.t += dt; moving = true; }             // (left alone for a few minutes, it rests)
      if (moving || S.dirty) {
        const v = vpOf(), L = light(), items = [];
        list.forEach((f) => {
          const yaw = f.yaw + f.sway, dim = f.dim * 0.62, model = M4.place(f.x, f.z, yaw, 0, f.sc);
          items.push({ geo: f.geo, model, pal: f.pal, dim, at: [f.x, f.z], life: f.life, lean: f.lean, head: f.head, body: f.body, body2: f.body2, arm: f.arm, armE: f.armE, armW: f.armW, armQ: f.armQ, face: f.face, look: f.look4 });
          f.cloth.forEach((c) => items.push(c.sim ? { geo: c.geo, model: M4.place(f.x, f.z, 0, 0, f.sc), pal: f.pal, dim } : { geo: c.geo, model, pal: f.pal, dim, life: f.life, lean: f.lean, head: f.head, body: f.body, body2: f.body2 }));
        });
        // the key light's own view of the stage (for its shadows): a box round what is in view, or round the one figure that is close
        const k = L.key, kl = Math.hypot(k[0], k[1], k[2]), one1 = S.focus >= 0 && !cam.to ? open[S.focus] : null;
        const cx = one1 ? one1.x : cam.x, hw = one1 ? 1.2 : Math.min(2.9, cam.dist * TAN * (S.w / S.h) + 0.5);
        const lvp = M4.mul(M4.ortho(-hw, hw, -Math.max(hw, 1.3), Math.max(hw, 1.3), 3.2, 9.2), M4.look([cx + k[0] / kl * 6, 0.95 + k[1] / kl * 6, k[2] / kl * 6], [cx, 0.95, 0], [0, 1, 0]));
        R.size(S.w, S.h, S.dpr);
        R.draw({ vp: v.vp, eye: v.eye, light: L, floor: [cam.x, Math.min(3.4, cam.dist * TAN * (S.w / S.h) + 0.5)], lvp, strength: 0.78, items });
        place(v.vp);
        S.dirty = false;
      }
      // a device that cannot keep up while a figure turns or the camera walks gives up the reflection, the light's
      // shadows and the shaped ones (round ones take their place) and the idle life, never the figures
      const hands = !!cam.to || list.some((f) => f.held || Math.abs(f.vel) > 0.01), busy = hands || turning || lively || list.some((f) => now - (f.lively || 0) < 400);      // (also while cloth is still swinging, or a head is turning)
      if (busy && S.busy) { if (now - S.prev > 42) S.slow = (S.slow || 0) + 1; else if (S.slow) S.slow--; if (S.slow > 14 && R.fine) { R.fine = false; if (S.tier < 1) { S.tier = 1; stiffen(); } S.dirty = true; } }
      S.busy = busy; S.prev = now;
      // a device whose idle frames cost too much gives up the cloth's own movement, then (if it must) the idle life
      if (!hands && !still && S.tier < 2 && S.t > 2.5) {
        const cost = performance.now() - began; S.cost = S.cost ? S.cost * 0.88 + cost * 0.12 : cost;
        if (cost > (S.tier ? 15 : 10)) { if (++S.over > 24) { S.tier++; S.over = 0; if (S.tier === 1) stiffen(); } } else if (S.over) S.over--;
      }
      // an idle stage is alive at a third of the speed: that is enough for a breath
      if (moving) { if (!busy) soon(); else kick(); }
    }
    // the numbers under the figures follow them
    function place(vp) {
      const fl = figs();
      [...marks.children].forEach((li, i) => {
        const f = fl[i]; if (!f) return;
        const p = M4.apply(vp, [f.x, 0.02, f.z + 0.1]);
        li.style.transform = `translate(${((p[0] * 0.5 + 0.5) * S.w).toFixed(1)}px, ${((0.5 - p[1] * 0.5) * S.h).toFixed(1)}px)`;
        li.style.opacity = S.focus >= 0 || cam.to ? 0 : 1;
      });
    }
    const resize = () => {
      const r = view.getBoundingClientRect(); if (r.width < 10) return;
      S.w = r.width; S.h = r.height; S.dpr = Math.min(window.devicePixelRatio || 1, r.width * r.height > 700000 ? 1.5 : 2);
      layout(); Object.assign(cam, frame()); cam.to = null; S.dirty = true; kick();
    };

    /* ---- the day */
    const labelOf = (f) => { const l = f.look; if (!l.noun) return l.label; return `${l.noun} ${String(f.main).toLowerCase()}${l.tail || ''}`; };
    const names = () => figs().map(labelOf);
    function showDay(i, ms) {
      S.day = clamp(i, 0, days.length - 1); S.focus = -1;
      const id = days[S.day].id; build(id); layout();
      // (the day's guests stand as they stood: nobody begins to move because the day was switched; their arms take
      // their turns again some seconds later, one guest after another)
      calm(5);
      { const order = [0, 1, 2, 3].sort(() => Math.random() - 0.5); figs().forEach((f, k) => { f.dimTo = 0; if (f.m) f.m.pending = null; settle(f, 5 + order[k % 4] * rnd(3, 4.5) + rnd(0, 2)); }); }
      dayName.textContent = days[S.day].name;
      host.dataset.day = id;
      [...tabs.children].forEach((b) => { const on = b.dataset.day === id; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      marks.innerHTML = names().map((n, k) => `<li><button type="button" data-look="${k}" aria-label="Look ${k + 1}: ${esc(n)}. Step closer">${k + 1}</button></li>`).join('');
      card.hidden = true; host.classList.remove('is-close');
      go(ms);
      if (opts.onDay) opts.onDay(id, names());
    }
    /* ---- one figure, close */
    function focus(i) {
      calm(5);
      const fl = figs(); if (i < 0 || !fl[i]) { S.focus = -1; fl.forEach((f) => { f.dimTo = 0; }); card.hidden = true; host.classList.remove('is-close'); go(650); if (opts.onLook) opts.onLook(days[S.day].id, -1); return; }
      S.focus = i; fl.forEach((f, k) => { f.dimTo = k === i ? 0 : 1; });
      stir(fl[i], 0.5);
      fl.forEach((g) => { if (g.m && g.gest) g.m.gAt = Math.max(g.m.gAt, S.t + rnd(5, 9)); });      // (no arm begins to move because a guest was stepped up to)
      const f = fl[i], sw = f.look.swap ? (opts.palette || []).filter((p) => p.wear === 'both' || p.wear === (f.look.sex === 'f' ? 'ladies' : 'gents')) : [];
      card.innerHTML = `<div class="dc-stage__head"><button type="button" data-step="-1" aria-label="The look before">&lsaquo;</button><p class="dc-stage__what" aria-live="polite"><span class="dc-stage__n" aria-hidden="true">${i + 1}</span><span class="dc-stage__label">${esc(labelOf(f))}</span></p><button type="button" data-step="1" aria-label="The next look">&rsaquo;</button></div>`
        + (sw.length ? `<div class="dc-stage__sws" role="group" aria-label="Try it in another colour of the palette">${sw.map((p) => `<button type="button" class="dc-stage__sw${p.name === f.main ? ' is-on' : ''}" data-colour="${esc(p.name)}" style="--c:${esc(p.hex)}" aria-label="${esc(p.name)}" aria-pressed="${p.name === f.main}"></button>`).join('')}</div>` : '')
        + `<div class="dc-stage__nav">${sw.length ? '<span class="dc-stage__try">Tap a colour to try it</span>' : '<span class="dc-stage__try">Drag to turn</span>'}<button type="button" class="dc-stage__all" data-look="-1">All four</button></div>`;
      card.hidden = false; host.classList.add('is-close');
      go(700);
      if (opts.onLook) opts.onLook(days[S.day].id, i);
    }
    const recolour = (f, name) => { const p = (opts.palette || []).find((x) => x.name === name); if (!p) return;
      if (!still && f.m) f.m.pending = { at: S.t + 0.12, kind: 'down', secs: 1.05, after: { kind: 'you', secs: 4.5, joy: 1 } };      // it looks down at what it has been given, then up, pleased
      f.main = name; const rgb = A.hex(p.hex); f.pal.set(rgb, 6); if (f.look.c.second == null || f.look.wear.legs && f.look.wear.legs.slot === 2) f.pal.set(rgb, 9); S.dirty = true; kick(); };

    /* ---- hands on: turn a figure, tap it, or use the keys */
    const pick = (cx) => { const v = vpOf(), r = canvas.getBoundingClientRect(); let best = -1, bd = 1e9; figs().forEach((f, i) => { const p = M4.apply(v.vp, [f.x, 1, f.z]), x = r.left + (p[0] * 0.5 + 0.5) * r.width, d = Math.abs(x - cx); if (d < bd) { bd = d; best = i; } }); return bd < Math.max(46, r.width * 0.16) ? best : -1; };
    let drag = null;
    host.addEventListener('pointerdown', wake); host.addEventListener('pointermove', (e) => { if (performance.now() - S.woke > 20000) wake(); }); host.addEventListener('keydown', wake);
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button) return;
      const i = S.focus >= 0 ? S.focus : pick(e.clientX);
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, i, moved: false, t: performance.now(), lx: e.clientX, lt: performance.now() };
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y, f = figs()[drag.i];
      if (!drag.moved) { if (Math.abs(dx) < 7 || Math.abs(dx) < Math.abs(dy)) { if (Math.abs(dy) > 14) drag = null; return; } drag.moved = true; try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* fine */ } host.classList.add('is-turned'); }
      if (!f) return;
      const now = performance.now(), step = (e.clientX - drag.lx) * 0.012;
      if (!f.held) stir(f, 0.6);
      f.held = true; f.yaw += step; f.vel = step / Math.max(0.008, (now - drag.lt) / 1000) * 0.9; drag.lx = e.clientX; drag.lt = now; f.idle = now;
      S.dirty = true; kick();
    });
    const up = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const f = figs()[drag.i], was = drag; drag = null;
      if (f) { f.held = false; if (performance.now() - was.lt > 90) f.vel = 0; f.vel = clamp(f.vel, -7.5, 7.5); }
      if (!was.moved && e.type === 'pointerup' && performance.now() - was.t < 600) { const i = pick(e.clientX); if (S.focus >= 0) focus(i === S.focus || i < 0 ? -1 : i); else if (i >= 0) focus(i); }
      kick();
    };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    host.addEventListener('click', (e) => {
      const t = e.target.closest('button'); if (!t) return;
      wake();                                                          // (a button of the stage itself was pressed: it is being looked at)
      if (t.dataset.day) { const i = days.findIndex((d) => d.id === t.dataset.day); if (i !== S.day) showDay(i, 950); }
      else if (t.dataset.look != null) focus(+t.dataset.look);
      else if (t.dataset.step) { const n = figs().length; focus((S.focus + +t.dataset.step + n) % n); }
      else if (t.dataset.colour && S.focus >= 0) { recolour(figs()[S.focus], t.dataset.colour); [...card.querySelectorAll('.dc-stage__sw')].forEach((b) => { const on = b === t; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on); }); card.querySelector('.dc-stage__label').textContent = labelOf(figs()[S.focus]); if (opts.onDay) opts.onDay(days[S.day].id, names()); }
    });
    host.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && S.focus >= 0) { focus(-1); e.preventDefault(); return; }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const b = e.target.closest && e.target.closest('[data-look], .dc-stage__card');
      const i = S.focus >= 0 ? S.focus : b && b.dataset && b.dataset.look != null ? +b.dataset.look : -1, f = figs()[i];
      if (!f) return;
      f.yaw += e.key === 'ArrowLeft' ? -0.35 : 0.35; f.idle = performance.now(); S.dirty = true; kick(); e.preventDefault();
    });

    /* ---- awake only while it can be seen */
    const io = 'IntersectionObserver' in window ? new IntersectionObserver((en) => { S.on = en[0].isIntersecting; if (S.on) { S.last = 0; S.dirty = true; wake(); } }, { rootMargin: '80px' }) : null;
    if (io) io.observe(host); else S.on = true;
    // (should the observer ever fail to say that the stage is back in view: the page being moved asks again, a few times a second at most)
    let asked = 0;
    const look = () => { if (S.on || S.dead) return; const now = performance.now(); if (now - asked < 250) return; asked = now; if (seen()) wake(); };
    window.addEventListener('scroll', look, { passive: true });
    const ro = 'ResizeObserver' in window ? new ResizeObserver(resize) : null;
    if (ro) ro.observe(view); else window.addEventListener('resize', resize);
    const vis = () => { if (!document.hidden) { S.last = 0; S.dirty = true; wake(); } };
    document.addEventListener('visibilitychange', vis);
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); if (S.dead) return; S.alive = false; host.classList.add('is-lost'); if (opts.onLost) opts.onLost(); });

    // The guests are made one at a time, between frames: the open day's four first (the stage shows itself when they
    // stand), then the other days' while nothing else is going on. A day asked for sooner is finished at once.
    const later = window.requestIdleCallback ? (fn) => requestIdleCallback(fn, { timeout: 500 }) : (fn) => setTimeout(fn, 50);
    const first = days[S.day].id, queue = [];
    [first].concat(days.map((d) => d.id).filter((id) => id !== first)).forEach((id) => A.LOOKS[id].forEach((l, i) => queue.push([id, i])));
    let shown = false;
    const more = () => {
      if (!S.alive) return;
      const job = queue.shift();
      if (job) {
        try { if (job[2]) hang(one(job[0], job[1])); else if (!one(job[0], job[1]).hung) queue.unshift([job[0], job[1], 1]); } catch (e) { S.alive = false; host.classList.add('is-lost'); if (opts.onLost) opts.onLost(); return; }
        layout(); S.dirty = true;
      }
      if (!shown && cast[first] && cast[first].filter((f) => f && f.hung).length === A.LOOKS[first].length) { shown = true; resize(); showDay(S.day, 0); }
      if (queue.length) later(more); else { kick(); warm(); }
    };
    // When all stand: what each guest's arms can do is worked out, a pose or a way at a time, while nothing else is
    // going on (a pose is worked out when it is first asked for: so no move begins with a wait)
    const warm = () => {
      const jobs = [];
      Object.keys(cast).forEach((id) => cast[id].forEach((f) => {
        if (!f || !f.gest) return; const mv = f.look.moves || MOVES;
        mv.forEach((n) => jobs.push(() => poseOf(f, n)));
        mv.forEach((a) => mv.forEach((b) => { if (a !== b && !(BOTH[a] && BOTH[b])) jobs.push(() => { const x = namesOf(a), y = namesOf(b); f.gest.planOf(x[0], x[1], y[0], y[1]); }); }));
      }));
      const next = () => { if (S.dead || !S.alive) return; const j = jobs.shift(); if (!j) return; j(); if (jobs.length) later(next); };
      if (jobs.length) later(next);
    };
    resize(); later(more);                              // (not in the same breath as unpacking the bodies)
    return {
      setDay(id, ms) { const i = days.findIndex((d) => d.id === id); if (i >= 0 && i !== S.day) showDay(i, ms == null ? 950 : ms); },
      focus, names, day: () => days[S.day].id,
      // (for the tests: a guest's arms into a pose by name; what each guest's arms are doing)
      pose: (i, name, secs) => { const f = figs()[i]; if (f && f.gest) { say(f, [[name, secs || 1.2]]); f.m.gAt = S.t + 30; wake(); } },
      arms: () => figs().map((f) => (f.gest ? [f.gName, !!f.ga, f.gq.length, f.look.moves || []] : null)),
      // (for the tests: how the stage is pacing itself, and what its guests are doing)
      state: () => ({ minds: figs().map((f) => f.m && [f.m.kind, +f.m.hy.toFixed(2), +f.m.w.toFixed(2), +f.m.smile.toFixed(2)]), tier: S.tier, cost: +S.cost.toFixed(2), busy: !!S.busy, fine: R.fine, on: !!S.on, alive: !!S.alive, raf: !!raf, pace: !!pace, cloth: figs().map((f) => f.cloth.map((c) => (c.sim ? [c.sim.still, +(Math.sqrt(c.sim.moved || 0) * 1000).toFixed(3)] : null))) }),
      destroy() { S.dead = true; S.alive = false; try { const x = R.gl.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); } catch (e) { /* fine */ } if (io) io.disconnect(); if (ro) ro.disconnect(); document.removeEventListener('visibilitychange', vis); window.removeEventListener('scroll', look); },
    };
  };
})();
