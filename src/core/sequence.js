/* PlantUML Studio — sequence diagrams: parser, well-formedness checks, renderer. */
'use strict';
(function (P) {

var PNAME = '[\\w@.$]+';
var PKINDS = ['participant', 'actor', 'boundary', 'control', 'entity', 'database', 'collections', 'queue'];

/* ============================ PARSER ============================ */
P.parseSequence = function (lines, meta) {
  var D = [];
  var parts = new Map(), order = [];
  var events = [];
  var fragStack = [];
  var noteBuf = null;

  function getPart(id, ln, kind, label) {
    var p = parts.get(id);
    if (!p) {
      p = { id: id, label: label || id, kind: kind || 'participant', line: ln };
      parts.set(id, p); order.push(p);
    } else if (kind) {
      if (!p.explicit) { p.kind = kind; p.label = label || p.label; }
    }
    return p;
  }

  function seqArrow(tok) {
    var t2 = tok.replace(/\[#[^\]]*\]/g, '');
    var m = /^(x|o)?(<{1,2})?(-{1,2})(>{1,2})?(x|o)?$/.exec(t2);
    if (!m) return null;
    var hasL = !!m[2], hasR = !!m[4];
    if (hasL === hasR) return null; /* need exactly one direction */
    return {
      leftward: hasL,
      dashed: m[3].length >= 2,
      async: (hasL ? m[2] : m[4]).length === 2,
      lost: hasL ? m[1] === 'x' : m[5] === 'x',
      found: hasL ? m[1] === 'o' : m[5] === 'o'
    };
  }

  for (var i = 0; i < lines.length; i++) {
    var t = lines[i].text, ln = lines[i].n, m;

    if (noteBuf) {
      if (/^end\s*(note|ref|rnote|hnote)$/i.test(t)) { events.push(noteBuf); noteBuf = null; }
      else noteBuf.text.push(t);
      continue;
    }

    /* participant declarations */
    if ((m = new RegExp('^(' + PKINDS.join('|') + ')\\s+(.+)$').exec(t))) {
      var kind = m[1], rest = m[2], mm;
      var id = null, label = null;
      if ((mm = new RegExp('^"([^"]+)"\\s+as\\s+(' + PNAME + ')\\s*(.*)$').exec(rest))) { label = mm[1]; id = mm[2]; rest = mm[3]; }
      else if ((mm = new RegExp('^(' + PNAME + ')\\s+as\\s+"([^"]+)"\\s*(.*)$').exec(rest))) { id = mm[1]; label = mm[2]; rest = mm[3]; }
      else if ((mm = /^"([^"]+)"\s*(.*)$/.exec(rest))) { id = mm[1]; label = mm[1]; rest = mm[2]; }
      else if ((mm = new RegExp('^(' + PNAME + ')\\s*(.*)$').exec(rest))) { id = mm[1]; label = mm[1]; rest = mm[2]; }
      if (id == null) { D.push(P.d('error', ln, 'Expected a name after "' + kind + '"')); continue; }
      rest = rest.replace(/order\s+\d+/, '').replace(/#[\w\/\\|-]+/, '').trim();
      if (rest) D.push(P.d('warning', ln, 'Ignored trailing "' + rest + '" in participant declaration'));
      var ex = parts.get(id);
      if (ex && ex.explicit) { D.push(P.d('error', ln, "participant '" + id + "' is declared twice (first at line " + ex.line + ")")); continue; }
      var pp = getPart(id, ln, kind, label);
      pp.explicit = true; pp.kind = kind; pp.label = label;
      continue;
    }

    /* fragments */
    if ((m = /^(alt|opt|loop|par|break|critical|group)\b\s*(.*)$/.exec(t))) {
      var fr = { k: 'fragOpen', op: m[1], label: m[2] || null, line: ln };
      fragStack.push(fr); events.push(fr);
      continue;
    }
    if ((m = /^else\b\s*(.*)$/.exec(t))) {
      if (!fragStack.length) { D.push(P.d('error', ln, "'else' outside of any alt/par/group block")); continue; }
      var top = fragStack[fragStack.length - 1];
      if (top.op !== 'alt' && top.op !== 'par' && top.op !== 'group' && top.op !== 'opt') {
        D.push(P.d('warning', ln, "'else' inside a '" + top.op + "' block — PlantUML only allows else in alt/par"));
      }
      events.push({ k: 'fragElse', label: m[1] || null, line: ln });
      continue;
    }
    if (/^end$/.test(t)) {
      if (!fragStack.length) { D.push(P.d('error', ln, "'end' without a matching alt/opt/loop/par/break/critical/group")); continue; }
      fragStack.pop();
      events.push({ k: 'fragClose', line: ln });
      continue;
    }

    /* notes and ref */
    if ((m = new RegExp('^[hr]?note\\s+(left|right)(?:\\s+of)?\\s+(' + PNAME + '|"[^"]+")\\s*(?::\\s*(.*))?$', 'i').exec(t))) {
      var tgt = P.unquote(m[2]);
      if (!parts.has(tgt)) D.push(P.d('error', ln, "note refers to '" + tgt + "' which has not appeared yet"));
      var nb = { k: 'note', side: m[1].toLowerCase(), targets: [tgt], text: m[3] != null ? [m[3]] : [], line: ln };
      if (m[3] != null) events.push(nb); else noteBuf = nb;
      continue;
    }
    if ((m = new RegExp('^[hr]?note\\s+over\\s+((?:' + PNAME + '|"[^"]+")(?:\\s*,\\s*(?:' + PNAME + '|"[^"]+"))*)\\s*(?::\\s*(.*))?$', 'i').exec(t))) {
      var tgts = m[1].split(/\s*,\s*/).map(P.unquote);
      tgts.forEach(function (g) { if (!parts.has(g)) D.push(P.d('error', ln, "note refers to '" + g + "' which has not appeared yet")); });
      var nb2 = { k: 'note', side: 'over', targets: tgts, text: m[2] != null ? [m[2]] : [], line: ln };
      if (m[2] != null) events.push(nb2); else noteBuf = nb2;
      continue;
    }
    if ((m = new RegExp('^ref\\s+over\\s+((?:' + PNAME + '|"[^"]+")(?:\\s*,\\s*(?:' + PNAME + '|"[^"]+"))*)\\s*(?::\\s*(.*))?$', 'i').exec(t))) {
      var tg2 = m[1].split(/\s*,\s*/).map(P.unquote);
      tg2.forEach(function (g) { if (!parts.has(g)) D.push(P.d('error', ln, "ref refers to '" + g + "' which has not appeared yet")); });
      var rb = { k: 'ref', targets: tg2, text: m[2] != null ? [m[2]] : [], line: ln };
      if (m[2] != null) events.push(rb); else noteBuf = rb;
      continue;
    }
    if (/^[hr]?note\b/i.test(t)) { D.push(P.d('error', ln, 'Malformed note — expected: note left|right of <P> : text, or note over <P>[,<Q>] : text')); continue; }

    /* dividers, delays, spacers */
    if ((m = /^==+\s*(.*?)\s*==+$/.exec(t))) { events.push({ k: 'divider', label: m[1], line: ln }); continue; }
    if ((m = /^\.\.\.\s*(.*?)\s*(?:\.\.\.)?$/.exec(t)) && /^\.\.\./.test(t)) { events.push({ k: 'delay', label: m[1] || null, line: ln }); continue; }
    if (/^\|{3,}$/.test(t)) { events.push({ k: 'spacer', line: ln }); continue; }

    /* autonumber */
    if ((m = /^autonumber\b\s*(.*)$/.exec(t))) {
      var arg = m[1].trim();
      if (arg === 'stop') events.push({ k: 'autonumber', mode: 'stop', line: ln });
      else if (arg === 'resume') events.push({ k: 'autonumber', mode: 'resume', line: ln });
      else {
        var nums = arg.match(/^(\d+)?(?:\s+(\d+))?/);
        events.push({ k: 'autonumber', mode: 'start', start: nums && nums[1] ? +nums[1] : 1, step: nums && nums[2] ? +nums[2] : 1, line: ln });
        if (/["<]/.test(arg)) D.push(P.d('info', ln, 'autonumber format strings are not supported — plain numbers used'));
      }
      continue;
    }

    /* activate / deactivate / destroy / create */
    if ((m = new RegExp('^(activate|deactivate|destroy)\\s+(' + PNAME + '|"[^"]+")\\s*(?:#\\S+)?$').exec(t))) {
      var pid = P.unquote(m[2]);
      if (!parts.has(pid)) { D.push(P.d('error', ln, "'" + pid + "' has not appeared yet — declare it or send it a message first")); getPart(pid, ln); }
      events.push({ k: m[1], id: pid, line: ln });
      continue;
    }
    if ((m = new RegExp('^create\\s+(?:(participant|actor|control|boundary|entity|database)\\s+)?(' + PNAME + '|"[^"]+")\\s*$').exec(t))) {
      var cid = P.unquote(m[2]);
      getPart(cid, ln, m[1] || 'participant');
      D.push(P.d('info', ln, "create: '" + cid + "' is shown from the start (creation timing is not rendered in this editor)"));
      continue;
    }
    if ((m = /^return\b\s*(.*)$/.exec(t))) { events.push({ k: 'return', label: m[1] || null, line: ln }); continue; }

    /* message */
    var msgRe = new RegExp('^(?:"([^"]+)"|(' + PNAME + '))\\s*([xo<>\\[\\]#\\w-]*?[-<>][xo<>\\[\\]#\\w-]*?)\\s*(?:"([^"]+)"|(' + PNAME + '))\\s*([+\\-*!]{1,4})?\\s*(?::\\s*(.*))?$');
    if ((m = msgRe.exec(t))) {
      var arr = seqArrow(m[3]);
      if (arr) {
        var a = m[1] || m[2], b = m[4] || m[5];
        var from = arr.leftward ? b : a;
        var to = arr.leftward ? a : b;
        getPart(from, ln); getPart(to, ln);
        var mods = m[6] || '';
        var ev = { k: 'msg', from: from, to: to, label: m[7] != null ? m[7] : null,
                   dashed: arr.dashed, async: arr.async, lost: arr.lost, line: ln,
                   activate: mods.indexOf('++') >= 0, deactivate: mods.indexOf('--') >= 0 };
        if (/\*\*|!!/.test(mods)) D.push(P.d('info', ln, '** / !! (create-destroy shorthand) is not rendered'));
        events.push(ev);
        continue;
      }
    }

    var sug = P.suggest(t.split(/\s+/)[0], PKINDS.concat(['alt', 'opt', 'loop', 'par', 'break', 'critical', 'group', 'end', 'else', 'note', 'ref', 'activate', 'deactivate', 'destroy', 'return', 'autonumber', 'title']));
    D.push(P.d('error', ln, 'Unrecognized statement: "' + (t.length > 60 ? t.slice(0, 60) + '…' : t) + '"' + (sug ? ' — did you mean "' + sug + '"?' : '') + '. Messages look like: A -> B : text'));
  }

  fragStack.forEach(function (fr) {
    D.push(P.d('error', fr.line, "'" + fr.op + "' block is never closed — add 'end'"));
    events.push({ k: 'fragClose', line: fr.line, auto: true });
  });
  if (noteBuf) D.push(P.d('error', noteBuf.line, "Missing 'end note'"));
  if (!order.length) D.push(P.d('warning', lines.length ? lines[0].n : 1, 'Empty sequence diagram — send a message: A -> B : hello'));

  /* simulate activations for well-formedness (mirrors the renderer) */
  (function () {
    var stacks = new Map(); /* id -> [{caller:bool}] */
    function st(id) { if (!stacks.has(id)) stacks.set(id, []); return stacks.get(id); }
    function dec(id, ln, what) {
      var s = st(id);
      if (!s.length) { D.push(P.d('warning', ln, what + " '" + id + "': it has no active activation")); return; }
      s.pop();
    }
    events.forEach(function (e) {
      if (e.k === 'msg') {
        if (e.activate) st(e.to).push({ caller: true });
        if (e.deactivate) dec(e.from, e.line, 'deactivate (--) on');
      } else if (e.k === 'activate') st(e.id).push({ caller: false });
      else if (e.k === 'deactivate') dec(e.id, e.line, 'deactivate');
      else if (e.k === 'destroy') stacks.set(e.id, []);
      else if (e.k === 'return') {
        var found = null;
        stacks.forEach(function (s) {
          if (s.length && s[s.length - 1].caller) found = s;
        });
        if (!found) D.push(P.d('warning', e.line, "return: no activation opened with '++' to return from"));
        else found.pop();
      }
    });
  })();

  return { model: { parts: order, byId: parts, events: events }, diagnostics: D };
};

/* ============================ RENDERER ============================ */
P.renderSequence = function (model, M, meta) {
  var S = P.S, C = P.C, r = P.r;
  var parts = model.parts;
  var out = '';
  if (!parts.length) return { body: '', w: 60, h: 40 };

  var idx = new Map();
  parts.forEach(function (p, i) { idx.set(p.id, i); });

  /* ---- head boxes ---- */
  parts.forEach(function (p) {
    p.headW = Math.max(M(p.label, 13, { bold: true }) + 22, 48);
    p.headH = p.kind === 'actor' ? 58 : p.kind === 'database' ? 50 : 30;
  });
  var headH = 0;
  parts.forEach(function (p) { headH = Math.max(headH, p.headH); });

  /* ---- horizontal placement ---- */
  var n = parts.length;
  var gaps = [];
  for (var i = 0; i < n - 1; i++) gaps.push(60);
  var leftM = 10, rightM = 10;

  function need(a, b, w) {
    /* ensure sum of gaps between a..b-1 plus half-widths >= w */
    if (a > b) { var t2 = a; a = b; b = t2; }
    if (a === b) return;
    var cur = 0;
    for (var q = a; q < b; q++) cur += gaps[q] + (q === a ? parts[q].headW / 2 : parts[q].headW) ;
    cur += parts[b].headW / 2;
    /* simpler: distance between centers */
    var dist = 0;
    for (q = a; q < b; q++) dist += parts[q].headW / 2 + gaps[q] + parts[q + 1].headW / 2;
    if (dist < w) {
      var add = (w - dist) / (b - a);
      for (q = a; q < b; q++) gaps[q] += add;
    }
  }

  var labelW = function (txt, sz) {
    var mx = 0;
    String(txt == null ? '' : txt).split(/\\n/).forEach(function (l) { mx = Math.max(mx, M(l, sz || 12.5)); });
    return mx;
  };

  model.events.forEach(function (e) {
    if (e.k === 'msg') {
      var a = idx.get(e.from), b = idx.get(e.to);
      if (a === b) {
        var wSelf = labelW(e.label) + 90;
        if (a < n - 1) need(a, a + 1, wSelf);
        else rightM = Math.max(rightM, wSelf - parts[a].headW / 2 + 20);
      } else {
        need(a, b, labelW(e.label) + 60);
      }
    } else if (e.k === 'note' || e.k === 'ref') {
      var w2 = Math.min(labelW(e.text.join(' '), 12), 220) + 30;
      var is2 = e.targets.map(function (g) { return idx.get(g); }).filter(function (x) { return x != null; });
      if (!is2.length) return;
      var mn = Math.min.apply(null, is2), mx = Math.max.apply(null, is2);
      if (e.side === 'over' || e.k === 'ref') {
        if (mn !== mx) need(mn, mx, w2 - 40);
      } else if (e.side === 'left' && mn === 0) leftM = Math.max(leftM, w2 + 10);
      else if (e.side === 'left') need(mn - 1, mn, w2 + 20);
      else if (e.side === 'right' && mx === n - 1) rightM = Math.max(rightM, w2 + 10);
      else if (e.side === 'right') need(mx, mx + 1, w2 + 20);
    }
  });

  var X = [];
  var cx = leftM + parts[0].headW / 2;
  parts.forEach(function (p, i2) {
    if (i2 > 0) cx += parts[i2 - 1].headW / 2 + gaps[i2 - 1] + p.headW / 2;
    X.push(cx);
  });
  var totalW = cx + parts[n - 1].headW / 2 + rightM;

  /* ---- vertical pass ---- */
  var y = headH + 18;
  var acts = new Map();      /* id -> stack of {y0, caller, depth} */
  var actsAll = [];          /* finished bars {id, y0, y1, depth} */
  var openOrder = [];        /* activation open order for return */
  var frames = [];           /* finalized fragment frames */
  var fStack = [];
  var draws = [];            /* deferred draw ops */
  var num = null;            /* autonumber state */
  var destroyed = new Map(); /* id -> y of destruction */

  function depth(id) { return (acts.get(id) || []).length; }
  function barEdgeX(id, side) {
    var d = depth(id);
    var base = X[idx.get(id)];
    if (d === 0) return base;
    var cxBar = base + (d - 1) * 6;
    return side === 'L' ? cxBar - 5 : cxBar + 5;
  }
  function touch(xa, xb) {
    for (var q = 0; q < fStack.length; q++) {
      fStack[q].min = Math.min(fStack[q].min, Math.min(xa, xb));
      fStack[q].max = Math.max(fStack[q].max, Math.max(xa, xb));
    }
  }
  function openAct(id, atY, caller) {
    var st = acts.get(id) || [];
    st.push({ y0: atY, caller: caller || null, depth: st.length + 1 });
    acts.set(id, st);
    openOrder.push(id);
  }
  function closeAct(id, atY) {
    var st = acts.get(id);
    if (!st || !st.length) return false;
    var a = st.pop();
    actsAll.push({ id: id, y0: a.y0, y1: atY, depth: a.depth });
    var oi = openOrder.lastIndexOf(id);
    if (oi >= 0) openOrder.splice(oi, 1);
    return true;
  }

  model.events.forEach(function (e) {
    switch (e.k) {
      case 'msg': {
        var lab = e.label;
        if (num && num.on && lab != null) { lab = num.v + ': ' + lab; num.v += num.step; }
        else if (num && num.on && lab == null) { lab = String(num.v); num.v += num.step; }
        var labLines = lab != null ? String(lab).split(/\\n/) : [];
        var a = idx.get(e.from), b = idx.get(e.to);
        if (a === b) {
          var sy = y + labLines.length * 15;
          var sx = barEdgeX(e.from, 'R');
          draws.push({ t: 'self', x: sx, y: sy, lines: labLines, dashed: e.dashed, async: e.async });
          touch(X[a] - 10, X[a] + 90 + labelW(e.label));
          if (e.activate) openAct(e.to, sy + 22, e.from);
          if (e.deactivate) closeAct(e.from, sy + 22);
          y = sy + 34;
        } else {
          var ay = y + labLines.length * 15 + 4;
          if (e.activate) openAct(e.to, ay, e.from);
          var ltr = a < b;
          var x1 = barEdgeX(e.from, ltr ? 'R' : 'L');
          var x2 = barEdgeX(e.to, ltr ? 'L' : 'R');
          draws.push({ t: 'arrow', x1: x1, x2: x2, y: ay, lines: labLines, dashed: e.dashed, async: e.async, lost: e.lost });
          touch(Math.min(x1, x2) - 4, Math.max(x1, x2) + 4);
          if (e.deactivate) closeAct(e.from, ay);
          y = ay + 16;
        }
        break;
      }
      case 'activate':
        openAct(e.id, y, null); y += 6;
        touch(X[idx.get(e.id)] - 10, X[idx.get(e.id)] + 10);
        break;
      case 'deactivate':
        if (!closeAct(e.id, y)) {
          /* diagnostic emitted at parse stage would need context; emit via draws hack — handled in validate pass below */
          draws.push({ t: 'warn-deact', line: e.line, id: e.id });
        }
        y += 6;
        break;
      case 'destroy': {
        var dx = X[idx.get(e.id)];
        draws.push({ t: 'destroy', x: dx, y: y + 6 });
        destroyed.set(e.id, y + 6);
        while (closeAct(e.id, y + 6)) {/* close all bars */}
        y += 20;
        break;
      }
      case 'return': {
        /* close the most recently opened activation that has a caller */
        var rid = null;
        for (var q = openOrder.length - 1; q >= 0; q--) {
          var cand = openOrder[q], st = acts.get(cand);
          if (st && st.length && st[st.length - 1].caller) { rid = cand; break; }
        }
        if (!rid) { draws.push({ t: 'warn-return', line: e.line }); y += 4; break; }
        var caller = acts.get(rid)[acts.get(rid).length - 1].caller;
        var lab2 = e.label;
        if (num && num.on && lab2) { lab2 = num.v + ': ' + lab2; num.v += num.step; }
        var ll2 = lab2 ? String(lab2).split(/\\n/) : [];
        var ry = y + ll2.length * 15 + 4;
        var ra = idx.get(rid), rb = idx.get(caller);
        var ltr2 = ra < rb;
        var rx1 = barEdgeX(rid, ltr2 ? 'R' : 'L');
        closeAct(rid, ry);
        var rx2 = barEdgeX(caller, ltr2 ? 'L' : 'R');
        draws.push({ t: 'arrow', x1: rx1, x2: rx2, y: ry, lines: ll2, dashed: true, async: false });
        touch(Math.min(rx1, rx2), Math.max(rx1, rx2));
        y = ry + 16;
        break;
      }
      case 'fragOpen': {
        var f = { op: e.op, label: e.label, y0: y + 4, elses: [], min: Infinity, max: -Infinity, depth: fStack.length };
        fStack.push(f); y += 28;
        break;
      }
      case 'fragElse': {
        if (fStack.length) { fStack[fStack.length - 1].elses.push({ y: y + 4, label: e.label }); y += 24; }
        break;
      }
      case 'fragClose': {
        var f2 = fStack.pop();
        if (f2) {
          f2.y1 = y + 6;
          if (!isFinite(f2.min)) { f2.min = X[0] - 10; f2.max = X[n - 1] + 10; }
          frames.push(f2);
          /* parent frames must contain this one */
          if (fStack.length) {
            var pf = fStack[fStack.length - 1];
            pf.min = Math.min(pf.min, f2.min - 9);
            pf.max = Math.max(pf.max, f2.max + 9);
          }
          y += 14;
        }
        break;
      }
      case 'note': case 'ref': {
        var is3 = e.targets.map(function (g) { return idx.get(g); }).filter(function (x) { return x != null; });
        if (!is3.length) { y += 6; break; }
        var mn3 = Math.min.apply(null, is3), mx3 = Math.max.apply(null, is3);
        var textLines = [];
        e.text.forEach(function (l) {
          P.wrapText(l, 200, 12, M).forEach(function (x) { textLines.push(x); });
        });
        if (!textLines.length) textLines = [''];
        var tw = 24;
        textLines.forEach(function (l) { tw = Math.max(tw, M(l, 12) + 24); });
        var th = textLines.length * 15 + 12 + (e.k === 'ref' ? 8 : 0);
        var nx;
        if (e.k === 'ref' || e.side === 'over') {
          var lo = X[mn3], hi = X[mx3];
          nx = (lo + hi) / 2 - Math.max(tw, hi - lo + 40) / 2;
          tw = Math.max(tw, hi - lo + 40);
        } else if (e.side === 'left') nx = X[mn3] - tw - 12;
        else nx = X[mx3] + 12;
        draws.push({ t: e.k, x: nx, y: y + 4, w: tw, h: th, lines: textLines });
        touch(nx, nx + tw);
        y += th + 12;
        break;
      }
      case 'divider': {
        draws.push({ t: 'divider', y: y + 8, label: e.label });
        y += 30;
        break;
      }
      case 'delay': {
        draws.push({ t: 'delay', y: y + 8, label: e.label });
        y += 34;
        break;
      }
      case 'spacer': y += 20; break;
      case 'autonumber': {
        if (e.mode === 'stop') { if (num) num.on = false; }
        else if (e.mode === 'resume') { if (num) num.on = true; else num = { v: 1, step: 1, on: true }; }
        else num = { v: e.start, step: e.step, on: true };
        break;
      }
    }
  });

  var bodyBottom = y + 12;
  /* close remaining activations at the bottom */
  parts.forEach(function (p) {
    while (closeAct(p.id, bodyBottom)) {/**/}
  });

  var maxFoot = 0;
  if (!(meta && meta.hideFootbox)) {
    parts.forEach(function (p) {
      if (destroyed.has(p.id)) return;
      maxFoot = Math.max(maxFoot, p.kind === 'actor' ? 72 : p.kind === 'database' ? 64 : 46);
    });
  }
  var totalH = bodyBottom + 6 + maxFoot;

  /* ---- draw ---- */
  /* lifelines */
  parts.forEach(function (p) {
    var x0 = X[idx.get(p.id)];
    var yEnd = destroyed.has(p.id) ? destroyed.get(p.id) : bodyBottom;
    out += S.line(x0, headH + 2, x0, yEnd, { dashed: '6,5', width: 1.1 });
  });

  /* activation bars */
  actsAll.forEach(function (a) {
    var x0 = X[idx.get(a.id)] + (a.depth - 1) * 6;
    out += S.rect(x0 - 5, a.y0, 10, Math.max(a.y1 - a.y0, 6), { fill: C.fill, width: 1.1 });
  });

  /* fragment frames (outermost first) */
  frames.sort(function (a, b) { return a.depth - b.depth; });
  frames.forEach(function (f) {
    var pad = 8;
    var fx = f.min - pad, fw = f.max - f.min + pad * 2;
    out += S.rect(fx, f.y0, fw, f.y1 - f.y0, { fill: 'none', width: 1.4 });
    var opW = M(f.op, 11.5, { bold: true }) + 16;
    out += S.path('M' + r(fx) + ',' + r(f.y0) + ' h' + r(opW) + ' v12 l-7,7 H' + r(fx) + ' Z', { fill: C.frameLabel, width: 1.2 });
    out += S.text(fx + 6, f.y0 + 13.5, f.op, { size: 11.5, bold: true });
    if (f.label) out += S.text(fx + opW + 8, f.y0 + 13.5, '[' + f.label + ']', { size: 11.5, italic: true });
    f.elses.forEach(function (el) {
      out += S.line(fx, el.y + 8, fx + fw, el.y + 8, { dashed: '4,3', width: 1.1 });
      if (el.label) out += S.text(fx + 8, el.y + 21, '[' + el.label + ']', { size: 11.5, italic: true });
    });
  });

  /* deferred ops */
  draws.forEach(function (d) {
    switch (d.t) {
      case 'arrow': {
        var head = d.async ? 'open' : 'solid';
        var ang = d.x2 >= d.x1 ? 0 : Math.PI;
        var hd = S.head(d.lost ? 'x' : head, d.x2, d.y, ang);
        var back = hd.back * (d.x2 >= d.x1 ? 1 : -1);
        out += S.line(d.x1, d.y, d.x2 - back, d.y, { dashed: d.dashed, width: 1.2 });
        out += hd.s;
        var mid = (d.x1 + d.x2) / 2;
        d.lines.forEach(function (l, li) {
          out += S.text(mid, d.y - 6 - (d.lines.length - 1 - li) * 15, l, { size: 12.5, anchor: 'middle', halo: true });
        });
        break;
      }
      case 'self': {
        var x0 = d.x, y0 = d.y;
        out += S.path('M' + r(x0) + ',' + r(y0) + ' h34 q6,0 6,6 v6 q0,6 -6,6 H' + r(x0 + 3), { dashed: d.dashed });
        var hd2 = S.head(d.async ? 'open' : 'solid', x0 + 1, y0 + 18, Math.PI);
        out += hd2.s;
        d.lines.forEach(function (l, li) {
          out += S.text(x0 + 48, y0 - 4 - (d.lines.length - 1 - li) * 15 + 12, l, { size: 12.5, halo: true });
        });
        break;
      }
      case 'note': {
        var f = 8;
        out += S.path('M' + r(d.x) + ',' + r(d.y) + ' h' + r(d.w - f) + ' l' + f + ',' + f + ' v' + r(d.h - f) + ' h-' + r(d.w) + ' Z',
          { fill: C.noteFill, stroke: C.noteStroke, linejoin: 'round' });
        out += S.path('M' + r(d.x + d.w - f) + ',' + r(d.y) + ' v' + f + ' h' + f, { stroke: C.noteStroke });
        d.lines.forEach(function (l, li) {
          out += S.text(d.x + 10, d.y + 15 + li * 15, l, { size: 12 });
        });
        break;
      }
      case 'ref': {
        out += S.rect(d.x, d.y, d.w, d.h, { fill: '#F4F4E9', width: 1.3 });
        out += S.path('M' + r(d.x) + ',' + r(d.y) + ' h30 v11 l-6,6 H' + r(d.x) + ' Z', { fill: C.frameLabel, width: 1.1 });
        out += S.text(d.x + 5, d.y + 12.5, 'ref', { size: 11, bold: true });
        d.lines.forEach(function (l, li) {
          out += S.text(d.x + d.w / 2, d.y + 24 + li * 15, l, { size: 12, anchor: 'middle' });
        });
        break;
      }
      case 'divider': {
        out += S.line(0, d.y + 6, totalW, d.y + 6, { width: 1 });
        out += S.line(0, d.y + 9, totalW, d.y + 9, { width: 1 });
        if (d.label) {
          var dw = M(d.label, 12, { bold: true }) + 20;
          out += S.rect(totalW / 2 - dw / 2, d.y - 2, dw, 19, { fill: '#EEEBDA', width: 1 });
          out += S.text(totalW / 2, d.y + 11.5, d.label, { size: 12, bold: true, anchor: 'middle' });
        }
        break;
      }
      case 'delay': {
        if (d.label) out += S.text(totalW / 2, d.y + 12, d.label, { size: 12, italic: true, anchor: 'middle', fill: C.muted, halo: true });
        else out += S.text(totalW / 2, d.y + 12, '…', { size: 14, anchor: 'middle', fill: C.muted, halo: true });
        break;
      }
      case 'destroy': {
        out += '<g stroke="' + C.stroke + '" stroke-width="2.2">' +
          '<line x1="' + r(d.x - 8) + '" y1="' + r(d.y - 8) + '" x2="' + r(d.x + 8) + '" y2="' + r(d.y + 8) + '"/>' +
          '<line x1="' + r(d.x - 8) + '" y1="' + r(d.y + 8) + '" x2="' + r(d.x + 8) + '" y2="' + r(d.y - 8) + '"/></g>';
        break;
      }
    }
  });

  /* participant heads (top + bottom) */
  function drawHead(p, top) {
    var x0 = X[idx.get(p.id)];
    var yTop = top ? headH - p.headH : bodyBottom + 8;
    var o2 = '';
    if (p.kind === 'actor') {
      var hy = top ? headH - 52 : bodyBottom + 12;
      o2 += '<circle cx="' + r(x0) + '" cy="' + r(hy + 6) + '" r="6" fill="' + C.fill + '" stroke="' + C.stroke + '" stroke-width="1.4"/>';
      o2 += S.line(x0, hy + 12, x0, hy + 26);
      o2 += S.line(x0 - 9, hy + 17, x0 + 9, hy + 17);
      o2 += S.line(x0, hy + 26, x0 - 8, hy + 36);
      o2 += S.line(x0, hy + 26, x0 + 8, hy + 36);
      o2 += S.text(x0, hy + 48, p.label, { size: 13, bold: true, anchor: 'middle' });
    } else if (p.kind === 'database') {
      var dw2 = Math.max(p.headW - 10, 44), dh = 34;
      var dxx = x0 - dw2 / 2, dyy = top ? headH - 46 : bodyBottom + 12;
      o2 += S.path('M' + r(dxx) + ',' + r(dyy + 6) + ' v' + (dh - 12) + ' a' + r(dw2 / 2) + ',6 0 0 0 ' + r(dw2) + ',0 v-' + (dh - 12) + ' a' + r(dw2 / 2) + ',6 0 0 0 -' + r(dw2) + ',0 Z', { fill: C.fill, width: 1.4 });
      o2 += '<ellipse cx="' + r(x0) + '" cy="' + r(dyy + 6) + '" rx="' + r(dw2 / 2) + '" ry="6" fill="' + C.fill + '" stroke="' + C.stroke + '" stroke-width="1.4"/>';
      o2 += S.text(x0, dyy + dh + 10, p.label, { size: 12.5, bold: true, anchor: 'middle' });
    } else {
      var bh = 30;
      var byy = top ? headH - bh : bodyBottom + 8;
      o2 += S.rect(x0 - p.headW / 2, byy, p.headW, bh, { rx: 3 });
      o2 += S.ctext(x0, byy + bh / 2, p.label, { size: 13, bold: true, anchor: 'middle' });
    }
    return o2;
  }
  parts.forEach(function (p) { out += drawHead(p, true); });
  if (!(meta && meta.hideFootbox)) parts.forEach(function (p) { if (!destroyed.has(p.id)) out += drawHead(p, false); });

  return { body: out, w: totalW, h: totalH };
};

})(PUML);
