// The demo page: loads the bodies, puts the stage on the page with the three days and the wedding's colours.
// Everything that draws and moves is in js/atelier-*.js (window.WWAtelier).
(async function () {
  // Your own links: the repository, and a "buy me a coffee" page (leave '' to hide it).
  const SOURCE = 'https://github.com/BoomslangChips/wedding-guests-3d';
  const COFFEE = '';

  const src = document.getElementById('source'), coffee = document.getElementById('coffee');
  if (SOURCE) src.href = SOURCE; else src.hidden = true;
  if (COFFEE) { coffee.href = COFFEE; coffee.hidden = false; }

  // The wedding's palette. wear: who a colour is suggested for (the stage offers it on the guests it suits).
  const PALETTE = [
    { name: 'Blush', hex: '#F0C4CB', wear: 'both' }, { name: 'Dusk Rose', hex: '#B48A93', wear: 'ladies' },
    { name: 'Heather Mauve', hex: '#9E7F8E', wear: 'ladies' }, { name: 'Night Sage', hex: '#8E9A92', wear: 'gents' },
    { name: 'Sage Mist', hex: '#B9C4BD', wear: 'ladies' }, { name: 'Slate Eucalyptus', hex: '#5A6964', wear: 'both' },
    { name: 'Stone Sand', hex: '#D6CBBE', wear: 'gents' }, { name: 'Dusty Blue', hex: '#8FA6B8', wear: 'both' },
    { name: 'Midnight Navy', hex: '#27334A', wear: 'both' }, { name: 'Burgundy', hex: '#6E2D3C', wear: 'both' },
    { name: 'Champagne', hex: '#FBEAD6', wear: 'accent' }, { name: 'Moonbone', hex: '#F2EEE9', wear: 'accent' },
  ];
  const DAYS = [{ id: 'fri', name: 'Friday' }, { id: 'sat', name: 'Saturday' }, { id: 'sun', name: 'Sunday' }];
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const host = document.getElementById('stage'), wearing = document.getElementById('wearing');
  const fallback = () => { host.hidden = true; wearing.hidden = true; document.getElementById('nogl').hidden = false; document.getElementById('noglPic').hidden = false; };
  const canDraw = () => { try { const c = document.createElement('canvas'), g = c.getContext('webgl') || c.getContext('experimental-webgl'); if (!g) return false; const x = g.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); return true; } catch (e) { return false; } };
  if (!window.WWAtelier || !window.WWAtelier.mount || !canDraw()) { fallback(); return; }
  try {
    await window.WWAtelier.loadBody('3d/body.json');
    host.textContent = ''; host.classList.remove('is-wait');      // (its place was kept: the stage itself takes it)
    window.stage = window.WWAtelier.mount(host, {
      days: DAYS, start: 'sat', palette: PALETTE,
      colour: (v) => { const p = PALETTE.find((x) => norm(x.name) === norm(v)); return p ? p.hex : v; },
      onDay: (id, names) => { wearing.textContent = 'Left to right: ' + names.join(' · '); },
      onLost: fallback,
    });
  } catch (e) { console.error(e); fallback(); }
})();
