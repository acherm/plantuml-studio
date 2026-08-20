/* PlantUML Studio — app layer (DOM). The core (PUML) is pure and DOM-free. */
(function () {
'use strict';
var $ = function (id) { return document.getElementById(id); };
var elCode = $('code'), elHl = $('hl'), elGutter = $('gutter');
var elViewport = $('viewport'), elCanvas = $('canvas'), elPlaceholder = $('placeholder');
var elVpStudio = $('vpStudio'), elVpOfficial = $('vpOfficial');
var elSquig = $('squig'), elCpop = $('cpop'), elEtip = $('etip'), elOffStatus = $('status');
var EDT_LH = 20.8, EDT_PT = 10, EDT_PL = 14; /* editor line-height & padding (must match CSS) */
var elProblems = $('problems'), elProblemsList = $('problemsList'), elProblemsCnt = $('problemsCnt');
var elPill = $('statusPill'), elCounts = $('statusCounts'), elType = $('statusType'), elPos = $('statusPos');
var elErrBadge = $('errBadge');
var LS_DOC = 'plantuml-studio.doc', LS_TYPE = 'plantuml-studio.type', LS_SPLIT = 'plantuml-studio.split';

/* ---------------- text measurement (canvas) ---------------- */
var mCanvas = document.createElement('canvas');
var mCtx = mCanvas.getContext('2d');
var mCache = new Map();
function measure(text, size, o) {
  o = o || {};
  var font = (o.italic ? 'italic ' : '') + (o.bold ? '600 ' : '400 ') + size + 'px ' +
    (o.mono ? "'IBM Plex Mono',ui-monospace,Menlo,Consolas,monospace" : "'IBM Plex Sans','Segoe UI',system-ui,sans-serif");
  var key = font + '\u0000' + text;
  var v = mCache.get(key);
  if (v == null) {
    mCtx.font = font;
    v = mCtx.measureText(String(text == null ? '' : text)).width;
    if (mCache.size > 30000) mCache.clear();
    mCache.set(key, v);
  }
  return v;
}
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(function () { mCache.clear(); compileNow(); });
}

/* ---------------- syntax highlighting ---------------- */
var KW = ['abstract class', 'abstract', 'class', 'interface', 'enum', 'annotation', 'entity', 'struct', 'object', 'map',
  'participant', 'actor', 'boundary', 'control', 'database', 'collections', 'queue',
  'activate', 'deactivate', 'destroy', 'create', 'return', 'autonumber',
  'alt', 'else', 'opt', 'loop', 'par', 'break', 'critical', 'group', 'end note', 'end title', 'end legend', 'end',
  'note', 'hnote', 'rnote', 'ref', 'over', 'left to right direction', 'top to bottom direction',
  'left', 'right', 'top', 'bottom', 'of', 'as', 'usecase', 'rectangle', 'state', 'package', 'namespace',
  'title', 'caption', 'header', 'footer', 'legend', 'skinparam', 'skin', 'hide', 'show', 'remove', 'scale',
  'extends', 'implements', 'order', 'newpage'];
var HL_RE = new RegExp(
  "('.*$)" +
  '|("[^"]*"?)' +
  '|(<<[^>]*>>)' +
  '|(@\\w+)' +
  '|(\\b(?:' + KW.map(function (k) { return k.replace(/ /g, '\\s+'); }).join('|') + ')\\b)' +
  '|((?:<\\||<<|<|\\*|o(?![\\w])|x(?![\\w]))?[-.=~]{1,}(?:\\|>|>>|>|\\*|o|x)?|\\[\\*\\])' +
  '|(\\b\\d+(?:\\.\\d+)?\\b)',
  'g');
var esc = PUML.esc;

function hlLine(line) {
  var out = '', last = 0, m;
  HL_RE.lastIndex = 0;
  while ((m = HL_RE.exec(line))) {
    if (m.index > last) out += plainSeg(line.slice(last, m.index));
    var cls = m[1] ? 'tk-cm' : m[2] ? 'tk-str' : m[3] ? 'tk-st' : m[4] ? 'tk-tag' : m[5] ? 'tk-kw' : m[6] ? 'tk-arrow' : 'tk-num';
    out += '<span class="' + cls + '">' + esc(m[0]) + '</span>';
    last = m.index + m[0].length;
    if (m[0].length === 0) HL_RE.lastIndex++;
  }
  out += plainSeg(line.slice(last));
  return out;
}

var lineSev = new Map();
var lineDiags = new Map();
var identSet = new Set(), identList = [];
function plainSeg(seg) {
  var e = esc(seg);
  if (!identSet.size) return e;
  return e.replace(/[A-Za-z_$][\w.$]*/g, function (w) {
    return identSet.has(w) ? '<span class="tk-id">' + w + '</span>' : w;
  });
}
function renderHighlight() {
  var lines = elCode.value.split('\n');
  var html = '';
  for (var i = 0; i < lines.length; i++) {
    var sev = lineSev.get(i + 1);
    var cls = sev === 'error' ? ' e-err' : sev === 'warning' ? ' e-warn' : '';
    html += '<span class="hline' + cls + '">' + (hlLine(lines[i]) || ' ') + '</span>';
  }
  elHl.innerHTML = html + '<span class="hline"> </span>';
  var g = '';
  for (i = 0; i < lines.length; i++) {
    var sev2 = lineSev.get(i + 1);
    var gc = sev2 === 'error' ? ' err' : sev2 === 'warning' ? ' warn' : sev2 === 'info' ? ' info' : '';
    var ds0 = lineDiags.get(i + 1);
    var ttl = ds0 ? ' title="' + esc(ds0.map(function (d) { return d.message; }).join('\n')) + '"' : '';
    g += '<div class="gl' + gc + '"' + ttl + '>' + (sev2 ? '<span class="dot"></span>' : '') + (i + 1) + '</div>';
  }
  elGutter.innerHTML = g;

  /* column-precise squiggles */
  var charW = measure('0', 13, { mono: true });
  var sq = '';
  lineDiags.forEach(function (ds, lnum) {
    ds.forEach(function (d) {
      if (!d.col) return;
      var cls = d.severity === 'error' ? 'err' : d.severity === 'warning' ? 'warn' : 'info';
      sq += '<i class="sq ' + cls + '" style="left:' + P_round(EDT_PL + (d.col - 1) * charW) +
        'px;top:' + P_round((lnum - 1) * EDT_LH + EDT_PT + 16.5) + 'px;width:' + P_round(Math.max(d.len || 1, 1) * charW) + 'px"></i>';
    });
  });
  elSquig.innerHTML = sq;
  syncScroll();
}
function P_round(v) { return Math.round(v * 10) / 10; }

function syncScroll() {
  elHl.scrollTop = elCode.scrollTop;
  elHl.scrollLeft = elCode.scrollLeft;
  elGutter.style.transform = 'translateY(' + (-elCode.scrollTop) + 'px)';
  elSquig.style.transform = 'translate(' + (-elCode.scrollLeft) + 'px,' + (-elCode.scrollTop) + 'px)';
}
elCode.addEventListener('scroll', function () { syncScroll(); hideCpop(); hideEtip(); });

/* ---------------- compile ---------------- */
var compileTimer = null, lastResult = null;
var view = { zoom: 1, x: 0, y: 0, touched: false };

function schedule() {
  clearTimeout(compileTimer);
  compileTimer = setTimeout(compileNow, 170);
}

function compileNow() {
  var text = elCode.value;
  var type = $('selType').value;
  var res = PUML.compile(text, { measure: measure, type: type });
  lastResult = res;

  lineSev.clear();
  lineDiags.clear();
  var counts = { error: 0, warning: 0, info: 0 };
  res.diagnostics.forEach(function (d) {
    counts[d.severity]++;
    if (d.line) {
      if (!lineDiags.has(d.line)) lineDiags.set(d.line, []);
      lineDiags.get(d.line).push(d);
    }
    var prev = lineSev.get(d.line);
    var rank = { error: 0, warning: 1, info: 2 };
    if (!prev || rank[d.severity] < rank[prev]) lineSev.set(d.line, d.severity);
  });
  identList = PUML.collectIdents(res.model, res.type);
  identSet = new Set(identList.map(function (x) { return x.name; }));

  renderHighlight();
  renderProblems(res, counts);
  renderStatus(res, counts);
  renderPreview(res, counts);
  if (renderMode === 'plantuml') scheduleOfficial();
  if (codeModal && !codeModal.classList.contains('hidden')) regenerateCode();
  try { localStorage.setItem(LS_DOC, text); localStorage.setItem(LS_TYPE, type); } catch (e) {}
}

function renderProblems(res, counts) {
  elProblemsList.innerHTML = '';
  if (!res.diagnostics.length) {
    var li = document.createElement('li');
    li.className = 'ok-row';
    li.textContent = res.empty ? 'The document is empty.' : 'No problems — the model is well-formed.';
    elProblemsList.appendChild(li);
  } else {
    res.diagnostics.forEach(function (d) {
      var li2 = document.createElement('li');
      var sev = document.createElement('span');
      sev.className = 'sev ' + (d.severity === 'error' ? 'err' : d.severity === 'warning' ? 'warn' : 'info');
      var ln = document.createElement('span');
      ln.className = 'lnum';
      ln.textContent = d.line ? 'L' + d.line : '—';
      var msg = document.createElement('span');
      msg.textContent = d.message;
      li2.appendChild(sev); li2.appendChild(ln); li2.appendChild(msg);
      if (d.fix) {
        var fb = document.createElement('button');
        fb.className = 'fixbtn';
        fb.textContent = 'Fix';
        fb.title = d.fix.title || 'Apply the suggested fix';
        (function (fix) {
          fb.addEventListener('click', function (ev) { ev.stopPropagation(); applyFix(fix); });
        })(d.fix);
        li2.appendChild(fb);
      }
      if (d.line) li2.addEventListener('click', function () { gotoLine(d.line); });
      elProblemsList.appendChild(li2);
    });
  }
  var parts = [];
  if (counts.error) parts.push(counts.error + ' error' + (counts.error > 1 ? 's' : ''));
  if (counts.warning) parts.push(counts.warning + ' warning' + (counts.warning > 1 ? 's' : ''));
  if (counts.info) parts.push(counts.info + ' hint' + (counts.info > 1 ? 's' : ''));
  elProblemsCnt.textContent = parts.length ? '— ' + parts.join(', ') : '';
}

function renderStatus(res, counts) {
  if (counts.error) {
    elPill.className = 'pill err';
    elPill.textContent = 'Invalid — ' + counts.error + ' error' + (counts.error > 1 ? 's' : '');
  } else if (counts.warning) {
    elPill.className = 'pill warn';
    elPill.textContent = 'Valid, with warnings';
  } else {
    elPill.className = 'pill ok';
    elPill.textContent = res.empty ? 'Empty' : 'Valid';
  }
  var t = [];
  if (counts.warning) t.push(counts.warning + ' warning' + (counts.warning > 1 ? 's' : ''));
  if (counts.info) t.push(counts.info + ' hint' + (counts.info > 1 ? 's' : ''));
  elCounts.textContent = t.join(' · ');
  var sel = $('selType').value;
  elType.textContent = res.type
    ? PUML.TYPES[res.type].label + (sel === 'auto' ? ' (auto)' : '')
    : '';
}

function renderPreview(res, counts) {
  if (res.svg) {
    elVpStudio.innerHTML = res.svg;
    elPlaceholder.classList.add('hidden');
    elCanvas.classList.toggle('invalid', counts.error > 0);
    if (counts.error > 0) {
      elErrBadge.textContent = counts.error + ' error' + (counts.error > 1 ? 's' : '') + ' — see Problems';
      elErrBadge.classList.remove('hidden');
    } else {
      elErrBadge.classList.add('hidden');
    }
    if (!view.touched && renderMode === 'studio') fit();
  } else {
    elVpStudio.innerHTML = '';
    if (renderMode === 'studio') elPlaceholder.classList.remove('hidden');
    elErrBadge.classList.add('hidden');
    elCanvas.classList.remove('invalid');
  }
}

/* ---------------- pan & zoom ---------------- */
function applyView() {
  elViewport.style.transform = 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.zoom + ')';
}
function activeSize() {
  if (renderMode === 'plantuml' && officialSize) return officialSize;
  if (lastResult && lastResult.svg) return { w: lastResult.width, h: lastResult.height };
  return null;
}
function fit() {
  var sz = activeSize();
  if (!sz) return;
  var cw = elCanvas.clientWidth, ch = elCanvas.clientHeight;
  var w = sz.w, h = sz.h;
  if (!w || !h || !cw || !ch) return;
  var z = Math.min((cw - 48) / w, (ch - 48) / h, 1.6);
  z = Math.max(z, 0.05);
  view.zoom = z;
  view.x = (cw - w * z) / 2;
  view.y = (ch - h * z) / 2;
  applyView();
}
function zoomAt(cx, cy, factor) {
  var nz = Math.min(6, Math.max(0.05, view.zoom * factor));
  factor = nz / view.zoom;
  view.x = cx - (cx - view.x) * factor;
  view.y = cy - (cy - view.y) * factor;
  view.zoom = nz;
  view.touched = true;
  applyView();
}
elCanvas.addEventListener('wheel', function (e) {
  e.preventDefault();
  var r = elCanvas.getBoundingClientRect();
  zoomAt(e.clientX - r.left, e.clientY - r.top, Math.pow(1.0015, -e.deltaY));
}, { passive: false });

var pan = null;
elCanvas.addEventListener('pointerdown', function (e) {
  if (e.button !== 0) return;
  pan = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
  elCanvas.setPointerCapture(e.pointerId);
  elCanvas.classList.add('panning');
});
elCanvas.addEventListener('pointermove', function (e) {
  if (!pan) return;
  var dx = e.clientX - pan.x, dy = e.clientY - pan.y;
  if (Math.abs(dx) + Math.abs(dy) > 3) pan.moved = true;
  view.x = pan.vx + dx;
  view.y = pan.vy + dy;
  if (pan.moved) view.touched = true;
  applyView();
});
['pointerup', 'pointercancel'].forEach(function (ev) {
  elCanvas.addEventListener(ev, function () { pan = null; elCanvas.classList.remove('panning'); });
});
elCanvas.addEventListener('dblclick', function () { view.touched = false; fit(); });
$('zIn').addEventListener('click', function () { zoomAt(elCanvas.clientWidth / 2, elCanvas.clientHeight / 2, 1.25); });
$('zOut').addEventListener('click', function () { zoomAt(elCanvas.clientWidth / 2, elCanvas.clientHeight / 2, 0.8); });
$('zFit').addEventListener('click', function () { view.touched = false; fit(); });
$('z100').addEventListener('click', function () {
  var sz = activeSize();
  view.zoom = 1; view.touched = true;
  view.x = Math.max(24, (elCanvas.clientWidth - (sz ? sz.w : 0)) / 2);
  view.y = 24;
  applyView();
});
window.addEventListener('resize', function () { if (!view.touched) fit(); });

/* ---------------- graphical bi-sync editing ----------------
   The rendered SVG is a pure function of the text (see P.compile). These
   handlers never touch a separate diagram model — every interaction reads
   the node's data-* attributes off the SVG the renderer already produced,
   then rewrites elCode.value with a text-surgical core helper and
   recompiles. Click navigates; drag persists a position via an
   auto-managed `' @pos id x,y` comment (an ordinary PlantUML comment, so
   the source stays valid outside this editor too); double-click renames
   the identifier everywhere it's referenced. */
function svgNodeAt(target) { return target && target.closest ? target.closest('.pu-node') : null; }

var selectedNodeG = null;
function clearNodeSelection() { if (selectedNodeG) selectedNodeG.classList.remove('pu-selected'); selectedNodeG = null; }
function selectNode(g) { clearNodeSelection(); selectedNodeG = g; g.classList.add('pu-selected'); }

var dragState = null, justDragged = false;
elVpStudio.addEventListener('pointerdown', function (e) {
  if (e.button !== 0) return;
  var g = svgNodeAt(e.target);
  if (!g || g.getAttribute('data-draggable') !== '1') return;
  e.stopPropagation();
  dragState = {
    g: g, pointerId: e.pointerId, moved: false,
    startX: e.clientX, startY: e.clientY,
    origX: parseFloat(g.getAttribute('data-x')) || 0,
    origY: parseFloat(g.getAttribute('data-y')) || 0
  };
  g.classList.add('pu-dragging');
  try { g.setPointerCapture(e.pointerId); } catch (err) {}
});
elVpStudio.addEventListener('pointermove', function (e) {
  if (!dragState || e.pointerId !== dragState.pointerId) return;
  var dx = (e.clientX - dragState.startX) / view.zoom;
  var dy = (e.clientY - dragState.startY) / view.zoom;
  if (Math.abs(dx) + Math.abs(dy) > 2) dragState.moved = true;
  dragState.dx = dx; dragState.dy = dy;
  dragState.g.setAttribute('transform', 'translate(' + dx + ',' + dy + ')');
});
function endNodeDrag() {
  if (!dragState) return;
  var g = dragState.g;
  g.classList.remove('pu-dragging');
  g.removeAttribute('transform');
  if (dragState.moved) {
    justDragged = true;
    var id = g.getAttribute('data-node');
    elCode.value = PUML.upsertPosOverride(elCode.value, id, dragState.origX + dragState.dx, dragState.origY + dragState.dy);
    compileNow();
  }
  dragState = null;
}
elVpStudio.addEventListener('pointerup', endNodeDrag);
elVpStudio.addEventListener('pointercancel', endNodeDrag);

elVpStudio.addEventListener('click', function (e) {
  if (justDragged) { justDragged = false; return; }
  var g = svgNodeAt(e.target);
  if (!g) { clearNodeSelection(); return; }
  selectNode(g);
  var line = g.getAttribute('data-line');
  if (line) gotoLine(+line);
});

function startNodeRename(g) {
  var id = g.getAttribute('data-node');
  if (!id || id.charAt(0) === '@') return; /* notes and pseudo-states have no user-facing name to rename */
  var rect = g.getBoundingClientRect();
  var inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'pu-rename-input';
  inp.value = id;
  inp.spellcheck = false;
  inp.style.left = rect.left + 'px';
  inp.style.top = rect.top + 'px';
  inp.style.width = Math.max(rect.width, 70) + 'px';
  document.body.appendChild(inp);
  inp.focus();
  inp.select();
  var done = false;
  function commit() {
    if (done) return;
    done = true;
    var newName = inp.value.trim();
    inp.remove();
    if (!newName || newName === id) return;
    /* class/object/state names are bare identifiers, word-boundary renamed;
       use-case/actor names are usually free natural-language text
       (`(Borrow a book)`, `:Some Actor:`) with no separate identifier to
       match, so they need the label-delimiter-aware transform instead */
    var isPlainIdentifier = /^[A-Za-z_$][\w.$]*$/.test(id);
    var result = isPlainIdentifier ? PUML.renameIdentifier(elCode.value, id, newName) : PUML.renameLabel(elCode.value, id, newName);
    if (result.error) { toast(result.error); return; }
    elCode.value = result.text;
    compileNow();
    toast("Renamed '" + id + "' to '" + newName + "'");
  }
  inp.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); done = true; inp.remove(); }
    e.stopPropagation();
  });
  inp.addEventListener('blur', commit);
}
elVpStudio.addEventListener('dblclick', function (e) {
  var g = svgNodeAt(e.target);
  if (!g) return;
  e.preventDefault();
  startNodeRename(g);
});

