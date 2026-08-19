/* PlantUML Studio — use case diagrams: parser, well-formedness checks, renderer. */
'use strict';
(function (P) {

var BARE = '[A-Za-z_$][\\w.$]*';
var REF = '\\([^()]+\\)|:[^:]+:|"[^"]*"|' + BARE;

/* ============================ PARSER ============================ */
P.parseUsecase = function (lines, meta) {
  var D = [];
  var els = new Map(), order = [];
  var edges = [], boundaries = [], notes = [];
  var bStack = [];
  var noteBuf = null, noteCount = 0;

  function curB() { return bStack.length ? bStack[bStack.length - 1] : null; }

  function refToId(ref) {
    ref = ref.trim();
    var kindHint = null, label = null, id = null;
    var m;
    if ((m = /^\(([^()]+)\)$/.exec(ref))) { kindHint = 'usecase'; id = m[1].trim(); label = id; }
    else if ((m = /^:([^:]+):$/.exec(ref))) { kindHint = 'actor'; id = m[1].trim(); label = id; }
    else if ((m = /^"([^"]*)"$/.exec(ref))) { kindHint = 'usecase'; id = m[1].trim(); label = id; }
    else { id = ref; label = ref; }
    return { id: id, label: label, kindHint: kindHint };
  }

  function getEl(ref, ln) {
    var rr = refToId(ref);
    var e = els.get(rr.id);
    if (!e) {
      var kind = rr.kindHint || 'usecase';
      e = { id: rr.id, label: rr.label, kind: kind, line: ln, implicit: true, boundary: curB() ? curB().id : null };
      els.set(rr.id, e); order.push(e);
      if (curB()) curB().members.push(rr.id);
      if (!rr.kindHint) D.push(P.d('info', ln, "'" + rr.id + "' created as a use case — write :" + rr.id + ": for an actor, or declare it with 'actor " + rr.id + "'"));
    } else if (rr.kindHint && e.implicit && e.kind !== rr.kindHint) {
      e.kind = rr.kindHint;
    }
    return e;
  }

  function declare(kind, id, label, ln) {
    var e = els.get(id);
    if (e && !e.implicit) { D.push(P.d('error', ln, "'" + id + "' is declared twice (first at line " + e.line + ")")); return e; }
    if (e) { e.implicit = false; e.kind = kind; e.label = label; e.line = ln; }
    else {
      e = { id: id, label: label, kind: kind, line: ln, implicit: false, boundary: curB() ? curB().id : null };
      els.set(id, e); order.push(e);
      if (curB()) curB().members.push(id);
    }
    return e;
  }

  for (var i = 0; i < lines.length; i++) {
    var t = lines[i].text, ln = lines[i].n, m;

    if (noteBuf) {
      if (/^end\s*note$/i.test(t)) { notes.push(noteBuf); noteBuf = null; }
      else noteBuf.text.push(t);
      continue;
    }

    if (t === '}') {
      if (bStack.length) bStack.pop();
      else D.push(P.d('error', ln, "Unexpected '}'"));
      continue;
    }

    /* boundary */
    if ((m = /^(?:rectangle|package)\s+(?:"([^"]+)"|([\w.$ ]+?))\s*(\{)?\s*$/.exec(t))) {
      var bl = (m[1] || m[2]).trim();
      var bd = { id: '@b' + boundaries.length + ':' + bl, label: bl, members: [], line: ln };
      boundaries.push(bd);
      if (m[3]) bStack.push(bd);
      else D.push(P.d('warning', ln, "rectangle without '{ … }' block has no content"));
      continue;
    }

    /* actor declaration */
    if ((m = new RegExp('^actor\\s+(?::([^:]+):|"([^"]+)"|(' + BARE + '))(?:\\s+as\\s+(?::([^:]+):|"([^"]+)"|(' + BARE + ')))?\\s*(?:<<[^>]*>>)?\\s*(?:#\\S+)?$').exec(t))) {
      var nm = m[1] || m[2] || m[3];
      var al = m[4] || m[5] || m[6];
      declare('actor', al || nm, nm, ln);
      continue;
    }

    /* usecase declaration */
    if ((m = new RegExp('^usecase\\s+(?:\\(([^()]+)\\)|"([^"]+)"|(' + BARE + '))(?:\\s+as\\s+(?:\\(([^()]+)\\)|"([^"]+)"|(' + BARE + ')))?\\s*(?:<<[^>]*>>)?\\s*(?:#\\S+)?$').exec(t))) {
      var nm2 = m[1] || m[2] || m[3];
      var al2 = m[4] || m[5] || m[6];
      declare('usecase', al2 || nm2, nm2, ln);
      continue;
    }

    /* standalone declaration by shorthand, e.g.  (Use food)  or  :Chef: */
    if ((m = /^\(([^()]+)\)(?:\s+as\s+([\w.$]+))?$/.exec(t))) {
      if (m[2]) declare('usecase', m[2], m[1].trim(), ln);
      else declare('usecase', m[1].trim(), m[1].trim(), ln);
      continue;
    }
    if ((m = /^:([^:]+):(?:\s+as\s+([\w.$]+))?$/.exec(t))) {
      if (m[2]) declare('actor', m[2], m[1].trim(), ln);
      else declare('actor', m[1].trim(), m[1].trim(), ln);
      continue;
    }

    /* note */
    if ((m = new RegExp('^note\\s+(left|right|top|bottom)\\s+of\\s+(' + REF + ')\\s*(?::\\s*(.*))?$', 'i').exec(t))) {
      var tgt = refToId(m[2]).id;
      if (!els.has(tgt)) D.push(P.d('error', ln, "note refers to '" + tgt + "' which is not declared"));
      var nb = { id: '@note' + (noteCount++), side: m[1].toLowerCase(), target: tgt, text: m[3] != null ? [m[3]] : [], line: ln };
      if (m[3] != null) notes.push(nb); else noteBuf = nb;
      continue;
    }

    /* link */
    var link = P.splitLink(t, REF);
    if (link) {
      var a = getEl(link.left, ln), b = getEl(link.right, ln);
      var cls = P.classifyEdge(link.arrow);
      var stereo = null, label = link.label;
      if (label) {
        var sm = /^\s*(?:<<\s*)?(include|extend)s?\s*(?:>>)?\s*$/i.exec(label);
        if (sm) { stereo = sm[1].toLowerCase(); label = null; }
      }
      if (stereo && cls.style !== 'dashed') D.push(P.d('warning', ln, '«' + stereo + '» relationships should use a dotted arrow: ..>'));
      edges.push({ from: a.id, to: b.id, cls: cls, label: label, stereo: stereo, line: ln });
      continue;
    }

    var sug = P.suggest(t.split(/\s+/)[0], ['actor', 'usecase', 'rectangle', 'note', 'title', 'left to right direction']);
    D.push(P.d('error', ln, 'Unrecognized statement: "' + (t.length > 60 ? t.slice(0, 60) + '…' : t) + '"' + (sug ? ' — did you mean "' + sug + '"?' : '')));
  }

  if (bStack.length) D.push(P.d('error', bStack[bStack.length - 1].line, "Missing '}' — rectangle '" + bStack[bStack.length - 1].label + "' is never closed"));
  if (noteBuf) D.push(P.d('error', noteBuf.line, "Missing 'end note'"));
  if (!order.length) D.push(P.d('warning', lines.length ? lines[0].n : 1, 'Empty use case diagram — declare an actor and a use case: :User: --> (Do something)'));

  /* isolated elements */
  var linked = new Set();
  edges.forEach(function (e) { linked.add(e.from); linked.add(e.to); });
  order.forEach(function (e) {
    if (!linked.has(e.id) && order.length > 1) D.push(P.d('info', e.line, "'" + e.id + "' is not connected to anything"));
  });

  return { model: { els: order, byId: els, edges: edges, boundaries: boundaries, notes: notes }, diagnostics: D };
};

/* ============================ RENDERER ============================ */
function buildActor(e, M) {
  var S = P.S, C = P.C, r = P.r;
  var lw = M(e.label, 13, { bold: true });
  var w = Math.max(lw, 30), h = 62;
  return {
    w: Math.ceil(w), h: h, shape: 'rect',
    draw: function (x, y) {
      var cx = x + w / 2;
      var o = '<circle cx="' + r(cx) + '" cy="' + r(y + 8) + '" r="7" fill="' + C.fill + '" stroke="' + C.stroke + '" stroke-width="1.5"/>';
      o += S.line(cx, y + 15, cx, y + 32, { width: 1.5 });
      o += S.line(cx - 11, y + 21, cx + 11, y + 21, { width: 1.5 });
      o += S.line(cx, y + 32, cx - 10, y + 44, { width: 1.5 });
      o += S.line(cx, y + 32, cx + 10, y + 44, { width: 1.5 });
      o += S.text(cx, y + 58, e.label, { size: 13, bold: true, anchor: 'middle' });
      return o;
    }
  };
}

function buildUsecase(e, M) {
  var S = P.S, C = P.C, r = P.r;
  var lines = P.wrapText(e.label, 150, 13, M);
  var tw = 20;
  lines.forEach(function (l) { tw = Math.max(tw, M(l, 13)); });
  var w = Math.max(tw * 1.35 + 30, 80);
  var h = Math.max(lines.length * 16 + 26, 40);
  return {
    w: Math.ceil(w), h: Math.ceil(h), shape: 'ellipse',
    draw: function (x, y) {
      var cx = x + w / 2, cy = y + h / 2;
      var o = '<ellipse cx="' + r(cx) + '" cy="' + r(cy) + '" rx="' + r(w / 2) + '" ry="' + r(h / 2) + '" fill="' + C.fill + '" stroke="' + C.stroke + '" stroke-width="1.4"/>';
      lines.forEach(function (l, i) {
        o += S.ctext(cx, cy + (i - (lines.length - 1) / 2) * 16, l, { size: 13, anchor: 'middle' });
      });
      return o;
    }
  };
}

P.renderUsecase = function (model, M, meta) {
  var S = P.S, C = P.C;
  var boxes = new Map();
  var specNodes = [];
  model.els.forEach(function (e) {
    var b = e.kind === 'actor' ? buildActor(e, M) : buildUsecase(e, M);
    boxes.set(e.id, b);
    specNodes.push({ id: e.id, w: b.w, h: b.h });
  });
  var notes = model.notes.map(function (n) {
    var b = P.buildNote(n, M);
    boxes.set(n.id, b);
    specNodes.push({ id: n.id, w: b.w, h: b.h });
    return n;
  });

  var specEdges = [];
  model.edges.forEach(function (e) {
    var a = model.byId.get(e.from), b = model.byId.get(e.to);
    if (a.kind === 'actor' && b.kind === 'actor') {
      specEdges.push({ from: e.from, to: e.to, constraint: 'same' });
    } else if (e.cls.isHierarchy) {
      specEdges.push({ from: e.from, to: e.to, constraint: 'same' });
    } else if (a.kind === 'actor' && b.kind !== 'actor') {
      specEdges.push({ from: e.from, to: e.to, constraint: 'rank' });
    } else if (b.kind === 'actor' && a.kind !== 'actor') {
      specEdges.push({ from: e.to, to: e.from, constraint: 'rank' });
    } else {
      specEdges.push({ from: e.from, to: e.to, constraint: e.cls.constraint === 'same' ? 'same' : 'rank' });
    }
  });
  notes.forEach(function (n) {
    if (n.target && model.byId.has(n.target)) specEdges.push({ from: n.id, to: n.target, constraint: 'same' });
  });

  var containers = model.boundaries.map(function (b) {
    return { id: b.id, label: b.label, members: b.members.slice(), padX: 24, padTop: 34, padBottom: 20, minW: 120 };
  });

  var lay = P.layout.graph({
    nodes: specNodes, edges: specEdges, containers: containers,
    dir: 'LR', gapNode: 30, gapRank: 90, gapComp: 50
  });

  var out = '';
  lay.rects.forEach(function (rc, cid) {
    var cont = containers.filter(function (c) { return c.id === cid; })[0];
    out += S.rect(rc.x, rc.y, rc.w, rc.h, { fill: 'rgba(245,242,222,0.3)', stroke: C.muted, width: 1.3 });
    out += S.text(rc.x + rc.w / 2, rc.y + 20, cont ? cont.label : '', { size: 13.5, bold: true, anchor: 'middle', fill: '#4a4a38' });
  });

  function nodeRect(id) {
    var p = lay.pos.get(id), b = boxes.get(id);
    return { x: p.x, y: p.y, w: b.w, h: b.h, shape: b.shape || 'rect' };
  }

  model.edges.forEach(function (e) {
    if (!lay.pos.has(e.from) || !lay.pos.has(e.to)) return;
    var na = nodeRect(e.from), nb = nodeRect(e.to);
    /* actor anchor: aim at the figure, not the label box */
    out += P.layout.edgeSvg(na, e.from === e.to ? na : nb, {
      style: e.cls.style, decoA: e.cls.decoL, decoB: e.cls.decoR,
      label: e.label, stereo: e.stereo ? '«' + e.stereo + '»' : null, M: M
    });
  });
  notes.forEach(function (n) {
    if (!n.target || !lay.pos.has(n.id) || !lay.pos.has(n.target)) return;
    var na = nodeRect(n.id), nb = nodeRect(n.target);
    var pa = S.anchor(na, nb.x + nb.w / 2, nb.y + nb.h / 2);
    var pb = S.anchor(nb, na.x + na.w / 2, na.y + na.h / 2);
    out += S.line(pa.x, pa.y, pb.x, pb.y, { dashed: '3,3', stroke: C.noteStroke, width: 1.1 });
  });

  model.els.forEach(function (e) {
    var p = lay.pos.get(e.id);
    if (p) out += boxes.get(e.id).draw(p.x, p.y);
  });
  notes.forEach(function (n) {
    var p = lay.pos.get(n.id);
    if (p) out += boxes.get(n.id).draw(p.x, p.y);
  });

  return { body: out, w: lay.w + 8, h: lay.h + 8 };
};

})(PUML);
