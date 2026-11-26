/* =====================================================================
 * DRAW IT (웹 버전) — 모바일 그리기 화면 스크립트
 *  · 도안/배경/펜 선택, 터치 드로잉, 지우개, 되돌리기
 *  · 방 코드(room)의 미디어월로 ntfy.sh 를 통해 즉시 전송
 * ===================================================================== */
(function () {
  'use strict';

  var SH = window.DrawItShapes;
  var RL = window.DrawItRelay;
  var $ = function (s, r) { return (r || document).querySelector(s); };

  var canvas = $('#art');
  var frame = $('#frame');
  var shapeBg = $('#shapeBg');
  var eyesBox = $('#eyesPreview');

  var state = {
    room: '',
    shape: 'bubble',
    bg: 'rose',
    ink: SH.INK[0],
    width: 5.5,
    eraser: false,
    strokes: [],
    drawing: false,
    cur: null,
    sending: false
  };

  var ctx = canvas.getContext('2d');

  /* ------------------------------------------------------- 방 코드 */

  function readRoom() {
    var fromUrl = (location.search.match(/[?&]room=([A-Za-z0-9]+)/) || [])[1];
    var saved = '';
    try { saved = localStorage.getItem('drawit:room') || ''; } catch (e) { /* ignore */ }
    saved = saved.replace(/"/g, '');
    return String(fromUrl || saved || '').toUpperCase().slice(0, 12);
  }

  function setRoom(id, remember) {
    state.room = String(id || '').toUpperCase();
    if (remember !== false) {
      try { localStorage.setItem('drawit:room', state.room); } catch (e) { /* ignore */ }
    }
    $('#roomLabel').textContent = state.room || '────────';
    var dot = $('#roomDot');
    if (dot) dot.classList.toggle('off', !state.room);
  }

  function showJoin(prefill) {
    var ov = $('#joinOverlay');
    $('#joinInput').value = prefill || state.room || '';
    ov.classList.add('show');
    ov.setAttribute('aria-hidden', 'false');
    setTimeout(function () { $('#joinInput').focus(); }, 120);
  }

  function hideJoin() {
    var ov = $('#joinOverlay');
    ov.classList.remove('show');
    ov.setAttribute('aria-hidden', 'true');
  }

  function joinFromInput() {
    var v = $('#joinInput').value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
    if (v.length < 4) {
      $('#joinNote').textContent = '방 코드는 4자 이상이에요. 큰 화면의 QR 코드를 다시 확인해 주세요.';
      return;
    }
    setRoom(v);
    hideJoin();
    $('#joinNote').textContent = '';
  }

  /* ------------------------------------------------------- 도안 그리기 */

  function paintShapeBackground() {
    var shape = SH.byId(state.shape);
    var bgi = SH.bgOf(state.bg);
    var multi = SH.isMultiPath(shape);
    shapeBg.innerHTML =
      '<defs>' +
        '<linearGradient id="mg" x1="0" y1="0" x2="0.35" y2="1">' +
          '<stop offset="0%" stop-color="#ffffff"/>' +
          '<stop offset="100%" stop-color="' + bgi.color + '"/>' +
        '</linearGradient>' +
        '<clipPath id="mc"><path d="' + shape.d + '"/></clipPath>' +
      '</defs>' +
      '<path d="' + shape.d + '" fill="url(#mg)"/>' +
      '<g clip-path="url(#mc)">' +
        '<ellipse cx="66" cy="46" rx="42" ry="21" fill="rgba(255,255,255,.78)" transform="rotate(-20 66 46)"/>' +
        (multi
          ? '<ellipse cx="150" cy="168" rx="64" ry="40" fill="rgba(255,255,255,.25)"/>'
          : '<path d="' + shape.d + '" fill="none" stroke="' + bgi.color + '" stroke-width="6" opacity=".45" transform="translate(100 100) scale(.955) translate(-100 -100)"/>') +
      '</g>';
  }

  var _pathCache = {};
  function shapePath() {
    if (!_pathCache[state.shape]) _pathCache[state.shape] = new Path2D(SH.byId(state.shape).d);
    return _pathCache[state.shape];
  }

  function paintEyesPreview() {
    var shape = SH.byId(state.shape);
    eyesBox.innerHTML = shape.eyes.map(function (e) {
      return '<div class="pv-eye" style="left:' + (e.x / 2) + '%;top:' + (e.y / 2) + '%">' +
        '<div class="pv-pupil"></div></div>';
    }).join('');
  }

  /* --------------------------------------------------------- 스트로크 */

  function styleStroke(st) {
    ctx.globalCompositeOperation = st.e ? 'destination-out' : 'source-over';
    ctx.strokeStyle = st.e ? 'rgba(0,0,0,1)' : st.c;
    ctx.lineWidth = st.w;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
  }

  function pathOf(p) {
    var n = p.length / 2;
    ctx.beginPath();
    ctx.moveTo(p[0] * 200, p[1] * 200);
    if (n === 1) { ctx.lineTo(p[0] * 200 + 0.01, p[1] * 200); return; }
    for (var i = 1; i < n - 1; i++) {
      var cx = p[i * 2] * 200, cy = p[i * 2 + 1] * 200;
      var nx = p[(i + 1) * 2] * 200, ny = p[(i + 1) * 2 + 1] * 200;
      ctx.quadraticCurveTo(cx, cy, (cx + nx) / 2, (cy + ny) / 2);
    }
    ctx.lineTo(p[(n - 1) * 2] * 200, p[(n - 1) * 2 + 1] * 200);
  }

  function redrawAll() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(canvas.width / 200, canvas.height / 200);
    ctx.clip(shapePath());
    state.strokes.forEach(function (st) {
      styleStroke(st);
      pathOf(st.p);
      ctx.stroke();
    });
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawSegment(st) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.save();
    ctx.scale(canvas.width / 200, canvas.height / 200);
    ctx.clip(shapePath());
    styleStroke(st);
    pathOf(st.p);
    ctx.stroke();
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
  }

  function clearCanvas() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  /* ------------------------------------------------------------ 입력 */

  function toNorm(e) {
    var r = canvas.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
    };
  }

  function down(e) {
    if (state.sending) return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    var p = toNorm(e);
    var st = {
      c: state.eraser ? '#000000' : state.ink,
      w: state.eraser ? state.width * 2.4 : state.width,
      p: [p.x, p.y]
    };
    if (state.eraser) st.e = true;
    state.strokes.push(st);
    state.cur = st;
    state.drawing = true;
    drawSegment(st);
    if (navigator.vibrate) navigator.vibrate(8);
  }

  function move(e) {
    // 눈동자가 손가락을 따라갑니다
    var r = canvas.getBoundingClientRect();
    var nx = (e.clientX - r.left) / r.width - 0.5;
    var ny = (e.clientY - r.top) / r.height - 0.5;
    var pupils = eyesBox.querySelectorAll('.pv-pupil');
    for (var i = 0; i < pupils.length; i++) {
      pupils[i].style.transform = 'translate(calc(-50% + ' + (nx * 26).toFixed(1) + '%), calc(-50% + ' + (ny * 26).toFixed(1) + '%))';
    }
    if (!state.drawing || !state.cur) return;
    e.preventDefault();
    var p = toNorm(e);
    var arr = state.cur.p;
    var lx = arr[arr.length - 2], ly = arr[arr.length - 1];
    var d = Math.hypot(p.x - lx, p.y - ly);
    if (d < 0.006) return;
    arr.push(p.x, p.y);
    drawSegment(state.cur);
  }

  function up(e) {
    if (!state.drawing) return;
    state.drawing = false;
    var st = state.cur;
    state.cur = null;
    if (st && st.p.length === 2) { st.p.push(st.p[0] + 0.002, st.p[1]); }
    redrawAll();
  }

  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', function (e) { if (state.drawing) up(e); });
  canvas.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });

  /* --------------------------------------------------------- 도구 UI */

  function buildShapeRow() {
    var row = $('#shapeRow');
    row.innerHTML = SH.SHAPES.map(function (s) {
      return '<button class="shape-chip" data-shape="' + s.id + '" aria-label="' + s.label + '" title="' + s.label + '">' +
        '<svg viewBox="0 0 200 200"><path d="' + s.d + '" fill="#C9B4F7"/></svg>' +
      '</button>';
    }).join('');
    row.addEventListener('click', function (e) {
      var btn = e.target.closest('.shape-chip');
      if (!btn) return;
      setShape(btn.dataset.shape);
    });
  }

  function buildBgRow() {
    var row = $('#bgRow');
    row.innerHTML = SH.BG.map(function (b) {
      return '<button class="sw" data-bg="' + b.id + '" style="background:' + b.color + '" aria-label="배경 ' + b.id + '"></button>';
    }).join('');
    row.addEventListener('click', function (e) {
      var btn = e.target.closest('.sw');
      if (!btn) return;
      state.bg = btn.dataset.bg;
      paintShapeBackground();
      markActive();
    });
  }

  function buildInkRow() {
    var row = $('#inkRow');
    row.innerHTML = SH.INK.map(function (c) {
      return '<button class="sw ink" data-ink="' + c + '" style="background:' + c + '" aria-label="펜 색 ' + c + '"></button>';
    }).join('');
    row.addEventListener('click', function (e) {
      var btn = e.target.closest('.sw');
      if (!btn) return;
      state.ink = btn.dataset.ink;
      state.eraser = false;
      $('#eraserBtn').classList.remove('is-on');
      markActive();
    });
  }

  function markActive() {
    Array.prototype.forEach.call(document.querySelectorAll('.shape-chip'), function (b) {
      b.classList.toggle('is-on', b.dataset.shape === state.shape);
    });
    Array.prototype.forEach.call(document.querySelectorAll('#bgRow .sw'), function (b) {
      b.classList.toggle('is-on', b.dataset.bg === state.bg);
    });
    Array.prototype.forEach.call(document.querySelectorAll('#inkRow .sw'), function (b) {
      b.classList.toggle('is-on', b.dataset.ink === state.ink && !state.eraser);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.size-btn'), function (b) {
      b.classList.toggle('is-on', Number(b.dataset.size) === state.width);
    });
  }

  function setShape(id) {
    state.shape = id;
    paintShapeBackground();
    paintEyesPreview();
    markActive();
    redrawAll();
  }

  $('#sizeRow').addEventListener('click', function (e) {
    var btn = e.target.closest('.size-btn');
    if (!btn) return;
    state.width = Number(btn.dataset.size);
    markActive();
  });

  $('#undoBtn').addEventListener('click', function () {
    var removed = state.strokes.pop();
    if (removed) redrawAll();
  });

  $('#eraserBtn').addEventListener('click', function () {
    state.eraser = !state.eraser;
    $('#eraserBtn').classList.toggle('is-on', state.eraser);
    markActive();
  });

  $('#clearBtn').addEventListener('click', function () {
    if (!state.strokes.length) return;
    state.strokes = [];
    clearCanvas();
  });

  /* ------------------------------------------------------------ 전송 */

  function payload() {
    var stamp = Date.now().toString(36);
    var salt = Math.random().toString(36).slice(2, 7);
    return {
      id: 'd' + stamp + salt,
      template: state.shape,
      bg: state.bg,
      caption: '',
      createdAt: Date.now(),
      strokes: state.strokes.map(function (s) {
        var out = { w: s.w, p: s.p.slice() };
        if (s.e) out.e = true; else out.c = s.c;
        return out;
      })
    };
  }

  function setSending(on) {
    state.sending = on;
    $('#sending').classList.toggle('show', on);
    $('#sendBtn').disabled = on;
  }

  function setDot(ok) {
    var dot = $('#roomDot');
    if (dot) dot.classList.toggle('off', !ok);
  }

  function attempt(data, tries) {
    return RL.publishDrawing(RL.topicFor(state.room), data).catch(function (err) {
      if (tries <= 1) throw err;
      return new Promise(function (resolve) { setTimeout(resolve, 700); }).then(function () {
        return attempt(data, tries - 1);
      });
    });
  }

  function doSend() {
    if (state.sending) return;
    if (!state.room) { showJoin(); return; }
    if (!state.strokes.length) {
      var b = $('#sendBtn');
      b.animate(
        [{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }],
        { duration: 320 }
      );
      return;
    }
    setSending(true);
    var data = payload();
    attempt(data, 3)
      .then(function () {
        setSending(false);
        setDot(true);
        $('#doneOverlay').classList.add('show');
        $('#doneOverlay').setAttribute('aria-hidden', 'false');
        if (navigator.vibrate) navigator.vibrate([12, 40, 18]);
      })
      .catch(function (err) {
        setSending(false);
        setDot(false);
        $('#errorText').textContent = (err && err.status ? '(' + err.status + ') ' : '') + '잠시 후 다시 시도해 주세요.';
        $('#errorOverlay').classList.add('show');
        $('#errorOverlay').setAttribute('aria-hidden', 'false');
      });
  }

  $('#sendBtn').addEventListener('click', doSend);

  $('#againBtn').addEventListener('click', function () {
    $('#doneOverlay').classList.remove('show');
    $('#doneOverlay').setAttribute('aria-hidden', 'true');
    state.strokes = [];
    clearCanvas();
  });

  $('#retryBtn').addEventListener('click', function () {
    $('#errorOverlay').classList.remove('show');
    $('#errorOverlay').setAttribute('aria-hidden', 'true');
    doSend();
  });

  $('#joinBtn').addEventListener('click', joinFromInput);
  $('#joinInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') joinFromInput();
  });
  $('#roomChip').addEventListener('click', function () { showJoin(); });

  /* ------------------------------------------------------------- 시작 */

  buildShapeRow();
  buildBgRow();
  buildInkRow();
  paintShapeBackground();
  paintEyesPreview();
  markActive();

  setRoom(readRoom());
  if (!state.room) showJoin();

  // 테스트/데모 훅
  window.__draw = {
    state: state,
    room: function () { return state.room; },
    setRoom: setRoom,
    strokes: function () { return state.strokes; },
    setShape: setShape,
    redraw: redrawAll,
    send: doSend,
    payload: payload
  };
})();