/* ---------------- editor behaviour ---------------- */
elCode.addEventListener('input', function () { renderHighlight(); schedule(); updatePos(); maybeComplete(false); });
elCode.addEventListener('keydown', function (e) {
  if (cpopOpen()) {
    if (e.key === 'ArrowDown') { e.preventDefault(); cpopMove(1); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); cpopMove(-1); return; }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); cpopAccept(); return; }
    if (e.key === 'Escape') { e.preventDefault(); hideCpop(); return; }
  }
  if (e.key === ' ' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); maybeComplete(true); return; }
  hideEtip();
  if (e.key === 'Tab') {
    e.preventDefault();
    var s = elCode.selectionStart, en = elCode.selectionEnd;
    elCode.setRangeText('  ', s, en, 'end');
    renderHighlight(); schedule();
  }
});
elCode.addEventListener('blur', function () { setTimeout(hideCpop, 150); });
elCode.addEventListener('click', function () { hideCpop(); });
['keyup', 'click', 'select'].forEach(function (ev) { elCode.addEventListener(ev, updatePos); });
function updatePos() {
  var s = elCode.value.slice(0, elCode.selectionStart);
  var line = s.split('\n').length;
  var col = s.length - s.lastIndexOf('\n');
  elPos.textContent = 'Ln ' + line + ', Col ' + col;
}
function gotoLine(n) {
  var lines = elCode.value.split('\n');
  var pos = 0;
  for (var i = 0; i < n - 1 && i < lines.length; i++) pos += lines[i].length + 1;
  var end = pos + (lines[n - 1] ? lines[n - 1].length : 0);
  elCode.focus();
  elCode.setSelectionRange(pos, end);
  var lh = 20.8;
  elCode.scrollTop = Math.max(0, (n - 1) * lh - elCode.clientHeight / 3);
  syncScroll();
  updatePos();
}

