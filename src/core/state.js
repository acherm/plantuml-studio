/* PlantUML Studio — state diagrams: parser, well-formedness checks, renderer. */
'use strict';
(function (P) {

var SNAME = '[A-Za-z_$][\\w.$]*';
var SREF = '\\[\\*\\]|"[^"]*"|' + SNAME;

/* ============================ PARSER ============================ */
P.parseState = function (lines, meta) {
  var D = [];
  var states = new Map(), order = [];
  var trans = [], notes = [];
  var scopeStack = [];   /* stack of composite state ids */
  var noteBuf = null, noteCount = 0;

  function scope() { return scopeStack.length ? scopeStack[scopeStack.length - 1] : ''; }

  function pseudo(kind) {
    /* one initial + one final node per scope */
    var id = '@' + kind + ':' + scope();
    var s = states.get(id);
    if (!s) {
      s = { id: id, label: '', kind: kind, desc: [], line: 0, implicit: false, parent: scope() || null };
      states.set(id, s); order.push(s);
      if (scope()) states.get(scope()).children.push(id);
    }
    return s;
  }

  function getState(id, ln, explicit) {
    var s = states.get(id);
    if (!s) {
      s = { id: id, label: id, kind: 'state', desc: [], line: ln, implicit: !explicit, parent: scope() || null, children: [] };
      states.set(id, s); order.push(s);
      if (scope()) states.get(scope()).children.push(id);
    }
    return s;
  }

  function resolveRef(ref, ln, isTarget) {
    ref = ref.trim();
    if (ref === '[*]') return pseudo(isTarget ? 'final' : 'initial').id;
    return getState(P.unquote(ref), ln).id;
  }

  for (var i = 0; i < lines.length; i++) {
    var t = lines[i].text, ln = lines[i].n, m;

    if (noteBuf) {
      if (/^end\s*note$/i.test(t)) { notes.push(noteBuf); noteBuf = null; }
      else noteBuf.text.push(t);
      continue;
    }

    if (t === '}') {
      if (scopeStack.length) scopeStack.pop();
      else D.push(P.d('error', ln, "Unexpected '}' — no open composite state"));
      continue;
    }
    if (/^(--+|\|\|+)$/.test(t) && scopeStack.length) {
      D.push(P.d('warning', ln, 'Concurrent regions (-- separators) are not supported — treated as one region'));
      continue;
    }

    /* state declaration */
    if ((m = new RegExp('^state\\s+(?:"([^"]+)"\\s+as\\s+(' + SNAME + ')|"([^"]+)"|(' + SNAME + '))\\s*(<<\\s*(choice|fork|join|end|start|entryPoint|exitPoint|history)\\s*>>)?\\s*(\\{)?\\s*$', 'i').exec(t))) {
      var id = m[2] || m[3] || m[4];
      var label = m[1] || m[3] || m[4];
      var stereo = m[6] ? m[6].toLowerCase() : null;
      var ex = states.get(id);
      if (ex && !ex.implicit && !m[7]) D.push(P.d('warning', ln, "state '" + id + "' was already declared (line " + ex.line + ") — declarations merged"));
      var s = getState(id, ln, true);
      s.implicit = false; s.label = label;
      if (stereo) {
        if (stereo === 'choice' || stereo === 'fork' || stereo === 'join') s.kind = stereo;
        else if (stereo === 'end') s.kind = 'final';
        else if (stereo === 'start') s.kind = 'initial';
        else D.push(P.d('warning', ln, '<<' + stereo + '>> is not supported — rendered as a normal state'));
      }
      if (m[7]) {
        s.kind = 'composite';
        if (!s.children) s.children = [];
        scopeStack.push(id);
      }
      continue;
    }

    /* note */
    if ((m = new RegExp('^note\\s+(left|right|top|bottom)\\s+of\\s+(' + SNAME + ')\\s*(?::\\s*(.*))?$', 'i').exec(t))) {
      if (!states.has(m[2])) D.push(P.dW('error', lines[i], m[2], "note refers to '" + m[2] + "' which is not declared"));
      var nb = { id: '@note' + (noteCount++), side: m[1].toLowerCase(), target: m[2], text: m[3] != null ? [m[3]] : [], line: ln, parent: scope() || null };
      if (m[3] != null) notes.push(nb); else noteBuf = nb;
      continue;
    }

    /* transition */
    var link = P.splitLink(t, SREF);
    if (link) {
      var backward = link.arrow.headL && !link.arrow.headR;
      var srcRef = backward ? link.right : link.left;
      var dstRef = backward ? link.left : link.right;
      var fromId = resolveRef(srcRef, ln, false);
      var toId = resolveRef(dstRef, ln, true);
      var cls = P.classifyEdge(link.arrow);
      var aboveEnd = link.arrow.dir === 'up' ? 'R' : 'L'; /* src above dst by default */
      trans.push({ from: fromId, to: toId, label: link.label, style: cls.style, constraint: cls.constraint, aboveEnd: aboveEnd, line: ln });
      continue;
    }

    /* State : description */
    if ((m = new RegExp('^(' + SNAME + ')\\s*:\\s*(.*)$').exec(t))) {
      getState(m[1], ln).desc.push(m[2]);
      continue;
    }

    var stWord = t.split(/\s+/)[0];
    var sug = P.suggest(stWord, ['state', 'note', 'title', 'hide', 'end note']);
    var dU = P.dW('error', lines[i], stWord, 'Unrecognized statement: "' + (t.length > 60 ? t.slice(0, 60) + '…' : t) + '"' + (sug ? ' — did you mean "' + sug + '"?' : '') + '. Transitions look like: A --> B : event');
    if (sug) dU.fix = { line: ln, find: stWord, replace: sug, title: 'Replace with "' + sug + '"' };
    D.push(dU);
  }

  if (scopeStack.length) D.push(P.d('error', states.get(scopeStack[scopeStack.length - 1]).line, "Missing '}' — composite state '" + scopeStack[scopeStack.length - 1] + "' is never closed"));
  if (noteBuf) D.push(P.d('error', noteBuf.line, "Missing 'end note'"));

  /* well-formedness: initial state and reachability at top level */
  var topStates = order.filter(function (s) { return !s.parent && s.kind !== 'initial' && s.kind !== 'final'; });
  var hasInitial = order.some(function (s) { return s.kind === 'initial' && !s.parent; });
  if (topStates.length && !hasInitial) {
    D.push(P.d('warning', topStates[0].line, 'No initial state — add: [*] --> ' + (topStates[0].label || topStates[0].id)));
  }
  if (hasInitial) {
    var adj = new Map();
    trans.forEach(function (tr) {
      if (!adj.has(tr.from)) adj.set(tr.from, []);
      adj.get(tr.from).push(tr.to);
    });
    var seen = new Set(), stack = [];
    order.forEach(function (s) { if (s.kind === 'initial') { stack.push(s.id); seen.add(s.id); } });
    while (stack.length) {
      var cur = stack.pop();
      (adj.get(cur) || []).forEach(function (nx) {
        if (!seen.has(nx)) { seen.add(nx); stack.push(nx); }
      });
      /* entering a composite reaches its children's region entry */
      var cs = states.get(cur);
      if (cs && cs.kind === 'composite') {
        (cs.children || []).forEach(function (ch) {
          var chs = states.get(ch);
          if (chs && chs.kind === 'initial' && !seen.has(ch)) { seen.add(ch); stack.push(ch); }
        });
      }
    }
    order.forEach(function (s) {
      if (s.kind === 'initial' || s.kind === 'final') return;
      if (s.parent && !seen.has(s.parent)) return; /* only report the outermost unreachable */
      if (!seen.has(s.id)) D.push(P.d('warning', s.line, "state '" + (s.label || s.id) + "' is unreachable from the initial state"));
    });
  }
  if (!order.length) D.push(P.d('warning', lines.length ? lines[0].n : 1, 'Empty state diagram — add: [*] --> SomeState'));

  return { model: { states: order, byId: states, trans: trans, notes: notes }, diagnostics: D };
};

/* ============================ RENDERER ============================ */
function buildStateNode(s, M) {
  var S = P.S, C = P.C, r = P.r;
  if (s.kind === 'initial') {
    return { w: 18, h: 18, shape: 'circle', draw: function (x, y) {
      return '<circle cx="' + r(x + 9) + '" cy="' + r(y + 9) + '" r="8" fill="#1B1B14" stroke="none"/>';
    } };
  }
  if (s.kind === 'final') {
    return { w: 20, h: 20, shape: 'circle', draw: function (x, y) {
      return '<circle cx="' + r(x + 10) + '" cy="' + r(y + 10) + '" r="9" fill="' + C.paper + '" stroke="#1B1B14" stroke-width="1.4"/>' +
             '<circle cx="' + r(x + 10) + '" cy="' + r(y + 10) + '" r="5" fill="#1B1B14"/>';
    } };
  }
  if (s.kind === 'choice') {
    return { w: 26, h: 26, shape: 'rect', draw: function (x, y) {
      return S.path('M' + r(x + 13) + ',' + r(y) + ' L' + r(x + 26) + ',' + r(y + 13) + ' L' + r(x + 13) + ',' + r(y + 26) + ' L' + r(x) + ',' + r(y + 13) + ' Z', { fill: C.fill, width: 1.4 }) +
        S.text(x + 34, y + 17, s.label !== s.id || !/^@/.test(s.id) ? s.label : '', { size: 11.5, fill: C.muted });
    } };
  }
  if (s.kind === 'fork' || s.kind === 'join') {
    return { w: 52, h: 8, shape: 'rect', draw: function (x, y) {
      return S.rect(x, y, 52, 8, { fill: '#1B1B14', stroke: 'none', rx: 3 });
    } };
  }
  var titleW = M(s.label, 13.5, { bold: true }) + 26;
  var w = Math.max(70, titleW);
  var descLines = [];
  s.desc.forEach(function (d) {
    P.wrapText(d, 220, 12, M).forEach(function (l) { descLines.push(l); });
  });
  descLines.forEach(function (l) { w = Math.max(w, M(l, 12) + 22); });
  var h = 28 + (descLines.length ? descLines.length * 15 + 10 : 0);
  return {
    w: Math.ceil(w), h: h, shape: 'rect',
    draw: function (x, y) {
      var o = S.rect(x, y, w, h, { rx: 11 });
      o += S.ctext(x + w / 2, y + 14, s.label, { size: 13.5, bold: true, anchor: 'middle' });
      if (descLines.length) {
        o += S.line(x, y + 27, x + w, y + 27, { width: 1.1 });
        descLines.forEach(function (l, i) {
          o += S.text(x + 11, y + 42 + i * 15, l, { size: 12 });
        });
      }
      return o;
    }
  };
}

P.renderState = function (model, M, meta) {
  var S = P.S, C = P.C;
  var boxes = new Map(), specNodes = [], containers = [];

  model.states.forEach(function (s) {
    if (s.kind === 'composite') {
      containers.push({ id: s.id, label: s.label, members: (s.children || []).slice(), padX: 18, padTop: 38, padBottom: 16, minW: 110, line: s.line });
      return;
    }
    var b = buildStateNode(s, M);
    boxes.set(s.id, b);
    specNodes.push({ id: s.id, w: b.w, h: b.h });
  });
  var notes = model.notes.map(function (n) {
    var b = P.buildNote(n, M);
    boxes.set(n.id, b);
    specNodes.push({ id: n.id, w: b.w, h: b.h });
    return n;
  });
  /* notes attached inside a composite must live in that container */
  notes.forEach(function (n) {
    if (n.parent) {
      var cont = containers.filter(function (c) { return c.id === n.parent; })[0];
      if (cont) cont.members.push(n.id);
    }
  });

  var specEdges = [];
  model.trans.forEach(function (e) {
    if (e.constraint === 'same') specEdges.push({ from: e.from, to: e.to, constraint: 'same' });
    else if (e.aboveEnd === 'R') specEdges.push({ from: e.to, to: e.from, constraint: 'rank' });
    else specEdges.push({ from: e.from, to: e.to, constraint: 'rank' });
  });
  notes.forEach(function (n) {
    if (n.target) specEdges.push({ from: n.id, to: n.target, constraint: 'same' });
  });

  var lay = P.layout.graph({
    nodes: specNodes, edges: specEdges, containers: containers,
    overrides: meta && meta.posOverrides,
    dir: 'TB', gapNode: 46, gapRank: 62, gapComp: 56
  });
  var containedIds = new Set();
  containers.forEach(function (c) { (c.members || []).forEach(function (m) { containedIds.add(m); }); });

  var out = '';
  lay.rects.forEach(function (rc, cid) {
    var cont = containers.filter(function (c) { return c.id === cid; })[0];
    out += S.rect(rc.x, rc.y, rc.w, rc.h, { rx: 12, fill: 'rgba(254,254,206,0.35)', width: 1.4 });
    out += S.text(rc.x + rc.w / 2, rc.y + 19, cont ? cont.label : '', { size: 13.5, bold: true, anchor: 'middle' });
    out += S.line(rc.x, rc.y + 27, rc.x + rc.w, rc.y + 27, { width: 1.1 });
  });

  function nodeRect(id) {
    if (lay.rects.has(id)) {
      var rc = lay.rects.get(id);
      return { x: rc.x, y: rc.y, w: rc.w, h: rc.h, shape: 'rect' };
    }
    var p = lay.pos.get(id), b = boxes.get(id);
    if (!p || !b) return null;
    return { x: p.x, y: p.y, w: b.w, h: b.h, shape: b.shape || 'rect' };
  }

  var pairCount = new Map(), pairSeen = new Map();
  model.trans.forEach(function (e) {
    var k = e.from < e.to ? e.from + ' ' + e.to : e.to + ' ' + e.from;
    pairCount.set(k, (pairCount.get(k) || 0) + 1);
  });
  model.trans.forEach(function (e) {
    var na = nodeRect(e.from), nb = nodeRect(e.to);
    if (!na || !nb) return;
    var k = e.from < e.to ? e.from + ' ' + e.to : e.to + ' ' + e.from;
    var cnt = pairCount.get(k), ix = pairSeen.get(k) || 0;
    pairSeen.set(k, ix + 1);
    out += P.layout.edgeSvg(na, e.from === e.to ? na : nb, {
      style: e.style, decoA: 'none', decoB: 'open',
      label: e.label, M: M, offset: cnt > 1 ? (ix - (cnt - 1) / 2) * 16 : 0,
      labelT: cnt > 1 ? 0.32 + 0.36 * (ix / Math.max(cnt - 1, 1)) : 0.5
    });
  });
  notes.forEach(function (n) {
    if (!n.target) return;
    var na = nodeRect(n.id), nb = nodeRect(n.target);
    if (!na || !nb) return;
    var pa = S.anchor(na, nb.x + nb.w / 2, nb.y + nb.h / 2);
    var pb = S.anchor(nb, na.x + na.w / 2, na.y + na.h / 2);
    out += S.line(pa.x, pa.y, pb.x, pb.y, { dashed: '3,3', stroke: C.noteStroke, width: 1.1 });
  });

  model.states.forEach(function (s) {
    if (s.kind === 'composite') return;
    var p = lay.pos.get(s.id);
    if (p) out += P.S.wrapNode(s.id, s.line, p.x, p.y, !containedIds.has(s.id), boxes.get(s.id).draw(p.x, p.y));
  });
  notes.forEach(function (n) {
    var p = lay.pos.get(n.id);
    if (p) out += P.S.wrapNode(n.id, n.line, p.x, p.y, true, boxes.get(n.id).draw(p.x, p.y));
  });

  return { body: out, w: lay.w + 60, h: lay.h + 8 };
};

})(PUML);
