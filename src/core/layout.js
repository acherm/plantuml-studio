/* PlantUML Studio — layered graph layout (class, object, usecase, state diagrams). */
'use strict';
(function (P) {

var L = P.layout = {};

function uf() {
  var p = new Map();
  function find(a) {
    if (!p.has(a)) p.set(a, a);
    var r = a;
    while (p.get(r) !== r) r = p.get(r);
    while (p.get(a) !== a) { var nx = p.get(a); p.set(a, r); a = nx; }
    return r;
  }
  return { find: find, union: function (a, b) { p.set(find(a), find(b)); } };
}

/* One level of layered layout.
   items: [{id,w,h}]  edges: [{from,to,constraint:'rank'|'same'|'none'}]
   opts: {dir:'TB'|'LR', gapNode, gapRank, gapComp}
   Returns {pos: Map id->{x,y} top-left (origin 0,0), w, h} */
L.level = function (items, edges, opts) {
  opts = opts || {};
  var dir = opts.dir || 'TB';
  var gapN = opts.gapNode != null ? opts.gapNode : 40;
  var gapR = opts.gapRank != null ? opts.gapRank : 64;
  var gapC = opts.gapComp != null ? opts.gapComp : 56;
  var pos = new Map();
  if (!items.length) return { pos: pos, w: 0, h: 0 };

  var byId = new Map();
  items.forEach(function (n) { byId.set(n.id, n); });
  function ps(n) { return dir === 'TB' ? n.h : n.w; }  /* primary size (rank axis) */
  function ss(n) { return dir === 'TB' ? n.w : n.h; }  /* secondary size */
  var E = (edges || []).filter(function (e) { return byId.has(e.from) && byId.has(e.to) && e.from !== e.to; });

  /* same-rank groups */
  var g = uf();
  items.forEach(function (n) { g.find(n.id); });
  E.forEach(function (e) { if (e.constraint === 'same') g.union(e.from, e.to); });

  /* ranks: break cycles with a DFS (back edges dropped), then longest path */
  var rank = new Map();
  var groups = [];
  items.forEach(function (n) {
    var gr = g.find(n.id);
    if (!rank.has(gr)) { rank.set(gr, 0); groups.push(gr); }
  });
  var rEdges = [];
  E.forEach(function (e) {
    if (e.constraint !== 'rank') return;
    var a = g.find(e.from), b = g.find(e.to);
    if (a !== b) rEdges.push({ a: a, b: b });
  });
  var outs = new Map();
  rEdges.forEach(function (e) {
    if (!outs.has(e.a)) outs.set(e.a, []);
    outs.get(e.a).push(e);
  });
  var color = new Map(); /* 0 unvisited, 1 on stack, 2 done */
  var kept = [];
  groups.forEach(function (s0) {
    if (color.get(s0)) return;
    var stack = [{ u: s0, i: 0 }];
    color.set(s0, 1);
    while (stack.length) {
      var f = stack[stack.length - 1];
      var es = outs.get(f.u) || [];
      if (f.i < es.length) {
        var e = es[f.i++];
        var st = color.get(e.b) || 0;
        if (st === 1) continue; /* back edge — drop to keep a DAG */
        kept.push(e);
        if (st === 0) { color.set(e.b, 1); stack.push({ u: e.b, i: 0 }); }
      } else { color.set(f.u, 2); stack.pop(); }
    }
  });
  var maxIter = groups.length + 2;
  for (var it = 0; it < maxIter; it++) {
    var changed = false;
    for (var i = 0; i < kept.length; i++) {
      var ke = kept[i];
      if (rank.get(ke.b) < rank.get(ke.a) + 1) { rank.set(ke.b, rank.get(ke.a) + 1); changed = true; }
    }
    if (!changed) break;
  }

  /* connected components */
  var comp = uf();
  items.forEach(function (n) { comp.find(n.id); });
  E.forEach(function (e) { comp.union(e.from, e.to); });
  var comps = new Map();
  items.forEach(function (n) {
    var c = comp.find(n.id);
    if (!comps.has(c)) comps.set(c, []);
    comps.get(c).push(n);
  });

  var adj = new Map();
  items.forEach(function (n) { adj.set(n.id, []); });
  E.forEach(function (e) { adj.get(e.from).push(e.to); adj.get(e.to).push(e.from); });

  var offS = 0, totalP = 0;
  comps.forEach(function (cn) {
    var mn = Infinity;
    cn.forEach(function (x) { mn = Math.min(mn, rank.get(g.find(x.id))); });
    var ranks = [];
    cn.forEach(function (x) {
      x._r = rank.get(g.find(x.id)) - mn;
      (ranks[x._r] = ranks[x._r] || []).push(x);
    });
    for (var r2 = 0; r2 < ranks.length; r2++) if (!ranks[r2]) ranks[r2] = [];

    /* initial secondary coordinates: declaration order */
    ranks.forEach(function (row) {
      var c = 0;
      row.forEach(function (x) { x._s = c + ss(x) / 2; c += ss(x) + gapN; });
    });

    /* sweeps: pull nodes toward the mean of their neighbours, keep min gaps */
    for (var sw = 0; sw < 8; sw++) {
      var order = [];
      for (r2 = 0; r2 < ranks.length; r2++) order.push(r2);
      if (sw % 2 === 1) order.reverse();
      order.forEach(function (r3) {
        var row = ranks[r3];
        if (!row.length) return;
        row.forEach(function (x) {
          var ns = adj.get(x.id), sum = 0, k = 0;
          for (var q = 0; q < ns.length; q++) {
            var m2 = byId.get(ns[q]);
            if (m2 && m2._s != null) { sum += m2._s; k++; }
          }
          x._want = k ? sum / k : x._s;
        });
        row.sort(function (a, b) { return a._want - b._want; });
        var prev = -Infinity;
        row.forEach(function (x) {
          var c2 = Math.max(x._want, prev + gapN + ss(x) / 2);
          x._s = c2; prev = c2 + ss(x) / 2;
        });
        var d = 0;
        row.forEach(function (x) { d += x._s - x._want; });
        d /= row.length;
        row.forEach(function (x) { x._s -= d; });
      });
    }

    /* primary coordinates per rank */
    var pTop = 0;
    ranks.forEach(function (row) {
      var mh = 0;
      row.forEach(function (x) { mh = Math.max(mh, ps(x)); });
      row.forEach(function (x) { x._p = pTop + (mh - ps(x)) / 2; });
      pTop += mh + gapR;
    });
    var compP = Math.max(0, pTop - gapR);

    var mnS = Infinity, mxS = -Infinity;
    cn.forEach(function (x) {
      mnS = Math.min(mnS, x._s - ss(x) / 2);
      mxS = Math.max(mxS, x._s + ss(x) / 2);
    });
    cn.forEach(function (x) {
      var sLeft = offS + (x._s - ss(x) / 2 - mnS);
      pos.set(x.id, dir === 'TB' ? { x: sLeft, y: x._p } : { x: x._p, y: sLeft });
    });
    offS += (mxS - mnS) + gapC;
    totalP = Math.max(totalP, compP);
  });
  var totalS = Math.max(0, offS - gapC);
  return dir === 'TB' ? { pos: pos, w: totalS, h: totalP } : { pos: pos, w: totalP, h: totalS };
};

/* Container-aware layout.
   spec: {nodes:[{id,w,h}], edges:[{from,to,constraint}],
          containers:[{id, members:[ids], padX, padTop, padBottom, minW}],
          dir, gapNode, gapRank, gapComp}
   Returns {pos: Map nodeId->{x,y} absolute, rects: Map contId->{x,y,w,h}, w, h} */
L.graph = function (spec) {
  var parentOf = new Map();
  var containers = spec.containers || [];
  containers.forEach(function (c) {
    c.members.forEach(function (m) { parentOf.set(m, c.id); });
  });
  var nodeById = new Map();
  spec.nodes.forEach(function (n) { nodeById.set(n.id, n); });
  var contById = new Map();
  containers.forEach(function (c) { contById.set(c.id, c); });

  /* representative of id at direct-child level of scope (null = top); null if not inside scope */
  function repIn(id, scope) {
    var cur = id;
    for (;;) {
      var p = parentOf.has(cur) ? parentOf.get(cur) : null;
      if (p === scope) return cur;
      if (p == null) return scope == null ? cur : null;
      cur = p;
    }
  }
  function depth(cid) {
    var d = 0, cur = cid;
    while (parentOf.has(cur)) { d++; cur = parentOf.get(cur); }
    return d;
  }

  var contSize = new Map(), contInner = new Map();
  var sorted = containers.slice().sort(function (a, b) { return depth(b.id) - depth(a.id); });

  sorted.forEach(function (c) {
    var children = [];
    spec.nodes.forEach(function (n) {
      if (parentOf.get(n.id) === c.id) children.push({ id: n.id, w: n.w, h: n.h });
    });
    sorted.forEach(function (c2) {
      if (parentOf.get(c2.id) === c.id) {
        var s = contSize.get(c2.id);
        children.push({ id: c2.id, w: s.w, h: s.h });
      }
    });
    var childSet = new Set(children.map(function (x) { return x.id; }));
    var edges2 = [];
    (spec.edges || []).forEach(function (e) {
      var a = repIn(e.from, c.id), b = repIn(e.to, c.id);
      if (a && b && a !== b && childSet.has(a) && childSet.has(b)) edges2.push({ from: a, to: b, constraint: e.constraint });
    });
    var lay = L.level(children, edges2, spec);
    var padX = c.padX != null ? c.padX : 16;
    var padT = c.padTop != null ? c.padTop : 30;
    var padB = c.padBottom != null ? c.padBottom : 14;
    contInner.set(c.id, { pos: lay.pos, padX: padX, padT: padT, layW: lay.w });
    var w = Math.max(lay.w + padX * 2, c.minW || 90);
    contSize.set(c.id, { w: w, h: Math.max(lay.h, 8) + padT + padB });
  });

  var top = [];
  spec.nodes.forEach(function (n) { if (!parentOf.has(n.id)) top.push({ id: n.id, w: n.w, h: n.h }); });
  containers.forEach(function (c) {
    if (!parentOf.has(c.id)) {
      var s = contSize.get(c.id);
      top.push({ id: c.id, w: s.w, h: s.h });
    }
  });
  var topSet = new Set(top.map(function (x) { return x.id; }));
  var tEdges = [];
  (spec.edges || []).forEach(function (e) {
    var a = repIn(e.from, null), b = repIn(e.to, null);
    if (a && b && a !== b && topSet.has(a) && topSet.has(b)) tEdges.push({ from: a, to: b, constraint: e.constraint });
  });
  var lay0 = L.level(top, tEdges, spec);

  var abs = new Map(), rects = new Map();
  function place(id, x, y) {
    if (contById.has(id)) {
      var s = contSize.get(id), inner = contInner.get(id);
      rects.set(id, { x: x, y: y, w: s.w, h: s.h });
      var extra = (s.w - inner.padX * 2 - inner.layW) / 2; /* center content if minW won */
      inner.pos.forEach(function (p2, cid) { place(cid, x + inner.padX + extra + p2.x, y + inner.padT + p2.y); });
    } else {
      abs.set(id, { x: x, y: y });
    }
  }
  lay0.pos.forEach(function (p2, id) { place(id, p2.x, p2.y); });

  var w = lay0.w, h = lay0.h;
  var overrides = spec.overrides;
  if (overrides) {
    /* only top-level nodes can be manually repositioned (v1 limitation —
       a node inside a package/boundary/composite state stays auto-placed) */
    Object.keys(overrides).forEach(function (id) {
      if (abs.has(id) && !parentOf.has(id)) abs.set(id, { x: overrides[id].x, y: overrides[id].y });
    });
    var minX = 0, minY = 0, maxX = 0, maxY = 0, any = false;
    abs.forEach(function (p2, id) {
      var n = nodeById.get(id); if (!n) return;
      any = true;
      minX = Math.min(minX, p2.x); minY = Math.min(minY, p2.y);
      maxX = Math.max(maxX, p2.x + n.w); maxY = Math.max(maxY, p2.y + n.h);
    });
    rects.forEach(function (rc) {
      any = true;
      minX = Math.min(minX, rc.x); minY = Math.min(minY, rc.y);
      maxX = Math.max(maxX, rc.x + rc.w); maxY = Math.max(maxY, rc.y + rc.h);
    });
    if (any && (minX < 0 || minY < 0)) {
      var dx = -Math.min(0, minX), dy = -Math.min(0, minY);
      abs.forEach(function (p2, id) { abs.set(id, { x: p2.x + dx, y: p2.y + dy }); });
      rects.forEach(function (rc, id) { rects.set(id, { x: rc.x + dx, y: rc.y + dy, w: rc.w, h: rc.h }); });
      maxX += dx; maxY += dy;
    }
    if (any) { w = Math.max(w, maxX); h = Math.max(h, maxY); }
  }
  return { pos: abs, rects: rects, w: w, h: h };
};

/* ---------- shared edge drawing between laid-out nodes ---------- */
/* na, nb: {x,y,w,h,shape}; o: {style, decoA, decoB, label, cardA, cardB, M, offset, stereo} */
L.edgeSvg = function (na, nb, o) {
  o = o || {};
  var M = o.M || P.defaultMeasure;
  var S = P.S, r = P.r;
  var out = '';

  /* self loop: same node by reference (state/usecase) or by geometry (class/object
     renderers may pass two rects built from the same layout position) */
  if (na === nb || (na.x === nb.x && na.y === nb.y && na.w === nb.w && na.h === nb.h)) {
    /* self loop on the right side; o.offset stacks several loops on one node */
    var x0 = na.x + na.w, cy = na.y + na.h / 2 + (o.offset || 0);
    var y1 = Math.max(na.y + 6, cy - 12), y2 = Math.min(na.y + na.h - 6, cy + 12);
    var ext = 34;
    var d = 'M' + r(x0) + ',' + r(y1) + ' h' + ext + ' q10,0 10,10 V' + r(y2 - 10) + ' q0,10 -10,10 H' + r(x0 + 3);
    out += S.path(d, { dashed: o.style === 'dashed' });
    if (o.decoA && o.decoA !== 'none') {
      out += S.head(o.decoA, x0 + 1, y1, Math.PI).s;
    }
    if (o.decoB && o.decoB !== 'none') {
      out += S.head(o.decoB, x0 + 1, y2, Math.PI).s;
    }
    var lx0 = x0 + ext + 16, lmid = (y1 + y2) / 2 + 4;
    if (o.stereo) {
      out += S.text(lx0, lmid - (o.label ? 14 : 0), o.stereo, { size: 11.5, italic: true, halo: true });
    }
    if (o.label) {
      var lls = String(o.label).split(/\\n/);
      for (var li = 0; li < lls.length; li++) {
        out += S.text(lx0, lmid + li * 14 - (lls.length - 1) * 7 + (o.stereo ? 8 : 0), lls[li], { size: 12, halo: true });
      }
    }
    /* multiplicities near each end of the loop, like on ordinary edges */
    if (o.cardA) out += S.text(x0 + 6, y1 - 5, o.cardA, { size: 11.5, halo: true, fill: P.C.muted });
    if (o.cardB) out += S.text(x0 + 6, y2 + 14, o.cardB, { size: 11.5, halo: true, fill: P.C.muted });
    return out;
  }

  var cA = { x: na.x + na.w / 2, y: na.y + na.h / 2 };
  var cB = { x: nb.x + nb.w / 2, y: nb.y + nb.h / 2 };
  var off = o.offset || 0;
  var dx0 = cB.x - cA.x, dy0 = cB.y - cA.y;
  var len0 = Math.sqrt(dx0 * dx0 + dy0 * dy0) || 1;
  var px = -dy0 / len0 * off, py = dx0 / len0 * off;

  var pa = P.S.anchor(na, cB.x + px, cB.y + py);
  var pb = P.S.anchor(nb, cA.x + px, cA.y + py);
  pa = { x: pa.x + px, y: pa.y + py };
  pb = { x: pb.x + px, y: pb.y + py };

  var dx = pb.x - pa.x, dy = pb.y - pa.y;
  var len = Math.sqrt(dx * dx + dy * dy);
  if (len < 2) return '';
  var ux = dx / len, uy = dy / len;
  var angB = Math.atan2(dy, dx), angA = Math.atan2(-dy, -dx);

  var backA = 0, backB = 0, headsSvg = '';
  if (o.decoA && o.decoA !== 'none') {
    var hA = S.head(o.decoA, pa.x, pa.y, angA);
    backA = hA.back; headsSvg += hA.s;
  }
  if (o.decoB && o.decoB !== 'none') {
    var hB = S.head(o.decoB, pb.x, pb.y, angB);
    backB = hB.back; headsSvg += hB.s;
  }
  out += S.line(pa.x + ux * backA, pa.y + uy * backA, pb.x - ux * backB, pb.y - uy * backB,
    { dashed: o.style === 'dashed', width: 1.2 });
  out += headsSvg;

  var lt = o.labelT != null ? o.labelT : 0.5;
  var mx = pa.x + dx * lt, my = pa.y + dy * lt;
  var nx = -uy, ny = ux;
  /* near-vertical edges: put the label beside the line, left-aligned, so it never sits on it */
  var sideways = Math.abs(nx) > 0.72;
  var lAnchor = sideways ? (nx > 0 ? 'start' : 'end') : 'middle';
  var lx = mx + nx * (sideways ? 7 : 9);
  if (o.stereo) {
    out += S.text(lx, my + (sideways ? 0 : ny * 9) - 8, o.stereo, { size: 11.5, anchor: lAnchor, italic: true, halo: true });
  }
  if (o.label) {
    var lines = String(o.label).split(/\\n/);
    var baseY = my + (sideways ? 0 : ny * 9) + (o.stereo ? 8 : 0) - (lines.length - 1) * 7 + 4;
    for (var i = 0; i < lines.length; i++) {
      out += S.text(lx, baseY + i * 14, lines[i], { size: 12, anchor: lAnchor, halo: true });
    }
  }
  function card(pt, txt) {
    var qx = pt.x + (pt.x < (pa.x + pb.x) / 2 ? 1 : -1) * 0; /* keep simple: offset along edge + perpendicular */
    return S.text(pt.x + nx * 11, pt.y + ny * 11, txt, { size: 11.5, anchor: 'middle', halo: true, fill: P.C.muted });
  }
  if (o.cardA) out += card({ x: pa.x + ux * 16, y: pa.y + uy * 16 }, o.cardA);
  if (o.cardB) out += card({ x: pb.x - ux * 16, y: pb.y - uy * 16 }, o.cardB);
  return out;
};

})(PUML);
