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
