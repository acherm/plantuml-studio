/* PlantUML Studio — class diagram -> source code generator.
   Pure JS, no DOM. A tiny Mustache-like template engine (editable, explicit
   text templates — no hidden magic) renders a per-class context built from
   the parsed class-diagram model. Ships default Java and Python templates;
   both the templates and the generation are exposed so a UI can let users
   edit the template and regenerate live. */
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
    supers.forEach(function (sid) { chain = chain.concat(infoById[sid].instanceAttrs); });
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

    var inheritedAttrs = (info.isEnum || info.isInterface) ? [] : collectInheritedAttrs(id);
    var allCtorAttrs = inheritedAttrs.concat(info.instanceAttrs);
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
      needsTyping: info.attributes.concat(methods.reduce(function (a, m) { return a.concat(m.params); }, []))
        .some(function (x) { return /^(List|Set|Dict)\[/.test(x.pyType); }),
      attributes: info.attributes, instanceAttrs: info.instanceAttrs, staticAttrs: info.staticAttrs,
      hasAttributes: info.attributes.length > 0, hasInstanceAttrs: info.instanceAttrs.length > 0,
      methods: methods, hasMethods: methods.length > 0,
      enumValues: info.enumValues, enumValuesStr: info.enumValues.join(', '),
      pyImports: pyImports, hasPyImports: pyImports.length > 0,
      hasSuperCtorArgs: hasSuperCtorArgs,
      hasCtorBody: hasSuperCtorArgs || info.instanceAttrs.length > 0,
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
  'public {{#if isAbstract}}abstract {{/if}}{{#if isInterface}}interface{{else}}class{{/if}} {{name}}{{extendsClause}}{{implementsClause}} {',
  '',
  '{{#each staticAttrs}}',
  '    {{visKw}}static {{type}} {{name}}{{#if hasDefault}} = {{defaultValue}}{{/if}};',
  '{{/each}}',
  '{{#each instanceAttrs}}',
  '    {{visKw}}{{type}} {{name}}{{#if hasDefault}} = {{defaultValue}}{{/if}};',
  '{{/each}}',
  '',
  '{{#unless isInterface}}',
  '    public {{name}}({{javaCtorParamsStr}}) {',
  '{{#if hasSuperCtorArgs}}',
  '        super({{superCallArgsStr}});',
  '{{/if}}',
  '{{#each instanceAttrs}}',
  '        this.{{name}} = {{name}};',
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
  '        self.{{pyName}} = {{pyParamName}}',
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
P.camelToSnake = camelToSnake;
P.toPyType = toPyType;

})(PUML);
