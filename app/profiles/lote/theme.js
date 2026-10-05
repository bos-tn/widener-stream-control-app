// League of the East overlay theme script (v2.0.0). The overlay page loads it
// after its own markup. It builds the layers of the league's four scene
// backgrounds inside .brand-bg; theme.css styles them, and the overlay shows
// one per scene with body[data-bg] (picked per scene in the control panel).
// Ported from the LotE Background Set: 09 Mark Shine, 22 Word Rows, 23 Mark
// Pattern and 26 Curtains. Only the background in use is drawn, so the other
// three cost nothing in OBS.
(function () {
  var root = document.getElementById('brand-bg');
  if (!root) return;
  var name = (window.BRAND && window.BRAND.name) || 'League of the East';
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }
  function layer(id, html) {
    var d = document.createElement('div');
    d.className = 'bg bg-' + id;
    d.innerHTML = html;
    root.appendChild(d);
  }

  // 09 Mark Shine: a purple halo, the mark, and a band of light crossing it.
  layer('mark-shine', '<i class="halo"></i><i class="mk base"></i><i class="mk shine"></i>');

  // 22 Word Rows: five rows of the league's name in outline, drifting in
  // opposite directions. Each row holds its words twice, so the loop is
  // seamless. [seconds per loop, direction, fill]
  var unit = esc(name) + '<i></i>';
  var half = unit + unit + unit + unit;
  var rows = [[70, '', ''], [85, 'reverse', ''], [60, '', 'fill'], [95, 'reverse', ''], [75, '', '']];
  layer('word-rows', rows.map(function (r, i) {
    return '<div class="wr" style="--r:' + i + '"><div class="tk ' + r[2] + '" style="--d:' + r[0] + 's;' +
      (r[1] ? '--dir:' + r[1] + ';' : '') + (i % 2 ? 'margin-left:-420px' : '') + '">' + half + half + '</div></div>';
  }).join(''));

  // 23 Mark Pattern: eight rows of small marks sliding past each other,
  // under a slow purple wash.
  var marks = '';
  for (var i = 0; i < 8; i++) {
    marks += '<i class="mr" style="--r:' + i + ';' + (i % 2 ? '--dir:reverse;background-position-x:67px' : '') + '"></i>';
  }
  layer('mark-pattern', marks + '<i class="wash"></i>');

  // 26 Curtains: five slanted panes of light crossing slowly.
  // [width, left, strength, seconds, travel, lavender instead of purple]
  var panes = [[1000, -200, 0.30, 30, 420, ''], [640, 380, 0.06, 38, 520, 'w'], [900, 700, 0.24, 34, 460, ''],
    [520, 1100, 0.05, 42, 380, 'w'], [760, 1280, 0.34, 28, 340, '']];
  layer('curtains', panes.map(function (p) {
    return '<i class="pn ' + p[5] + '" style="--w:' + p[0] + 'px;--l:' + p[1] + 'px;--a:' + p[2] + ';--d:' + p[3] + 's;--m:' + p[4] + 'px"></i>';
  }).join(''));

  // The vignette, over whichever background is showing.
  var vig = document.createElement('i');
  vig.className = 'vig';
  root.appendChild(vig);
})();