/* ---------------- problems panel toggling ---------------- */
function toggleProblems(force) {
  var collapsed = typeof force === 'boolean' ? !force : !elProblems.classList.contains('collapsed');
  elProblems.classList.toggle('collapsed', collapsed);
  $('btnToggleProblems').textContent = collapsed ? '▸' : '▾';
}
$('problemsHead').addEventListener('click', function () { toggleProblems(); });
elPill.addEventListener('click', function () { toggleProblems(); });

/* ---------------- toolbar ---------------- */
function toast(msg) {
  var t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(function () { t.remove(); }, 1900);
}

/* examples menu (with a filter box once the list grows — e.g. course editions) */
var menu = $('menuExamples');
var menuFilter = null;
if (PUML.EXAMPLES.length > 12) {
  menuFilter = document.createElement('input');
  menuFilter.className = 'menu-filter';
  menuFilter.type = 'search';
  menuFilter.placeholder = 'Filter ' + PUML.EXAMPLES.length + ' examples…';
  menuFilter.setAttribute('aria-label', 'Filter examples');
  menuFilter.addEventListener('input', function () { filterMenu(menuFilter.value); });
  menuFilter.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      var first = menu.querySelector('button:not(.hidden)');
      if (first) first.click();
    }
  });
  menu.appendChild(menuFilter);
}
var noMatch = document.createElement('div');
noMatch.className = 'no-match hidden';
noMatch.textContent = 'No example matches.';
menu.appendChild(noMatch);
PUML.EXAMPLES.forEach(function (ex, i) {
  var b = document.createElement('button');
  b.setAttribute('role', 'menuitem');
  b.textContent = ex.name;
  b.addEventListener('click', function () {
    loadExample(i);
    menu.classList.add('hidden');
  });
  menu.appendChild(b);
});
function filterMenu(q) {
  q = (q || '').toLowerCase().trim();
  var terms = q.split(/\s+/).filter(Boolean);
  var any = false;
  Array.prototype.forEach.call(menu.querySelectorAll('button'), function (b) {
    var t = b.textContent.toLowerCase();
    var show = terms.every(function (w) { return t.indexOf(w) >= 0; });
    b.classList.toggle('hidden', !show);
    if (show) any = true;
  });
  noMatch.classList.toggle('hidden', any);
}
function loadExample(i) {
  var ex = PUML.EXAMPLES[i];
  if (!ex) return;
  elCode.value = ex.code;
  $('selType').value = 'auto';
  view.touched = false;
  compileNow();
  elCode.focus();
  elCode.setSelectionRange(0, 0);
  elCode.scrollTop = 0;
  syncScroll();
}
$('btnExamples').addEventListener('click', function (e) {
  e.stopPropagation();
  menu.classList.toggle('hidden');
  if (!menu.classList.contains('hidden') && menuFilter) {
    menuFilter.value = '';
    filterMenu('');
    menuFilter.focus();
  }
});
document.addEventListener('click', function (e) {
  if (!menu.classList.contains('hidden') && !menu.contains(e.target)) menu.classList.add('hidden');
});

