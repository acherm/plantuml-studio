/* PlantUML Studio — core: preprocessing, diagnostics, shared parsing & SVG utils.
   Pure JS, no DOM. The app injects a canvas-based text measurer; tests use the estimator. */
'use strict';
var PUML = {};
(function (P) {

P.VERSION = '1.0.0';

/* ---------------- diagnostics ---------------- */
/* severity: 'error' | 'warning' | 'info' */
P.d = function (severity, line, message) { return { severity: severity, line: line, message: message }; };

/* diagnostic anchored to a word within a content line L = {n, text, off} */
P.dW = function (severity, L, word, message) {
  var d = P.d(severity, L.n, message);
  if (word != null && L && L.text) {
    var i = L.text.indexOf(word);
    if (i >= 0) { d.col = (L.off || 0) + i + 1; d.len = String(word).length; }
  }
  return d;
};

/* ---------------- string utils ---------------- */
P.esc = function (s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
};

P.unquote = function (s) {
  if (s == null) return s;
  s = String(s).trim();
  if (s.length >= 2 && s.charAt(0) === '"' && s.charAt(s.length - 1) === '"') return s.slice(1, -1);
  return s;
};

P.r = function (v) { return Math.round(v * 100) / 100; };

/* crude but stable text metrics; the app injects a canvas measurer instead */
P.defaultMeasure = function (text, size, o) {
  o = o || {};
  var s = String(text == null ? '' : text);
  if (o.mono) return s.length * size * 0.602;
  var w = 0;
  for (var i = 0; i < s.length; i++) {
    var c = s.charAt(i);
    if (c === ' ') w += 0.28;
    else if ("iIl1j!|.,:;'".indexOf(c) >= 0) w += 0.32;
    else if ('ftrJ()[]{}"-*/\\'.indexOf(c) >= 0) w += 0.40;
    else if ('mwMW@'.indexOf(c) >= 0) w += 0.94;
    else if (c >= 'A' && c <= 'Z') w += 0.72;
    else if (c >= '0' && c <= '9') w += 0.60;
    else w += 0.56;
  }
  return w * size * (o.bold ? 1.05 : 1);
};

/* greedy word wrap; understands literal \n in labels */
P.wrapText = function (text, maxW, size, M, o) {
  var out = [];
  var paras = String(text == null ? '' : text).split(/\\n|\n/);
  for (var p = 0; p < paras.length; p++) {
    var words = paras[p].split(/\s+/).filter(function (x) { return x !== ''; });
    if (!words.length) { out.push(''); continue; }
    var cur = words[0];
    for (var i = 1; i < words.length; i++) {
      var t = cur + ' ' + words[i];
      if (M(t, size, o) > maxW) { out.push(cur); cur = words[i]; }
      else cur = t;
    }
    out.push(cur);
  }
  return out;
};

P.lev = function (a, b) {
  a = String(a); b = String(b);
  var m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  var prev = [], cur = [];
  for (var j = 0; j <= n; j++) prev[j] = j;
  for (var i = 1; i <= m; i++) {
    cur[0] = i;
    for (j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
    }
    var t = prev; prev = cur; cur = t;
  }
  return prev[n];
};

P.suggest = function (word, candidates) {
  var best = null, bestD = 3;
  word = String(word).toLowerCase();
  for (var i = 0; i < candidates.length; i++) {
    var d = P.lev(word, candidates[i].toLowerCase());
    if (d < bestD || (d === bestD && best === null)) { bestD = d; best = candidates[i]; }
  }
  return bestD <= 2 && word.length > 2 ? best : null;
};

/* ---------------- graphical-edit text transforms ----------------
   The rendered SVG is a pure function of the text; dragging or renaming a
   node in the diagram works by rewriting the text and recompiling — never
   by mutating a separate in-memory model. Node positions persist as
   `' @pos Id x,y` comment lines: ordinary PlantUML comments (ignored by
   real PlantUML and by every parser here), read only by the layout stage
   as a side-channel so manual placement survives a recompile. */

/* Scans the RAW, unstripped text (independent of the normal
   comment-stripping pass) so this works regardless of where the
   `@pos` line ends up relative to @startuml/@enduml. */
P.extractPosOverrides = function (text) {
  var out = {};
  var re = /^[ \t]*'[ \t]*@pos[ \t]+(\S+)[ \t]+(-?[\d.]+)[ \t]*,[ \t]*(-?[\d.]+)[ \t]*$/gm;
  var m;
  while ((m = re.exec(String(text == null ? '' : text)))) out[m[1]] = { x: parseFloat(m[2]), y: parseFloat(m[3]) };
  return out;
};

P.upsertPosOverride = function (text, id, x, y) {
  var lines = String(text == null ? '' : text).split(/\r\n|\r|\n/);
  var idEsc = String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  var re = new RegExp("^[ \\t]*'[ \\t]*@pos[ \\t]+" + idEsc + "[ \\t]+-?[\\d.]+[ \\t]*,[ \\t]*-?[\\d.]+[ \\t]*$");
  var newLine = "' @pos " + id + ' ' + Math.round(x) + ',' + Math.round(y);
  for (var i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) { lines[i] = newLine; return lines.join('\n'); }
  }
  var insertAt = lines.length;
  for (i = 0; i < lines.length; i++) { if (/^\s*@startuml\b/i.test(lines[i])) { insertAt = i + 1; break; } }
  lines.splice(insertAt, 0, newLine);
  return lines.join('\n');
};

/* Renames every unquoted, non-comment, word-boundary occurrence of oldId to
   newId — leaves string-literal labels and whole-line comments untouched,
   since those are free-form prose, not identifier references. */
P.renameIdentifier = function (text, oldId, newId) {
  text = String(text == null ? '' : text);
  if (!oldId || !newId || oldId === newId) return { text: text };
  if (!/^[A-Za-z_$][\w.$]*$/.test(newId)) {
    return { error: 'A name must start with a letter or _ and contain only letters, digits, _ . $ — got "' + newId + '"' };
  }
  var re = new RegExp('\\b' + oldId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g');
  var changed = false;
  var out = text.split(/\r\n|\r|\n/).map(function (line) {
    if (/^\s*'/.test(line)) return line;
    var segs = line.split(/("[^"]*")/);
    for (var i = 0; i < segs.length; i += 2) {
      segs[i] = segs[i].replace(re, function () { changed = true; return newId; });
    }
    return segs.join('');
  }).join('\n');
  if (!changed) return { error: "'" + oldId + "' was not found in the document (as an unquoted identifier)." };
  return { text: out };
};

/* Renames a free-text label — the way most use cases and actors are
   actually written: `(Borrow a book)`, `usecase "Borrow a book"`,
   `:Some Actor:` — where the *label itself* is the identity (no separate
   bare identifier exists to word-boundary-match, and the new name is
   typically not identifier-shaped either, e.g. "Return a book"). Replaces
   the label wherever it appears inside (...), "...", or :...: delimiters. */
P.renameLabel = function (text, oldLabel, newLabel) {
  text = String(text == null ? '' : text);
  if (!oldLabel || !newLabel || oldLabel === newLabel) return { text: text };
  if (/[():"]/.test(newLabel)) return { error: 'A name can\'t contain (, ), ", or :' };
  var esc = oldLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  var changed = false;
  function sub(re, wrap) {
    return function (line) { return line.replace(re, function () { changed = true; return wrap; }); };
  }
  var out = text.split(/\r\n|\r|\n/).map(function (line) {
    if (/^\s*'/.test(line)) return line;
    line = sub(new RegExp('\\(' + esc + '\\)', 'g'), '(' + newLabel + ')')(line);
    line = sub(new RegExp(':' + esc + ':', 'g'), ':' + newLabel + ':')(line);
    line = sub(new RegExp('"' + esc + '"', 'g'), '"' + newLabel + '"')(line);
    return line;
  }).join('\n');
  if (!changed) return { error: "'" + oldLabel + "' was not found in the document." };
  return { text: out };
};

/* ---------------- preprocessing ---------------- */
/* Strips comments, handles @startuml/@enduml, consumes global directives.
   Returns {lines:[{n,text}], meta, diagnostics} */
P.preprocess = function (text) {
  var D = [];
  var rawLines = String(text == null ? '' : text).split(/\r\n|\r|\n/);
  var stripped = [];
  var inBlock = false;
  for (var i = 0; i < rawLines.length; i++) {
    var s = rawLines[i], out = '', j = 0;
    while (j < s.length) {
      if (inBlock) {
        var k = s.indexOf("'/", j);
        if (k === -1) { j = s.length; } else { inBlock = false; j = k + 2; }
      } else {
        var k2 = s.indexOf("/'", j);
        if (k2 === -1) { out += s.slice(j); j = s.length; }
        else { out += s.slice(j, k2); inBlock = true; j = k2 + 2; }
      }
    }
    var t = out.trim();
    if (t === '' || t.charAt(0) === "'") continue;
    stripped.push({ n: i + 1, text: t, off: (/^[ \t]*/.exec(out))[0].length });
  }
  if (inBlock) D.push(P.d('warning', rawLines.length, "Unclosed block comment /' … (missing closing '/)"));

  var meta = { title: null, direction: null, hideFootbox: false, scoreHints: { sequence: 0 } };
  var lines = [];
  var sawStart = false, sawEnd = false, afterEndWarned = false;
  var skinDepth = 0, multiline = null; /* 'title' | 'legend' | 'header' | 'footer' */
  var contentDepth = 0; /* inside { } of a class/object/package body: no global directives there */
  function pushContent(L2) {
    contentDepth += (L2.text.match(/\{/g) || []).length - (L2.text.match(/\}/g) || []).length;
    if (contentDepth < 0) contentDepth = 0;
    lines.push(L2);
  }

  for (i = 0; i < stripped.length; i++) {
    var L = stripped[i]; t = L.text;

    if (skinDepth > 0) {
      skinDepth += (t.match(/\{/g) || []).length - (t.match(/\}/g) || []).length;
      if (skinDepth < 0) skinDepth = 0;
      continue;
    }
    if (multiline) {
      if (new RegExp('^end\\s*' + multiline + '$', 'i').test(t)) multiline = null;
      else if (multiline === 'title' && meta.title === null) meta.title = t;
      else if (multiline === 'title') meta.title += '\n' + t;
      continue;
    }

    if (/^@startuml\b/i.test(t)) {
      if (sawStart) { D.push(P.d('error', L.n, 'Multiple @startuml found — this editor renders one diagram per document; everything after this line is ignored')); break; }
      if (sawEnd) { D.push(P.d('error', L.n, '@startuml after @enduml — only one diagram per document')); break; }
      sawStart = true;
      if (lines.length) { D.push(P.d('warning', L.n, 'Content before @startuml is ignored by PlantUML')); lines = []; }
      continue;
    }
    if (/^@start\w+/i.test(t)) {
      D.push(P.d('error', L.n, 'Only @startuml documents are supported (class, object, sequence, use case and state diagrams)'));
      continue;
    }
    if (/^@enduml\b/i.test(t)) {
      if (!sawStart) D.push(P.d('warning', L.n, '@enduml without a matching @startuml'));
      sawEnd = true; continue;
    }
    if (/^@end\w+/i.test(t)) { D.push(P.d('warning', L.n, 'Unexpected ' + t.split(/\s/)[0] + ' — expected @enduml')); sawEnd = true; continue; }
    if (sawEnd) {
      if (!afterEndWarned) { D.push(P.d('warning', L.n, 'Content after @enduml is ignored')); afterEndWarned = true; }
      continue;
    }

    /* inside a { } body: everything is content, never a global directive */
    if (contentDepth > 0) { pushContent(L); continue; }

    /* global directives (PlantUML keywords are case-insensitive; identifiers are not) */
    var m;
    if ((m = /^title\s+(.+)$/i.exec(t))) { meta.title = m[1]; continue; }
    if (/^title$/i.test(t)) { multiline = 'title'; continue; }
    if (/^legend\b/i.test(t)) { multiline = 'legend'; continue; }
    if (/^(center\s+)?header\b\s*$/i.test(t)) { multiline = 'header'; continue; }
    if (/^(center\s+)?footer\b\s*$/i.test(t)) { multiline = 'footer'; continue; }
    if ((m = /^skinparam\b.*$/i.exec(t))) {
      skinDepth = (t.match(/\{/g) || []).length - (t.match(/\}/g) || []).length;
      if (skinDepth < 0) skinDepth = 0;
      continue;
    }
    if (/^hide\s+footbox\b/i.test(t)) { meta.hideFootbox = true; meta.scoreHints.sequence += 4; continue; }
    if (/^(skin|scale|caption|header|footer|mainframe)\b/i.test(t)) continue;
    if (/^(hide|show|remove)\b/i.test(t)) continue;
    if (/^left\s+to\s+right\s+direction$/i.test(t)) { meta.direction = 'LR'; continue; }
    if (/^top\s+to\s+bottom\s+direction$/i.test(t)) { meta.direction = 'TB'; continue; }
    if (/^!pragma\b/i.test(t)) continue;
    if (/^!theme\b/i.test(t)) { D.push(P.d('info', L.n, 'Themes are not supported in this offline editor — directive ignored')); continue; }
    if (/^!(include|includesub|import|define|definelong|undef|function|procedure|endfunction|endprocedure|if|ifdef|ifndef|else|endif|while|endwhile|assert|log|dump_memory|startsub|endsub|\$?\w+\s*=)/i.test(t)) {
      D.push(P.d('warning', L.n, 'Preprocessor directives (!include, !define, …) are not supported — line ignored'));
      continue;
    }
    if (/^newpage\b/i.test(t)) { D.push(P.d('warning', L.n, 'newpage is not supported — line ignored')); continue; }
    if (/^autoactivate\b/i.test(t)) { D.push(P.d('warning', L.n, 'autoactivate is not supported — use activate/deactivate or ++/-- instead')); meta.scoreHints.sequence += 3; continue; }

    pushContent(L);
  }

  if (lines.length && !sawStart) {
    var dS = P.d('warning', lines[0].n, 'Missing @startuml — PlantUML requires the document to start with @startuml');
    dS.fix = { insertTop: '@startuml', title: 'Insert @startuml' };
    D.push(dS);
  }
  if (lines.length && !sawEnd) {
    var dE = P.d('warning', lines[lines.length - 1].n, 'Missing @enduml — PlantUML requires the document to end with @enduml');
    dE.fix = { append: '@enduml', title: 'Append @enduml' };
    D.push(dE);
  }

  return { lines: lines, meta: meta, diagnostics: D };
};

/* ---------------- diagram type detection ---------------- */
P.detectType = function (lines, meta) {
  var sc = { class: 0, object: 0, sequence: 0, usecase: 0, state: 0 };
  if (meta && meta.scoreHints) sc.sequence += meta.scoreHints.sequence || 0;
  for (var i = 0; i < lines.length; i++) {
    var t = lines[i].text;
    if (/^(abstract\s+class|class|interface|annotation)\b/i.test(t)) sc.class += 5;
    if (/^enum\b/i.test(t)) sc.class += 4;
    if (/^package\b/i.test(t)) sc.class += 1;
    if (/^object\b/i.test(t)) sc.object += 6;
    if (/^map\b/i.test(t)) sc.object += 4;
    if (/^(participant|boundary|control|entity|database|collections|queue)\b/i.test(t)) sc.sequence += 5;
    if (/^(activate|deactivate|autonumber|destroy)\b/i.test(t)) sc.sequence += 4;
    if (/^return\b/i.test(t)) sc.sequence += 3;
    if (/^(alt|opt|loop|par|break|critical|group)\b/i.test(t)) sc.sequence += 2;
    if (/^==.*==$/.test(t)) sc.sequence += 2;
    if (/^\.\.\./.test(t)) sc.sequence += 1;
    if (/^usecase\b/i.test(t)) sc.usecase += 6;
    if (/^rectangle\b/i.test(t)) sc.usecase += 3;
    if (/^actor\b/i.test(t)) { sc.usecase += 2; sc.sequence += 2; }
    if (/\([^()]+\)/.test(t) && /(--|\.\.|->|\.>|<\.)/.test(t)) sc.usecase += 4;
    if (/^:[^:]+:\s/.test(t) || /\s:[^:]+:$/.test(t)) sc.usecase += 3;
    if (/^state\b/i.test(t)) sc.state += 6;
    if (/\[\*\]/.test(t)) sc.state += 5;
    /* sequence message: A -> B : text (also <-, dashed, and ++/-- activation modifiers) */
    if (/^[^\s:<>-]+\s*(?:x|o)?(?:<{1,2})?-{1,2}(?:>{1,2})?(?:x|o)?\s*[^\s:<>-]+\s*(?:[+\-*!]{1,4}\s*)?:\s*\S/.test(t) && /[<>]/.test(t)) sc.sequence += 3;
    /* label-less message with ++/-- modifiers is uniquely sequence */
    if (/^[^\s:<>-]+\s*(?:x|o)?(?:<{1,2})?-{1,2}(?:>{1,2})?(?:x|o)?\s*[^\s:<>-]+\s*[+\-*!]{1,4}\s*(?::|$)/.test(t)) sc.sequence += 4;
    /* class-ish arrows */
    if (/(<\|[-.]|[-.]\|>|\*[-.]|[-.]\*|\bo[-.]{2}|[-.]{2}o\b)/.test(t)) sc.class += 3;
    if (/^\S+\s*:\s*\S+\s*=/.test(t)) sc.object += 2;
  }
  var best = null, bestScore = 0;
  var order = ['class', 'sequence', 'state', 'usecase', 'object'];
  for (var k = 0; k < order.length; k++) {
    if (sc[order[k]] > bestScore) { best = order[k]; bestScore = sc[order[k]]; }
  }
  return { type: best, scores: sc };
};

/* ---------------- arrow / link parsing (class, object, usecase, state) ---------------- */
P.parseArrowToken = function (tok) {
  var m = /^(<\||<<|<|\*|o|x|\+|\^|#)?([-.=~]+)(?:(left|right|up|down|le|ri|do|l|r|u|d)([-.=~]+))?(\|>|>>|>|\*|o|x|\+|\^|#)?$/.exec(tok);
  if (!m) return null;
  var body = m[2] + (m[4] || '');
  var dirs = { l: 'left', le: 'left', left: 'left', r: 'right', ri: 'right', right: 'right', u: 'up', up: 'up', d: 'down', do: 'down', down: 'down' };
  return {
    headL: m[1] || '', headR: m[5] || '',
    style: /[.~]/.test(body) ? 'dashed' : 'solid',
    len: body.length,
    dir: m[3] ? dirs[m[3]] : null
  };
};

/* Finds "NAME [card] ARROW [card] NAME [: label]" in a line.
   nameSrc: alternation of endpoint forms (no capture groups). Returns null if not a link. */
P.splitLink = function (t, nameSrc) {
  var nameRe = new RegExp('^(?:' + nameSrc + ')$');
  var arrG = /(<\||<<|<|\*|o|x|\+|\^|#)?([-.=~]+(?:(?:left|right|up|down|le|ri|do|l|r|u|d)[-.=~]+)?)(\|>|>>|>|\*|o|x|\+|\^|#)?/g;
  var m;
  while ((m = arrG.exec(t))) {
    var start = m.index, end = m.index + m[0].length;
    var headL = m[1] || '', body = m[2], headR = m[3] || '';
    /* an 'o'/'x' glued to a name is part of the name, not an arrow head */
    if ((headL === 'o' || headL === 'x') && start > 0 && /[\w)"\]:]/.test(t.charAt(start - 1))) { start += 1; headL = ''; }
    if ((headR === 'o' || headR === 'x') && end < t.length && /[\w("[:]/.test(t.charAt(end))) { end -= 1; headR = ''; }
    var left = t.slice(0, start).trim();
    var right = t.slice(end).trim();
    if (!left || !right) continue;
    var arrow = P.parseArrowToken(headL + body + headR);
    if (!arrow) continue;

    var cardL = null, lName = left;
    var lm = /^(.*?)\s*"([^"]*)"$/.exec(left);
    if (lm && nameRe.test(lm[1].trim())) { lName = lm[1].trim(); cardL = lm[2]; }
    if (!nameRe.test(lName)) continue;

    var rre = new RegExp('^(?:"([^"]*)"\\s+)?(' + nameSrc + ')\\s*(?::\\s*(.*))?$');
    var rr = rre.exec(right);
    if (!rr) continue;
    return {
      left: lName, right: rr[2],
      cardL: cardL, cardR: rr[1] != null ? rr[1] : null,
      label: rr[3] != null ? rr[3].trim() : null,
      arrow: arrow
    };
  }
  return null;
};

/* class-diagram semantics of a parsed arrow */
P.classifyEdge = function (a) {
  var deco = { '<|': 'tri', '|>': 'tri', '^': 'tri', '<<': 'open', '>>': 'open', '<': 'open', '>': 'open', '*': 'diamond', 'o': 'odiamond', 'x': 'x', '+': 'none', '#': 'none', '': 'none' };
  var dL = deco[a.headL] || 'none', dR = deco[a.headR] || 'none';
  var parent = dL === 'tri' ? 'L' : (dR === 'tri' ? 'R' : null);
  var constraint = (a.dir === 'left' || a.dir === 'right' || a.len <= 1) ? 'same' : 'rank';
  var aboveEnd = 'L';
  if (parent === 'R') aboveEnd = 'R';
  else if (parent === 'L') aboveEnd = 'L';
  else if (a.dir === 'up') aboveEnd = 'R';
  return { decoL: dL, decoR: dR, style: a.style, constraint: constraint, aboveEnd: aboveEnd, isHierarchy: parent !== null };
};

/* ---------------- shared palette (classic PlantUML look) ---------------- */
P.C = {
  stroke: '#A80036',
  fill: '#FEFECE',
  text: '#1B1B14',
  muted: '#6E6E58',
  paper: '#FDFDF8',
  noteFill: '#FBFB77',
  noteStroke: '#B8B84B',
  frameLabel: '#EEEAD5',
  badge: { class: '#ADD1B2', abstract: '#A9DCDF', interface: '#B4A7E5', enum: '#EB937F', annotation: '#E0D5C6', entity: '#ADD1B2', object: '#ADD1B2' },
  vis: { '+': '#3C9D57', '-': '#C0392B', '#': '#C7A427', '~': '#3B6EA5' }
};

/* ---------------- SVG primitives ---------------- */
var S = P.S = {};
var r = P.r;

S.text = function (x, y, str, o) {
  o = o || {};
  var a = '<text x="' + r(x) + '" y="' + r(y) + '" font-size="' + (o.size || 13) + '"';
  if (o.anchor) a += ' text-anchor="' + o.anchor + '"';
  if (o.bold) a += ' font-weight="600"';
  if (o.italic) a += ' font-style="italic"';
  if (o.mono) a += " font-family=\"'IBM Plex Mono',ui-monospace,Menlo,Consolas,monospace\"";
  if (o.underline) a += ' text-decoration="underline"';
  a += ' fill="' + (o.fill || P.C.text) + '"';
  if (o.halo) a += ' paint-order="stroke" stroke="' + (o.halo === true ? P.C.paper : o.halo) + '" stroke-width="3.5" stroke-linejoin="round"';
  return a + '>' + P.esc(str) + '</text>';
};

/* text vertically centered on cy */
S.ctext = function (x, cy, str, o) {
  o = o || {};
  return S.text(x, cy + (o.size || 13) * 0.35, str, o);
};

S.line = function (x1, y1, x2, y2, o) {
  o = o || {};
  var a = '<line x1="' + r(x1) + '" y1="' + r(y1) + '" x2="' + r(x2) + '" y2="' + r(y2) + '"';
  a += ' stroke="' + (o.stroke || P.C.stroke) + '" stroke-width="' + (o.width || 1.2) + '"';
  if (o.dashed) a += ' stroke-dasharray="' + (o.dashed === true ? '5,4' : o.dashed) + '"';
  return a + '/>';
};

S.rect = function (x, y, w, h, o) {
  o = o || {};
  var a = '<rect x="' + r(x) + '" y="' + r(y) + '" width="' + r(w) + '" height="' + r(h) + '"';
  if (o.rx) a += ' rx="' + o.rx + '"';
  a += ' fill="' + (o.fill || P.C.fill) + '"';
  if (o.stroke !== 'none') a += ' stroke="' + (o.stroke || P.C.stroke) + '" stroke-width="' + (o.width || 1.4) + '"';
  else a += ' stroke="none"';
  if (o.dashed) a += ' stroke-dasharray="5,4"';
  return a + '/>';
};

S.path = function (d, o) {
  o = o || {};
  var a = '<path d="' + d + '" fill="' + (o.fill || 'none') + '"';
  if (o.stroke !== 'none') a += ' stroke="' + (o.stroke || P.C.stroke) + '" stroke-width="' + (o.width || 1.2) + '"';
  if (o.dashed) a += ' stroke-dasharray="5,4"';
  if (o.linejoin) a += ' stroke-linejoin="' + o.linejoin + '"';
  return a + '/>';
};

/* arrow heads: returns {s: svg, back: distance the line should stop short of the tip} */
S.head = function (type, x, y, ang) {
  var deg = Math.round(ang * 180 / Math.PI * 10) / 10;
  function g(inner) {
    return '<g transform="translate(' + r(x) + ',' + r(y) + ') rotate(' + deg + ')">' + inner + '</g>';
  }
  function p(d, fill) {
    return g('<path d="' + d + '" fill="' + fill + '" stroke="' + P.C.stroke + '" stroke-width="1.2" stroke-linejoin="miter"/>');
  }
  switch (type) {
    case 'tri': return { back: 15, s: p('M0,0 L-15,-7.5 L-15,7.5 Z', P.C.paper) };
    case 'solid': return { back: 3, s: p('M0,0 L-11,-4.5 L-11,4.5 Z', P.C.stroke) };
    case 'open': return { back: 0, s: g('<path d="M-11,-5.5 L0,0 L-11,5.5" fill="none" stroke="' + P.C.stroke + '" stroke-width="1.4"/>') };
    case 'diamond': return { back: 18, s: p('M0,0 L-9,-5 L-18,0 L-9,5 Z', P.C.stroke) };
    case 'odiamond': return { back: 18, s: p('M0,0 L-9,-5 L-18,0 L-9,5 Z', P.C.paper) };
    case 'x': return { back: 4, s: g('<path d="M-9,-5 L-1,3 M-9,3 L-1,-5" fill="none" stroke="' + P.C.stroke + '" stroke-width="1.6"/>') };
    default: return { back: 0, s: '' };
  }
};

/* border anchor of a node shape toward an external point */
S.anchor = function (n, tx, ty) {
  var cx = n.x + n.w / 2, cy = n.y + n.h / 2;
  var dx = tx - cx, dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  if (n.shape === 'ellipse' || n.shape === 'circle') {
    var rx = n.w / 2, ry = n.h / 2;
    var tt = Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry)) || 1;
    return { x: cx + dx / tt, y: cy + dy / tt };
  }
  var sx = dx !== 0 ? (n.w / 2) / Math.abs(dx) : Infinity;
  var sy = dy !== 0 ? (n.h / 2) / Math.abs(dy) : Infinity;
  var s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
};

/* wraps a node's drawn SVG so the app layer can hit-test clicks/drags
   against it — click-to-navigate works for any node; dragging only for
   ones the layout actually allows overriding (see L.graph, top-level only) */
S.wrapNode = function (id, line, x, y, draggable, inner) {
  var a = '<g class="pu-node" data-node="' + P.esc(id) + '"';
  if (line) a += ' data-line="' + line + '"';
  a += ' data-x="' + P.r(x) + '" data-y="' + P.r(y) + '" data-draggable="' + (draggable ? '1' : '0') + '">';
  return a + inner + '</g>';
};

P.svgDoc = function (w, h, body) {
  w = Math.max(80, Math.ceil(w)); h = Math.max(50, Math.ceil(h));
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h +
    '" font-family="\'IBM Plex Sans\',\'Segoe UI\',system-ui,sans-serif">' +
    '<rect x="0" y="0" width="' + w + '" height="' + h + '" fill="' + P.C.paper + '"/>' + body + '</svg>';
};

})(PUML);

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
      /* always implicit here — even when a relation hints at a kind (e.g. an
         implements target is presumably an interface), the user never wrote
         an actual declaration, so a later explicit one must still be able
         to claim this id without triggering a "declared twice" error */
      var guessedKind = kind || 'class';
      c = { id: id, display: id, kind: guessedKind, stereo: null, generics: null,
            members: [], line: ln, implicit: true, pkg: curPkg() ? curPkg().id : null };
      classes.set(id, c); order.push(c);
      D.push(P.d('info', ln, "'" + id + "' is not declared — implicitly created as " + (guessedKind === 'interface' ? 'an interface' : 'a class')));
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
      if (/^(abstract\s+class|abstract\s|class\s|interface\s|enum\s|annotation\s|entity\s|struct\s|package\s|namespace\s|object\s)/i.test(t)) {
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
    if ((m = /^(?:package|namespace)\s+(?:"([^"]+)"|([\w.$]+))(?:\s+<<[^>]*>>)?(?:\s+#\S+)?\s*(\{)?\s*$/i.exec(t))) {
      var pname = m[1] || m[2];
      var pkg = { id: '@pkg' + packages.length + ':' + pname, label: pname, members: [], line: ln, parent: curPkg() ? curPkg().id : null };
      packages.push(pkg);
      if (curPkg()) curPkg().members.push(pkg.id);
      if (m[3]) pkgStack.push(pkg);
      else D.push(P.d('warning', ln, "package without '{ … }' block has no content"));
      continue;
    }

    /* declaration */
    if ((m = /^(abstract\s+class|abstract|class|interface|enum|annotation|entity|struct)\s+(.+)$/i.exec(t))) {
      var kind = KINDMAP[m[1].replace(/\s+/g, ' ').toLowerCase()];
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
        if ((mm2 = new RegExp('^as\\s+(' + NAME + ')\\s*(.*)$', 'i').exec(rest))) { alias = mm2[1]; rest = mm2[2]; }
        else if ((mm2 = /^as\s+"([^"]+)"\s*(.*)$/i.exec(rest))) { display = mm2[1]; rest = mm2[2]; }
        else if ((mm2 = /^<<\s*([^>]*?)\s*>>\s*(.*)$/.exec(rest))) { stereo = mm2[1]; rest = mm2[2]; }
        else if ((mm2 = /^#[\w|\\\/;:.-]+\s*(.*)$/.exec(rest))) { rest = mm2[1]; }
        else if ((mm2 = new RegExp('^extends\\s+(' + NAME + '(?:\\s*,\\s*' + NAME + ')*)\\s*(.*)$', 'i').exec(rest))) { ext = mm2[1].split(/\s*,\s*/); rest = mm2[2]; }
        else if ((mm2 = new RegExp('^implements\\s+(' + NAME + '(?:\\s*,\\s*' + NAME + ')*)\\s*(.*)$', 'i').exec(rest))) { impl = mm2[1].split(/\s*,\s*/); rest = mm2[2]; }
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
      if (!classes.has(target)) D.push(P.dW('error', lines[i], target, "note refers to '" + target + "' which is not declared (declare it before the note)"));
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
    var dU = P.dW('error', lines[i], word, 'Unrecognized statement: "' + (t.length > 60 ? t.slice(0, 60) + '…' : t) + '"' + (sug ? ' — did you mean "' + sug + '"?' : ''));
    if (sug) dU.fix = { line: ln, find: word, replace: sug, title: 'Replace with "' + sug + '"' };
    D.push(dU);
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

    if ((m = new RegExp('^object\\s+(?:"([^"]+)"\\s+as\\s+(' + NAME + ')|"([^"]+)"|(' + NAME + '))(?:\\s+<<[^>]*>>)?(?:\\s+#\\S+)?\\s*(\\{)?\\s*$', 'i').exec(t))) {
      var id = m[2] || m[3] || m[4];
      var display = m[1] || m[3] || m[4];
      var ex = objects.get(id);
      if (ex && !ex.implicit) { D.push(P.d('error', ln, "object '" + id + "' is declared twice (first at line " + ex.line + ")")); }
      var o = getObj(id, ln, true);
      o.implicit = false; o.display = display; o.line = ln;
      if (m[5]) { cur = o; curOpenLine = ln; }
      continue;
    }
    if (/^map\b/i.test(t)) {
      D.push(P.d('warning', ln, 'map (table) objects are not supported — block ignored'));
      if (/\{\s*$/.test(t)) mapSkip = 1;
      continue;
    }
    if ((m = new RegExp('^note\\s+(left|right|top|bottom)\\s+of\\s+(' + NAME + ')\\s*(?::\\s*(.*))?$', 'i').exec(t))) {
      if (!objects.has(m[2])) D.push(P.dW('error', lines[i], m[2], "note refers to '" + m[2] + "' which is not declared"));
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
    var oWord = t.split(/\s+/)[0];
    var sug = P.suggest(oWord, ['object', 'map', 'note', 'title']);
    var dO = P.dW('error', lines[i], oWord, 'Unrecognized statement: "' + (t.length > 60 ? t.slice(0, 60) + '…' : t) + '"' + (sug ? ' — did you mean "' + sug + '"?' : ''));
    if (sug) dO.fix = { line: ln, find: oWord, replace: sug, title: 'Replace with "' + sug + '"' };
    D.push(dO);
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
    if (e.from === e.to) return; /* self loops impose no ranking */
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
    overrides: opts && opts.posOverrides,
    dir: 'TB', gapNode: 44, gapRank: 72, gapComp: 56
  });
  var containedIds = new Set();
  containers.forEach(function (c) { (c.members || []).forEach(function (m) { containedIds.add(m); }); });

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
    var k = e.from < e.to ? e.from + '\u0000' + e.to : e.to + '\u0000' + e.from;
    pairCount.set(k, (pairCount.get(k) || 0) + 1);
  });

  edges.forEach(function (e) {
    if (!lay.pos.has(e.from) || !lay.pos.has(e.to)) return;
    var k = e.from < e.to ? e.from + '\u0000' + e.to : e.to + '\u0000' + e.from;
    var n = pairCount.get(k), idx = pairSeen.get(k) || 0;
    pairSeen.set(k, idx + 1);
    var offset = n > 1 ? (idx - (n - 1) / 2) * 18 : 0;
    var stereo = null, label = e.label;
    if (label) {
      var lm = /^\s*(?:<<\s*(.*?)\s*>>|«(.*?)»)\s*$/.exec(label);
      if (lm) { stereo = '«' + (lm[1] || lm[2]) + '»'; label = null; }
      else label = label.replace(/\s*[<>]\s*$/, '').replace(/^\s*[<>]\s*/, '');
    }
    var na = nodeRect(e.from);
    var nb = e.from === e.to ? na : nodeRect(e.to); /* same ref => edgeSvg self-loop path */
    out += P.layout.edgeSvg(na, nb, {
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
    if (p) out += P.S.wrapNode(n.id, n.line, p.x, p.y, !containedIds.has(n.id), n.box.draw(p.x, p.y));
  });
  notes.forEach(function (n) {
    var p = lay.pos.get(n.id);
    if (p) out += P.S.wrapNode(n.id, n.line, p.x, p.y, true, n.box.draw(p.x, p.y));
  });

  /* recompute extent (self loops / labels can stick out a bit) */
  return { body: out, w: lay.w + 60, h: lay.h + 8 };
}

P.renderClass = function (model, M, meta) {
  var nodes = model.classes.map(function (c) { return { id: c.id, line: c.line, box: buildBox(c, M, 'class') }; });
  var notes = model.notes.map(function (n) { return { id: n.id, line: n.line, box: buildNote(n, M), target: n.target, side: n.side }; });
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
  return renderBoxDiagram(nodes, model.relations, containers, notes, attach, M, { posOverrides: meta && meta.posOverrides });
};

P.renderObject = function (model, M, meta) {
  var nodes = model.objects.map(function (o) { return { id: o.id, line: o.line, box: buildBox(o, M, 'object') }; });
  var notes = model.notes.map(function (n) { return { id: n.id, line: n.line, box: buildNote(n, M), target: n.target, side: n.side }; });
  var attach = [];
  model.notes.forEach(function (n) {
    if (n.target) attach.push({ from: n.id, to: n.target, side: n.side });
  });
  return renderBoxDiagram(nodes, model.links, [], notes, attach, M, { posOverrides: meta && meta.posOverrides });
};

P.buildNote = buildNote; /* reused by other renderers */

})(PUML);

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
    if ((m = new RegExp('^(' + PKINDS.join('|') + ')\\s+(.+)$', 'i').exec(t))) {
      var kind = m[1].toLowerCase(), rest = m[2], mm;
      var id = null, label = null;
      if ((mm = new RegExp('^"([^"]+)"\\s+as\\s+(' + PNAME + ')\\s*(.*)$', 'i').exec(rest))) { label = mm[1]; id = mm[2]; rest = mm[3]; }
      else if ((mm = new RegExp('^(' + PNAME + ')\\s+as\\s+"([^"]+)"\\s*(.*)$', 'i').exec(rest))) { id = mm[1]; label = mm[2]; rest = mm[3]; }
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
    if ((m = /^(alt|opt|loop|par|break|critical|group)\b\s*(.*)$/i.exec(t))) {
      var fr = { k: 'fragOpen', op: m[1].toLowerCase(), label: m[2] || null, line: ln };
      fragStack.push(fr); events.push(fr);
      continue;
    }
    if ((m = /^else\b\s*(.*)$/i.exec(t))) {
      if (!fragStack.length) { D.push(P.d('error', ln, "'else' outside of any alt/par/group block")); continue; }
      var top = fragStack[fragStack.length - 1];
      if (top.op !== 'alt' && top.op !== 'par' && top.op !== 'group' && top.op !== 'opt') {
        D.push(P.d('warning', ln, "'else' inside a '" + top.op + "' block — PlantUML only allows else in alt/par"));
      }
      events.push({ k: 'fragElse', label: m[1] || null, line: ln });
      continue;
    }
    if (/^end$/i.test(t)) {
      if (!fragStack.length) { D.push(P.d('error', ln, "'end' without a matching alt/opt/loop/par/break/critical/group")); continue; }
      fragStack.pop();
      events.push({ k: 'fragClose', line: ln });
      continue;
    }

    /* notes and ref */
    if ((m = new RegExp('^[hr]?note\\s+(left|right)(?:\\s+of)?\\s+(' + PNAME + '|"[^"]+")\\s*(?::\\s*(.*))?$', 'i').exec(t))) {
      var tgt = P.unquote(m[2]);
      if (!parts.has(tgt)) D.push(P.dW('error', lines[i], tgt, "note refers to '" + tgt + "' which has not appeared yet"));
      var nb = { k: 'note', side: m[1].toLowerCase(), targets: [tgt], text: m[3] != null ? [m[3]] : [], line: ln };
      if (m[3] != null) events.push(nb); else noteBuf = nb;
      continue;
    }
    if ((m = new RegExp('^[hr]?note\\s+over\\s+((?:' + PNAME + '|"[^"]+")(?:\\s*,\\s*(?:' + PNAME + '|"[^"]+"))*)\\s*(?::\\s*(.*))?$', 'i').exec(t))) {
      var tgts = m[1].split(/\s*,\s*/).map(P.unquote);
      tgts.forEach(function (g) { if (!parts.has(g)) D.push(P.dW('error', lines[i], g, "note refers to '" + g + "' which has not appeared yet")); });
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
    if ((m = /^autonumber\b\s*(.*)$/i.exec(t))) {
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
    if ((m = new RegExp('^(activate|deactivate|destroy)\\s+(' + PNAME + '|"[^"]+")\\s*(?:#\\S+)?$', 'i').exec(t))) {
      var pid = P.unquote(m[2]);
      getPart(pid, ln); /* silently auto-created, same as a participant's first mention in a message */
      events.push({ k: m[1].toLowerCase(), id: pid, line: ln });
      continue;
    }
    if ((m = new RegExp('^create\\s+(?:(participant|actor|control|boundary|entity|database)\\s+)?(' + PNAME + '|"[^"]+")\\s*$', 'i').exec(t))) {
      var cid = P.unquote(m[2]);
      getPart(cid, ln, m[1] ? m[1].toLowerCase() : 'participant');
      D.push(P.d('info', ln, "create: '" + cid + "' is shown from the start (creation timing is not rendered in this editor)"));
      continue;
    }
    if ((m = /^return\b\s*(.*)$/i.exec(t))) { events.push({ k: 'return', label: m[1] || null, line: ln }); continue; }

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

    var sWord = t.split(/\s+/)[0];
    var sug = P.suggest(sWord, PKINDS.concat(['alt', 'opt', 'loop', 'par', 'break', 'critical', 'group', 'end', 'else', 'note', 'ref', 'activate', 'deactivate', 'destroy', 'return', 'autonumber', 'title']));
    var dU = P.dW('error', lines[i], sWord, 'Unrecognized statement: "' + (t.length > 60 ? t.slice(0, 60) + '…' : t) + '"' + (sug ? ' — did you mean "' + sug + '"?' : '') + '. Messages look like: A -> B : text');
    if (sug) dU.fix = { line: ln, find: sWord, replace: sug, title: 'Replace with "' + sug + '"' };
    D.push(dU);
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
    if ((m = /^(?:rectangle|package)\s+(?:"([^"]+)"|([\w.$ ]+?))\s*(\{)?\s*$/i.exec(t))) {
      var bl = (m[1] || m[2]).trim();
      var bd = { id: '@b' + boundaries.length + ':' + bl, label: bl, members: [], line: ln };
      boundaries.push(bd);
      if (m[3]) bStack.push(bd);
      else D.push(P.d('warning', ln, "rectangle without '{ … }' block has no content"));
      continue;
    }

    /* actor declaration */
    if ((m = new RegExp('^actor\\s+(?::([^:]+):|"([^"]+)"|(' + BARE + '))(?:\\s+as\\s+(?::([^:]+):|"([^"]+)"|(' + BARE + ')))?\\s*(?:<<[^>]*>>)?\\s*(?:#\\S+)?$', 'i').exec(t))) {
      var nm = m[1] || m[2] || m[3];
      var al = m[4] || m[5] || m[6];
      declare('actor', al || nm, nm, ln);
      continue;
    }

    /* usecase declaration */
    if ((m = new RegExp('^usecase\\s+(?:\\(([^()]+)\\)|"([^"]+)"|(' + BARE + '))(?:\\s+as\\s+(?:\\(([^()]+)\\)|"([^"]+)"|(' + BARE + ')))?\\s*(?:<<[^>]*>>)?\\s*(?:#\\S+)?$', 'i').exec(t))) {
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
      if (!els.has(tgt)) D.push(P.dW('error', lines[i], tgt, "note refers to '" + tgt + "' which is not declared"));
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

    var uWord = t.split(/\s+/)[0];
    var sug = P.suggest(uWord, ['actor', 'usecase', 'rectangle', 'note', 'title', 'left to right direction']);
    var dU = P.dW('error', lines[i], uWord, 'Unrecognized statement: "' + (t.length > 60 ? t.slice(0, 60) + '…' : t) + '"' + (sug ? ' — did you mean "' + sug + '"?' : ''));
    if (sug) dU.fix = { line: ln, find: uWord, replace: sug, title: 'Replace with "' + sug + '"' };
    D.push(dU);
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
    overrides: meta && meta.posOverrides,
    dir: 'LR', gapNode: 30, gapRank: 90, gapComp: 50
  });
  var containedIds = new Set();
  containers.forEach(function (c) { (c.members || []).forEach(function (m) { containedIds.add(m); }); });

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
    if (p) out += P.S.wrapNode(e.id, e.line, p.x, p.y, !containedIds.has(e.id), boxes.get(e.id).draw(p.x, p.y));
  });
  notes.forEach(function (n) {
    var p = lay.pos.get(n.id);
    if (p) out += P.S.wrapNode(n.id, n.line, p.x, p.y, true, boxes.get(n.id).draw(p.x, p.y));
  });

  return { body: out, w: lay.w + 8, h: lay.h + 8 };
};

})(PUML);

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

/* PlantUML Studio — editor services (pure, DOM-free): completion context, candidates. */
'use strict';
(function (P) {

/* statement-starter keywords / snippets per diagram type ('*' = any type) */
var KW = {
  '*': [
    { l: 'title ', d: 'diagram title' },
    { l: '@startuml', d: 'document start' },
    { l: '@enduml', d: 'document end' },
    { l: 'note left of ', d: 'note (needs a target)' },
    { l: 'note right of ', d: 'note (needs a target)' },
    { l: 'end note', d: 'close a multi-line note' },
    { l: 'skinparam ', d: 'accepted, not interpreted' },
    { l: 'hide ', d: 'accepted, not interpreted' }
  ],
  class: [
    { l: 'class ', d: 'declare a class' },
    { l: 'abstract class ', d: 'abstract class' },
    { l: 'interface ', d: 'declare an interface' },
    { l: 'enum ', d: 'declare an enumeration' },
    { l: 'annotation ', d: 'declare an annotation' },
    { l: 'package ', d: 'group into a package { }' },
    { l: 'note top of ', d: 'note above a class' },
    { l: 'note bottom of ', d: 'note below a class' }
  ],
  object: [
    { l: 'object ', d: 'declare an object' },
    { l: 'map ', d: 'not supported (warning)' }
  ],
  sequence: [
    { l: 'participant ', d: 'declare a participant' },
    { l: 'actor ', d: 'stick-figure participant' },
    { l: 'database ', d: 'database participant' },
    { l: 'boundary ', d: 'participant (plain box here)' },
    { l: 'control ', d: 'participant (plain box here)' },
    { l: 'entity ', d: 'participant (plain box here)' },
    { l: 'queue ', d: 'participant (plain box here)' },
    { l: 'collections ', d: 'participant (plain box here)' },
    { l: 'activate ', d: 'open an activation bar' },
    { l: 'deactivate ', d: 'close an activation bar' },
    { l: 'destroy ', d: 'end a lifeline with ✕' },
    { l: 'return ', d: 'reply + deactivate' },
    { l: 'autonumber', d: 'number the messages' },
    { l: 'alt ', d: 'alternatives … else … end' },
    { l: 'else ', d: 'next branch' },
    { l: 'opt ', d: 'optional block … end' },
    { l: 'loop ', d: 'loop block … end' },
    { l: 'par ', d: 'parallel block … end' },
    { l: 'break ', d: 'break block … end' },
    { l: 'critical ', d: 'critical block … end' },
    { l: 'group ', d: 'named block … end' },
    { l: 'end', d: 'close alt/opt/loop/…' },
    { l: 'note over ', d: 'note across lifelines' },
    { l: 'ref over ', d: 'reference fragment' },
    { l: 'hide footbox', d: 'no bottom participant boxes' },
    { l: '== ', d: 'divider: == Phase ==' },
    { l: '... ', d: 'delay: ... later ...' }
  ],
  usecase: [
    { l: 'actor ', d: 'declare an actor' },
    { l: 'usecase ', d: 'declare a use case' },
    { l: 'rectangle ', d: 'system boundary { }' },
    { l: 'left to right direction', d: 'layout hint' }
  ],
  state: [
    { l: 'state ', d: 'declare a state' },
    { l: '[*] --> ', d: 'initial transition' }
  ]
};

/* Completion context at (lineText, col 0-based chars before cursor).
   Returns {mode:'none'|'stmt'|'ident'|'any', prefix, start} — start = char index of the prefix. */
P.completionContext = function (lineText, col) {
  var before = String(lineText || '').slice(0, col);
  if (((before.match(/"/g) || []).length) % 2 === 1) return { mode: 'none' };
  /* after "… : " we are in free label/member text */
  if (/\s:\s/.test(before) || /\s:$/.test(before)) return { mode: 'none' };
  if (/^\s*'/.test(before)) return { mode: 'none' };
  var m = /([A-Za-z_$@][\w.$]*)?$/.exec(before);
  var prefix = m[1] || '';
  var start = col - prefix.length;
  var pre = before.slice(0, start);
  if (/^\s*$/.test(pre)) return { mode: 'stmt', prefix: prefix, start: start };
  if (/\b(?:of|over|from|to)\s+$/.test(pre)) return { mode: 'ident', prefix: prefix, start: start };
  if (/[-.=~]{1,2}(?:\|>|>>|>|\*|o)?\s+$/.test(pre)) return { mode: 'ident', prefix: prefix, start: start };
  if (/(?:<\||<<|<|\*|o)?[-.=~]{1,2}$/.test(pre)) return { mode: 'none' }; /* still typing the arrow */
  if (/,\s*$/.test(pre)) return { mode: 'ident', prefix: prefix, start: start };
  if (/\b(?:extends|implements|as)\s+$/.test(pre)) return { mode: 'ident', prefix: prefix, start: start };
  return { mode: 'any', prefix: prefix, start: start };
};

/* Names usable as references, from a compiled model. Returns [{name, insert, d}]. */
P.collectIdents = function (model, type) {
  var out = [];
  if (!model) return out;
  function push(name, insert, d) {
    if (!name || name.charAt(0) === '@') return;
    out.push({ name: name, insert: insert || name, d: d || '' });
  }
  if (type === 'class' && model.classes) {
    model.classes.forEach(function (c) { push(c.id, c.id, c.kind); });
  } else if (type === 'object' && model.objects) {
    model.objects.forEach(function (o) { push(o.id, o.id, 'object'); });
  } else if (type === 'sequence' && model.parts) {
    model.parts.forEach(function (p) { push(p.id, /[^\w.$@]/.test(p.id) ? '"' + p.id + '"' : p.id, p.kind); });
  } else if (type === 'usecase' && model.els) {
    model.els.forEach(function (e) {
      var ins = e.id;
      if (/[^\w.$]/.test(e.id)) ins = e.kind === 'actor' ? ':' + e.id + ':' : '(' + e.id + ')';
      push(e.id, ins, e.kind);
    });
  } else if (type === 'state' && model.states) {
    model.states.forEach(function (s) {
      if (s.kind === 'initial' || s.kind === 'final') return;
      push(s.id, /[^\w.$]/.test(s.id) ? '"' + s.id + '"' : s.id, s.kind);
    });
  }
  return out;
};

/* Ranked candidates for a context. Returns [{label, insert, kind, d}] (max 12). */
P.completionsFor = function (ctx, type, idents) {
  if (!ctx || ctx.mode === 'none') return [];
  var pfx = (ctx.prefix || '').toLowerCase();
  var out = [], seen = new Set();
  function add(label, insert, kind, d) {
    if (seen.has(label)) return;
    if (pfx && label.toLowerCase().indexOf(pfx) !== 0) return;
    if (label.toLowerCase() === pfx && insert === ctx.prefix) return; /* nothing to add */
    seen.add(label);
    out.push({ label: label, insert: insert, kind: kind, d: d || '' });
  }
  var kws = (KW[type] || []).concat(KW['*']);
  var ids = idents || [];
  if (ctx.mode === 'ident') {
    ids.forEach(function (x) { add(x.name, x.insert, 'ident', x.d); });
  } else if (ctx.mode === 'stmt') {
    kws.forEach(function (k) { add(k.l.trim(), k.l, 'kw', k.d); });
    ids.forEach(function (x) { add(x.name, x.insert, 'ident', x.d); });
  } else {
    ids.forEach(function (x) { add(x.name, x.insert, 'ident', x.d); });
    kws.forEach(function (k) { add(k.l.trim(), k.l, 'kw', k.d); });
  }
  return out.slice(0, 12);
};

})(PUML);

/* PlantUML Studio — a minimal, dependency-free ZIP writer (STORE method,
   i.e. no compression — the generated projects are small text files, so
   there's nothing to gain from DEFLATE and a lot of complexity to avoid).
   Pure JS, no DOM; only needs TextEncoder, which every target environment
   here (browsers + Node's test runner) provides globally. */
'use strict';
(function (P) {

var CRC_TABLE = (function () {
  var t = new Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  var crc = 0xFFFFFFFF;
  for (var i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
P.crc32 = crc32;

function u16(n) { return [n & 0xFF, (n >>> 8) & 0xFF]; }
function u32(n) { return [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF]; }

/* files: [{name, data: string|Uint8Array}] — name uses '/' as the path
   separator regardless of platform, per the ZIP spec. Returns a Uint8Array
   of the complete archive. Timestamps are fixed at the MS-DOS epoch
   (1980-01-01): the exact time a generated file was zipped has no meaning
   here, and a fixed stamp keeps the output byte-identical for identical
   input, which is easier to test and to diff. */
P.makeZip = function (files) {
  var enc = (typeof TextEncoder !== 'undefined') ? new TextEncoder() : null;
  function toBytes(s) {
    if (s instanceof Uint8Array) return s;
    if (enc) return enc.encode(String(s));
    /* Node < 11 fallback, not expected to be hit in practice */
    return new Uint8Array(Buffer.from(String(s), 'utf8'));
  }
  var DOS_TIME = 0, DOS_DATE = 0x21;
  var localChunks = [], centralChunks = [], offset = 0, count = 0;

  files.forEach(function (f) {
    var name = String(f.name).replace(/\\/g, '/').replace(/^\/+/, '');
    var nameBytes = toBytes(name);
    var dataBytes = toBytes(f.data);
    var crc = crc32(dataBytes);
    var size = dataBytes.length;

    var local = [].concat(
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(DOS_TIME), u16(DOS_DATE),
      u32(crc), u32(size), u32(size), u16(nameBytes.length), u16(0)
    );
    var localBytes = new Uint8Array(local.length + nameBytes.length + dataBytes.length);
    localBytes.set(local, 0);
    localBytes.set(nameBytes, local.length);
    localBytes.set(dataBytes, local.length + nameBytes.length);
    localChunks.push(localBytes);

    var central = [].concat(
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(DOS_TIME), u16(DOS_DATE),
      u32(crc), u32(size), u32(size), u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0),
      u32(offset)
    );
    var centralBytes = new Uint8Array(central.length + nameBytes.length);
    centralBytes.set(central, 0);
    centralBytes.set(nameBytes, central.length);
    centralChunks.push(centralBytes);

    offset += localBytes.length;
    count++;
  });

  var centralStart = offset, centralSize = 0;
  centralChunks.forEach(function (c) { centralSize += c.length; });

  var eocd = new Uint8Array(u32(0x06054b50).concat(
    u16(0), u16(0), u16(count), u16(count), u32(centralSize), u32(centralStart), u16(0)
  ));

  var total = offset + centralSize + eocd.length;
  var out = new Uint8Array(total);
  var pos = 0;
  localChunks.forEach(function (c) { out.set(c, pos); pos += c.length; });
  centralChunks.forEach(function (c) { out.set(c, pos); pos += c.length; });
  out.set(eocd, pos);
  return out;
};

})(PUML);

/* PlantUML Studio — class diagram -> source code generator.
   Pure JS, no DOM. A tiny Mustache-like template engine (editable, explicit
   text templates — no hidden magic) renders a per-class context built from
   the parsed class-diagram model. Ships default Java and Python templates;
   both the templates and the generation are exposed so a UI can let users
   edit the template and regenerate live.

   NOT everything is template-editable, though — worth knowing before you go
   looking for "List" in the wrong place:
     - The DECISION that a field is a collection, and the literal type
       STRING "List<X>" / "List[X]", are built in JS (toPyType() for
       user-typed generics; the assoc-field block in classGenModel() for
       to-many associations) and handed to the template already resolved as
       {{type}}/{{pyType}}. Changing List to e.g. Set here means editing
       this file, not the template.
     - Whether an IMPORT line is emitted (needsJavaCollections / needsTyping)
       is also decided in JS, but the import line's TEXT lives in the
       template itself (P.JAVA_TEMPLATE / P.PYTHON_TEMPLATE below) — that
       part genuinely is just template text, editable live in the UI. */
'use strict';
(function (P) {

/* ============================ TEMPLATE ENGINE ============================
   Supported tags: {{path}}  {{#each path}}...{{/each}}  {{#if path}}...{{else}}...{{/if}}
   {{#unless path}}...{{/unless}}. `path` is a dot-separated lookup resolved
   against a context stack (innermost frame first, falling back outward —
   so a variable from an outer scope is visible inside a nested #each/#if
   without needing explicit parent references). A leading '!' on an #if/#unless
   condition negates it. Block tags alone on their own line consume that whole
   line (including the newline), like Mustache's "standalone tags", so
   templates stay readable without producing ragged blank lines. */

var STANDALONE_RE = /^[ \t]*\{\{(#each\s[^}]*|\/each|#if\s[^}]*|\/if|#unless\s[^}]*|\/unless|else)\}\}[ \t]*\r?\n/gm;

function tmplGet(stack, path) {
  if (path === '.') { /* {{.}}: the current frame's own value, for arrays of primitives */
    for (var k = stack.length - 1; k >= 0; k--) {
      if (stack[k] && Object.prototype.hasOwnProperty.call(stack[k], '.')) return stack[k]['.'];
    }
    return undefined;
  }
  var parts = path.split('.');
  for (var i = stack.length - 1; i >= 0; i--) {
    var v = stack[i], ok = true;
    for (var j = 0; j < parts.length; j++) {
      if (v == null || (typeof v !== 'object' && typeof v !== 'function')) { ok = false; break; }
      v = v[parts[j]];
      if (v === undefined) { ok = false; break; }
    }
    if (ok) return v;
  }
  return undefined;
}
function tmplTruthy(v) { return Array.isArray(v) ? v.length > 0 : !!v; }

function tokenize(src) {
  src = src.replace(STANDALONE_RE, function (_, inner) { return '{{' + inner + '}}'; });
  var toks = [], i = 0;
  while (i < src.length) {
    var a = src.indexOf('{{', i);
    if (a === -1) { toks.push({ t: 'text', v: src.slice(i) }); break; }
    if (a > i) toks.push({ t: 'text', v: src.slice(i, a) });
    var b = src.indexOf('}}', a);
    if (b === -1) { toks.push({ t: 'text', v: src.slice(a) }); break; }
    var inner = src.slice(a + 2, b).trim();
    i = b + 2;
    if (/^#each\s+/.test(inner)) toks.push({ t: 'openEach', path: inner.replace(/^#each\s+/, '').trim() });
    else if (inner === '/each') toks.push({ t: 'closeEach' });
    else if (/^#if\s+/.test(inner)) toks.push({ t: 'openIf', path: inner.replace(/^#if\s+/, '').trim() });
    else if (/^#unless\s+/.test(inner)) toks.push({ t: 'openIf', path: inner.replace(/^#unless\s+/, '').trim(), negateBase: true });
    else if (inner === '/if' || inner === '/unless') toks.push({ t: 'closeIf' });
    else if (inner === 'else') toks.push({ t: 'else' });
    else toks.push({ t: 'var', path: inner });
  }
  return toks;
}

/* stack-based parse into a node tree: {type:'text'|'var', ...} | {type:'each', path, body} | {type:'if', path, neg, then, els} */
function parse(toks) {
  var root = { type: 'root', body: [] };
  var stack = [root];
  function top() { return stack[stack.length - 1]; }
  function push(node) { top().body.push(node); }
  toks.forEach(function (tk) {
    if (tk.t === 'text') push({ type: 'text', value: tk.v });
    else if (tk.t === 'var') push({ type: 'var', path: tk.path });
    else if (tk.t === 'openEach') { var n = { type: 'each', path: tk.path, body: [] }; push(n); stack.push(n); }
    else if (tk.t === 'closeEach') { if (top().type === 'each') stack.pop(); }
    else if (tk.t === 'openIf') {
      var neg = false, path = tk.path;
      if (tk.negateBase) neg = !neg;
      if (path.charAt(0) === '!') { neg = !neg; path = path.slice(1).trim(); }
      var n2 = { type: 'if', path: path, neg: neg, then: [], els: null };
      push(n2); n2.body = n2.then; stack.push(n2);
    }
    else if (tk.t === 'else') { var f = top(); if (f.type === 'if') { f.els = []; f.body = f.els; } }
    else if (tk.t === 'closeIf') { if (top().type === 'if') stack.pop(); }
  });
  return root;
}

function render(nodes, stack, out) {
  nodes.forEach(function (n) {
    if (n.type === 'text') { out.push(n.value); return; }
    if (n.type === 'var') { var v = tmplGet(stack, n.path); out.push(v == null ? '' : String(v)); return; }
    if (n.type === 'each') {
      var arr = tmplGet(stack, n.path);
      if (Array.isArray(arr)) {
        arr.forEach(function (item, idx) {
          var frame = (item && typeof item === 'object') ? Object.assign({}, item) : { '.': item };
          frame['@index'] = idx; frame['@first'] = idx === 0; frame['@last'] = idx === arr.length - 1;
          stack.push(frame);
          render(n.body, stack, out);
          stack.pop();
        });
      }
      return;
    }
    if (n.type === 'if') {
      var cond = tmplTruthy(tmplGet(stack, n.path));
      if (n.neg) cond = !cond;
      render(cond ? n.then : (n.els || []), stack, out);
      return;
    }
  });
}

P.tmplRender = function (src, ctx) {
  var tree = parse(tokenize(String(src == null ? '' : src)));
  var out = [];
  render(tree.body, [ctx || {}], out);
  return out.join('');
};

/* ============================ MEMBER SIGNATURE PARSER ============================ */
/* splits on top-level commas only, respecting <>, (), [] nesting (so
   `Map<String, Integer>` in a parameter type isn't split in half) */
function splitTopLevel(s) {
  var parts = [], depth = 0, cur = '';
  for (var i = 0; i < s.length; i++) {
    var c = s.charAt(i);
    if (c === '<' || c === '(' || c === '[') depth++;
    else if (c === '>' || c === ')' || c === ']') depth = Math.max(0, depth - 1);
    if (c === ',' && depth === 0) { parts.push(cur); cur = ''; }
    else cur += c;
  }
  if (cur.trim() !== '' || parts.length) parts.push(cur);
  return parts.map(function (p) { return p.trim(); }).filter(function (p) { return p !== ''; });
}

/* member.text is the raw signature classdiag.js kept, e.g. "speed: int",
   "drive(m: Member): Loan", "count: int = 0", or a bare "RED" (enum literal) */
P.parseMemberSignature = function (text) {
  text = String(text || '').trim();
  var m = /^([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*(?::\s*(.+))?$/.exec(text);
  if (m) {
    var params = splitTopLevel(m[2]).map(function (p) {
      var pm = /^([A-Za-z_$][\w$]*)\s*(?::\s*(.+))?$/.exec(p);
      return pm ? { name: pm[1], type: (pm[2] || 'Object').trim() } : { name: p, type: 'Object' };
    });
    return { isMethod: true, name: m[1], params: params, returnType: (m[3] || 'void').trim() };
  }
  var a = /^([A-Za-z_$][\w$]*)\s*(?::\s*([^=]+?))?\s*(?:=\s*(.+))?$/.exec(text);
  if (a) return { isMethod: false, name: a[1], type: a[2] ? a[2].trim() : 'Object', defaultValue: a[3] ? a[3].trim() : null };
  return { isMethod: false, name: text || 'value', type: 'Object', defaultValue: null };
};

/* ============================ TYPE MAPPING (Java-ish -> Python) ============================ */
var PY_TYPE_MAP = {
  int: 'int', integer: 'int', long: 'int', short: 'int', byte: 'int',
  double: 'float', float: 'float', boolean: 'bool', bool: 'bool',
  char: 'str', character: 'str', string: 'str', void: 'None', object: 'object'
};
/* Maps a Java-ish type STRING to its Python equivalent — this is the ONLY
   place "List" is produced for a member the user typed by hand (e.g.
   `-books: List<Book>` in the diagram); association-derived collection
   fields build their pyType directly (see the assoc-field block below) and
   never call this, since their target is always a plain class name, not a
   generic that needs recursing into. */
function toPyType(t) {
  t = String(t || '').trim();
  var g = /^([\w.]+)\s*<\s*(.+)\s*>$/.exec(t);
  if (g) {
    var outer = g[1].toLowerCase();
    if (outer === 'list' || outer === 'arraylist' || outer === 'linkedlist' || outer === 'collection') return 'List[' + toPyType(g[2]) + ']';
    if (outer === 'set' || outer === 'hashset') return 'Set[' + toPyType(g[2]) + ']';
    if (outer === 'map' || outer === 'hashmap') {
      var kv = splitTopLevel(g[2]);
      return 'Dict[' + toPyType(kv[0] || 'object') + ', ' + toPyType(kv[1] || 'object') + ']';
    }
    return toPyType(g[2]);
  }
  var low = t.toLowerCase();
  return PY_TYPE_MAP[low] || t;
}
function camelToSnake(s) {
  return String(s || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}
var VIS_JAVA = { '+': 'public ', '-': 'private ', '#': 'protected ', '~': '' };

/* PlantUML multiplicities: "*", "0..*", "1..*", "3", "2..5" -> to-many */
function isManyCard(card) {
  if (!card) return false;
  var s = String(card).trim();
  if (s.indexOf('*') >= 0) return true;
  var parts = s.split('..');
  var n = parseFloat(parts[parts.length - 1]);
  return !isNaN(n) && n > 1;
}
function lowerFirst(s) { return s ? s.charAt(0).toLowerCase() + s.slice(1) : s; }
function pluralize(s) {
  if (/[sxz]$/i.test(s) || /[cs]h$/i.test(s)) return s + 'es';
  if (/[^aeiou]y$/i.test(s)) return s.slice(0, -1) + 'ies';
  return s + 's';
}

/* a UML member name is free-form text and may collide with a reserved word
   in the target language (a "return()" operation is a plausible, real
   example) — append '_' the way both language communities conventionally do */
var JAVA_KEYWORDS = ('abstract assert boolean break byte case catch char class const continue default do double ' +
  'else enum extends final finally float for goto if implements import instanceof int interface long native new ' +
  'package private protected public return short static strictfp super switch synchronized this throw throws ' +
  'transient try void volatile while true false null var record yield').split(' ');
var PY_KEYWORDS = ('False None True and as assert async await break class continue def del elif else except ' +
  'finally for from global if import in is lambda nonlocal not or pass raise return try while with yield self').split(' ');
function escJava(name) { return JAVA_KEYWORDS.indexOf(name) >= 0 ? name + '_' : name; }
function escPy(name) { return PY_KEYWORDS.indexOf(name) >= 0 ? name + '_' : name; }

/* common JDK types a class diagram will name as a bare attribute/parameter
   type (Date, BigDecimal, ...) but that need an explicit import to compile —
   unlike sibling generated classes, which Java resolves via the classpath
   with no import needed at all */
var JAVA_WELLKNOWN_IMPORTS = {
  Date: 'java.util.Date', LocalDate: 'java.time.LocalDate', LocalDateTime: 'java.time.LocalDateTime',
  LocalTime: 'java.time.LocalTime', Instant: 'java.time.Instant', Duration: 'java.time.Duration',
  Optional: 'java.util.Optional', UUID: 'java.util.UUID',
  BigDecimal: 'java.math.BigDecimal', BigInteger: 'java.math.BigInteger'
};
function baseTypeNames(t) { return String(t || '').split(/[<>,\[\]\s]+/).filter(Boolean); }

/* ============================ CLASS MODEL -> GENERATION MODEL ============================ */
/* One entry per top-level (non-implicit) class/interface/enum/etc. Attaches
   both *java and py* fields to every attribute/parameter/method so ONE model
   drives both default templates (and any custom ones). */
P.classGenModel = function (model) {
  var byId = model.byId;
  var superOf = {}, interfacesOf = {};
  (model.relations || []).forEach(function (rel) {
    if (!rel.cls || !rel.cls.isHierarchy) return;
    var childId, parentId;
    if (rel.cls.decoR === 'tri') { childId = rel.from; parentId = rel.to; }
    else if (rel.cls.decoL === 'tri') { childId = rel.to; parentId = rel.from; }
    else return;
    if (rel.cls.style === 'dashed') { (interfacesOf[childId] = interfacesOf[childId] || []).push(parentId); }
    else { superOf[childId] = parentId; }
  });

  /* non-hierarchy relations become fields on the owning side:
     - composition/aggregation: the diamond end owns a reference to the other
     - directed association (A --> B): A owns a reference to B
     - plain "--" (no arrowhead at all): UML leaves navigability unspecified,
       so both ends get a reference to each other
     - dependency (..>, a single open arrowhead, dashed, no diamond): skipped
       — a dependency is "uses" (e.g. a parameter type), not a stored field */
  var assocFieldsOf = {};
  function addAssocField(ownerId, targetId, cardOnTargetSide, label) {
    (assocFieldsOf[ownerId] = assocFieldsOf[ownerId] || []).push({ targetId: targetId, many: isManyCard(cardOnTargetSide), label: label || null });
  }
  (model.relations || []).forEach(function (rel) {
    var c = rel.cls;
    if (!c || c.isHierarchy) return;
    if (c.decoL === 'diamond' || c.decoL === 'odiamond') { addAssocField(rel.from, rel.to, rel.cardR, rel.label); return; }
    if (c.decoR === 'diamond' || c.decoR === 'odiamond') { addAssocField(rel.to, rel.from, rel.cardL, rel.label); return; }
    var isDependency = c.style === 'dashed' && ((c.decoL === 'open' && c.decoR === 'none') || (c.decoR === 'open' && c.decoL === 'none'));
    if (isDependency) return;
    if (c.decoR === 'open' && c.decoL === 'none') { addAssocField(rel.from, rel.to, rel.cardR, rel.label); return; }
    if (c.decoL === 'open' && c.decoR === 'none') { addAssocField(rel.to, rel.from, rel.cardL, rel.label); return; }
    if (c.decoL === 'none' && c.decoR === 'none') {
      addAssocField(rel.from, rel.to, rel.cardR, rel.label);
      addAssocField(rel.to, rel.from, rel.cardL, rel.label);
    }
  });

  /* PASS 1: each class's own attributes/methods, keyed by model id (not yet
     aware of inheritance — that needs every class's own info to exist first) */
  var infoById = {};
  model.classes.filter(function (c) { return !c.implicit; }).forEach(function (c) {
    var isEnum = c.kind === 'enum';
    var isInterface = c.kind === 'interface' || c.kind === 'annotation';
    var isAbstract = c.kind === 'abstract';
    var superId = superOf[c.id] || null;
    var superName = superId && byId.has(superId) ? byId.get(superId).display : null;
    var ifaceNames = (interfacesOf[c.id] || []).map(function (id) { return byId.has(id) ? byId.get(id).display : id; });

    var attributes = [], methods = [], enumValues = [];
    (c.members || []).forEach(function (mb) {
      if (mb.kind === 'sep') return;
      var sig = P.parseMemberSignature(mb.text);
      if (isEnum && !sig.isMethod) { enumValues.push(sig.name); return; }
      var visKw = VIS_JAVA[mb.vis] != null ? VIS_JAVA[mb.vis] : 'public ';
      var pyVis = (mb.vis === '-' || mb.vis === '#') ? '_' : '';
      if (sig.isMethod) {
        var params = sig.params.map(function (p) {
          return {
            name: escJava(p.name), type: p.type,
            pyName: escPy(camelToSnake(p.name)), pyType: toPyType(p.type)
          };
        });
        var bodiless = isInterface || mb.abst;
        methods.push({
          name: escJava(sig.name), pyName: escPy(camelToSnake(sig.name)),
          visKw: visKw, isStatic: mb.stat, isAbstract: !!mb.abst, bodiless: bodiless,
          returnType: sig.returnType, isVoid: /^void$/i.test(sig.returnType),
          pyReturnType: toPyType(sig.returnType),
          params: params,
          paramsStr: params.map(function (p) { return p.type + ' ' + p.name; }).join(', '),
          pyParamsStr: ['self'].concat(params.map(function (p) { return p.pyName + ': ' + p.pyType; })).join(', ')
        });
      } else {
        var pyParamName = escPy(camelToSnake(sig.name));
        attributes.push({
          name: escJava(sig.name), pyName: pyVis + pyParamName, pyParamName: pyParamName,
          visKw: visKw, isStatic: mb.stat,
          type: sig.type, pyType: toPyType(sig.type),
          hasDefault: sig.defaultValue != null, defaultValue: sig.defaultValue
        });
      }
    });

    var instanceAttrs = attributes.filter(function (a) { return !a.isStatic; });
    var staticAttrs = attributes.filter(function (a) { return a.isStatic; });

    infoById[c.id] = {
      id: c.id, name: c.display, kind: c.kind,
      isAbstract: isAbstract, isInterface: isInterface, isEnum: isEnum,
      superId: superId, superName: superName, interfaceIds: interfacesOf[c.id] || [], ifaceNames: ifaceNames,
      attributes: attributes, instanceAttrs: instanceAttrs, staticAttrs: staticAttrs,
      methods: methods, enumValues: enumValues
    };
  });

  /* PASS 1.5: merge association-derived fields into each class's own
     attributes — MUST happen before any inheritance threading below, since
     a subclass's super(...) call needs to know about fields an ancestor
     picked up from an association, not just the ones it declared itself */
  Object.keys(infoById).forEach(function (id) {
    var info = infoById[id];
    var existingNames = {};
    info.attributes.forEach(function (a) { existingNames[a.name] = true; });
    var assocAttrs = [], seenAssoc = {};
    (assocFieldsOf[id] || []).forEach(function (cand) {
      var targetInfo = infoById[cand.targetId];
      var targetName = targetInfo ? targetInfo.name : (byId.has(cand.targetId) ? byId.get(cand.targetId).display : null);
      if (!targetName) return;
      var base = lowerFirst(targetName);
      var fieldName = escJava(cand.many ? pluralize(base) : base);
      if (existingNames[fieldName] || seenAssoc[fieldName]) return;
      seenAssoc[fieldName] = true;
      var pyParamName = escPy(camelToSnake(fieldName));
      /* a trailing/leading < or > in the label is just a PlantUML "read the
         label this way" rendering hint, not part of the text itself */
      var note = cand.label ? cand.label.replace(/\s*[<>]\s*$/, '').replace(/^\s*[<>]\s*/, '').trim() : null;
      /* this is where "List" is decided for an association-derived field:
         cand.many comes from isManyCard() reading the far-end multiplicity
         (e.g. "0..*") — a to-many association always becomes a List here,
         hardcoded, not read from the diagram or the template. To generate
         Set<X>/List[X] differently, or a different collection type, this is
         the line to change — the template only ever sees the resolved
         {{type}}/{{pyType}} string below, it can't alter the choice. */
      assocAttrs.push({
        name: fieldName, pyName: '_' + pyParamName, pyParamName: pyParamName,
        visKw: 'private ', isStatic: false,
        type: cand.many ? 'List<' + targetName + '>' : targetName,
        pyType: cand.many ? 'List[' + targetName + ']' : targetName,
        hasDefault: false, defaultValue: null,
        isCollection: cand.many, assocNote: note || null
      });
    });
    if (assocAttrs.length) {
      info.attributes = info.attributes.concat(assocAttrs);
      info.instanceAttrs = info.instanceAttrs.concat(assocAttrs);
    }
  });

  /* every method a CONCRETE descendant of `id` must eventually provide a body
     for: the class/interface's own bodiless methods, plus whatever its own
     ancestors still require and it doesn't itself override with a real body */
  function collectRequirements(id, seen) {
    if (seen[id] || !infoById[id]) return {};
    seen[id] = true;
    var info = infoById[id], reqs = {};
    ([info.superId].concat(info.interfaceIds)).forEach(function (pid) {
      if (!pid) return;
      var inherited = collectRequirements(pid, seen);
      Object.keys(inherited).forEach(function (k) { reqs[k] = inherited[k]; });
    });
    info.methods.forEach(function (m) {
      var k = m.name + '/' + m.params.length;
      if (m.bodiless) reqs[k] = m; else delete reqs[k];
    });
    return reqs;
  }

  /* a class's own instance attributes are assigned in ITS constructor; every
     ancestor's instance attributes must still reach that constructor so it
     can forward them via super(...) — Java requires an explicit super call
     whenever the parent has no viable no-arg constructor */
  function collectInheritedAttrs(id) {
    var chain = [], cur = infoById[id] && infoById[id].superId, seen = {};
    var supers = [];
    while (cur && infoById[cur] && !seen[cur]) { seen[cur] = true; supers.unshift(cur); cur = infoById[cur].superId; }
    supers.forEach(function (sid) {
      chain = chain.concat(infoById[sid].instanceAttrs.filter(function (a) { return !a.isCollection; }));
    });
    return chain;
  }

  /* PASS 2: resolve inheritance — inject stub overrides for anything a
     concrete class still owes an ancestor interface/abstract class, and
     thread ancestor fields through the constructor chain */
  var classes = Object.keys(infoById).map(function (id) {
    var info = infoById[id];
    var methods = info.methods.slice();
    if (!info.isEnum && !info.isInterface && !info.isAbstract) {
      var reqs = {};
      ([info.superId].concat(info.interfaceIds)).forEach(function (pid) {
        if (!pid) return;
        var r = collectRequirements(pid, {});
        Object.keys(r).forEach(function (k) { reqs[k] = r[k]; });
      });
      info.methods.forEach(function (m) { delete reqs[m.name + '/' + m.params.length]; });
      Object.keys(reqs).forEach(function (k) {
        methods.push(Object.assign({}, reqs[k], { bodiless: false, isAbstract: false, isStatic: false, visKw: 'public ' }));
      });
    }

    /* attributes/instanceAttrs already include association-derived fields —
       merged in PASS 1.5, before collectInheritedAttrs (below) could need them */
    var attributes = info.attributes, instanceAttrs = info.instanceAttrs, staticAttrs = info.staticAttrs;

    var inheritedAttrs = (info.isEnum || info.isInterface) ? [] : collectInheritedAttrs(id);
    var ctorInstanceAttrs = instanceAttrs.filter(function (a) { return !a.isCollection; });
    var allCtorAttrs = inheritedAttrs.concat(ctorInstanceAttrs);
    var hasSuperCtorArgs = !!(info.superName && inheritedAttrs.length);
    var needsAbcHere = info.isInterface || methods.some(function (m) { return m.bodiless; });
    var pyBases = (info.superName ? [info.superName] : []).concat(info.ifaceNames);
    /* @abstractmethod is a no-op unless the class actually derives from ABC —
       every class that declares one (interfaces, and abstract classes with
       at least one still-abstract method) needs it in its own base list,
       even if a superclass elsewhere in the chain already has it (redundant
       but harmless — Python's MRO collapses repeated bases) */
    if (needsAbcHere && pyBases.indexOf('ABC') < 0) pyBases.push('ABC');

    /* Python needs the real base-class objects to build the class (unlike
       Java, which finds sibling .java files via the classpath automatically),
       so — unlike attribute/parameter type hints, which `from __future__
       import annotations` below makes lazy — base classes need a real import */
    var pyImports = [], seenImp = {};
    ([info.superId].concat(info.interfaceIds)).forEach(function (pid) {
      if (!pid || !infoById[pid] || seenImp[pid]) return;
      seenImp[pid] = true;
      var otherName = infoById[pid].name;
      pyImports.push({ module: camelToSnake(otherName), name: otherName });
    });

    var javaImports = [], seenJI = {};
    attributes.concat(methods.reduce(function (a, m) { return a.concat(m.params, [{ type: m.returnType }]); }, []))
      .forEach(function (x) {
        baseTypeNames(x.type).forEach(function (n) {
          var imp = JAVA_WELLKNOWN_IMPORTS[n];
          if (imp && !seenJI[imp]) { seenJI[imp] = true; javaImports.push(imp); }
        });
      });
    javaImports.sort();

    return {
      name: info.name, kind: info.kind,
      isClass: !info.isEnum && !info.isInterface && !info.isAbstract,
      isAbstract: info.isAbstract, isInterface: info.isInterface, isEnum: info.isEnum,
      superclass: info.superName, interfaces: info.ifaceNames, hasInterfaces: info.ifaceNames.length > 0,
      interfacesStr: info.ifaceNames.join(', '),
      extendsClause: info.superName ? ' extends ' + info.superName : '',
      implementsClause: info.ifaceNames.length ? ' implements ' + info.ifaceNames.join(', ') : '',
      pyBases: pyBases, pyBasesStr: pyBases.join(', '), hasPyBases: pyBases.length > 0,
      needsAbc: needsAbcHere,
      /* needsTyping/needsJavaCollections only decide WHETHER an import
         line fires — the import line's TEXT is plain text sitting in
         P.JAVA_TEMPLATE / P.PYTHON_TEMPLATE below (search for "List" in
         either), so THAT part is genuinely editable in the template pane */
      needsTyping: attributes.concat(methods.reduce(function (a, m) { return a.concat(m.params); }, []))
        .some(function (x) { return /^(List|Set|Dict)\[/.test(x.pyType); }),
      needsJavaCollections: instanceAttrs.some(function (a) { return a.isCollection; }),
      javaImports: javaImports,
      hasAnyJavaImports: javaImports.length > 0 || instanceAttrs.some(function (a) { return a.isCollection; }),
      attributes: attributes, instanceAttrs: instanceAttrs, staticAttrs: staticAttrs,
      hasAttributes: attributes.length > 0, hasInstanceAttrs: instanceAttrs.length > 0,
      methods: methods, hasMethods: methods.length > 0,
      enumValues: info.enumValues, enumValuesStr: info.enumValues.join(', '),
      pyImports: pyImports, hasPyImports: pyImports.length > 0,
      hasSuperCtorArgs: hasSuperCtorArgs,
      hasCtorBody: hasSuperCtorArgs || instanceAttrs.length > 0,
      superCallArgsStr: inheritedAttrs.map(function (a) { return a.name; }).join(', '),
      pySuperCallArgsStr: inheritedAttrs.map(function (a) { return a.pyParamName; }).join(', '),
      javaCtorParamsStr: allCtorAttrs.map(function (a) { return a.type + ' ' + a.name; }).join(', '),
      pyInitParamsStr: ['self'].concat(allCtorAttrs.map(function (a) {
        return a.pyParamName + ': ' + a.pyType + (a.hasDefault ? ' = ' + a.defaultValue : '');
      })).join(', ')
    };
  });
  return { classes: classes };
};

/* ============================ DEFAULT TEMPLATES (editable) ============================ */
P.JAVA_TEMPLATE = [
  '{{#if isEnum}}',
  'public enum {{name}} {',
  '    {{enumValuesStr}}',
  '}',
  '{{else}}',
  /* the two lines below are the ONLY place "List"/"ArrayList" appear as
     literal, user-editable text — change them here to swap the collection
     import (e.g. to java.util.Set) if you also change the type string in
     classGenModel()'s assoc-field block; the {{type}} on a field further
     down is already resolved by then and won't reflect an edit made here */
  '{{#if needsJavaCollections}}',
  'import java.util.ArrayList;',
  'import java.util.List;',
  '{{/if}}',
  '{{#each javaImports}}',
  'import {{.}};',
  '{{/each}}',
  '{{#if hasAnyJavaImports}}',
  '',
  '{{/if}}',
  'public {{#if isAbstract}}abstract {{/if}}{{#if isInterface}}interface{{else}}class{{/if}} {{name}}{{extendsClause}}{{implementsClause}} {',
  '',
  '{{#each staticAttrs}}',
  '    {{visKw}}static {{type}} {{name}}{{#if hasDefault}} = {{defaultValue}}{{/if}};',
  '{{/each}}',
  '{{#each instanceAttrs}}',
  '    {{visKw}}{{type}} {{name}}{{#if hasDefault}} = {{defaultValue}}{{/if}};{{#if assocNote}} // {{assocNote}}{{/if}}',
  '{{/each}}',
  '',
  '{{#unless isInterface}}',
  '    public {{name}}({{javaCtorParamsStr}}) {',
  '{{#if hasSuperCtorArgs}}',
  '        super({{superCallArgsStr}});',
  '{{/if}}',
  '{{#each instanceAttrs}}',
  '{{#if isCollection}}',
  '        this.{{name}} = new ArrayList<>();',
  '{{else}}',
  '        this.{{name}} = {{name}};',
  '{{/if}}',
  '{{/each}}',
  '    }',
  '',
  '{{/unless}}',
  '{{#each methods}}',
  '    {{visKw}}{{#if isStatic}}static {{/if}}{{#if bodiless}}abstract {{/if}}{{returnType}} {{name}}({{paramsStr}}){{#if bodiless}};{{else}} {',
  '        throw new UnsupportedOperationException("TODO: implement {{name}}");',
  '    }{{/if}}',
  '',
  '{{/each}}',
  '}',
  '{{/if}}',
  ''
].join('\n');

P.PYTHON_TEMPLATE = [
  '{{#if isEnum}}',
  'from enum import Enum, auto',
  '',
  '',
  'class {{name}}(Enum):',
  '{{#each enumValues}}',
  '    {{.}} = auto()',
  '{{/each}}',
  '{{else}}',
  'from __future__ import annotations',
  '{{#if needsAbc}}',
  'from abc import ABC, abstractmethod',
  '{{/if}}',
  /* same story as the Java ArrayList/List import above: editable text, but
     the field types that make needsTyping true ("List[X]") are decided in
     JS (toPyType() / classGenModel()'s assoc-field block), not here */
  '{{#if needsTyping}}',
  'from typing import List, Set, Dict',
  '{{/if}}',
  '{{#each pyImports}}',
  'from {{module}} import {{name}}',
  '{{/each}}',
  '',
  '',
  'class {{name}}{{#if hasPyBases}}({{pyBasesStr}}){{/if}}:',
  '',
  '{{#each staticAttrs}}',
  '    {{name}}: {{pyType}}{{#if hasDefault}} = {{defaultValue}}{{/if}}',
  '{{/each}}',
  '',
  '{{#unless isInterface}}',
  '    def __init__({{pyInitParamsStr}}):',
  '{{#if hasSuperCtorArgs}}',
  '        super().__init__({{pySuperCallArgsStr}})',
  '{{/if}}',
  '{{#each instanceAttrs}}',
  '{{#if isCollection}}',
  '        self.{{pyName}}: {{pyType}} = []{{#if assocNote}}  # {{assocNote}}{{/if}}',
  '{{else}}',
  '        self.{{pyName}} = {{pyParamName}}{{#if assocNote}}  # {{assocNote}}{{/if}}',
  '{{/if}}',
  '{{/each}}',
  '{{#unless hasCtorBody}}',
  '        pass',
  '{{/unless}}',
  '',
  '{{/unless}}',
  '{{#each methods}}',
  '{{#if isStatic}}',
  '    @staticmethod',
  '    def {{pyName}}({{#each params}}{{pyName}}: {{pyType}}{{#unless @last}}, {{/unless}}{{/each}}) -> {{pyReturnType}}:',
  '{{else}}',
  '{{#if bodiless}}',
  '    @abstractmethod',
  '{{/if}}',
  '    def {{pyName}}({{pyParamsStr}}) -> {{pyReturnType}}:',
  '{{/if}}',
  '{{#if bodiless}}',
  '        ...',
  '{{else}}',
  '        raise NotImplementedError("TODO: implement {{pyName}}")',
  '{{/if}}',
  '',
  '{{/each}}',
  '{{/if}}',
  ''
].join('\n');

/* ============================ PROJECT SCAFFOLDING (Maven / uv) ============================ */
/* These four are templates too (Mustache-like, same engine) — editable the
   same way as the class templates, just not exposed in the template editor
   pane by default since there's no per-class "preview" for them. */
P.POM_XML_TEMPLATE = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<project xmlns="http://maven.apache.org/POM/4.0.0"',
  '         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
  '         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">',
  '  <modelVersion>4.0.0</modelVersion>',
  '',
  '  <groupId>com.example</groupId>',
  '  <artifactId>{{slug}}</artifactId>',
  '  <version>1.0-SNAPSHOT</version>',
  '  <packaging>jar</packaging>',
  '',
  '  <properties>',
  '    <maven.compiler.release>17</maven.compiler.release>',
  '    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>',
  '  </properties>',
  '',
  '  <build>',
  '    <finalName>{{slug}}</finalName>',
  '  </build>',
  '</project>',
  ''
].join('\n');
var JAVA_GITIGNORE = 'target/\n*.class\n.idea/\n*.iml\n';
P.JAVA_README_TEMPLATE = [
  '# {{slug}}',
  '',
  'Generated by [PlantUML Studio](https://blog.mathieuacher.com/plantuml-studio/) from a class diagram.',
  '',
  '## Build & run',
  '',
  '```sh',
  'mvn compile',
  '```',
  '',
  'Classes (default package, `src/main/java/`):',
  '',
  '{{#each classNames}}',
  '- `{{.}}`',
  '{{/each}}',
  '',
  'Method bodies are stubs (`throw new UnsupportedOperationException(...)`) — fill them in.',
  ''
].join('\n');

P.PYPROJECT_TOML_TEMPLATE = [
  '[project]',
  'name = "{{slug}}"',
  'version = "0.1.0"',
  'description = "Generated by PlantUML Studio from a class diagram"',
  'readme = "README.md"',
  'requires-python = ">=3.12"',
  'dependencies = []',
  ''
].join('\n');
var PY_GITIGNORE = '# Python-generated files\n__pycache__/\n*.py[oc]\nbuild/\ndist/\nwheels/\n*.egg-info\n\n# Virtual environments\n.venv\n';
P.PY_README_TEMPLATE = [
  '# {{slug}}',
  '',
  'Generated by [PlantUML Studio](https://blog.mathieuacher.com/plantuml-studio/) from a class diagram.',
  '',
  '## Run',
  '',
  '```sh',
  'uv run main.py',
  '```',
  '',
  '`uv` downloads and pins the right Python version and creates `.venv`',
  'automatically — no separate install step needed.',
  '',
  'Classes:',
  '',
  '{{#each classNames}}',
  '- `{{.}}`',
  '{{/each}}',
  '',
  'Method bodies are stubs (`raise NotImplementedError(...)`) — fill them in.',
  ''
].join('\n');
P.PY_MAIN_TEMPLATE = [
  '{{#if firstClass}}',
  'from {{firstModule}} import {{firstClass}}',
  '',
  '',
  '{{/if}}',
  'def main():',
  '{{#if firstClass}}',
  '    # TODO: replace with real arguments',
  '    # example = {{firstClass}}(...)',
  '    pass',
  '{{else}}',
  '    pass',
  '{{/if}}',
  '',
  '',
  'if __name__ == "__main__":',
  '    main()',
  ''
].join('\n');

function slugify(name) {
  var s = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'plantuml-project';
}

/* ============================ ENTRY POINT ============================ */
/* Returns [{className, filename, code}] — one file per top-level
   class/interface/enum. lang: 'java' | 'python'. */
P.genCode = function (model, template, lang) {
  var gm = P.classGenModel(model);
  return gm.classes.map(function (c) {
    var code = P.tmplRender(template, c);
    var filename = lang === 'python' ? camelToSnake(c.name) + '.py' : c.name + '.java';
    return { className: c.name, filename: filename, code: code };
  });
};

/* A full, buildable project: pom.xml + src/main/java/*.java (Maven), or
   pyproject.toml + *.py + main.py (uv — a flat "app" layout, the same one
   `uv init` produces without --package, so uv run/uv sync work unmodified).
   Returns {zipName, files: [{path, content}]}. */
P.genProject = function (model, template, lang, projectName) {
  var slug = slugify(projectName);
  var classFiles = P.genCode(model, template, lang);
  var classNames = classFiles.map(function (f) { return f.className; });
  var files = [];
  if (lang === 'python') {
    files.push({ path: 'pyproject.toml', content: P.tmplRender(P.PYPROJECT_TOML_TEMPLATE, { slug: slug }) });
    files.push({ path: '.python-version', content: '3.12\n' });
    files.push({ path: '.gitignore', content: PY_GITIGNORE });
    files.push({ path: 'README.md', content: P.tmplRender(P.PY_README_TEMPLATE, { slug: slug, classNames: classNames }) });
    /* pick a concrete, instantiable class for the illustrative import — an
       interface or abstract class would make a misleading first example */
    var gm = P.classGenModel(model);
    var concreteIdx = -1;
    for (var i = 0; i < gm.classes.length; i++) { if (gm.classes[i].isClass) { concreteIdx = i; break; } }
    var first = classFiles[concreteIdx >= 0 ? concreteIdx : 0];
    files.push({ path: 'main.py', content: P.tmplRender(P.PY_MAIN_TEMPLATE, first ? { firstClass: first.className, firstModule: camelToSnake(first.className) } : {}) });
    classFiles.forEach(function (f) { files.push({ path: f.filename, content: f.code }); });
  } else {
    files.push({ path: 'pom.xml', content: P.tmplRender(P.POM_XML_TEMPLATE, { slug: slug }) });
    files.push({ path: '.gitignore', content: JAVA_GITIGNORE });
    files.push({ path: 'README.md', content: P.tmplRender(P.JAVA_README_TEMPLATE, { slug: slug, classNames: classNames }) });
    classFiles.forEach(function (f) { files.push({ path: 'src/main/java/' + f.filename, content: f.code }); });
  }
  return { zipName: slug + '-' + lang + '.zip', files: files };
};

/* Convenience: build the project AND zip it in one call. */
P.genProjectZip = function (model, template, lang, projectName) {
  var proj = P.genProject(model, template, lang, projectName);
  return { zipName: proj.zipName, data: P.makeZip(proj.files.map(function (f) { return { name: f.path, data: f.content }; })) };
};

P.camelToSnake = camelToSnake;
P.toPyType = toPyType;

})(PUML);

/* PlantUML Studio — compile entry point, examples, syntax reference. */
'use strict';
(function (P) {

P.TYPES = {
  class:    { label: 'Class diagram',    parse: function (l, m) { return P.parseClass(l, m); },    render: function (mo, M, me) { return P.renderClass(mo, M, me); } },
  object:   { label: 'Object diagram',   parse: function (l, m) { return P.parseObject(l, m); },   render: function (mo, M, me) { return P.renderObject(mo, M, me); } },
  sequence: { label: 'Sequence diagram', parse: function (l, m) { return P.parseSequence(l, m); }, render: function (mo, M, me) { return P.renderSequence(mo, M, me); } },
  usecase:  { label: 'Use case diagram', parse: function (l, m) { return P.parseUsecase(l, m); },  render: function (mo, M, me) { return P.renderUsecase(mo, M, me); } },
  state:    { label: 'State diagram',    parse: function (l, m) { return P.parseState(l, m); },    render: function (mo, M, me) { return P.renderState(mo, M, me); } }
};

var SEV_RANK = { error: 0, warning: 1, info: 2 };

P.compile = function (text, opts) {
  opts = opts || {};
  var M = opts.measure || P.defaultMeasure;
  var pre = P.preprocess(text);
  pre.meta.posOverrides = P.extractPosOverrides(text);
  var diags = pre.diagnostics.slice();
  var det = P.detectType(pre.lines, pre.meta);
  var type = (opts.type && opts.type !== 'auto') ? opts.type : det.type;
  if (!type && pre.lines.length) {
    type = 'class';
    diags.push(P.d('info', pre.lines[0].n, 'Diagram type not detected — defaulting to a class diagram. Declare elements explicitly (class, object, participant, usecase, state) or set the type manually.'));
  }

  var out = { type: type || null, detected: det.type, scores: det.scores, svg: null,
              width: 0, height: 0, diagnostics: diags, valid: true, title: pre.meta.title || null,
              empty: !pre.lines.length };

  if (type && pre.lines.length) {
    var run = function () {
      var T = P.TYPES[type];
      var parsed = T.parse(pre.lines, pre.meta);
      parsed.diagnostics.forEach(function (d) { diags.push(d); });
      var r = T.render(parsed.model, M, pre.meta);
      var pad = 14;
      var w = r.w + pad * 2, h = r.h + pad * 2, topExtra = 0;
      var body = '';
      if (pre.meta.title) {
        var titleLines = String(pre.meta.title).split('\n');
        topExtra = titleLines.length * 20 + 10;
        titleLines.forEach(function (tl, i) {
          body += P.S.text(w / 2, 20 + i * 20, tl, { size: 15, bold: true, anchor: 'middle' });
        });
        w = Math.max(w, M(pre.meta.title, 15, { bold: true }) + 40);
      }
      body += '<g transform="translate(' + pad + ',' + (pad + topExtra) + ')">' + r.body + '</g>';
      out.svg = P.svgDoc(w, h + topExtra, body);
      out.width = Math.max(80, Math.ceil(w));
      out.height = Math.max(50, Math.ceil(h + topExtra));
      out.model = parsed.model;
    };
    if (opts.strict) run();
    else {
      try { run(); }
      catch (e) { diags.push(P.d('error', 0, 'Internal renderer error: ' + (e && e.message ? e.message : e))); }
    }
  }

  diags.sort(function (a, b) {
    return (a.line || 0) - (b.line || 0) || SEV_RANK[a.severity] - SEV_RANK[b.severity];
  });
  out.valid = !diags.some(function (x) { return x.severity === 'error'; });
  return out;
};

/* ============================ EXAMPLES ============================ */
P.EXAMPLES = [
{ name: 'Class — Library', type: 'class', code: [
'@startuml',
'title Library — domain model',
'',
"' The classic teaching example: inheritance, interface,",
"' enum, composition and a note.",
'',
'interface Borrowable {',
'  +checkOut(m: Member): Loan',
'  +return(): void',
'}',
'',
'abstract class Media {',
'  #title: String',
'  #year: int',
'  +{abstract} describe(): String',
'}',
'',
'class Book extends Media implements Borrowable {',
'  -isbn: String',
'  -pages: int',
'  +describe(): String',
'}',
'',
'class DVD extends Media implements Borrowable {',
'  -runtime: int',
'  +describe(): String',
'}',
'',
'enum Genre {',
'  NOVEL',
'  ESSAY',
'  DOCUMENTARY',
'}',
'',
'class Library {',
'  -name: String',
'  +register(m: Member): void',
'}',
'',
'class Member {',
'  -memberId: String',
'}',
'',
'class Loan {',
'  -dueDate: Date',
'}',
'',
'Library "1" *-- "0..*" Media : owns',
'Media --> Genre',
'Member "1" -- "0..*" Loan : borrows >',
'Loan "0..*" -- "1" Media',
'',
'note right of Library : Aggregate root.\\nOwns the media collection.',
'@enduml'].join('\n') },

{ name: 'Object — Library instances', type: 'object', code: [
'@startuml',
'title A small library, as objects',
'',
'object lib {',
'  name = "BU Beaulieu"',
'}',
'',
'object book1 {',
'  title = "Le Petit Prince"',
'  isbn = "978-2070612758"',
'}',
'',
'object book2 {',
'  title = "Candide"',
'}',
'',
'object alice {',
'  memberId = "M-0042"',
'}',
'',
'object loan1',
'loan1 : dueDate = 2026-09-15',
'',
'lib *-- book1',
'lib *-- book2',
'alice -- loan1 : borrows',
'loan1 -- book1',
'@enduml'].join('\n') },

{ name: 'Sequence — Check out a book', type: 'sequence', code: [
'@startuml',
'title Checking out a book',
'autonumber',
'',
'actor Member',
'participant "Library UI" as UI',
'participant Catalog',
'database Loans',
'',
'Member -> UI : checkOut("Candide")',
'activate UI',
'UI -> Catalog : findBook(title)',
'activate Catalog',
'Catalog --> UI : book',
'deactivate Catalog',
'',
'alt book available',
'  UI -> Loans ++ : createLoan(book, member)',
'  Loans --> UI -- : loan',
'  UI --> Member : due date',
'else book already on loan',
'  UI --> Member : sorry, on loan',
'end',
'deactivate UI',
'',
'note right of Loans : Loans are kept\\nfor two weeks.',
'@enduml'].join('\n') },

{ name: 'Use case — Library system', type: 'usecase', code: [
'@startuml',
'title Library — use cases',
'left to right direction',
'',
'actor Member',
'actor Librarian',
'actor "Guest" as Guest',
'',
'rectangle "Library system" {',
'  usecase "Borrow a book" as Borrow',
'  usecase "Return a book" as Return',
'  usecase "Search catalog" as Search',
'  usecase "Register member" as Register',
'  usecase "Authenticate" as Auth',
'}',
'',
'Member --> Borrow',
'Member --> Return',
'Member --> Search',
'Guest --> Search',
'Librarian --> Register',
'Borrow ..> Auth : include',
'Return ..> Auth : include',
'Guest --|> Member',
'@enduml'].join('\n') },

{ name: 'State — Loan lifecycle', type: 'state', code: [
'@startuml',
'title Loan lifecycle',
'',
'[*] --> Requested',
'Requested --> Active : approve',
'Requested --> [*] : reject',
'',
'state Active {',
'  [*] --> OnTime',
'  OnTime --> Overdue : due date passed',
'  Overdue --> OnTime : renew',
'}',
'',
'Active : book is out of the library',
'Active --> Returned : bring back',
'Overdue --> Lost : 90 days late',
'Returned --> [*]',
'Lost --> [*]',
'',
'note right of Lost : Member is billed\\nfor the book.',
'@enduml'].join('\n') },

{ name: 'Broken — validation demo', type: 'class', code: [
'@startuml',
"' This file is intentionally wrong — look at the Problems panel.",
'',
'clas Vehicle',
'',
'class Car {',
'  -speed: int',
'  +drive(): void',
'',
'class Car {',
'  +brake(): void',
'}',
'',
'Car --|> Vehicle',
'Wheel "4" --* Car',
'',
'note left of Truck : truck is never declared'].join('\n') },

{ name: 'Blank', type: null, code: '@startuml\n\n@enduml' }
];

/* ============================ SYNTAX REFERENCE ============================ */
P.REFERENCE = {
  class: [
    { h: 'Declarations', rows: [
      ['class Car', 'a class'],
      ['abstract class Shape', 'abstract class (italic name)'],
      ['interface Drivable', 'interface'],
      ['enum Color { RED\\nGREEN }', 'enumeration with literals'],
      ['class "Nice name" as C1', 'display name + alias'],
      ['class Car <<entity>>', 'stereotype'],
      ['class Box<T>', 'generics'],
      ['package Vehicles { … }', 'group classes in a package']] },
    { h: 'Members', rows: [
      ['class Car {\\n  -speed: int\\n  +drive(): void\\n}', 'attributes and methods (parentheses ⇒ method)'],
      ['+ public   - private', 'visibility markers'],
      ['# protected   ~ package', 'visibility markers'],
      ['{static} count: int', 'underlined (static)'],
      ['{abstract} area(): double', 'italic (abstract)'],
      ['Car : +honk()', 'add a member from outside'],
      ['--  ..  ==  __', 'compartment separators inside { }']] },
    { h: 'Relationships', rows: [
      ['Car --|> Vehicle', 'inheritance (extends)'],
      ['Car ..|> Drivable', 'realization (implements)'],
      ['Car --> Engine', 'directed association'],
      ['Car -- Driver', 'association'],
      ['Car *-- Wheel', 'composition'],
      ['Team o-- Player', 'aggregation'],
      ['Car ..> Fuel', 'dependency'],
      ['A "1" -- "0..*" B : label', 'multiplicities + label'],
      ['A -> B', 'short arrow: same rank (side by side)'],
      ['class A extends B', 'inline inheritance']] },
    { h: 'Notes', rows: [
      ['note right of Car : text', 'attached note (left/right/top/bottom)'],
      ['note left of Car\\n  line 1\\n  line 2\\nend note', 'multi-line note']] }
  ],
  object: [
    { h: 'Objects', rows: [
      ['object alice', 'an object (underlined name)'],
      ['object "alice: Member" as a1', 'display name + alias'],
      ['object alice {\\n  id = 42\\n}', 'fields in a block'],
      ['alice : name = "Alice"', 'add a field from outside']] },
    { h: 'Links', rows: [
      ['alice -- loan1', 'link'],
      ['alice --> loan1 : borrows', 'directed link with label'],
      ['lib *-- book1', 'composition link'],
      ['note right of alice : text', 'attached note']] }
  ],
  sequence: [
    { h: 'Participants', rows: [
      ['participant Service', 'a participant (box)'],
      ['actor User', 'stick figure'],
      ['database Store', 'database cylinder'],
      ['participant "Nice name" as S', 'display name + alias'],
      ['boundary / control / entity …', 'drawn as plain boxes here']] },
    { h: 'Messages', rows: [
      ['A -> B : request', 'synchronous message'],
      ['A --> B : reply', 'dashed reply'],
      ['A ->> B : async', 'asynchronous (open arrow)'],
      ['B <- A : same as A -> B', 'reversed syntax'],
      ['A -> A : think', 'self message'],
      ['A -> B ++ : call', 'activate B on arrival'],
      ['B --> A -- : done', 'deactivate B on send'],
      ['return result', 'reply + deactivate in one'],
      ['autonumber', 'number the messages']] },
    { h: 'Activation & lifecycle', rows: [
      ['activate B / deactivate B', 'explicit activation bar'],
      ['destroy B', 'X on the lifeline'],
      ['hide footbox', 'no repeated boxes at the bottom']] },
    { h: 'Structure', rows: [
      ['alt cond … else … end', 'alternatives'],
      ['opt cond … end', 'optional block'],
      ['loop n times … end', 'loop'],
      ['par … else … end', 'parallel'],
      ['group MyLabel … end', 'named group'],
      ['ref over A,B : see other diagram', 'reference fragment'],
      ['== Phase two ==', 'divider'],
      ['... 5 minutes later ...', 'delay'],
      ['note right of A : text', 'note (left/right/over A,B)']] }
  ],
  usecase: [
    { h: 'Elements', rows: [
      ['actor Member', 'an actor'],
      ['actor :Nice name: as M', 'actor with display name'],
      ['usecase "Borrow a book" as UC1', 'use case with alias'],
      ['(Borrow a book)', 'use case, shorthand'],
      [':Member:', 'actor, shorthand'],
      ['rectangle "System" { … }', 'system boundary']] },
    { h: 'Relationships', rows: [
      ['Member --> (Borrow)', 'actor uses a use case'],
      ['(Borrow) ..> (Authenticate) : include', '«include»'],
      ['(Renew) ..> (Borrow) : extend', '«extend»'],
      ['Guest --|> Member', 'actor generalization'],
      ['left to right direction', 'recommended layout hint']] }
  ],
  state: [
    { h: 'States & transitions', rows: [
      ['[*] --> Idle', 'initial state'],
      ['Idle --> Running : start', 'transition with event'],
      ['Running --> [*]', 'final state'],
      ['state "Long name" as S1', 'display name + alias'],
      ['Running : counting up', 'internal description'],
      ['A -> B', 'short arrow: side by side']] },
    { h: 'Composite & pseudo-states', rows: [
      ['state Active {\\n  [*] --> Warm\\n}', 'composite state with its own region'],
      ['state c <<choice>>', 'choice (diamond)'],
      ['state f <<fork>>  /  <<join>>', 'fork / join bars'],
      ['note right of Idle : text', 'attached note']] }
  ]
};

})(PUML);
if (typeof module !== 'undefined' && module.exports) module.exports = PUML;
