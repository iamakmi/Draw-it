/* =====================================================================
 * DRAW IT — 실시간 중계 (서버 없는 정적 웹앱용)
 *
 *  ntfy.sh 의 공개 pub/sub 채널을 HTTPS 443 포트로 사용합니다.
 *    · 보내기 : POST https://ntfy.sh/<topic>          (본문 = 작은 JSON)
 *    · 받기    : WebSocket wss://ntfy.sh/<topic>/ws   (끊기면 자동 재연결)
 *               + 보조 수단으로 HTTP 폴링          (WebSocket 이 막힌 망에서도 동작)
 *
 *  ntfy 메시지 하나는 4KB 를 넘을 수 없어서,
 *   · 그림의 좌표를 3자리(0.001) 정수 + 36진수 문자로 압축하고
 *   · 그래도 길면 여러 메시지로 나눠 보내고 받는 쪽에서 이어 붙입니다.
 * ===================================================================== */
(function (root) {
  'use strict';

  var HOST = 'https://ntfy.sh';
  var WS = 'wss://ntfy.sh';
  var MAX_BODY = 3800;        // 메시지 하나의 안전 한도 (바이트)
  var CHUNK_BYTES = 3300;     // 본문에 넣을 데이터 조각 크기

  var INK = ['#2B2A33', '#2F6FED', '#F0455E', '#1FA36B', '#7B4DFF', '#FF8A00', '#FF4FA3', '#00A6C4'];
  var WIDTHS = [3, 5.5, 9];

  var enc = new TextEncoder();

  function bytes(s) { return enc.encode(s).length; }
  function escBytes(s) { return bytes(JSON.stringify(s)) - 2; }

  function topicFor(room) {
    return 'drawit-' + String(room || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /* ================================================================ 코덱 */

  function b36(n, pad) {
    var s = Math.max(0, Math.min(1295, Math.round(n))).toString(36);
    while (s.length < pad) s = '0' + s;
    return s;
  }

  function inkIndex(color) {
    var i = INK.indexOf(String(color || '').toUpperCase());
    if (i >= 0) return i;
    i = INK.indexOf(String(color || ''));
    if (i >= 0) return i;
    // 팔레트 밖 색은 가장 가까운 색으로
    var best = 0, bestD = Infinity;
    var n = parseInt(String(color || '#2B2A33').replace('#', ''), 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    for (var k = 0; k < INK.length; k++) {
      var m = parseInt(INK[k].slice(1), 16);
      var d = Math.pow(r - ((m >> 16) & 255), 2) + Math.pow(g - ((m >> 8) & 255), 2) + Math.pow(b - (m & 255), 2);
      if (d < bestD) { bestD = d; best = k; }
    }
    return best;
  }

  function widthIndex(w) {
    var best = 0, bestD = Infinity;
    for (var i = 0; i < WIDTHS.length; i++) {
      var d = Math.abs(WIDTHS[i] - w);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  /* 그림 → 짧은 문자열 */
  function packStrokes(strokes) {
    var out = [];
    (strokes || []).forEach(function (st) {
      var p = st.p || [];
      if (p.length < 2) return;
      var n = Math.floor(p.length / 2);
      var head = (st.e ? 'e' : String(inkIndex(st.c))) + String(widthIndex(st.w || 5.5));
      var buf = head;
      for (var i = 0; i < n; i++) {
        var x = Math.max(0, Math.min(1, p[i * 2]));
        var y = Math.max(0, Math.min(1, p[i * 2 + 1]));
        buf += b36(x * 1000, 2) + b36(y * 1000, 2);
      }
      out.push(buf);
    });
    return out.join('|');
  }

  /* 짧은 문자열 → 그림의 획 배열 */
  function unpackStrokes(str) {
    var out = [];
    if (!str) return out;
    String(str).split('|').forEach(function (chunk) {
      if (chunk.length < 3) return;
      var head = chunk.slice(0, 2);
      var eraser = head[0] === 'e';
      var ink = eraser ? 0 : parseInt(head[0], 36);
      var wi = parseInt(head[1], 36);
      var w = WIDTHS[wi] || 5.5;
      if (eraser) w = w * 2.4;
      var p = [];
      for (var i = 2; i + 3 < chunk.length; i += 4) {
        p.push(parseInt(chunk.substr(i, 2), 36) / 1000, parseInt(chunk.substr(i + 2, 2), 36) / 1000);
      }
      if (p.length < 2) return;
      var st = { c: INK[ink] || INK[0], w: w, p: p };
      if (eraser) st.e = true;
      out.push(st);
    });
    return out;
  }

  function packDrawing(d) {
    return JSON.stringify({
      t: d.template,
      b: d.bg,
      c: d.caption || '',
      s: packStrokes(d.strokes)
    });
  }

  function unpackDrawing(id, str, room) {
    var o = JSON.parse(str);
    return {
      id: id,
      room: room || '',
      template: o.t || 'bubble',
      bg: o.b || 'rose',
      caption: o.c || '',
      strokes: unpackStrokes(o.s)
    };
  }

  /* ============================================================ 보내기 */

  function post(topic, body) {
    return fetch(HOST + '/' + topic, {
      method: 'POST',
      body: body,
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      cache: 'no-store'
    }).then(function (r) {
      if (!r.ok) {
        var err = new Error('relay ' + r.status);
        err.status = r.status;
        throw err;
      }
      return r.json().catch(function () { return {}; });
    });
  }

  /* 긴 문자열을 JSON 이스케이프 후에도 CHUNK_BYTES 를 넘지 않게 자릅니다 */
  function split(str) {
    var out = [];
    var i = 0;
    while (i < str.length) {
      var lo = 1, hi = str.length - i, best = 1;
      while (lo <= hi) {
        var mid = (lo + hi) >> 1;
        if (escBytes(str.substr(i, mid)) <= CHUNK_BYTES) { best = mid; lo = mid + 1; }
        else hi = mid - 1;
      }
      out.push(str.substr(i, best));
      i += best;
    }
    return out.length ? out : [''];
  }

  function publishEnvelope(topic, env) {
    var body = JSON.stringify(env);
    if (bytes(body) > MAX_BODY) throw new Error('message too large');
    return post(topic, body);
  }

  /* 그림 하나를 (보통 1개, 길면 여러 개) 메시지로 나눠 순서대로 보냅니다 */
  function publishDrawing(topic, drawing) {
    var payload = packDrawing(drawing);
    var parts = split(payload);
    var seq = Promise.resolve();
    parts.forEach(function (part, idx) {
      seq = seq.then(function () {
        return publishEnvelope(topic, { k: 'd', id: drawing.id, i: idx, n: parts.length, p: part });
      });
    });
    return seq.then(function () { return { parts: parts.length }; });
  }

  /* 설정·초기화 같은 작은 신호 (4KB 를 넘지 않습니다) */
  function publishEvent(topic, kind, extra) {
    var env = { k: kind };
    if (extra) for (var key in extra) if (Object.prototype.hasOwnProperty.call(extra, key)) env[key] = extra[key];
    return publishEnvelope(topic, env).then(function () { return { parts: 1 }; });
  }

  /* ============================================================== 받기 */

  function makeReceiver(onEvent, room) {
    var pending = {};   // id -> {n, got:{}}

    return function (text) {
      var env = null;
      try { env = JSON.parse(text); } catch (e) { return; }
      if (!env || typeof env !== 'object' || !env.k) return;

      if (env.k === 'd') {
        var total = env.n || 1;
        var whole = null;

        if (total === 1) {
          whole = env.p;
        } else {
          var buf = pending[env.id] || (pending[env.id] = { n: total, got: {}, at: Date.now() });
          buf.n = total;
          buf.got[env.i] = env.p;
          if (Object.keys(buf.got).length >= buf.n) {
            whole = '';
            for (var i = 0; i < buf.n; i++) whole += buf.got[i] || '';
            delete pending[env.id];
          } else {
            setTimeout(function () { delete pending[env.id]; }, 60000);
          }
        }

        if (whole != null) {
          var d = null;
          try { d = unpackDrawing(env.id, whole, room); } catch (err) { return; }
          if (d) onEvent('drawing', d, env);
        }
        return;
      }

      if (env.k === 's') { onEvent('settings', env.v || {}, env); return; }
      if (env.k === 'x') { onEvent('reset', {}, env); return; }
      if (env.k === 'r') { onEvent('reseed', {}, env); return; }
      if (env.k === 'dd') { onEvent('delete', { id: env.id }, env); return; }
      if (env.k === 'hello') { onEvent('hello', {}, env); return; }
    };
  }

  /* ============================================================ 구독 */

  function connect(room, onEvent, onStatus) {
    var topic = topicFor(room);
    var ws = null;
    var stopped = false;
    var retry = 0;
    var pollTimer = null;
    var feed = makeReceiver(onEvent, room);
    var lastPoll = 0;

    function status(s) { if (onStatus) onStatus(s); }
    function schedule() {
      if (stopped) return;
      retry = Math.min(10000, 800 + retry * 1.7);
      setTimeout(open, retry);
    }

    function open() {
      if (stopped) return;
      var url = WS + '/' + topic + '/ws?since=2h';
      try { ws = new WebSocket(url); } catch (e) { status('closed'); schedule(); return; }
      ws.onopen = function () { retry = 0; status('open'); };
      ws.onmessage = function (ev) {
        var obj = null;
        try { obj = JSON.parse(ev.data); } catch (e) { return; }
        if (!obj || obj.event !== 'message' || obj.message == null) return;
        feed(obj.message);
      };
      ws.onclose = function () { status('closed'); schedule(); };
      ws.onerror = function () { try { ws.close(); } catch (e) { /* ignore */ } };
    }

    /* WebSocket 이 막힌 환경(학교·회사 망 등)을 위한 폴링 보조 수단 */
    function poll() {
      if (stopped) return;
      lastPoll = Date.now();
      fetch(HOST + '/' + topic + '/json?poll=1&since=1h&cache=no', { cache: 'no-store' })
        .then(function (r) { return r.text(); })
        .then(function (text) {
          text.split('\n').forEach(function (line) {
            line = line.trim();
            if (!line) return;
            var obj = null;
            try { obj = JSON.parse(line); } catch (e) { return; }
            if (obj && obj.event === 'message' && obj.message != null) feed(obj.message);
          });
        })
        .catch(function () { /* ignore */ });
    }

    open();
    poll();
    pollTimer = setInterval(function () {
      var isOpen = ws && ws.readyState === 1;
      if (!isOpen && Date.now() - lastPoll > 20000) poll();
    }, 5000);

    return {
      topic: topic,
      close: function () {
        stopped = true;
        clearInterval(pollTimer);
        if (ws) { try { ws.close(); } catch (e) { /* ignore */ } }
      }
    };
  }

  root.DrawItRelay = {
    HOST: HOST,
    topicFor: topicFor,
    post: post,
    publishDrawing: publishDrawing,
    publishEvent: publishEvent,
    connect: connect,
    INK: INK,
    codec: {
      packStrokes: packStrokes,
      unpackStrokes: unpackStrokes,
      packDrawing: packDrawing,
      unpackDrawing: unpackDrawing
    },
    _split: split
  };
}(typeof self !== 'undefined' ? self : this));