$('selType').addEventListener('change', function () { view.touched = false; compileNow(); });

$('btnCopy').addEventListener('click', function () {
  copyText(elCode.value, 'Code copied');
});
function copyText(text, okMsg) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function () { toast(okMsg); }, function () { fallbackCopy(text, okMsg); });
  } else fallbackCopy(text, okMsg);
}
function fallbackCopy(text, okMsg) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); toast(okMsg); } catch (e) { toast('Copy failed — select the text manually'); }
  ta.remove();
}

function anchorDownload(name, blob) {
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
}
/* Save a file. In the Claude artifact viewer plain downloads are inert, so the
   `downloads` capability is tried first; locally we fall back to an <a download>. */
function exportFile(name, data, mime, textFallback, fallbackMsg) {
  var blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  var useClaude = typeof window.claude !== 'undefined' && window.claude && typeof window.claude.use === 'function';
  if (!useClaude) { anchorDownload(name, blob); return; }
  window.claude.use('downloads').then(function (dl) {
    if (!dl) { anchorDownload(name, blob); return; }
    dl.save({ filename: name, data: blob }).then(function () {
      toast('Saved ' + name);
    }, function (err) {
      var code = err && err.code;
      if (code === 'declined') return;
      if (code === 'rate_limited') { toast('A save prompt is already open — try again in a moment'); return; }
      if (textFallback != null) copyText(textFallback, 'Saving is unavailable here — ' + name.split('.').pop().toUpperCase() + ' copied to the clipboard instead');
      else toast(fallbackMsg || 'Saving is unavailable here — use the SVG button instead');
    });
  }, function () { anchorDownload(name, blob); });
}
$('btnSvg').addEventListener('click', function () {
  if (!lastResult || !lastResult.svg) { toast('Nothing to export yet'); return; }
  exportFile('diagram.svg', lastResult.svg, 'image/svg+xml', lastResult.svg);
});
$('btnPng').addEventListener('click', function () {
  if (!lastResult || !lastResult.svg) { toast('Nothing to export yet'); return; }
  var scale = 2;
  var img = new Image();
  img.onload = function () {
    var c = document.createElement('canvas');
    c.width = lastResult.width * scale;
    c.height = lastResult.height * scale;
    var cx = c.getContext('2d');
    cx.fillStyle = '#FDFDF8';
    cx.fillRect(0, 0, c.width, c.height);
    cx.drawImage(img, 0, 0, c.width, c.height);
    c.toBlob(function (b) {
      if (b) exportFile('diagram.png', b, 'image/png', null);
      else toast('PNG export failed in this browser — use SVG instead');
    }, 'image/png');
  };
  img.onerror = function () { toast('PNG export failed — use SVG instead'); };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(lastResult.svg);
});

