/* =====================================================================
 * DRAW IT — 도안(템플릿) 정의
 * 모든 좌표는 200 x 200 상자 기준입니다.
 * 메인 미디어월과 모바일 그리기 화면이 이 파일 하나를 함께 씁니다.
 * ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DrawItShapes = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function num(v) { return Math.round(v * 100) / 100; }

  /* 다각형 path (시계방향으로 넣습니다) */
  function poly(points) {
    var out = 'M' + num(points[0][0]) + ' ' + num(points[0][1]);
    for (var i = 1; i < points.length; i++) out += 'L' + num(points[i][0]) + ' ' + num(points[i][1]);
    return out + 'Z';
  }

  /* 원을 다각형으로 (nonzero 합집합이 확실하게 동작하도록) */
  function circle(cx, cy, r, seg) {
    seg = seg || 54;
    var pts = [];
    for (var i = 0; i < seg; i++) {
      var a = (i / seg) * Math.PI * 2;
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    return poly(pts);
  }

  /* 여러 개의 부분 도형을 합칠 때 감김 방향을 모두 같게 맞춥니다.
     (방향이 반대면 겹치는 부분이 구멍으로 뚫립니다) */
  function fixWinding(d) {
    var parts = d.split(/(?=M)/).filter(Boolean);
    return parts.map(function (sub) {
      var nums = (sub.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
      if (nums.length < 6) return sub;
      var area = 0;
      var n = nums.length;
      for (var i = 0; i < n; i += 2) {
        var x1 = nums[i], y1 = nums[i + 1];
        var x2 = nums[(i + 2) % n], y2 = nums[(i + 3) % n];
        area += x1 * y2 - x2 * y1;
      }
      if (area >= 0) return sub;
      var pts = [];
      for (var j = 0; j < n; j += 2) pts.push([nums[j], nums[j + 1]]);
      pts.reverse();
      return poly(pts);
    }).join('');
  }

  function starPoints(cx, cy, outer, inner, spikes) {
    var pts = [];
    for (var i = 0; i < spikes * 2; i++) {
      var a = (-90 + i * (180 / spikes)) * Math.PI / 180;
      var r = (i % 2 === 0) ? outer : inner;
      pts.push([+(cx + r * Math.cos(a)).toFixed(1), +(cy + r * Math.sin(a)).toFixed(1)]);
    }
    return pts;
  }

  var SHAPES = [
    {
      id: 'bubble',
      label: '둥근 말풍선',
      d: circle(100, 100, 90),
      eyes: [{ x: 78, y: 94 }, { x: 122, y: 94 }],
      eyeR: 10.5
    },
    {
      id: 'cloud',
      label: '구름 말풍선',
      d: fixWinding(circle(68, 118, 33) + circle(104, 92, 40) + circle(146, 116, 31) + circle(104, 126, 43)),
      eyes: [{ x: 82, y: 104 }, { x: 124, y: 104 }],
      eyeR: 10.5
    },
    {
      id: 'heart',
      label: '하트',
      d: 'M100 182C44 142 20 110 20 80C20 52 42 32 66 32C84 32 96 44 100 56C104 44 116 32 134 32C158 32 180 52 180 80C180 110 156 142 100 182Z',
      eyes: [{ x: 79, y: 88 }, { x: 125, y: 88 }],
      eyeR: 10
    },
    {
      id: 'star',
      label: '별',
      d: poly(starPoints(100, 104, 96, 47, 5)),
      eyes: [{ x: 87, y: 98 }, { x: 116, y: 98 }],
      eyeR: 9.5
    },
    {
      id: 'cat',
      label: '고양이',
      d: fixWinding(circle(100, 108, 82) +
        poly([[38, 70], [44, 8], [98, 44]]) +
        poly([[162, 70], [156, 8], [102, 44]])),
      eyes: [{ x: 80, y: 96 }, { x: 122, y: 96 }],
      eyeR: 10
    },
    {
      id: 'bear',
      label: '곰',
      d: fixWinding(circle(100, 108, 80) + circle(40, 48, 25) + circle(160, 48, 25)),
      eyes: [{ x: 80, y: 100 }, { x: 122, y: 100 }],
      eyeR: 10.5
    }
  ];

  var BG = [
    { id: 'rose',     color: '#FFF1F2' },
    { id: 'cream',    color: '#FFF6E3' },
    { id: 'mint',     color: '#E8F8EE' },
    { id: 'sky',      color: '#E7F1FF' },
    { id: 'lavender', color: '#F0EBFF' },
    { id: 'pink',     color: '#FFEAF4' },
    { id: 'aqua',     color: '#E6F7F9' },
    { id: 'sand',     color: '#F6EFE2' }
  ];

  var INK = ['#2B2A33', '#2F6FED', '#F0455E', '#1FA36B', '#7B4DFF', '#FF8A00', '#FF4FA3', '#00A6C4'];

  function byId(id) {
    for (var i = 0; i < SHAPES.length; i++) if (SHAPES[i].id === id) return SHAPES[i];
    return SHAPES[0];
  }
  function bgOf(id) {
    for (var i = 0; i < BG.length; i++) if (BG[i].id === id) return BG[i];
    return BG[0];
  }
  function isMultiPath(shape) {
    return (shape.d.match(/M/g) || []).length > 1;
  }

  return {
    SHAPES: SHAPES, BG: BG, INK: INK,
    byId: byId, bgOf: bgOf, isMultiPath: isMultiPath,
    poly: poly, circle: circle, fixWinding: fixWinding, starPoints: starPoints
  };
}));
