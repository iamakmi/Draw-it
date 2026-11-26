/* =====================================================================
 * DRAW IT (웹 버전) — 관리자 페이지 스크립트
 *  · 미디어월과 같은 브라우저(localStorage)의 방명록·설정을 다룹니다.
 *  · 바꾼 설정은 ntfy 채널로도 보내 다른 기기의 미디어월에 바로 반영됩니다.
 * ===================================================================== */
(function () {
  'use strict';

  var SH = window.DrawItShapes;
  var RL = window.DrawItRelay;
  var $ = function (s) { return document.querySelector(s); };

  var DEFAULT_SETTINGS = {
    theme: 'lavender',
    qrPosition: 'bottom',
    qrVisible: true,
    title: '방명록',
    subtitle: "What's on your mind? Fill your bubble!"
  };

  var ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

  var state = {
    room: '',
    drawings: [],
    settings: Object.assign({}, DEFAULT_SETTINGS)
  };

  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (e) { return fallback; }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
  }
  function roomKey(kind) { return 'drawit:' + kind + ':' + state.room; }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var toastTimer = null;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2400);
  }

  function when(ts) {
    if (!ts) return '';
    var d = Date.now() - ts;
    if (d < 60e3) return '방금 전';
    if (d < 3600e3) return Math.floor(d / 60e3) + '분 전';
    if (d < 86400e3) return Math.floor(d / 3600e3) + '시간 전';
    var dt = new Date(ts);
    return (dt.getMonth() + 1) + '/' + dt.getDate() + ' ' + String(dt.getHours()).padStart(2, '0') + ':' + String(dt.getMinutes()).padStart(2, '0');
  }

  var _clipCache = {};
  function clipPathFor(template) {
    if (!_clipCache[template]) _clipCache[template] = new Path2D(SH.byId(template).d);
    return _clipCache[template];
  }

  function paintThumb(canvas, d) {
    var ctx = canvas.getContext('2d');
    var k = canvas.width / 200;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(k, k);
    ctx.clip(clipPathFor(d.template));
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    (d.strokes || []).forEach(function (st) {
      var p = st.p;
      if (!p || p.length < 2) return;
      ctx.globalCompositeOperation = st.e ? 'destination-out' : 'source-over';
      ctx.strokeStyle = st.e ? '#000' : (st.c || '#2B2A33');
      ctx.lineWidth = st.w || 4;
      ctx.beginPath();
      ctx.moveTo(p[0] * 200, p[1] * 200);
      var n = p.length / 2;
      if (n === 1) { ctx.lineTo(p[0] * 200 + 0.01, p[1] * 200); }
      else {
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

  function renderList() {
    var list = $('#cardList');
    $('#countText').textContent = state.drawings.length;
    $('#emptyMsg').hidden = state.drawings.length > 0;
    list.innerHTML = state.drawings.map(function (d, i) {
      var shape = SH.byId(d.template);
      var bgi = SH.bgOf(d.bg);
      var gid = 'ag' + i + '_' + Math.random().toString(36).slice(2, 6);
      var cid = 'ac' + i + '_' + Math.random().toString(36).slice(2, 6);
      return '<div class="mini" data-id="' + d.id + '">' +
        '<button class="del" title="삭제" data-del="' + d.id + '">✕</button>' +
        '<div class="thumb">' +
          '<svg viewBox="0 0 200 200"><defs>' +
            '<linearGradient id="' + gid + '" x1="0" y1="0" x2="0.35" y2="1">' +
              '<stop offset="0%" stop-color="#ffffff"/><stop offset="100%" stop-color="' + bgi.color + '"/>' +
            '</linearGradient>' +
            '<clipPath id="' + cid + '"><path d="' + shape.d + '"/></clipPath>' +
          '</defs>' +
          '<path d="' + shape.d + '" fill="url(#' + gid + ')"/>' +
          '<path d="' + shape.d + '" fill="none" stroke="' + bgi.color + '" stroke-width="6" opacity=".5" transform="translate(100 100) scale(.955) translate(-100 -100)"/>' +
          '</svg>' +
          '<canvas width="400" height="400" data-paint="' + d.id + '"></canvas>' +
        '</div>' +
        (d.caption ? '<p class="cap">' + esc(d.caption) + '</p>' : '<p class="cap" style="opacity:.4">(글 없음)</p>') +
        '<p class="when">' + when(d.createdAt) + ' · ' + shape.label + '</p>' +
      '</div>';
    }).join('');

    state.drawings.forEach(function (d) {
      var c = list.querySelector('canvas[data-paint="' + d.id + '"]');
      if (!c) return;
      paintThumb(c, d);
    });
  }

  function renderQR(url) {
    $('#drawUrlText').textContent = url;
    if (typeof qrcode !== 'function') return;
    var qr;
    try { qr = qrcode(0, 'M'); qr.addData(url); qr.make(); } catch (e) { return; }
    var n = qr.getModuleCount();
    var canvas = $('#qrCanvas');
    var ctx = canvas.getContext('2d');
    var quiet = 4, total = n + quiet * 2;
    var cell = Math.floor(canvas.width / total);
    var size = cell * total;
    var off = Math.floor((canvas.width - size) / 2);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#2B2340';
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (!qr.isDark(r, c)) continue;
        var x = off + (c + quiet) * cell, y = off + (r + quiet) * cell;
        var rad = cell * 0.3;
        ctx.beginPath();
        ctx.moveTo(x + rad, y);
        ctx.arcTo(x + cell * 1.02, y, x + cell * 1.02, y + cell * 1.02, rad);
        ctx.arcTo(x + cell * 1.02, y + cell * 1.02, x, y + cell * 1.02, rad);
        ctx.arcTo(x, y + cell * 1.02, x, y, rad);
        ctx.arcTo(x, y, x + cell * 1.02, y, rad);
        ctx.closePath();
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

  function applySettingsUI(s) {
    $('#themeSel').value = s.theme || 'lavender';
    $('#qrPosSel').value = s.qrPosition || 'bottom';
    $('#qrVisChk').checked = s.qrVisible !== false;
    $('#titleInp').value = s.title || '방명록';
    $('#subtitleInp').value = s.subtitle || '';
  }

  function newRoomId() {
    var out = '';
    var buf = new Uint8Array(8);
    (window.crypto || window.msCrypto).getRandomValues(buf);
    for (var i = 0; i < 8; i++) out += ALPHABET[buf[i] % ALPHABET.length];
    return out;
  }

  function renderRooms() {
    var list = readJSON('drawit:rooms', []);
    $('#roomList').innerHTML = list.slice().reverse().map(function (r) {
      return '<li><a href="index.html?room=' + r.id + '" target="_blank" rel="noopener">' +
        (r.id === state.room ? '● ' : '') + r.id + '</a> <span>' + when(r.createdAt) + '</span></li>';
    }).join('');
  }

  function load() {
    state.room = (readJSON('drawit:room', '') || '').toString().toUpperCase();
    if (!state.room) state.room = newRoomId();
    var stored = readJSON(roomKey('drawings'), null);
    if (!Array.isArray(stored)) {
      stored = (window.DRAWIT_SEED || []).slice();
      writeJSON(roomKey('drawings'), stored);
    }
    state.drawings = stored;
    state.settings = Object.assign({}, DEFAULT_SETTINGS, readJSON('drawit:settings', {}) || {});

    $('#roomText').textContent = state.room;
    renderQR(drawUrlFor(state.room));
    renderRooms();
    applySettingsUI(state.settings);
    renderList();
  }

  $('#cardList').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-del]');
    if (!btn) return;
    var id = btn.dataset.del;
    state.drawings = state.drawings.filter(function (d) { return d.id !== id; });
    writeJSON(roomKey('drawings'), state.drawings);
    renderList();
    RL.publishEvent(RL.topicFor(state.room), 'dd', { id: id }).catch(function () {});
    toast('삭제했어요');
  });

  $('#resetBtn').addEventListener('click', function () {
    if (!confirm('방명록을 모두 비울까요? 되돌릴 수 없어요.')) return;
    state.drawings = [];
    writeJSON(roomKey('drawings'), []);
    renderList();
    RL.publishEvent(RL.topicFor(state.room), 'x').catch(function () {});
    toast('전체 비우기를 완료했어요');
  });

  $('#reseedBtn').addEventListener('click', function () {
    if (!confirm('샘플 방명록 12개로 다시 채울까요? 지금 방명록은 사라져요.')) return;
    state.drawings = (window.DRAWIT_SEED || []).slice();
    writeJSON(roomKey('drawings'), state.drawings);
    renderList();
    RL.publishEvent(RL.topicFor(state.room), 'r').catch(function () {});
    toast('샘플을 다시 채웠어요');
  });

  $('#saveSettings').addEventListener('click', function () {
    var next = {
      theme: $('#themeSel').value,
      qrPosition: $('#qrPosSel').value,
      qrVisible: $('#qrVisChk').checked,
      title: $('#titleInp').value.trim() || '방명록',
      subtitle: $('#subtitleInp').value
    };
    state.settings = next;
    writeJSON('drawit:settings', next);
    applySettingsUI(next);
    RL.publishEvent(RL.topicFor(state.room), 's', { v: next }).catch(function () {});
    toast('설정을 저장했어요');
  });

  $('#newRoomBtn').addEventListener('click', function () {
    if (!confirm('새 방을 만들까요?\n\n지금 방(' + state.room + ')은 그대로 남고, 새 코드가 생깁니다.')) return;
    var id = newRoomId();
    var list = readJSON('drawit:rooms', []);
    list.push({ id: id, createdAt: Date.now() });
    writeJSON('drawit:rooms', list.slice(-12));
    writeJSON('drawit:room', id);
    load();
    toast('새 방 ' + id + ' — 미디어월을 새로 열면 이 방으로 시작해요');
  });

  $('#openRoomBtn').addEventListener('click', function () {
    window.open('index.html?room=' + state.room, '_blank', 'noopener');
  });

  /* 미디어월과 같은 브라우저에서 열었을 때 서로 맞춰 주기 */
  window.addEventListener('storage', function (ev) {
    if (!ev.key) return;
    if (ev.key.indexOf('drawit:') === 0) load();
  });

  load();
})();