/* ---------------- help modal ---------------- */
var modal = $('modal'), modalBody = $('modalBody'), modalTabs = $('modalTabs');
var TYPE_ORDER = ['class', 'object', 'sequence', 'usecase', 'state'];
function openHelp(type) {
  modal.classList.remove('hidden');
  modalTabs.innerHTML = '';
  TYPE_ORDER.forEach(function (tp) {
    var b = document.createElement('button');
    b.textContent = PUML.TYPES[tp].label.replace(' diagram', '');
    if (tp === type) b.classList.add('on');
    b.addEventListener('click', function () { openHelp(tp); });
    modalTabs.appendChild(b);
  });
  modalBody.innerHTML = '';
  (PUML.REFERENCE[type] || []).forEach(function (sec) {
    var h = document.createElement('h3');
    h.textContent = sec.h;
    modalBody.appendChild(h);
    var tb = document.createElement('table');
    tb.className = 'ref-table';
    sec.rows.forEach(function (row) {
      var tr = document.createElement('tr');
      var td1 = document.createElement('td');
      td1.textContent = row[0].replace(/\\n/g, '\n');
      var td2 = document.createElement('td');
      td2.textContent = row[1];
      tr.appendChild(td1); tr.appendChild(td2);
      tb.appendChild(tr);
    });
    modalBody.appendChild(tb);
  });
  var note = document.createElement('p');
  note.className = 'modal-note';
  note.textContent = 'This editor implements a well-defined subset of PlantUML, entirely offline — the checks and the rendering run in your browser. ' +
    "Comments start with '. Documents should be wrapped in @startuml … @enduml. " +
    'Global directives (title, skinparam, hide, scale, …) are accepted; skinparam styling and the preprocessor (!include, !define) are not interpreted.';
  modalBody.appendChild(note);
  var note2 = document.createElement('p');
  note2.className = 'modal-note';
  note2.textContent = 'The diagram itself is editable: click a shape to jump to its source line, double-click its name to rename it everywhere, ' +
    'or drag it to reposition it (class, object, use case and state diagrams — the position is saved as an ordinary \' @pos comment).';
  modalBody.appendChild(note2);
}
$('btnHelp').addEventListener('click', function () {
  openHelp(lastResult && lastResult.type ? lastResult.type : 'class');
});
$('modalClose').addEventListener('click', function () { modal.classList.add('hidden'); });
modal.addEventListener('click', function (e) { if (e.target === modal) modal.classList.add('hidden'); });
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') { modal.classList.add('hidden'); menu.classList.add('hidden'); hideCpop(); hideEtip(); }
});

