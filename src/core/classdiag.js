/* PlantUML Studio — class & object diagrams: parser, well-formedness checks, renderer. */
'use strict';
(function (P) {

var NAME = '[A-Za-z_$][\\w.$]*';
var LINK_NAME = NAME + '|"[^"]*"';
var KWSUGGEST = ['class', 'interface', 'enum', 'abstract class', 'annotation', 'object', 'note', 'package', 'title', 'skinparam', 'hide', 'show', 'end note'];

/* ============================ CLASS PARSER ============================ */
P.parseClass = function (lines, meta) {
  var D = [];
  var classes = new Map(), order = [];
  var relations = [], packages = [], notes = [], noteLinks = [];
  var pkgStack = [];
  var cur = null;          /* class currently open with { */
  var curOpenLine = 0;
  var noteBuf = null;
  var noteCount = 0;

  function curPkg() { return pkgStack.length ? pkgStack[pkgStack.length - 1] : null; }

  function getClass(id, ln, kind) {
    var c = classes.get(id);
    if (!c) {
      c = { id: id, display: id, kind: kind || 'class', stereo: null, generics: null,
            members: [], line: ln, implicit: !kind, pkg: curPkg() ? curPkg().id : null };
      classes.set(id, c); order.push(c);
      if (!kind) D.push(P.d('info', ln, "'" + id + "' is not declared — implicitly created as a class"));
      if (curPkg()) curPkg().members.push(id);
    }
    return c;
  }

  function declare(kind, id, display, ln) {
    var c = classes.get(id);
    if (c && !c.implicit) {
      D.push(P.d('error', ln, "'" + id + "' is declared twice (first declaration at line " + c.line + ")"));
      return c;
    }
    if (c) { c.implicit = false; c.kind = kind; c.display = display; c.line = ln; }
    else {
      c = { id: id, display: display, kind: kind, stereo: null, generics: null,
            members: [], line: ln, implicit: false, pkg: curPkg() ? curPkg().id : null };
      classes.set(id, c); order.push(c);
      if (curPkg()) curPkg().members.push(id);
    }
    return c;
  }

  function parseMember(t, ln, cls) {
    var vis = null, stat = false, abst = false, forced = null;
    var mm = /^([+\-#~])\s*(.*)$/.exec(t);
    if (mm) { vis = mm[1]; t = mm[2]; }
    t = t.replace(/\{\s*(static|abstract|classifier|field|method)\s*\}/gi, function (_, w) {
      w = w.toLowerCase();
      if (w === 'static' || w === 'classifier') stat = true;
      else if (w === 'abstract') abst = true;
      else forced = w;
      return '';
    }).trim();
    if (!t) { D.push(P.d('warning', ln, 'Empty member declaration')); return; }
    var kind = forced === 'field' ? 'attr' : forced === 'method' ? 'meth'
      : (t.indexOf('(') >= 0 ? 'meth' : 'attr');
    var dup = cls.members.some(function (m) { return m.kind !== 'sep' && m.text === t && m.vis === vis; });
    if (dup) D.push(P.d('warning', ln, "Duplicate member '" + t + "' in " + cls.id));
    cls.members.push({ kind: kind, text: t, vis: vis, stat: stat, abst: abst });
  }

  var KINDMAP = { 'abstract class': 'abstract', 'abstract': 'abstract', 'class': 'class',
    'interface': 'interface', 'enum': 'enum', 'annotation': 'annotation', 'entity': 'entity', 'struct': 'class' };

  for (var i = 0; i < lines.length; i++) {
    var t = lines[i].text, ln = lines[i].n, m;

    if (noteBuf) {
      if (/^end\s*note$/i.test(t)) { notes.push(noteBuf); noteBuf = null; }
      else noteBuf.text.push(t);
      continue;
    }

    if (t === '}') {
      if (cur) { cur = null; }
      else if (pkgStack.length) pkgStack.pop();
      else D.push(P.d('error', ln, "Unexpected '}' — no open class or package block"));
      continue;
    }

    if (cur) {
      /* a new declaration inside an open body ⇒ a '}' is missing above */
      if (/^(abstract\s+class|abstract\s|class\s|interface\s|enum\s|annotation\s|entity\s|struct\s|package\s|namespace\s|object\s)/.test(t)) {
        D.push(P.d('error', ln, "Declaration inside the body of '" + cur.id + "' — did you forget '}' before this line? (block opened at line " + curOpenLine + ')'));
        cur = null;
        i--; /* reprocess this line as a top-level statement */
        continue;
      }
      var sm = /^([-.=_])\1+$/.exec(t);
      var sm2 = /^([-.=_])\1+\s*(.+?)\s*\1\1+$/.exec(t);
      if (sm || sm2) { cur.members.push({ kind: 'sep', text: sm2 ? sm2[2] : null }); continue; }
      parseMember(t, ln, cur);
      continue;
    }

    /* package / namespace */
    if ((m = /^(?:package|namespace)\s+(?:"([^"]+)"|([\w.$]+))(?:\s+<<[^>]*>>)?(?:\s+#\S+)?\s*(\{)?\s*$/.exec(t))) {
      var pname = m[1] || m[2];
      var pkg = { id: '@pkg' + packages.length + ':' + pname, label: pname, members: [], line: ln, parent: curPkg() ? curPkg().id : null };
      packages.push(pkg);
      if (curPkg()) curPkg().members.push(pkg.id);
      if (m[3]) pkgStack.push(pkg);
      else D.push(P.d('warning', ln, "package without '{ … }' block has no content"));
      continue;
    }

    /* declaration */
    if ((m = /^(abstract\s+class|abstract|class|interface|enum|annotation|entity|struct)\s+(.+)$/.exec(t))) {
      var kind = KINDMAP[m[1].replace(/\s+/g, ' ')];
      var rest = m[2], mm2;
      var name = null, alias = null, display = null, generics = null, stereo = null;
      var ext = [], impl = [], opensBrace = false, bad = false;
      if ((mm2 = /^"([^"]+)"\s*(.*)$/.exec(rest))) { name = mm2[1]; rest = mm2[2]; }
      else if ((mm2 = new RegExp('^(' + NAME + ')(?:<([^>{}]*)>)?\\s*(.*)$').exec(rest))) {
        name = mm2[1]; generics = mm2[2] || null; rest = mm2[3];
      } else {
        D.push(P.d('error', ln, 'Expected a name after "' + m[1] + '"'));
        continue;
      }
      while (rest) {
        if ((mm2 = new RegExp('^as\\s+(' + NAME + ')\\s*(.*)$').exec(rest))) { alias = mm2[1]; rest = mm2[2]; }
        else if ((mm2 = /^as\s+"([^"]+)"\s*(.*)$/.exec(rest))) { display = mm2[1]; rest = mm2[2]; }
        else if ((mm2 = /^<<\s*([^>]*?)\s*>>\s*(.*)$/.exec(rest))) { stereo = mm2[1]; rest = mm2[2]; }
        else if ((mm2 = /^#[\w|\\\/;:.-]+\s*(.*)$/.exec(rest))) { rest = mm2[1]; }
        else if ((mm2 = new RegExp('^extends\\s+(' + NAME + '(?:\\s*,\\s*' + NAME + ')*)\\s*(.*)$').exec(rest))) { ext = mm2[1].split(/\s*,\s*/); rest = mm2[2]; }
        else if ((mm2 = new RegExp('^implements\\s+(' + NAME + '(?:\\s*,\\s*' + NAME + ')*)\\s*(.*)$').exec(rest))) { impl = mm2[1].split(/\s*,\s*/); rest = mm2[2]; }
        else if (rest === '{' || rest === '{}') { opensBrace = rest === '{'; rest = ''; }
        else {
          D.push(P.d('error', ln, 'Unexpected "' + rest + '" in ' + m[1] + ' declaration'));
          bad = true; rest = '';
        }
      }
      var id = alias || name;
      var c = declare(kind, id, display || name, ln);
      if (generics) c.generics = generics;
      if (stereo) c.stereo = stereo;
      ext.forEach(function (pid) {
        getClass(pid, ln, classes.has(pid) ? undefined : kind === 'interface' ? 'interface' : 'class');
        relations.push({ from: id, to: pid, cls: { decoL: 'none', decoR: 'tri', style: 'solid', constraint: 'rank', aboveEnd: 'R', isHierarchy: true }, label: null, cardL: null, cardR: null, line: ln });
      });
      impl.forEach(function (pid) {
        getClass(pid, ln, classes.has(pid) ? undefined : 'interface');
        relations.push({ from: id, to: pid, cls: { decoL: 'none', decoR: 'tri', style: 'dashed', constraint: 'rank', aboveEnd: 'R', isHierarchy: true }, label: null, cardL: null, cardR: null, line: ln });
      });
      if (opensBrace) { cur = c; curOpenLine = ln; }
      continue;
    }

    /* notes */
    if ((m = new RegExp('^note\\s+(left|right|top|bottom)\\s+of\\s+(' + NAME + ')\\s*(?::\\s*(.*))?$', 'i').exec(t))) {
      var target = m[2];
      if (!classes.has(target)) D.push(P.d('error', ln, "note refers to '" + target + "' which is not declared (declare it before the note)"));
      var nb = { id: '@note' + (noteCount++), side: m[1].toLowerCase(), target: target, text: m[3] != null ? [m[3]] : [], line: ln };
      if (m[3] != null) notes.push(nb); else noteBuf = nb;
      continue;
    }
    if ((m = new RegExp('^note\\s+"([^"]+)"\\s+as\\s+(' + NAME + ')$', 'i').exec(t))) {
      notes.push({ id: m[2], side: null, target: null, text: [m[1]], line: ln, floating: true });
      continue;
    }
    if (/^note\b/i.test(t)) { D.push(P.d('error', ln, 'Malformed note — expected: note left|right|top|bottom of <Class> : <text>, or note "text" as <Name>')); continue; }

    /* link */
    var link = P.splitLink(t, LINK_NAME);
    if (link) {
      var lId = P.unquote(link.left), rId = P.unquote(link.right);
      var noteEnd = null, clsEnd = null;
      var isNoteL = notes.some(function (n) { return n.id === lId; });
      var isNoteR = notes.some(function (n) { return n.id === rId; });
      if (isNoteL || isNoteR) {
        noteLinks.push({ from: lId, to: rId, line: ln });
        continue;
      }
      getClass(lId, ln); getClass(rId, ln);
      var cls = P.classifyEdge(link.arrow);
      relations.push({ from: lId, to: rId, cls: cls, label: link.label, cardL: link.cardL, cardR: link.cardR, line: ln });
      continue;
    }

    /* Class : member */
    if ((m = new RegExp('^(' + NAME + ')\\s*:\\s*(.+)$').exec(t))) {
      var host = getClass(m[1], ln);
      parseMember(m[2].trim(), ln, host);
      continue;
    }

    var word = t.split(/\s+/)[0];
    var sug = P.suggest(word, KWSUGGEST);
    D.push(P.d('error', ln, 'Unrecognized statement: "' + (t.length > 60 ? t.slice(0, 60) + '…' : t) + '"' + (sug ? ' — did you mean "' + sug + '"?' : '')));
  }

  if (cur) D.push(P.d('error', curOpenLine, "Missing '}' — the block of '" + cur.id + "' is never closed"));
  if (pkgStack.length) D.push(P.d('error', pkgStack[pkgStack.length - 1].line, "Missing '}' — package '" + pkgStack[pkgStack.length - 1].label + "' is never closed"));
  if (noteBuf) D.push(P.d('error', noteBuf.line, "Missing 'end note'"));
  if (!order.length && !notes.length) D.push(P.d('warning', lines.length ? lines[0].n : 1, 'Empty class diagram — declare a class, interface or enum'));

  return { model: { classes: order, byId: classes, relations: relations, packages: packages, notes: notes, noteLinks: noteLinks }, diagnostics: D };
};

/* ============================ OBJECT PARSER ============================ */
P.parseObject = function (lines, meta) {
  var D = [];
  var objects = new Map(), order = [];
  var links = [], notes = [], noteLinks = [];
  var cur = null, curOpenLine = 0, noteBuf = null, noteCount = 0, mapSkip = 0;

  function getObj(id, ln, explicit) {
    var o = objects.get(id);
    if (!o) {
      o = { id: id, display: id, fields: [], line: ln, implicit: !explicit };
      objects.set(id, o); order.push(o);
      if (!explicit) D.push(P.d('info', ln, "'" + id + "' is not declared — implicitly created as an object"));
    }
    return o;
  }

  for (var i = 0; i < lines.length; i++) {
    var t = lines[i].text, ln = lines[i].n, m;

    if (mapSkip) { if (t === '}') mapSkip = 0; continue; }
    if (noteBuf) {
      if (/^end\s*note$/i.test(t)) { notes.push(noteBuf); noteBuf = null; }
      else noteBuf.text.push(t);
      continue;
    }
    if (t === '}') {
      if (cur) cur = null;
      else D.push(P.d('error', ln, "Unexpected '}'"));
      continue;
    }
    if (cur) { cur.fields.push(t); continue; }

    if ((m = new RegExp('^object\\s+(?:"([^"]+)"\\s+as\\s+(' + NAME + ')|"([^"]+)"|(' + NAME + '))(?:\\s+<<[^>]*>>)?(?:\\s+#\\S+)?\\s*(\\{)?\\s*$').exec(t))) {
      var id = m[2] || m[3] || m[4];
      var display = m[1] || m[3] || m[4];
      var ex = objects.get(id);
      if (ex && !ex.implicit) { D.push(P.d('error', ln, "object '" + id + "' is declared twice (first at line " + ex.line + ")")); }
      var o = getObj(id, ln, true);
      o.implicit = false; o.display = display; o.line = ln;
      if (m[5]) { cur = o; curOpenLine = ln; }
      continue;
    }
    if (/^map\b/.test(t)) {
      D.push(P.d('warning', ln, 'map (table) objects are not supported — block ignored'));
      if (/\{\s*$/.test(t)) mapSkip = 1;
      continue;
    }
    if ((m = new RegExp('^note\\s+(left|right|top|bottom)\\s+of\\s+(' + NAME + ')\\s*(?::\\s*(.*))?$', 'i').exec(t))) {
      if (!objects.has(m[2])) D.push(P.d('error', ln, "note refers to '" + m[2] + "' which is not declared"));
      var nb = { id: '@note' + (noteCount++), side: m[1].toLowerCase(), target: m[2], text: m[3] != null ? [m[3]] : [], line: ln };
      if (m[3] != null) notes.push(nb); else noteBuf = nb;
      continue;
    }
    var link = P.splitLink(t, LINK_NAME);
    if (link) {
      getObj(P.unquote(link.left), ln); getObj(P.unquote(link.right), ln);
      links.push({ from: P.unquote(link.left), to: P.unquote(link.right), cls: P.classifyEdge(link.arrow), label: link.label, cardL: link.cardL, cardR: link.cardR, line: ln });
      continue;
    }
    if ((m = new RegExp('^(' + NAME + ')\\s*:\\s*(.+)$').exec(t))) {
      getObj(m[1], ln).fields.push(m[2].trim());
      continue;
    }
    var sug = P.suggest(t.split(/\s+/)[0], ['object', 'map', 'note', 'title']);
    D.push(P.d('error', ln, 'Unrecognized statement: "' + (t.length > 60 ? t.slice(0, 60) + '…' : t) + '"' + (sug ? ' — did you mean "' + sug + '"?' : '')));
  }
  if (cur) D.push(P.d('error', curOpenLine, "Missing '}' — the block of '" + cur.id + "' is never closed"));
  if (noteBuf) D.push(P.d('error', noteBuf.line, "Missing 'end note'"));
  if (!order.length) D.push(P.d('warning', lines.length ? lines[0].n : 1, 'Empty object diagram — declare an object'));
  return { model: { objects: order, links: links, notes: notes }, diagnostics: D };
};

/* ============================ RENDERING ============================ */
var S_TITLE = 14, S_MEMBER = 12.5, ROW = 17, PADX = 10;

function visIcon(x, cy, vis) {
  var c = P.C.vis[vis] || P.C.muted;
  var s = 3.6;
  switch (vis) {
    case '+': return '<circle cx="' + P.r(x) + '" cy="' + P.r(cy) + '" r="' + s + '" fill="' + c + '" stroke="#5c5c46" stroke-width="0.8"/>';
    case '-': return '<rect x="' + P.r(x - s) + '" y="' + P.r(cy - s) + '" width="' + (2 * s) + '" height="' + (2 * s) + '" fill="' + c + '" stroke="#5c5c46" stroke-width="0.8"/>';
    case '#': return '<path d="M' + P.r(x) + ',' + P.r(cy - s - 1) + ' l' + (s + 1) + ',' + (s + 1) + ' l-' + (s + 1) + ',' + (s + 1) + ' l-' + (s + 1) + ',-' + (s + 1) + ' Z" fill="' + c + '" stroke="#5c5c46" stroke-width="0.8"/>';
    case '~': return '<path d="M' + P.r(x - s) + ',' + P.r(cy + s) + ' h' + (2 * s) + ' l-' + s + ',-' + (2 * s) + ' Z" fill="' + c + '" stroke="#5c5c46" stroke-width="0.8"/>';
    default: return '';
  }
}

/* Builds a class/object node: returns {w,h,draw(x,y)} */
function buildBox(c, M, mode) {
  var S = P.S;
  var isObj = mode === 'object';
  var kind = isObj ? 'object' : c.kind;
  var badgeLetter = { class: 'C', abstract: 'A', interface: 'I', enum: 'E', annotation: '@', entity: 'E', object: 'O' }[kind] || 'C';
  var badgeColor = P.C.badge[kind] || P.C.badge.class;
  var title = isObj ? c.display : (c.display + (c.generics ? '<' + c.generics + '>' : ''));
  var titleItalic = kind === 'abstract' || kind === 'interface';
  var stereoText = !isObj && (c.stereo || (kind === 'interface' ? 'interface' : kind === 'annotation' ? 'annotation' : kind === 'enum' && c.stereo ? c.stereo : null));
  if (stereoText) stereoText = '«' + stereoText + '»';

  var titleW = M(title, S_TITLE, { bold: true }) + 26;
  var w = Math.max(70, titleW + PADX * 2);
  if (stereoText) w = Math.max(w, M(stereoText, 12) + PADX * 2);

  var members = isObj
    ? c.fields.map(function (f) { return { kind: 'attr', text: f, vis: null, stat: false, abst: false }; })
    : c.members;

  members.forEach(function (mb) {
    if (mb.kind === 'sep') { if (mb.text) w = Math.max(w, M(mb.text, 11) + 40); return; }
    w = Math.max(w, M(mb.text, S_MEMBER, { italic: mb.abst }) + (mb.vis ? 20 : 10) + PADX * 2);
  });

  /* compartments: explicit separators keep order; otherwise attrs then methods */
  var comps = [];
  var hasSep = members.some(function (mb) { return mb.kind === 'sep'; });
  if (isObj) {
    comps = [members];
  } else if (hasSep) {
    var curC = [];
    comps.push(curC);
    members.forEach(function (mb) {
      if (mb.kind === 'sep') { curC = []; curC.sepLabel = mb.text; comps.push(curC); }
      else curC.push(mb);
    });
  } else if (kind === 'enum') {
    comps = [members];
  } else {
    comps = [members.filter(function (mb) { return mb.kind === 'attr'; }),
             members.filter(function (mb) { return mb.kind === 'meth'; })];
  }

  var titleH = 26 + (stereoText ? 15 : 0);
  var h = titleH;
  comps.forEach(function (cp) { h += Math.max(cp.length * ROW + 6, 10) + (cp.sepLabel ? 6 : 0); });

  return {
    w: Math.ceil(w), h: Math.ceil(h),
    draw: function (x, y) {
      var out = S.rect(x, y, w, h, { rx: 2.5 });
      var ty = y + (stereoText ? 13 : 0);
      if (stereoText) out += S.text(x + w / 2, y + 14, stereoText, { size: 12, anchor: 'middle', fill: P.C.muted });
      /* badge + title centered as a group */
      var grpW = M(title, S_TITLE, { bold: true }) + 26;
      var bx = x + (w - grpW) / 2 + 10, byc = ty + 14;
      out += '<circle cx="' + P.r(bx) + '" cy="' + P.r(byc) + '" r="9" fill="' + badgeColor + '" stroke="#5c5c46" stroke-width="0.9"/>';
      out += S.ctext(bx, byc, badgeLetter, { size: 11, anchor: 'middle', bold: true, fill: '#333322' });
      out += S.ctext(bx + 15, byc, title, { size: S_TITLE, bold: true, italic: titleItalic, underline: isObj });
      var cy = y + titleH;
      comps.forEach(function (cp) {
        out += S.line(x, cy, x + w, cy, { width: 1.1 });
        if (cp.sepLabel) {
          out += S.text(x + w / 2, cy + 4, ' ' + cp.sepLabel + ' ', { size: 10.5, anchor: 'middle', fill: P.C.muted, halo: P.C.fill });
          cy += 6;
        }
        var innerH = Math.max(cp.length * ROW + 6, 10);
        var ry = cy + 3;
        cp.forEach(function (mb) {
          var rcy = ry + ROW / 2;
          var tx = x + PADX;
          if (mb.vis) { out += visIcon(x + PADX + 3, rcy, mb.vis); tx = x + PADX + 12; }
          out += S.ctext(tx, rcy, mb.text, { size: S_MEMBER, italic: mb.abst, underline: mb.stat });
          ry += ROW;
        });
        cy += innerH;
      });
      return out;
    }
  };
}

function buildNote(n, M) {
  var S = P.S;
  var raw = n.text.join('\n');
  var lines = [];
  raw.split('\n').forEach(function (l) {
    P.wrapText(l, 170, 12, M).forEach(function (x) { lines.push(x); });
  });
  if (!lines.length) lines = [''];
  var w = 20;
  lines.forEach(function (l) { w = Math.max(w, M(l, 12) + 22); });
  var h = lines.length * 15 + 14;
  return {
    w: Math.ceil(w), h: Math.ceil(h),
    draw: function (x, y) {
      var f = 9;
      var d = 'M' + P.r(x) + ',' + P.r(y) + ' h' + P.r(w - f) + ' l' + f + ',' + f + ' v' + P.r(h - f) + ' h-' + P.r(w) + ' Z';
      var out = S.path(d, { fill: P.C.noteFill, stroke: P.C.noteStroke, linejoin: 'round' });
      out += S.path('M' + P.r(x + w - f) + ',' + P.r(y) + ' v' + f + ' h' + f, { stroke: P.C.noteStroke });
      lines.forEach(function (l, i) {
        out += S.text(x + 8, y + 16 + i * 15, l, { size: 12 });
      });
      return out;
    }
  };
}

function renderBoxDiagram(nodes, edges, containers, notes, noteAttach, M, opts) {
  /* nodes: [{id, box}], edges: relations w/ .cls, containers: packages, notes: [{id,box,target,side}] */
  var S = P.S;
  var specNodes = [], boxes = new Map();
  nodes.forEach(function (n) { specNodes.push({ id: n.id, w: n.box.w, h: n.box.h }); boxes.set(n.id, n.box); });
  notes.forEach(function (n) { specNodes.push({ id: n.id, w: n.box.w, h: n.box.h }); boxes.set(n.id, n.box); });

  var specEdges = [];
  edges.forEach(function (e) {
    var c = e.cls;
    if (c.constraint === 'same') specEdges.push({ from: e.from, to: e.to, constraint: 'same' });
    else if (c.aboveEnd === 'R') specEdges.push({ from: e.to, to: e.from, constraint: 'rank' });
    else specEdges.push({ from: e.from, to: e.to, constraint: 'rank' });
  });
  noteAttach.forEach(function (a) {
    specEdges.push({ from: a.from, to: a.to, constraint: a.side === 'top' || a.side === 'bottom' ? 'rank' : 'same' });
  });

  var lay = P.layout.graph({
    nodes: specNodes, edges: specEdges,
    containers: containers,
    dir: 'TB', gapNode: 44, gapRank: 72, gapComp: 56
  });

  var out = '';
  /* containers first (behind) */
  lay.rects.forEach(function (rc, cid) {
    var cont = containers.filter(function (c) { return c.id === cid; })[0];
    var label = cont && cont.label || '';
    var tabW = Math.min(M(label, 12.5, { bold: true }) + 22, rc.w - 10);
    out += P.S.path('M' + P.r(rc.x) + ',' + P.r(rc.y + 14) + ' v-10 q0,-4 4,-4 h' + P.r(tabW - 8) + ' q4,0 4,4 v10',
      { fill: '#F5F2DE', stroke: P.C.muted, width: 1.2 });
    out += P.S.rect(rc.x, rc.y + 14, rc.w, rc.h - 14, { fill: 'rgba(245,242,222,0.35)', stroke: P.C.muted, width: 1.2 });
    out += P.S.text(rc.x + 9, rc.y + 10.5, label, { size: 12.5, bold: true, fill: '#4a4a38' });
  });

  function nodeRect(id) {
    var p = lay.pos.get(id), b = boxes.get(id);
    return { x: p.x, y: p.y, w: b.w, h: b.h, shape: 'rect' };
  }

  /* multi-edge offsets between the same pair */
  var pairCount = new Map(), pairSeen = new Map();
  edges.forEach(function (e) {
    var k = e.from < e.to ? e.from + ' ' + e.to : e.to + ' ' + e.from;
    pairCount.set(k, (pairCount.get(k) || 0) + 1);
  });

  edges.forEach(function (e) {
    if (!lay.pos.has(e.from) || !lay.pos.has(e.to)) return;
    var k = e.from < e.to ? e.from + ' ' + e.to : e.to + ' ' + e.from;
    var n = pairCount.get(k), idx = pairSeen.get(k) || 0;
    pairSeen.set(k, idx + 1);
    var offset = n > 1 ? (idx - (n - 1) / 2) * 18 : 0;
    var stereo = null, label = e.label;
    if (label) {
      var lm = /^\s*(?:<<\s*(.*?)\s*>>|«(.*?)»)\s*$/.exec(label);
      if (lm) { stereo = '«' + (lm[1] || lm[2]) + '»'; label = null; }
      else label = label.replace(/\s*[<>]\s*$/, '').replace(/^\s*[<>]\s*/, '');
    }
    out += P.layout.edgeSvg(nodeRect(e.from), e.from === e.to ? nodeRect(e.from) : nodeRect(e.to), {
      style: e.cls.style, decoA: e.cls.decoL, decoB: e.cls.decoR,
      label: label, stereo: stereo, cardA: e.cardL, cardB: e.cardR, M: M, offset: offset,
      labelT: n > 1 ? 0.32 + 0.36 * (idx / Math.max(n - 1, 1)) : 0.5
    });
  });
  noteAttach.forEach(function (a) {
    if (!lay.pos.has(a.from) || !lay.pos.has(a.to)) return;
    var na = nodeRect(a.from), nb = nodeRect(a.to);
    var pa = P.S.anchor(na, nb.x + nb.w / 2, nb.y + nb.h / 2);
    var pb = P.S.anchor(nb, na.x + na.w / 2, na.y + na.h / 2);
    out += S.line(pa.x, pa.y, pb.x, pb.y, { dashed: '3,3', stroke: P.C.noteStroke, width: 1.1 });
  });

  nodes.forEach(function (n) {
    var p = lay.pos.get(n.id);
    if (p) out += n.box.draw(p.x, p.y);
  });
  notes.forEach(function (n) {
    var p = lay.pos.get(n.id);
    if (p) out += n.box.draw(p.x, p.y);
  });

  /* recompute extent (self loops / labels can stick out a bit) */
  return { body: out, w: lay.w + 60, h: lay.h + 8 };
}

P.renderClass = function (model, M, meta) {
  var nodes = model.classes.map(function (c) { return { id: c.id, box: buildBox(c, M, 'class') }; });
  var notes = model.notes.map(function (n) { return { id: n.id, box: buildNote(n, M), target: n.target, side: n.side }; });
  var attach = [];
  model.notes.forEach(function (n) {
    if (n.target && model.byId.has(n.target)) attach.push({ from: n.id, to: n.target, side: n.side });
  });
  (model.noteLinks || []).forEach(function (l) {
    attach.push({ from: l.from, to: l.to, side: 'left' });
  });
  var containers = model.packages.map(function (p) {
    return { id: p.id, label: p.label, members: p.members.slice(), padX: 18, padTop: 34, padBottom: 16 };
  });
  return renderBoxDiagram(nodes, model.relations, containers, notes, attach, M, {});
};

P.renderObject = function (model, M, meta) {
  var nodes = model.objects.map(function (o) { return { id: o.id, box: buildBox(o, M, 'object') }; });
  var notes = model.notes.map(function (n) { return { id: n.id, box: buildNote(n, M), target: n.target, side: n.side }; });
  var attach = [];
  model.notes.forEach(function (n) {
    if (n.target) attach.push({ from: n.id, to: n.target, side: n.side });
  });
  return renderBoxDiagram(nodes, model.links, [], notes, attach, M, {});
};

P.buildNote = buildNote; /* reused by other renderers */

})(PUML);
