// Team and league profiles (v2.3.0): every profile in this install, teams and
// leagues apart, and the one to open. Two ways in:
// - from the app's files before any profile runs (main.js). picker-preload.js
//   gives window.streamControl, and choosing starts the profile in this
//   window.
// - at /picker/ on a running profile's server (Settings, Profile, or a
//   dock). Choosing another profile posts /api/app/profile, and the app
//   restarts in it with that profile's port, so a page on this one's port
//   (a dock) does not come back with it.
(function () {
  const GROUPS = [
    { kind: 'team', title: 'Teams' },
    { kind: 'league', title: 'Leagues' },
  ];

  const api = window.streamControl || {
    profiles: () => fetch('/api/app/profiles').then((r) => r.json()),
    choose: (id) => fetch('/api/app/profile', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
    }).then((r) => r.json().then((b) => (r.ok ? b : Promise.reject(new Error(b.error || `Error ${r.status}`))))),
  };

  const list = document.getElementById('list');
  const status = document.getElementById('status');
  let info = { profiles: [], current: '', live: false, canSwitch: false };
  let busy = false;

  function setStatus(text, error) {
    status.textContent = text;
    status.classList.toggle('error', !!error);
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }

  function item(p) {
    const b = el('button', 'item');
    b.type = 'button';
    b.dataset.id = p.id;
    b.disabled = !!p.locked;
    b.classList.toggle('locked', !!p.locked);
    if (p.locked) { b.title = p.lockReason; b.setAttribute('aria-disabled', 'true'); }
    if (p.icon) {
      const img = el('img');
      img.src = p.icon;
      img.alt = '';
      b.appendChild(img);
    } else {
      b.appendChild(el('span', 'ph'));
    }
    const text = el('span', 'text');
    text.appendChild(el('span', 'name', p.name));
    // A team: the league it plays in. A league: its short name.
    const meta = p.kind === 'team' ? p.league : p.shortName;
    if (meta && meta !== p.name) text.appendChild(el('span', 'meta', meta));
    b.appendChild(text);
    if (p.locked) b.appendChild(el('span', 'tag', 'Locked'));
    else if (p.id === info.current) b.appendChild(el('span', 'tag', 'Open'));
    b.addEventListener('click', () => choose(p));
    return b;
  }

  function render() {
    list.textContent = '';
    if (!info.profiles.length) {
      setStatus('No profiles in this install.', true);
      return;
    }
    GROUPS.forEach((g) => {
      const profiles = info.profiles.filter((p) => p.kind === g.kind);
      if (!profiles.length) return;
      const section = el('section', 'group');
      section.appendChild(el('h2', '', g.title));
      const ul = el('ul', 'items');
      profiles.forEach((p) => {
        const li = el('li');
        li.appendChild(item(p));
        ul.appendChild(li);
      });
      section.appendChild(ul);
      list.appendChild(section);
    });
    const first = list.querySelector('.item:not(:disabled)');
    if (first) first.focus();
  }

  async function choose(p) {
    if (busy) return;
    if (p.locked) { setStatus(p.lockReason, true); return; }
    if (p.id === info.current) { location.href = '/control/'; return; }
    // `node server.js` on its own: nothing can restart it.
    if (info.current && !info.canSwitch) { setStatus(`Start the server with --profile=${p.id}.`, true); return; }
    if (info.current && info.live) {
      const open = (info.profiles.find((x) => x.id === info.current) || {}).name || 'This profile';
      const ok = window.confirm(`OBS is streaming or recording. Switching to ${p.name} restarts the app; ${open}'s browser sources go blank until it is opened again.`);
      if (!ok) return;
    }
    busy = true;
    list.querySelectorAll('.item').forEach((b) => { b.disabled = true; });
    setStatus(info.current ? `Restarting in ${p.name}…` : `Opening ${p.name}…`);
    try {
      await api.choose(p.id);
    } catch (err) {
      busy = false;
      list.querySelectorAll('.item').forEach((b) => { b.disabled = !!info.profiles.find((p) => p.id === b.dataset.id)?.locked; });
      setStatus(err.message || String(err), true);
    }
  }

  api.profiles().then((r) => {
    info = { ...info, ...r };
    document.getElementById('back').hidden = !info.current;
    if (info.version) document.getElementById('version').textContent = `v${info.version}`;
    render();
  }).catch((err) => setStatus(`Profiles could not be read: ${err.message || err}`, true));
})();