/* ---------------- quick fixes ---------------- */
function applyFix(fix) {
  var lines = elCode.value.split('\n');
  if (fix.insertTop) lines.unshift(fix.insertTop);
  else if (fix.append) lines.push(fix.append);
  else if (fix.line && fix.find != null) {
    var idx = fix.line - 1;
    if (idx >= 0 && idx < lines.length) lines[idx] = lines[idx].replace(fix.find, fix.replace);
  }
  elCode.value = lines.join('\n');
  compileNow();
  elCode.focus();
  toast('Fixed');
}

/* ---------------- completion popup ---------------- */
var cpopItems = [], cpopIdx = 0, cpopCtx = null, cpopLineStart = 0;
function cpopOpen() { return !elCpop.classList.contains('hidden'); }
function hideCpop() { elCpop.classList.add('hidden'); }
function maybeComplete(force) {
  if (elCode.selectionStart !== elCode.selectionEnd) { hideCpop(); return; }
  var pos = elCode.selectionStart;
  var upto = elCode.value.slice(0, pos);
  var lineStart = upto.lastIndexOf('\n') + 1;
  var lineEnd = elCode.value.indexOf('\n', lineStart);
  if (lineEnd === -1) lineEnd = elCode.value.length;
  var lineText = elCode.value.slice(lineStart, lineEnd);
  var col = pos - lineStart;
  var type = lastResult && lastResult.type ? lastResult.type : 'class';
  var ctx = PUML.completionContext(lineText, col);
  if (ctx.mode === 'none' || (!force && (ctx.prefix || '').length < 2)) { hideCpop(); return; }
  var items = PUML.completionsFor(ctx, type, identList);
  if (!items.length) { hideCpop(); return; }
  cpopItems = items; cpopIdx = 0; cpopCtx = ctx; cpopLineStart = lineStart;
  var lineNo = (upto.match(/\n/g) || []).length;
  var charW = measure('0', 13, { mono: true });
  elCpop.style.left = Math.max(4, EDT_PL + ctx.start * charW - elCode.scrollLeft) + 'px';
  elCpop.style.top = (lineNo * EDT_LH + EDT_PT - elCode.scrollTop + EDT_LH + 3) + 'px';
  renderCpop();
  elCpop.classList.remove('hidden');
}
function renderCpop() {
  elCpop.innerHTML = '';
  cpopItems.forEach(function (it, i) {
    var d = document.createElement('div');
    d.className = 'cpop-item' + (i === cpopIdx ? ' on' : '');
    var l = document.createElement('span');
    l.className = 'cl ' + (it.kind === 'ident' ? 'ci' : 'ck');
    l.textContent = it.label;
    var dd = document.createElement('span');
    dd.className = 'cd';
    dd.textContent = it.d;
    d.appendChild(l); d.appendChild(dd);
    d.addEventListener('pointerdown', function (ev) { ev.preventDefault(); });
    d.addEventListener('click', function () { cpopIdx = i; cpopAccept(); });
    elCpop.appendChild(d);
  });
}
function cpopMove(dir) { cpopIdx = (cpopIdx + dir + cpopItems.length) % cpopItems.length; renderCpop(); }
function cpopAccept() {
  var it = cpopItems[cpopIdx];
  if (!it || !cpopCtx) { hideCpop(); return; }
  var from = cpopLineStart + cpopCtx.start;
  elCode.setRangeText(it.insert, from, elCode.selectionStart, 'end');
  hideCpop();
  renderHighlight(); schedule(); updatePos();
}

/* ---------------- diagnostics hover ---------------- */
var etipTimer = null, etipLine = 0;
function hideEtip() { clearTimeout(etipTimer); etipTimer = null; etipLine = 0; elEtip.classList.add('hidden'); }
elCode.addEventListener('mousemove', function (e) {
  var line = Math.floor((e.offsetY + elCode.scrollTop - EDT_PT) / EDT_LH) + 1;
  var ds = lineDiags.get(line);
  if (!ds || !ds.length) { hideEtip(); return; }
  if (line === etipLine && !elEtip.classList.contains('hidden')) return;
  clearTimeout(etipTimer);
  etipTimer = setTimeout(function () {
    etipLine = line;
    elEtip.innerHTML = '';
    ds.slice(0, 4).forEach(function (d) {
      var row = document.createElement('div');
      row.className = 'etip-row ' + (d.severity === 'error' ? 'err' : d.severity === 'warning' ? 'warn' : 'info');
      row.textContent = d.message;
      elEtip.appendChild(row);
    });
    elEtip.style.left = Math.min(e.clientX + 14, window.innerWidth - 360) + 'px';
    elEtip.style.top = Math.min(e.clientY + 16, window.innerHeight - 120) + 'px';
    elEtip.classList.remove('hidden');
  }, 140);
});
elCode.addEventListener('mouseleave', hideEtip);

/* ---------------- official PlantUML renderer (vendored js-plantuml, beta) ---------------- */
var renderMode = 'studio';
var officialSize = null, officialLoadPromise = null, officialTimer = null, officialSeq = 0;

function setOffStatus(msg) { elOffStatus.textContent = msg; }

function loadOfficial() {
  if (officialLoadPromise) return officialLoadPromise;
  officialLoadPromise = new Promise(function (resolve, reject) {
    if (location.protocol === 'file:') {
      reject(new Error('The official engine cannot load from file:// — serve this folder over HTTP (e.g. python3 -m http.server) or use the hosted version.'));
      return;
    }
    var s = document.createElement('script');
    s.src = 'vendor/viz-global.js';
    s.onload = function () {
      import(new URL('vendor/plantuml.js', location.href).href).then(resolve, function () {
        reject(new Error('Could not load vendor/plantuml.js'));
      });
    };
    s.onerror = function () {
      reject(new Error('The official engine files (vendor/) are not available here — use the hosted version at blog.mathieuacher.com/plantuml-studio.'));
    };
    document.head.appendChild(s);
  });
  officialLoadPromise['catch'](function () { /* allow retry after failures on next switch */
    officialLoadPromise = null;
  });
  return officialLoadPromise;
}

