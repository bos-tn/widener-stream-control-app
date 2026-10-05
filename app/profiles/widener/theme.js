// Widener Esports overlay theme script (v2.0.0). The overlay page loads it
// after its own markup. It builds the layers of the scene backgrounds inside
// .brand-bg; theme.css styles them, and the overlay shows one per scene with
// body[data-bg] (picked per scene in the control panel).
// Ported from the Widener Background Set: 01 Varsity Stripes, 02 Shutters,
// 12 W Shine, 14 Pride Lions and 27 Pride Tape. "Moving Stripes", the sixth
// choice, is the page's own stripes and needs no layer. Only the background
// in use is drawn, so the others cost nothing in OBS.
(function () {
  var root = document.getElementById('brand-bg');
  if (!root) return;
  var brand = window.BRAND || {};
  var doc = document.documentElement;
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }
  // Every layer starts with the stage's ground and ends with the vignette.
  function layer(id, html) {
    var d = document.createElement('div');
    d.className = 'bg bg-' + id;
    d.innerHTML = '<i class="ground"></i>' + html + '<i class="vig"></i>';
    root.appendChild(d);
  }

  // The backgrounds are drawn at 1920 x 1080 and scaled to cover the page.
  function fit() { doc.style.setProperty('--bg-fit', Math.max(window.innerWidth / 1920, window.innerHeight / 1080)); }
  fit();
  window.addEventListener('resize', fit);

  // Until the first state arrives the page doesn't know which background its
  // scene uses. Start from the scene's default, so a scene that keeps its
  // default never shows the stripes for a moment first.
  var view = new URLSearchParams(window.location.search).get('view');
  var dflt = ((brand.backgrounds || {}).defaults || {})[view];
  if (dflt && !document.body.dataset.bg) document.body.dataset.bg = dflt;

  // The W and the lions are the profile's own art, never redrawn.
  doc.style.setProperty('--bg-w', 'url(' + (brand.logo || '/brand/logo.png') + ')');
  doc.style.setProperty('--bg-lions', 'url(' + (brand.mascot || '/brand/mascot.png') + ')');

  // 01 Varsity Stripes: two depths of stripes under a sheen.
  layer('varsity-stripes', '<i class="vs b"></i><i class="vs a"></i><i class="sheen"></i>');

  // 02 Shutters: twenty slats, each starting its glow a little after the last.
  var slats = '';
  for (var i = 0; i < 20; i++) slats += '<i class="sl" style="--i:' + i + '"></i>';
  layer('shutters', slats);

  // 12 W Shine: a blue halo, the W, and a band of light crossing it.
  layer('w-shine', '<i class="halo"></i><i class="mk art"></i><i class="mk shine"></i>');

  // 14 Pride Lions: a halo, the lions, and a glint along the mane.
  layer('pride-lions', '<i class="halo"></i><i class="ln art"></i><i class="ln shine"></i>');

  // 27 Pride Tape: three bands of words. [top, seconds per loop, direction, gold]
  var unit = 'Go Pride<i></i>Blue &amp; Gold<i></i>' + esc(brand.name || 'Widener Esports') + '<i></i>';
  var half = unit + unit + unit + unit + unit;
  var tapes = [[210, 70, '', ''], [560, 110, 'reverse', 'g'], [840, 84, '', '']];
  layer('pride-tape', '<i class="glow"></i>' + tapes.map(function (t) {
    return '<div class="tape ' + t[3] + '" style="--y:' + t[0] + 'px"><div class="tk" style="--d:' + t[1] + 's;' +
      (t[2] ? '--dir:' + t[2] : '') + '">' + half + half + '</div></div>';
  }).join(''));
})();
