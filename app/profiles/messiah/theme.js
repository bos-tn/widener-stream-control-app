// Messiah beta: draw only the selected gallery plate for this scene. The
// 1920x1080 stage is scaled by the shared overlay and stays on localhost.
(function () {
  'use strict';
  var root = document.getElementById('brand-bg');
  if (!root) return;
  var brand = window.BRAND || {};
  var plates = {
    'plate-30': { id: '30', family: 'Hardline' },
    'plate-25': { id: '25', family: 'Hardline' },
    'plate-08': { id: '08', family: 'Flight' },
    'plate-01': { id: '01', family: 'Glass' },
    'plate-05': { id: '05', family: 'Flight' },
  };
  var view = new URLSearchParams(window.location.search).get('view');
  var defaults = (brand.backgrounds || {}).defaults || {};
  var chosen = defaults[view] || 'plate-25';
  if (!document.body.dataset.bg) document.body.dataset.bg = chosen;
  var canvas = document.createElement('canvas');
  canvas.className = 'messiah-plate';
  canvas.width = 1920;
  canvas.height = 1080;
  root.appendChild(canvas);
  var ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return;
  var engine = null;
  var lastFrame = -Infinity;
  var frameMs = 1000 / 30;
  var observer = new MutationObserver(function () {
    chosen = plates[document.body.dataset.bg] ? document.body.dataset.bg : (defaults[view] || 'plate-25');
    lastFrame = -Infinity;
  });
  observer.observe(document.body, { attributes: true, attributeFilter: ['data-bg'] });
  function frame(now) {
    requestAnimationFrame(frame);
    if (!engine || now - lastFrame < frameMs || getComputedStyle(root).display === 'none') return;
    lastFrame = now;
    engine.draw(ctx, plates[chosen] || plates['plate-25'], now / 1000, 1920, 1080);
  }
  var script = document.createElement('script');
  script.src = '/brand/plate-engine.js';
  script.onload = function () {
    engine = window.MESSIAH_ENGINE;
    if (engine) requestAnimationFrame(frame);
  };
  script.onerror = function () { console.error('Messiah plate engine could not load'); };
  document.head.appendChild(script);
})();