function scheduleOfficial() {
  clearTimeout(officialTimer);
  officialTimer = setTimeout(updateOfficial, 350);
}

function officialMessage(html) {
  elVpOfficial.innerHTML = '<div class="off-msg">' + html + '</div>';
  officialSize = null;
}

function updateOfficial() {
  if (renderMode !== 'plantuml') return;
  var seq = ++officialSeq;
  var linesArr = elCode.value.split(/\r\n|\r|\n/);
  setOffStatus('Rendering with the official PlantUML engine…');
  loadOfficial().then(function (mod) {
    if (seq !== officialSeq) return;
    elVpOfficial.innerHTML = '';
    try { mod.render(linesArr, 'vpOfficial'); }
    catch (e2) { setOffStatus('Official render failed: ' + (e2 && e2.message || e2)); return; }
    waitOfficialSvg(seq, 0);
  }, function (err) {
    setOffStatus('Official engine unavailable');
    officialMessage(esc(err && err.message || 'Official engine unavailable'));
  });
}
function waitOfficialSvg(seq, tries) {
  if (seq !== officialSeq) return;
  if (elVpOfficial.querySelector('svg')) { finalizeOfficial(); return; }
  if (tries > 80) { setOffStatus('Official engine produced no output'); return; }
  setTimeout(function () { waitOfficialSvg(seq, tries + 1); }, 120);
}
function finalizeOfficial() {
  var svg = elVpOfficial.querySelector('svg');
  if (!svg) { setOffStatus('Official engine produced no output'); return; }
  var w = parseFloat(svg.getAttribute('width')) || 0;
  var h = parseFloat(svg.getAttribute('height')) || 0;
  if ((!w || !h) && svg.viewBox && svg.viewBox.baseVal) { w = svg.viewBox.baseVal.width; h = svg.viewBox.baseVal.height; }
  officialSize = { w: w || 600, h: h || 400 };
  setOffStatus('Official PlantUML engine (beta, vendored js-plantuml build) — diagnostics still come from Studio');
  if (!view.touched) fit();
}
function setRenderMode(m) {
  renderMode = m;
  Array.prototype.forEach.call($('renderSel').querySelectorAll('button'), function (b) {
    b.classList.toggle('on', b.getAttribute('data-mode') === m);
  });
  elVpStudio.classList.toggle('hidden', m !== 'studio');
  elVpOfficial.classList.toggle('hidden', m !== 'plantuml');
  elOffStatus.classList.toggle('hidden', m !== 'plantuml');
  view.touched = false;
  if (m === 'plantuml') { elPlaceholder.classList.add('hidden'); updateOfficial(); }
  else {
    if (lastResult && !lastResult.svg) elPlaceholder.classList.remove('hidden');
    fit();
  }
}
$('renderSel').addEventListener('click', function (e) {
  var b = e.target.closest ? e.target.closest('button') : null;
  if (b) setRenderMode(b.getAttribute('data-mode'));
});

/* ---------------- split divider ---------------- */
var divider = $('divider'), main = $('main');
var dragging = null;
divider.addEventListener('pointerdown', function (e) {
  dragging = true;
  divider.classList.add('drag');
  divider.setPointerCapture(e.pointerId);
});
divider.addEventListener('pointermove', function (e) {
  if (!dragging) return;
  var r = main.getBoundingClientRect();
  if (window.innerWidth <= 760) {
    var fy = Math.min(0.8, Math.max(0.2, (e.clientY - r.top) / r.height));
    main.style.gridTemplateRows = 'minmax(0,' + (fy * 100).toFixed(1) + 'fr) 6px minmax(0,' + ((1 - fy) * 100).toFixed(1) + 'fr)';
  } else {
    var fx = Math.min(0.8, Math.max(0.2, (e.clientX - r.left) / r.width));
    main.style.gridTemplateColumns = 'minmax(280px,' + (fx * 100).toFixed(1) + 'fr) 6px minmax(280px,' + ((1 - fx) * 100).toFixed(1) + 'fr)';
    try { localStorage.setItem(LS_SPLIT, String(fx)); } catch (err) {}
  }
  if (!view.touched) fit();
});
['pointerup', 'pointercancel'].forEach(function (ev) {
  divider.addEventListener(ev, function () { dragging = null; divider.classList.remove('drag'); });
});

/* ---------------- code generation (Java / Python) ---------------- */
var codeModal = $('codeModal'), codeLangTabs = $('codeLangTabs');
var codeTemplateEditor = $('codeTemplateEditor'), codeOutput = $('codeOutput'), codeFileSelect = $('codeFileSelect');
var codeNote = $('codeNote'), codeProjectName = $('codeProjectName');
var CODE_LANG_KEY = 'plantuml-studio.codegen.lang';
var CODE_TPL_KEY_PREFIX = 'plantuml-studio.codegen.tpl.';
var codeLang = 'java', codeFiles = [], codeGenTimer = null;

