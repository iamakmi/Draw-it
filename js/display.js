/* =====================================================================
 * DRAW IT (웹 버전) — 메인 미디어월 스크립트
 *  · 방(room) 단위로 그림을 주고받고 localStorage 에 영구 저장
 *  · ntfy.sh 공개 채널로 손님 휴대폰 ↔ 미디어월 실시간 연결
 *  · 새 그림 스포트라이트 등장 + 모든 캐릭터가 그쪽을 바라보는 시선 반응
 * ===================================================================== */
(function () {
  'use strict';

  var SH = window.DrawItShapes;
  var RL = window.DrawItRelay;
  var qs = function (sel, root) { return (root || document).querySelector(sel); };

  var DEFAULT_SETTINGS = {
    theme: 'lavender',
    qrPosition: 'bottom',
    titlePosition: 'top-center',
    qrVisible: true,
    fontScale: 100,
    title: '방명록',
    subtitle: "What's on your mind? Fill your bubble!"
  };

  var ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  var MAX_CARDS = 48;
  var CARD_MIN = 152;
  var CARD_MAX = 212;

  /* 동그란 말풍선 모양의 '똑' 마스코트 3종 (미디어월에서 항상 함께 둥실둥실 떠다님) */
  var MASCOTS = [
    { id: 'mascot-ttok-1', template: 'bubble', bg: 'pink',  mascotImg: 'ttok1.png', isMascot: true, strokes: [] },
    { id: 'mascot-ttok-2', template: 'bubble', bg: 'cream', mascotImg: 'ttok2.png', isMascot: true, strokes: [] },
    { id: 'mascot-ttok-3', template: 'bubble', bg: 'sky',   mascotImg: 'ttok3.png', isMascot: true, strokes: [] }
  ];

  function ensureMascots() {
    MASCOTS.forEach(function (m) {
      if (!state.cards.has(m.id)) addCard(m, { instant: true });
    });
  }

  var el = {
    stage: qs('#stage'),
    topbar: qs('#topbar'),
    brandBadge: qs('.brand-badge'),
    title: qs('#title'),
    subtitle: qs('#subtitle'),
    qrPanel: qs('#qrPanel'),
    qrCanvas: qs('#qrCanvas'),
    drawUrl: qs('#drawUrl'),
    roomCode: qs('#roomCode'),
    countNum: qs('#countNum'),
    spotlight: qs('#spotlight'),
    toast: qs('#toast'),
    conn: qs('#conn'),
    touchbar: qs('#touchbar'),
    touchShow: qs('#touchShow'),
    quickSettings: qs('#quickSettings'),
    badge: qs('#countBadge'),
    hint: qs('#hint')
  };

  var state = {
    cards: new Map(),
    order: [],
    settings: Object.assign({}, DEFAULT_SETTINGS),
    room: '',
    drawUrl: '',
    uiHidden: false,
    barFolded: false,
    link: null,
    relayStatus: 'closed',
    gaze: { el: null, until: 0, strength: 0 },
    last: 0,
    saveTimer: null
  };

  /* ------------------------------------------------------------- 저장소 */

  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (e) { return fallback; }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 용량 초과 등 */ }
  }

  function roomKey(kind) { return 'drawit:' + kind + ':' + state.room; }

  function saveDrawings() {
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(function () {
      state.saveTimer = null;
      var list = [];
      state.order.forEach(function (id) {
        var c = state.cards.get(id);
        if (c && !c.data.isMascot) list.push(c.data);
      });
      writeJSON(roomKey('drawings'), list);
    }, 300);
  }

  function loadDrawings() {
    var stored = readJSON(roomKey('drawings'), null);
    if (!Array.isArray(stored)) {
      var seed = (window.DRAWIT_SEED || []).map(function (d) { return d; });
      writeJSON(roomKey('drawings'), seed);
      return seed;
    }
    return stored;
  }

  function saveSettings() { writeJSON('drawit:settings', state.settings); }
  function loadSettings() {
    var s = readJSON('drawit:settings', null);
    state.settings = Object.assign({}, DEFAULT_SETTINGS, s || {});
  }

  function newRoomId() {
    var out = '';
    var buf = new Uint8Array(8);
    (window.crypto || window.msCrypto).getRandomValues(buf);
    for (var i = 0; i < 8; i++) out += ALPHABET[buf[i] % ALPHABET.length];
    return out;
  }

  function rememberRoom(id) {
    var list = readJSON('drawit:rooms', []);
    if (!list.some(function (r) { return r.id === id; })) {
      list.push({ id: id, createdAt: Date.now() });
      writeJSON('drawit:rooms', list.slice(-12));
    }
  }

  function ensureRoom() {
    var fromUrl = (location.search.match(/[?&]room=([A-Za-z0-9]+)/) || [])[1];
    var saved = readJSON('drawit:room', '') || '';
    var room = (fromUrl || saved || '').toUpperCase();
    if (!room) room = newRoomId();
    state.room = room;
    writeJSON('drawit:room', room);
    rememberRoom(room);
    return room;
  }

  /* ------------------------------------------------------------ 유틸 */

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function easeOutBack(t) {
    var c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }
  function hash(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return Math.abs(h);
  }
  function lighten(hex, amt) {
    var n = parseInt(hex.slice(1), 16);
    var r = clamp(((n >> 16) & 255) + amt, 0, 255);
    var g = clamp(((n >> 8) & 255) + amt, 0, 255);
    var b = clamp((n & 255) + amt, 0, 255);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  /* ------------------------------------------------------------ 배치 계산 */

  function field() {
    var W = window.innerWidth, H = window.innerHeight;
    var pad = clamp(W * 0.022, 18, 44);
    var tpos = (state.settings && state.settings.titlePosition) || 'top-center';
    var top = tpos === 'top-center' ? clamp(H * 0.165, 118, 195) : clamp(H * 0.08, 64, 110);
    return { x: pad, y: top, w: W - pad * 2, h: H - top - pad - 12 };
  }

  function reservedRects() {
    var out = [];
    function reserve(node, pad) {
      if (!node) return;
      var r = node.getBoundingClientRect();
      if (!r.width || !r.height) return;
      out.push({ x: r.left - pad, y: r.top - pad, w: r.width + pad * 2, h: r.height + pad * 2 });
    }
    if (state.settings && state.settings.qrVisible !== false) reserve(el.qrPanel, 18);
    if (el.touchbar && !state.barFolded && !state.uiHidden) reserve(el.touchbar, 12);
    if (el.hint && !state.uiHidden && getComputedStyle(el.hint).display !== 'none') reserve(el.hint, 8);
    if (el.badge && !state.uiHidden) reserve(el.badge, 10);
    if (el.brandBadge && !state.uiHidden) reserve(el.brandBadge, 10);
    if (el.topbar && !state.uiHidden) reserve(el.topbar, 12);
    return out;
  }

  function gapTo(a, b) {
    var dx = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w));
    var dy = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h));
    if (dx >= 0 && dy >= 0) return Math.hypot(dx, dy);
    return Math.max(dx, dy);
  }

  function isChristmas() {
    var th = (state.settings && state.settings.theme) || document.documentElement.dataset.theme;
    return th === 'christmas' || th === 'starlight';
  }

  /* 별빛 크리스마스 트리 (퍼플 스파클 나선 트리 + Merry Christmas 캘리그라피) 렌더링 */
  function paintStarlightTree() {
    var cv = qs('#starlightCanvas');
    if (!cv) return;
    var ctx = cv.getContext('2d');
    var W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);

    var seed = 20261225;
    function rnd() {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    var cx = W * 0.5;
    var topY = 105;
    var botY = 785;
    var treeH = botY - topY;

    var bgGlow = ctx.createRadialGradient(cx, topY + treeH * 0.55, 20, cx, topY + treeH * 0.55, 390);
    bgGlow.addColorStop(0, 'rgba(195, 110, 255, 0.25)');
    bgGlow.addColorStop(0.5, 'rgba(130, 55, 200, 0.10)');
    bgGlow.addColorStop(1, 'rgba(40, 10, 70, 0)');
    ctx.fillStyle = bgGlow;
    ctx.fillRect(0, 0, W, H);

    var floorGlow = ctx.createRadialGradient(cx, botY + 18, 10, cx, botY + 18, 320);
    floorGlow.addColorStop(0, 'rgba(235, 175, 255, 0.28)');
    floorGlow.addColorStop(0.5, 'rgba(140, 60, 210, 0.10)');
    floorGlow.addColorStop(1, 'rgba(20, 5, 35, 0)');
    ctx.fillStyle = floorGlow;
    ctx.beginPath();
    ctx.ellipse(cx, botY + 18, 320, 38, 0, 0, Math.PI * 2);
    ctx.fill();

    function drawGlowDot(x, y, r, alpha, tint) {
      var g = ctx.createRadialGradient(x, y, 0, x, y, r * 3.2);
      g.addColorStop(0, 'rgba(255, 255, 255, ' + alpha + ')');
      g.addColorStop(0.35, tint || 'rgba(240, 185, 255, ' + (alpha * 0.65) + ')');
      g.addColorStop(1, 'rgba(180, 90, 255, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r * 3.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = 'rgba(255, 255, 255, ' + Math.min(1, alpha * 1.15) + ')';
      ctx.beginPath();
      ctx.arc(x, y, r * 0.75, 0, Math.PI * 2);
      ctx.fill();
    }

    for (var i = 0; i < 1550; i++) {
      var t = Math.pow(rnd(), 0.78);
      var y = topY + t * treeH;
      var maxR = (10 + t * 265) * (0.92 + 0.08 * Math.sin(t * Math.PI * 11));
      var spread = (rnd() - 0.5) * 2;
      var x = cx + spread * maxR * (0.35 + 0.65 * Math.pow(rnd(), 0.45));
      var yy = y + (rnd() - 0.5) * 18;
      var sz = 0.8 + Math.pow(rnd(), 2.4) * 3.2;
      var al = 0.25 + rnd() * 0.7;
      drawGlowDot(x, yy, sz, al);
    }

    var turns = 5.6;
    var steps = 920;
    for (var s = 0; s < steps; s++) {
      var u = s / steps;
      var angle = u * turns * Math.PI * 2;
      var front = Math.sin(angle);
      var ty = topY + u * treeH;
      var coneR = 8 + u * 262;
      var sx = cx + Math.cos(angle) * coneR;
      var sy = ty + Math.sin(angle) * (12 + u * 24);

      var scatter = (front > -0.2) ? 16 : 8;
      for (var k = 0; k < 3; k++) {
        var jx = sx + (rnd() - 0.5) * scatter * (0.5 + u);
        var jy = sy + (rnd() - 0.5) * (scatter * 0.65);
        var r = (front > 0 ? 1.5 + rnd() * 2.8 : 0.9 + rnd() * 1.6);
        var a = (front > 0 ? 0.55 + rnd() * 0.45 : 0.2 + rnd() * 0.28);
        drawGlowDot(jx, jy, r, a);
      }
    }

    var flares = [
      [0.18, 0.15, 22], [0.30, -0.22, 20], [0.36, 0.38, 25],
      [0.48, -0.35, 28], [0.54, 0.18, 22], [0.62, 0.48, 27],
      [0.71, -0.18, 26], [0.76, -0.58, 24], [0.81, 0.34, 28],
      [0.91, -0.55, 30], [0.93, 0.08, 24], [0.94, 0.64, 30]
    ];
    for (var fi = 0; fi < flares.length; fi++) {
      var fu = flares[fi][0], fxr = flares[fi][1], frad = flares[fi][2];
      var fy = topY + fu * treeH;
      var fx = cx + fxr * (12 + fu * 265);
      var fg = ctx.createRadialGradient(fx, fy, 0, fx, fy, frad * 2.2);
      fg.addColorStop(0, 'rgba(255, 255, 255, 0.98)');
      fg.addColorStop(0.25, 'rgba(250, 210, 255, 0.78)');
      fg.addColorStop(0.55, 'rgba(210, 120, 255, 0.28)');
      fg.addColorStop(1, 'rgba(160, 60, 230, 0)');
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.arc(fx, fy, frad * 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    for (var d = 0; d < 180; d++) {
      var du = rnd();
      var dy = topY - 20 + du * (treeH + 60);
      var dx = cx + (rnd() - 0.5) * (140 + du * 640);
      drawGlowDot(dx, dy, 0.7 + rnd() * 1.8, 0.2 + rnd() * 0.55);
    }

    var starY = topY - 8;
    var topGlow = ctx.createRadialGradient(cx, starY, 0, cx, starY, 95);
    topGlow.addColorStop(0, 'rgba(255, 255, 255, 1)');
    topGlow.addColorStop(0.22, 'rgba(252, 215, 255, 0.85)');
    topGlow.addColorStop(0.5, 'rgba(215, 125, 255, 0.32)');
    topGlow.addColorStop(1, 'rgba(160, 60, 240, 0)');
    ctx.fillStyle = topGlow;
    ctx.beginPath();
    ctx.arc(cx, starY, 95, 0, Math.PI * 2);
    ctx.fill();

    var rays = [
      { ang: -0.24, len: 135, w: 2.6 },
      { ang: -0.24 + Math.PI * 0.5, len: 95, w: 2.2 },
      { ang: 0.45, len: 70, w: 1.5 },
      { ang: 0.45 + Math.PI * 0.5, len: 70, w: 1.5 }
    ];
    rays.forEach(function (ray) {
      ctx.save();
      ctx.translate(cx, starY);
      ctx.rotate(ray.ang);
      var rg = ctx.createLinearGradient(-ray.len, 0, ray.len, 0);
      rg.addColorStop(0, 'rgba(255, 220, 255, 0)');
      rg.addColorStop(0.35, 'rgba(245, 195, 255, 0.45)');
      rg.addColorStop(0.5, 'rgba(255, 255, 255, 0.98)');
      rg.addColorStop(0.65, 'rgba(245, 195, 255, 0.45)');
      rg.addColorStop(1, 'rgba(255, 220, 255, 0)');
      ctx.strokeStyle = rg;
      ctx.lineWidth = ray.w;
      ctx.beginPath();
      ctx.moveTo(-ray.len, 0);
      ctx.lineTo(ray.len, 0);
      ctx.stroke();
      ctx.restore();
    });

    ctx.save();
    ctx.font = 'italic 600 84px "Brush Script MT", "Segoe Script", "Snell Roundhand", "Apple Chancery", "Nanum Pen Script", Georgia, cursive';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(235, 150, 255, 0.95)';
    ctx.shadowBlur = 24;
    var tg = ctx.createLinearGradient(cx - 260, botY + 80, cx + 260, botY + 145);
    tg.addColorStop(0, '#F8D8FF');
    tg.addColorStop(0.5, '#FFFFFF');
    tg.addColorStop(1, '#E5A8FF');
    ctx.fillStyle = tg;
    ctx.fillText('Merry Christmas', cx, botY + 112);
    ctx.shadowBlur = 8;
    ctx.fillText('Merry Christmas', cx, botY + 112);
    ctx.restore();
  }

  /* 크리스마스 트리 실루엣 안에 들어가도록 x 범위와 후보 좌표를 계산합니다 */
  function treeBoundsAt(yNorm, f) {
    var t = clamp((yNorm - 0.06) / 0.84, 0, 1);
    var tierWave = 0.03 * Math.sin(t * Math.PI * 4);
    var halfRatio = clamp(0.07 + t * 0.37 + tierWave, 0.07, 0.46);
    var cx = f.x + f.w * 0.5;
    var treeW = Math.min(f.w * 0.92, f.h * 0.96);
    var halfW = treeW * halfRatio;
    return { cx: cx, minX: cx - halfW, maxX: cx + halfW, halfW: halfW };
  }

  function findHome(size, hasCaption, skipId) {
    var f = field();
    var xmas = isChristmas();
    var boxW = hasCaption ? Math.max(size, xmas ? 128 : 150) : size;
    var boxH = size + (hasCaption ? 24 : 0);
    var occupied = [];
    state.cards.forEach(function (c) {
      if (c.id === skipId || !c.home) return;
      occupied.push({ x: c.home.x, y: c.home.y, w: c.boxW, h: c.boxH });
    });
    var reserved = reservedRects();
    var best = null;
    var step = xmas ? 11 : 14;
    var yStart = xmas ? f.y + f.h * 0.06 : f.y;
    var yEnd = xmas ? f.y + f.h * 0.88 - boxH : f.y + f.h - boxH;

    for (var y = yStart; y <= yEnd; y += step) {
      var xStart = f.x;
      var xEnd = f.x + f.w - boxW;
      var yNorm = (y + size * 0.5 - f.y) / Math.max(1, f.h);
      var tb = null;
      if (xmas) {
        tb = treeBoundsAt(yNorm, f);
        xStart = Math.max(f.x, tb.minX - size * 0.45);
        xEnd = Math.min(f.x + f.w - boxW, tb.maxX - size * 0.55);
        if (xEnd < xStart) { xStart = tb.cx - boxW * 0.5; xEnd = xStart; }
      }
      for (var x = xStart; x <= xEnd; x += step) {
        var cand = { x: x, y: y, w: boxW, h: boxH };
        var min = Infinity;
        for (var i = 0; i < occupied.length; i++) { var g = gapTo(cand, occupied[i]); if (g < min) min = g; }
        for (var j = 0; j < reserved.length; j++) { var g2 = gapTo(cand, reserved[j]); if (g2 < min) min = g2; }
        var score = min + Math.random() * 2.5;
        if (xmas && tb) {
          var cardCx = x + boxW * 0.5;
          var distRatio = Math.abs(cardCx - tb.cx) / Math.max(1, tb.halfW);
          if (distRatio > 1.0) score -= (distRatio - 1.0) * 45;
        }
        if (!best || score > best.score) best = { x: x, y: y, score: score, min: min };
      }
    }
    if (!best) best = { x: f.x + (f.w - boxW) * 0.5, y: f.y + f.h * 0.3, min: -999 };
    return { x: best.x, y: best.y, min: best.min, boxW: boxW, boxH: boxH };
  }

  function placeCard(card) {
    var caption = !!card.data.caption;
    var minSize = isChristmas() ? 72 : 84;
    var size = Math.min(card.size, Math.max(targetSize(card.id), minSize));
    var h = findHome(size, caption, card.id);
    var guard = 0;
    while (h.min < (isChristmas() ? 5 : 8) && size > minSize + 4 && guard++ < 16) {
      size = Math.round(size * 0.94);
      h = findHome(size, caption, card.id);
    }
    if (size !== card.size) {
      card.size = size;
      card.el.style.width = size + 'px';
      card.el.style.height = size + 'px';
    }
    card.boxW = h.boxW;
    card.boxH = h.boxH;
    card.home = { x: h.x, y: h.y };
    card.el.style.left = h.x + 'px';
    card.el.style.top = h.y + 'px';
    return card.home;
  }

  function capSize() {
    var f = field();
    var n = Math.max(state.cards.size, 12);
    if (isChristmas()) {
      var treeArea = Math.min(f.w * 0.85, f.h * 0.92) * f.h * 0.42;
      var perTree = treeArea / n;
      return clamp(Math.sqrt(perTree) * 0.58, 72, 134);
    }
    var per = (f.w * f.h) / n;
    return clamp(Math.sqrt(per) * 0.62, 84, CARD_MAX);
  }

  function targetSize(id) {
    var cap = capSize();
    var jitter = 0.82 + ((hash(id) % 100) / 100) * 0.18;
    return Math.max(84, Math.round(Math.min(cap * jitter, cap)));
  }

  function cardSize(d) {
    var base = CARD_MIN + (hash(d.id) % (CARD_MAX - CARD_MIN + 1));
    base = Math.min(base, targetSize(d.id));
    var n = state.cards.size;
    if (n > 26) base = Math.min(base, 176);
    if (n > 36) base = Math.min(base, 156);
    return Math.max(84, Math.round(base));
  }

  /* 화면 크기나 그림 수가 바뀌어 카드가 너무 커졌으면 전체를 다시 맞춥니다 */
  function reflow() {
    var changed = false;
    state.cards.forEach(function (c) {
      var t = targetSize(c.id);
      if (c.data && c.data.isMascot) t = Math.round(t * 0.88);
      if (Math.abs(c.size - t) > 7) {
        c.size = t;
        c.el.style.width = t + 'px';
        c.el.style.height = t + 'px';
        c.home = null;
        changed = true;
      }
    });
    if (changed) {
      state.order.forEach(function (id) {
        var c = state.cards.get(id);
        if (c) placeCard(c);
      });
    }
  }

  /* -------------------------------------------------------------- 카드 */

  function eyesHTML(shape) {
    var r = shape.eyeR || 10.5;
    var w = r * 2, h = r * 2.18;
    var delay = (Math.random() * 4.2).toFixed(2);
    return shape.eyes.map(function (e) {
      return '<div class="eye" style="left:' + e.x + 'px;top:' + e.y + 'px">' +
        '<div class="eye-white" style="width:' + w + 'px;height:' + h + 'px;left:' + (-w / 2) + 'px;top:' + (-h / 2) + 'px;animation-delay:' + delay + 's"></div>' +
        '<div class="pupil" style="animation-delay:' + delay + 's">' +
          '<i style="width:' + (r * 0.95) + 'px;height:' + (r * 0.95) + 'px;left:' + (-r * 0.475) + 'px;top:' + (-r * 0.475) + 'px"></i>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  var _clipCache = {};
  function clipPathFor(template) {
    if (!_clipCache[template]) _clipCache[template] = new Path2D(SH.byId(template).d);
    return _clipCache[template];
  }

  function paintArt(canvas, drawing) {
    var ctx = canvas.getContext('2d');
    var k = canvas.width / 200;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(k, k);
    ctx.clip(clipPathFor(drawing.template));
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    (drawing.strokes || []).forEach(function (st) {
      var p = st.p;
      if (!p || p.length < 2) return;
      ctx.globalCompositeOperation = st.e ? 'destination-out' : 'source-over';
      ctx.strokeStyle = st.e ? 'rgba(0,0,0,1)' : (st.c || '#2B2A33');
      ctx.lineWidth = st.w || 4;
      ctx.beginPath();
      var x0 = p[0] * 200, y0 = p[1] * 200;
      ctx.moveTo(x0, y0);
      var n = p.length / 2;
      if (n === 1) {
        ctx.lineTo(x0 + 0.01, y0);
      } else {
        for (var i = 1; i < n - 1; i++) {
          var cx = p[i * 2] * 200, cy = p[i * 2 + 1] * 200;
          var nx = p[(i + 1) * 2] * 200, ny = p[(i + 1) * 2 + 1] * 200;
          ctx.quadraticCurveTo(cx, cy, (cx + nx) / 2, (cy + ny) / 2);
        }
        ctx.lineTo(p[(n - 1) * 2] * 200, p[(n - 1) * 2 + 1] * 200);
      }
      ctx.stroke();
    });
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
  }

  function addCard(d, opts) {
    opts = opts || {};
    if (!d || !d.id) return null;
    if (state.cards.has(d.id)) return state.cards.get(d.id);
    if (!d.isMascot && state.cards.size >= MAX_CARDS) {
      var oldestIdx = -1;
      for (var k = 0; k < state.order.length; k++) {
        var cand = state.cards.get(state.order[k]);
        if (cand && !cand.data.isMascot) { oldestIdx = k; break; }
      }
      if (oldestIdx >= 0) {
        var oldestId = state.order.splice(oldestIdx, 1)[0];
        var oc = state.cards.get(oldestId);
        if (oc) {
          oc.el.classList.add('fade-out');
          (function (node) { setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 700); })(oc.el);
          state.cards.delete(oldestId);
        }
      }
    }

    var shape = SH.byId(d.template);
    var bgi = SH.bgOf(d.bg);
    var size = opts.size || cardSize(d);
    if (d.isMascot) size = Math.round(size * 0.88);
    if (opts.isNew) size = Math.max(size, 194);
    var multi = SH.isMultiPath(shape);
    var gid = 'g' + Math.random().toString(36).slice(2, 9);
    var cid = 'c' + Math.random().toString(36).slice(2, 9);

    var root = document.createElement('div');
    root.className = 'card' + (opts.instant ? ' no-anim' : '') + (d.isMascot ? ' is-mascot' : '');
    root.dataset.id = d.id;
    root.style.width = size + 'px';
    root.style.height = size + 'px';
    root.innerHTML =
      '<div class="inner">' +
        '<svg class="shape" viewBox="0 0 200 200" aria-hidden="true">' +
          '<defs>' +
            '<linearGradient id="' + gid + '" x1="0" y1="0" x2="0.35" y2="1">' +
              '<stop offset="0%" stop-color="' + lighten(bgi.color, 10) + '"/>' +
              '<stop offset="100%" stop-color="' + bgi.color + '"/>' +
            '</linearGradient>' +
            '<clipPath id="' + cid + '"><path d="' + shape.d + '"/></clipPath>' +
          '</defs>' +
          '<path d="' + shape.d + '" fill="url(#' + gid + ')"/>' +
          '<g clip-path="url(#' + cid + ')">' +
            '<ellipse cx="66" cy="46" rx="42" ry="21" fill="rgba(255,255,255,.55)" transform="rotate(-20 66 46)"/>' +
            (multi
              ? '<ellipse cx="150" cy="168" rx="64" ry="40" fill="rgba(255,255,255,.18)"/>'
              : '<path d="' + shape.d + '" fill="none" stroke="rgba(255,255,255,.62)" stroke-width="7" transform="translate(100 100) scale(.955) translate(-100 -100)"/>') +
          '</g>' +
        '</svg>' +
        (d.mascotImg ? '<img class="mascot-art" src="' + esc(d.mascotImg) + '" alt="똑">' : '<canvas class="art" width="400" height="400"></canvas>') +
        '<div class="eyes">' + eyesHTML(shape) + '</div>' +
        '<div class="halo"></div>' +
        '<div class="sparkles"></div>' +
      '</div>' +
      (d.caption ? '<div class="caption">' + esc(d.caption) + '</div>' : '');

    var canvas = qs('canvas.art', root);
    if (canvas) paintArt(canvas, d);

    var card = {
      id: d.id,
      el: root,
      inner: qs('.inner', root),
      art: canvas,
      pupils: Array.prototype.slice.call(root.querySelectorAll('.pupil')),
      size: size,
      boxW: size,
      boxH: size + (d.caption ? 26 : 0),
      home: null,
      phase: Math.random() * Math.PI * 2,
      bobSpeed: 0.5 + Math.random() * 0.5,
      popStart: 0,
      presentScale: 1,
      presentGoal: 1,
      data: d
    };

    el.stage.appendChild(root);
    state.cards.set(d.id, card);
    state.order.push(d.id);
    if (!opts.isNew) reflow();

    if (opts.instant) {
      placeCard(card);
      requestAnimationFrame(function () { root.classList.remove('no-anim'); });
      saveDrawings();
    } else if (opts.isNew) {
      arrival(card);
      saveDrawings();
    } else {
      placeCard(card);
      saveDrawings();
    }
    updateCount();
    return card;
  }

  function arrival(card) {
    var size = card.size;
    card.el.style.transition = 'none';
    card.el.style.left = ((window.innerWidth - size) / 2) + 'px';
    card.el.style.top = ((window.innerHeight - size) / 2 - 24) + 'px';
    card.el.classList.add('is-spotlight');
    card.el.offsetHeight; // reflow
    card.el.style.transition = '';
    card.popStart = performance.now();
    card.presentScale = 1.45;
    card.presentGoal = 1.45;

    spawnSparkles(card.el);
    moveSpotlight(card.el);
    el.spotlight.classList.add('on');

    state.gaze.el = card.el;
    state.lastArrival = performance.now();
    state.gaze.until = performance.now() + 7800;
    document.body.classList.add('presenting');

    setTimeout(function () {
      placeCard(card);
      card.presentGoal = 1;
      moveSpotlight(card.el);
    }, 3200);
    setTimeout(function () {
      el.spotlight.classList.remove('on');
      document.body.classList.remove('presenting');
    }, 5000);
    setTimeout(function () { card.el.classList.remove('is-spotlight'); }, 8000);
  }

  function moveSpotlight(node) {
    var r = node.getBoundingClientRect();
    el.spotlight.style.left = (r.left + r.width / 2) + 'px';
    el.spotlight.style.top = (r.top + r.height / 2) + 'px';
  }

  function spawnSparkles(root) {
    var box = qs('.sparkles', root);
    if (!box) return;
    box.innerHTML = '';
    for (var i = 0; i < 16; i++) {
      var s = document.createElement('span');
      var ang = (i / 16) * Math.PI * 2 + Math.random() * 0.4;
      var dist = 130 + Math.random() * 110;
      s.className = 'sparkle' + (i % 3 === 0 ? ' star' : '');
      s.style.setProperty('--dx', (Math.cos(ang) * dist).toFixed(1) + 'px');
      s.style.setProperty('--dy', (Math.sin(ang) * dist).toFixed(1) + 'px');
      s.style.animationDelay = (Math.random() * 120) + 'ms';
      box.appendChild(s);
    }
    setTimeout(function () { box.innerHTML = ''; }, 1500);
  }

  function removeCard(id) {
    var c = state.cards.get(id);
    if (!c) return;
    state.cards.delete(id);
    state.order = state.order.filter(function (x) { return x !== id; });
    c.el.classList.add('fade-out');
    setTimeout(function () { if (c.el.parentNode) c.el.parentNode.removeChild(c.el); }, 520);
    updateCount();
    saveDrawings();
  }

  function clearAll(persist) {
    state.cards.forEach(function (c) { if (c.el.parentNode) c.el.parentNode.removeChild(c.el); });
    state.cards.clear();
    state.order = [];
    ensureMascots();
    updateCount();
    if (persist !== false) saveDrawings();
  }

  function relayout() {
    state.cards.forEach(function (c) {
      var t = targetSize(c.id);
      if (c.data && c.data.isMascot) t = Math.round(t * 0.88);
      c.size = t;
      c.el.style.width = t + 'px';
      c.el.style.height = t + 'px';
      c.home = null;
    });
    state.order.forEach(function (id) {
      var c = state.cards.get(id);
      if (!c) return;
      placeCard(c);
    });
  }

  function updateCount() {
    if (!el.countNum) return;
    var n = 0;
    state.cards.forEach(function (c) { if (!c.data.isMascot) n++; });
    el.countNum.textContent = n;
  }

  /* ------------------------------------------------------- 시선 애니메이션 */

  function centerOf(node) {
    var r = node.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function loop(now) {
    var dt = Math.min(64, now - (state.last || now));
    state.last = now;

    var gazeNode = state.gaze.el;
    var active = gazeNode && now < state.gaze.until && gazeNode.isConnected;
    var target = active ? centerOf(gazeNode) : null;
    var rate = target ? Math.min(1, dt / 170) : Math.min(1, dt / 520);
    state.gaze.strength += ((target ? 1 : 0) - state.gaze.strength) * rate;
    if (!active && state.gaze.strength < 0.01) state.gaze.el = null;

    var t = now / 1000;
    var gs = state.gaze.strength;

    state.cards.forEach(function (card) {
      var bob = Math.sin(t * card.bobSpeed + card.phase) * 5.5;
      var sway = Math.cos(t * card.bobSpeed * 0.62 + card.phase * 1.4) * 3.4;
      var tilt = Math.sin(t * 0.55 + card.phase) * 0.9;
      var leanX = 0, leanY = 0;
      var lookX = Math.sin(t * 0.5 + card.phase) * 1.3;
      var lookY = Math.cos(t * 0.44 + card.phase * 1.7) * 1.0;

      if (target && gs > 0.02 && card.el !== state.gaze.el) {
        var cx = card.el.offsetLeft + card.size / 2;
        var cy = card.el.offsetTop + card.size / 2;
        var dx = target.x - cx;
        var dy = target.y - cy;
        var dist = Math.hypot(dx, dy) || 1;
        var nx = dx / dist, ny = dy / dist;
        lookX = lookX * (1 - gs) + nx * 4.4 * gs;
        lookY = lookY * (1 - gs) + ny * 4.4 * gs;
        tilt += nx * 7.5 * gs;
        leanX = nx * 3.2 * gs;
        leanY = ny * 3.0 * gs;
      }

      var pop = 1;
      if (card.popStart) {
        var p = Math.min(1, (now - card.popStart) / 860);
        pop = 0.5 + 0.5 * easeOutBack(p);
        if (p >= 1) card.popStart = 0;
      }

      card.presentScale += (card.presentGoal - card.presentScale) * Math.min(1, dt / 380);

      var scale = (card.size / 200) * pop * card.presentScale * (1 + 0.016 * gs);
      card.inner.style.transform =
        'translate3d(' + sway.toFixed(2) + 'px,' + (bob + leanY).toFixed(2) + 'px,0) ' +
        'rotate(' + tilt.toFixed(2) + 'deg) scale(' + scale.toFixed(4) + ')';

      for (var i = 0; i < card.pupils.length; i++) {
        card.pupils[i].style.transform = 'translate(' + lookX.toFixed(2) + 'px,' + lookY.toFixed(2) + 'px)';
      }
    });

    requestAnimationFrame(loop);
  }

  /* ------------------------------------------------------------------ QR */

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function renderQR(text) {
    if (!text || typeof qrcode !== 'function') return;
    var qr;
    try {
      qr = qrcode(0, 'M');
      qr.addData(text);
      qr.make();
    } catch (e) { return; }
    var n = qr.getModuleCount();
    var canvas = el.qrCanvas;
    var ctx = canvas.getContext('2d');
    var quiet = 4;
    var total = n + quiet * 2;
    var cell = Math.floor(canvas.width / total);
    var size = cell * total;
    var off = Math.floor((canvas.width - size) / 2);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#2B2340';
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (!qr.isDark(r, c)) continue;
        var x = off + (c + quiet) * cell;
        var y = off + (r + quiet) * cell;
        roundRect(ctx, x, y, cell * 1.02, cell * 1.02, cell * 0.3);
        ctx.fill();
      }
    }
  }

  function baseUrl() {
    if (location.protocol === 'file:') return location.href.replace(/[^/]*$/, '');
    return location.origin + location.pathname.replace(/[^/]*$/, '');
  }

  function drawUrlFor(room) {
    return baseUrl() + 'draw.html?room=' + room;
  }

  function setDrawUrl(url) {
    state.drawUrl = url;
    if (el.drawUrl) el.drawUrl.textContent = url.replace(/^https?:\/\//, '');
    if (el.roomCode) el.roomCode.textContent = state.room;
    renderQR(url);
  }

  /* -------------------------------------------------------------- 설정 반영 */

  function applySettings(s) {
    if (!s) return;
    state.settings = Object.assign({}, state.settings, s);
    var isXmas = state.settings.theme === 'christmas' || state.settings.theme === 'starlight';
    document.documentElement.dataset.theme = state.settings.theme || 'lavender';
    var fs = Math.min(160, Math.max(70, Number(state.settings.fontScale) || 100));
    document.documentElement.style.setProperty('--font-scale', (fs / 100).toFixed(2));
    if (el.title) {
      var t = state.settings.title || '방명록';
      el.title.innerHTML = esc(t).replace(/\s+(\S+)$/, ' <span class="title-dot">$1</span>');
    }
    if (el.subtitle) el.subtitle.textContent = state.settings.subtitle || '';
    var showQR = state.settings.qrVisible !== false;
    el.qrPanel.classList.toggle('hidden', !showQR);
    var pos = state.settings.qrPosition || 'bottom';
    if (isXmas && pos === 'bottom') pos = 'corner';
    el.qrPanel.classList.remove('corner', 'pos-corner', 'pos-bottom-left', 'pos-top-right', 'pos-top-left');
    if (pos === 'corner') el.qrPanel.classList.add('corner', 'pos-corner');
    else if (pos !== 'bottom') el.qrPanel.classList.add('pos-' + pos);

    if (el.topbar) {
      var tpos = state.settings.titlePosition || 'top-center';
      el.topbar.classList.remove('tpos-top-center', 'tpos-top-left', 'tpos-top-right', 'tpos-bottom-center', 'tpos-bottom-left', 'tpos-bottom-right', 'tpos-center');
      if (tpos !== 'top-center') el.topbar.classList.add('tpos-' + tpos);
    }
    syncQuickSettingsUI();
    setTimeout(relayout, 60);
  }

  /* -------------------------------------------------------------- 실시간 연결 */

  function setConn(ok) {
    el.conn.classList.toggle('off', !ok);
    el.conn.title = ok ? '실시간 연결됨' : '연결 확인 중…';
  }

  var toastTimer = null;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.classList.remove('show'); }, 2600);
  }

  function onRelayEvent(kind, payload, env) {
    if (kind === 'drawing') {
      var d = payload;
      if (!d || !d.id) return;
      if (d.room && d.room !== state.room) return;
      if (state.cards.has(d.id)) return;
      if (!SH.byId(d.template)) return;
      addCard(d, { isNew: true });
      toast('✨ 새 방명록 도착!' + (d.caption ? ' ' + d.caption : ''));
      return;
    }
    if (kind === 'settings') {
      applySettings(payload);
      saveSettings();
      return;
    }
    if (kind === 'reset') {
      clearAll();
      toast('방명록을 비웠어요');
      return;
    }
    if (kind === 'reseed') {
      clearAll(false);
      (window.DRAWIT_SEED || []).forEach(function (d) { addCard(d, { instant: true }); });
      relayout();
      toast('샘플 방명록을 다시 채웠어요');
      return;
    }
    if (kind === 'delete') {
      removeCard(payload.id);
      return;
    }
  }

  function subscribe() {
    if (state.link) state.link.close();
    if (!RL) return;
    state.link = RL.connect(state.room, onRelayEvent, function (status) {
      state.relayStatus = status;
      setConn(status === 'open');
    });
  }

  /* ------------------------------------------------------------- 방 전환 */

  function renderRoom() {
    setDrawUrl(drawUrlFor(state.room));
    clearAll(false);
    loadDrawings().forEach(function (d) { addCard(d, { instant: true }); });
    relayout();
    subscribe();
  }

  function switchRoom(id) {
    state.room = String(id).toUpperCase();
    writeJSON('drawit:room', state.room);
    rememberRoom(state.room);
    renderRoom();
  }

  function makeNewRoom() {
    var ok = window.confirm('새 방을 만들까요?\n\n지금 화면의 QR 코드가 새 주소로 바뀝니다. (기존 그림은 이 방에 그대로 보관돼요)');
    if (!ok) return;
    switchRoom(newRoomId());
    toast('새 방 ' + state.room + ' — QR 코드가 바뀌었어요');
  }

  function resetDrawings() {
    var userCount = 0;
    state.cards.forEach(function (c) { if (!c.data.isMascot) userCount++; });
    if (!userCount) return;
    var ok = window.confirm('이 방의 방명록을 모두 비울까요?\n\n(' + userCount + '개 그림이 지워집니다)');
    if (!ok) return;
    clearAll();
    if (RL) RL.publishEvent(RL.topicFor(state.room), 'x').catch(function () {});
    toast('방명록을 비웠어요');
  }

  function cycleTheme() {
    var themes = ['lavender', 'cream', 'night', 'christmas', 'starlight'];
    var idx = themes.indexOf(state.settings.theme || 'lavender');
    state.settings.theme = themes[(idx + 1) % themes.length];
    applySettings(state.settings);
    saveSettings();
    if (RL) RL.publishEvent(RL.topicFor(state.room), 's', { v: state.settings }).catch(function () {});
  }

  function toggleQR() {
    var next = !(state.settings.qrVisible !== false);
    state.settings.qrVisible = next;
    el.qrPanel.classList.toggle('hidden', !next);
    saveSettings();
    setTimeout(relayout, 460);
    if (RL) RL.publishEvent(RL.topicFor(state.room), 's', { v: state.settings }).catch(function () {});
  }

  function toggleUI() {
    state.uiHidden = !state.uiHidden;
    document.body.classList.toggle('ui-hidden', state.uiHidden);
    if (el.touchShow) el.touchShow.classList.toggle('on', state.uiHidden && state.barFolded);
    setTimeout(relayout, 460);
  }

  /* ------------------------------------------------------------- 터치 버튼 */

  function toggleFullscreen() {
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
    } catch (e) { /* ignore */ }
  }

  function toggleQuickSettings() {
    if (!el.quickSettings) return;
    el.quickSettings.classList.toggle('hidden');
    syncQuickSettingsUI();
  }

  function syncQuickSettingsUI() {
    var s = state.settings;
    if (!s || !el.quickSettings) return;
    var th = qs('#qsTheme'), fs = qs('#qsFontScale'), fv = qs('#qsFontVal');
    var tp = qs('#qsTitlePos'), qp = qs('#qsQrPos'), qv = qs('#qsQrVis');
    if (th) th.value = s.theme || 'lavender';
    var scale = Number(s.fontScale) || 100;
    if (fs) fs.value = scale;
    if (fv) fv.textContent = scale + '%';
    if (tp) tp.value = s.titlePosition || 'top-center';
    if (qp) qp.value = s.qrPosition || 'bottom';
    if (qv) qv.checked = s.qrVisible !== false;
  }

  function pushSettingsPatch(patch) {
    Object.assign(state.settings, patch);
    applySettings(state.settings);
    saveSettings();
    if (RL) RL.publishEvent(RL.topicFor(state.room), 's', { v: state.settings }).catch(function () {});
  }

  function setupTouchbar() {
    if (!el.touchbar) return;
    el.touchbar.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act]');
      if (!btn) return;
      e.preventDefault();
      var act = btn.dataset.act;
      if (act === 'theme') cycleTheme();
      else if (act === 'qr') toggleQR();
      else if (act === 'newroom') makeNewRoom();
      else if (act === 'reset') resetDrawings();
      else if (act === 'hide') toggleUI();
      else if (act === 'fullscreen') toggleFullscreen();
      else if (act === 'settings') toggleQuickSettings();
      else if (act === 'fold') setFolded(true);
    });
    if (el.touchShow) {
      el.touchShow.addEventListener('click', function () { setFolded(false); });
    }
    if (qs('#qsClose')) {
      qs('#qsClose').addEventListener('click', function () { el.quickSettings.classList.add('hidden'); });
    }
    if (qs('#qsTheme')) {
      qs('#qsTheme').addEventListener('change', function () { pushSettingsPatch({ theme: this.value }); });
    }
    if (qs('#qsFontScale')) {
      qs('#qsFontScale').addEventListener('input', function () {
        if (qs('#qsFontVal')) qs('#qsFontVal').textContent = this.value + '%';
        pushSettingsPatch({ fontScale: Number(this.value) });
      });
    }
    if (qs('#qsTitlePos')) {
      qs('#qsTitlePos').addEventListener('change', function () { pushSettingsPatch({ titlePosition: this.value }); });
    }
    if (qs('#qsQrPos')) {
      qs('#qsQrPos').addEventListener('change', function () { pushSettingsPatch({ qrPosition: this.value }); });
    }
    if (qs('#qsQrVis')) {
      qs('#qsQrVis').addEventListener('change', function () { pushSettingsPatch({ qrVisible: this.checked }); });
    }
  }

  function setFolded(folded) {
    state.barFolded = folded;
    el.touchbar.classList.toggle('folded', folded);
    if (el.touchShow) el.touchShow.classList.toggle('on', folded && !state.uiHidden);
  }

  /* -------------------------------------------------------------- 초기화 */

  function boot() {
    paintStarlightTree();
    ensureRoom();
    loadSettings();
    applySettings(state.settings);

    setDrawUrl(drawUrlFor(state.room));
    ensureMascots();
    loadDrawings().forEach(function (d) { addCard(d, { instant: true }); });
    relayout();
    subscribe();
    setupTouchbar();

    window.addEventListener('resize', function () {
      clearTimeout(boot._rt);
      boot._rt = setTimeout(function () { relayout(); if (state.drawUrl) renderQR(state.drawUrl); }, 260);
    });

    window.addEventListener('storage', function (ev) {
      if (!ev.key) return;
      if (ev.key === 'drawit:settings') { loadSettings(); applySettings(state.settings); }
      if (ev.key === 'drawit:room' && ev.newValue && ev.newValue.replace(/"/g, '') !== state.room) {
        switchRoom(ev.newValue.replace(/"/g, ''));
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      var k = e.key.toLowerCase();
      if (k === 'h') toggleUI();
      else if (k === 'q') toggleQR();
      else if (k === 't') cycleTheme();
      else if (k === 'f') {
        if (document.fullscreenElement) document.exitFullscreen();
        else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
      } else if (e.key === 'Escape' && state.uiHidden) toggleUI();
    });

    // 테스트/데모용 훅
    requestAnimationFrame(loop);

    window.__drawIt = {
      state: state,
      room: function () { return state.room; },
      drawUrl: function () { return state.drawUrl; },
      counts: function () { return { cards: state.cards.size, gaze: state.gaze.strength, target: !!state.gaze.el }; },
      addTestDrawing: function (d) { return addCard(d, { isNew: true }); },
      switchRoom: switchRoom
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
