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