function defaultTemplate(lang) { return lang === 'python' ? PUML.PYTHON_TEMPLATE : PUML.JAVA_TEMPLATE; }
function loadTemplate(lang) {
  try { var saved = localStorage.getItem(CODE_TPL_KEY_PREFIX + lang); if (saved != null) return saved; } catch (e) {}
  return defaultTemplate(lang);
}
function saveTemplate(lang, text) {
  try { localStorage.setItem(CODE_TPL_KEY_PREFIX + lang, text); } catch (e) {}
}
function regenerateCode() {
  if (!lastResult || lastResult.type !== 'class' || !lastResult.model) {
    codeFiles = [];
    codeFileSelect.innerHTML = '';
    codeOutput.value = '';
    codeNote.textContent = 'Code generation reads a class diagram\'s classes, members and relationships — switch to (or write) one to generate ' + (codeLang === 'python' ? 'Python' : 'Java') + '.';
    return;
  }
  var prevClass = codeFileSelect.value;
  try {
    codeFiles = PUML.genCode(lastResult.model, codeTemplateEditor.value, codeLang);
    codeNote.textContent = codeFiles.length + ' file' + (codeFiles.length === 1 ? '' : 's') +
      ' generated from the class diagram — inherited interface/abstract methods are stubbed in, and constructors chain to their superclass.';
  } catch (e) {
    codeFiles = [];
    codeNote.textContent = 'Template error: ' + (e && e.message ? e.message : e);
  }
  codeFileSelect.innerHTML = '';
  codeFiles.forEach(function (f) {
    var opt = document.createElement('option');
    opt.value = f.className; opt.textContent = f.filename;
    codeFileSelect.appendChild(opt);
  });
  if (codeFiles.length) {
    var idx = -1;
    for (var i = 0; i < codeFiles.length; i++) if (codeFiles[i].className === prevClass) { idx = i; break; }
    codeFileSelect.selectedIndex = idx >= 0 ? idx : 0;
    codeOutput.value = codeFiles[codeFileSelect.selectedIndex].code;
  } else {
    codeOutput.value = '';
  }
}
codeFileSelect.addEventListener('change', function () {
  var f = codeFiles[codeFileSelect.selectedIndex];
  codeOutput.value = f ? f.code : '';
});
codeTemplateEditor.addEventListener('input', function () {
  saveTemplate(codeLang, codeTemplateEditor.value);
  clearTimeout(codeGenTimer);
  codeGenTimer = setTimeout(regenerateCode, 200);
});
$('codeResetTemplate').addEventListener('click', function () {
  codeTemplateEditor.value = defaultTemplate(codeLang);
  saveTemplate(codeLang, codeTemplateEditor.value);
  regenerateCode();
  toast('Template reset to default');
});
$('codeCopyBtn').addEventListener('click', function () {
  var f = codeFiles[codeFileSelect.selectedIndex];
  if (!f) { toast('Nothing to copy yet'); return; }
  copyText(f.code, 'Copied ' + f.filename);
});
$('codeDownloadBtn').addEventListener('click', function () {
  var f = codeFiles[codeFileSelect.selectedIndex];
  if (!f) { toast('Nothing to export yet'); return; }
  exportFile(f.filename, f.code, 'text/plain', f.code);
});
$('codeDownloadZip').addEventListener('click', function () {
  if (!lastResult || lastResult.type !== 'class' || !lastResult.model) { toast('Nothing to export yet'); return; }
  try {
    var proj = PUML.genProjectZip(lastResult.model, codeTemplateEditor.value, codeLang, codeProjectName.value);
    exportFile(proj.zipName, proj.data, 'application/zip', null,
      'ZIP downloads aren’t available in this preview — open the app at blog.mathieuacher.com/plantuml-studio to download the project.');
  } catch (e) {
    toast('Could not build the project: ' + (e && e.message ? e.message : e));
  }
});
function setCodeLang(lang) {
  codeLang = lang;
  Array.prototype.forEach.call(codeLangTabs.querySelectorAll('button'), function (b) {
    b.classList.toggle('on', b.getAttribute('data-lang') === lang);
  });
  codeTemplateEditor.value = loadTemplate(lang);
  try { localStorage.setItem(CODE_LANG_KEY, lang); } catch (e) {}
  regenerateCode();
}
codeLangTabs.addEventListener('click', function (e) {
  var b = e.target.closest ? e.target.closest('button') : null;
  if (b) setCodeLang(b.getAttribute('data-lang'));
});
$('btnCode').addEventListener('click', function () {
  codeModal.classList.remove('hidden');
  if (!codeProjectName.value && lastResult && lastResult.title) {
    codeProjectName.value = String(lastResult.title).split('\n')[0];
  }
  regenerateCode();
});
$('codeModalClose').addEventListener('click', function () { codeModal.classList.add('hidden'); });
codeModal.addEventListener('click', function (e) { if (e.target === codeModal) codeModal.classList.add('hidden'); });
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') codeModal.classList.add('hidden'); });

/* ---------------- boot ---------------- */
(function boot() {
  try {
    var sp = parseFloat(localStorage.getItem(LS_SPLIT));
    if (sp && sp > 0.2 && sp < 0.8 && window.innerWidth > 760) {
      main.style.gridTemplateColumns = 'minmax(280px,' + (sp * 100).toFixed(1) + 'fr) 6px minmax(280px,' + ((1 - sp) * 100).toFixed(1) + 'fr)';
    }
  } catch (e) {}

  var savedLang = 'java';
  try { savedLang = localStorage.getItem(CODE_LANG_KEY) || 'java'; } catch (e) {}
  setCodeLang(savedLang === 'python' ? 'python' : 'java');

  var wantOfficial = /official/.test(location.hash || '');
  var hashEx = /[#&]ex=([^&]+)/.exec(location.hash || '');
  if (hashEx) {
    var key = decodeURIComponent(hashEx[1]);
    var idx = /^\d+$/.test(key) ? +key : PUML.EXAMPLES.findIndex(function (x) { return x.name.toLowerCase().indexOf(key.toLowerCase()) >= 0; });
    if (PUML.EXAMPLES[idx]) {
      loadExample(idx);
      if (wantOfficial) setRenderMode('plantuml');
      return;
    }
  }
  var saved = null, savedType = 'auto';
  try {
    saved = localStorage.getItem(LS_DOC);
    savedType = localStorage.getItem(LS_TYPE) || 'auto';
  } catch (e) {}
  if (saved != null && saved.trim() !== '' && saved.trim() !== '@startuml\n\n@enduml') {
    elCode.value = saved;
    $('selType').value = ['auto', 'class', 'object', 'sequence', 'usecase', 'state'].indexOf(savedType) >= 0 ? savedType : 'auto';
    compileNow();
  } else {
    loadExample(0);
  }
  if (wantOfficial) setRenderMode('plantuml');
})();

})();
