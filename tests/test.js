#!/usr/bin/env node
/* PlantUML Studio — core test suite. Run: node tools/build-single.js && node tests/test.js */
'use strict';
const path = require('path');
const P = require(path.join(__dirname, '..', 'dist', 'puml-core.cjs'));

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error('FAIL: ' + msg); }
}
function eq(a, b, msg) { ok(a === b, msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }

function errs(res) { return res.diagnostics.filter(d => d.severity === 'error'); }
function warns(res) { return res.diagnostics.filter(d => d.severity === 'warning'); }
function has(res, sev, re) { return res.diagnostics.some(d => d.severity === sev && re.test(d.message)); }
function svgSane(res, name) {
  ok(res.svg && res.svg.indexOf('<svg') === 0, name + ': svg produced');
  if (!res.svg) return;
  ok(res.svg.indexOf('NaN') === -1, name + ': no NaN in svg');
  ok(res.svg.indexOf('Infinity') === -1, name + ': no Infinity in svg');
  ok(res.svg.indexOf('undefined') === -1, name + ': no undefined in svg');
  const opens = (res.svg.match(/<([a-zA-Z]+)[\s>]/g) || []).length;
  const closes = (res.svg.match(/<\/[a-zA-Z]+>/g) || []).length + (res.svg.match(/\/>/g) || []).length;
  ok(opens === closes, name + ': balanced tags (' + opens + ' vs ' + closes + ')');
}

/* ---------- preprocess ---------- */
{
  const pre = P.preprocess("@startuml\n' comment\nclass A\n/' block\nstill '/ class B\n@enduml\n");
  eq(pre.lines.length, 2, 'preprocess keeps content lines');
  eq(pre.lines[0].text, 'class A', 'comment stripped');
  eq(pre.lines[1].text, 'class B', 'block comment stripped inline');
  eq(pre.diagnostics.length, 0, 'no diags for clean doc');
}
{
  const pre = P.preprocess('class A\n');
  ok(pre.diagnostics.some(d => /Missing @startuml/.test(d.message)), 'missing @startuml warned');
  ok(pre.diagnostics.some(d => /Missing @enduml/.test(d.message)), 'missing @enduml warned');
}
{
  const pre = P.preprocess('@startuml\ntitle Hello world\nskinparam classAttributeIconSize 0\nskinparam class {\n BackgroundColor red\n}\nclass A\n@enduml');
  eq(pre.meta.title, 'Hello world', 'title captured');
  eq(pre.lines.length, 1, 'skinparam block consumed');
}
{
  const pre = P.preprocess('@startuml\nhide footbox\nA -> B : x\n@enduml');
  ok(pre.meta.hideFootbox, 'hide footbox captured');
}

/* ---------- detection ---------- */
function det(code) { return P.compile(code).type; }
eq(det('@startuml\nclass A\nA --> B\n@enduml'), 'class', 'detect class');
eq(det('@startuml\nobject o1\n@enduml'), 'object', 'detect object');
eq(det('@startuml\nAlice -> Bob : hi\nBob --> Alice : yo\n@enduml'), 'sequence', 'detect sequence');
eq(det('@startuml\nactor U\nU --> (Do)\n@enduml'), 'usecase', 'detect usecase');
eq(det('@startuml\n[*] --> S1\nS1 --> [*]\n@enduml'), 'state', 'detect state');

/* ---------- class diagrams ---------- */
{
  const res = P.compile('@startuml\nclass Car {\n  -speed: int\n  +drive(): void\n  {static} +count: int\n}\nclass Vehicle\nCar --|> Vehicle\n@enduml');
  eq(res.type, 'class', 'class type');
  eq(errs(res).length, 0, 'clean class diagram has no errors');
  const car = res.model.byId.get('Car');
  eq(car.members.length, 3, 'members parsed');
  eq(car.members[0].vis, '-', 'visibility parsed');
  eq(car.members[1].kind, 'meth', 'method detected by parens');
  ok(car.members[2].stat, 'static modifier');
  eq(res.model.relations.length, 1, 'relation parsed');
  eq(res.model.relations[0].cls.decoR, 'tri', 'inheritance triangle at parent end');
  svgSane(res, 'class');
}
{
  const res = P.compile('@startuml\nclass A\nclass A\n@enduml');
  ok(has(res, 'error', /declared twice/), 'duplicate class detected');
}
{
  const res = P.compile('@startuml\nclass A {\n  +x: int\n@enduml');
  ok(has(res, 'error', /never closed/), 'unclosed brace detected');
}
{
  const res = P.compile('@startuml\nclas A\n@enduml');
  ok(has(res, 'error', /did you mean "class"/), 'typo suggestion for clas');
}
{
  const res = P.compile('@startuml\nA --> B\nclass A\n@enduml');
  ok(has(res, 'info', /'B' is not declared/), 'implicit class info');
  ok(!has(res, 'info', /'A' is not declared.*\n.*again/), 'no dup info');
}
{
  const res = P.compile('@startuml\nclass Book extends Media implements Borrowable\n@enduml');
  eq(res.model.relations.length, 2, 'extends+implements create relations');
  eq(res.model.byId.get('Borrowable').kind, 'interface', 'implements target is interface');
  eq(errs(res).length, 0, 'extends/implements clean');
}
{
  /* regression: extends/implements targets must stay implicit so a LATER
     explicit declaration of the same name isn't rejected as a duplicate */
  const res = P.compile('@startuml\ninterface I\nclass B extends A implements I\nclass A\n@enduml');
  eq(errs(res).length, 0, "declaring the extends target after it's referenced is not a duplicate");
  eq(res.model.byId.get('A').implicit, false, 'the later explicit declaration wins');
}
{
  /* case-insensitivity: PlantUML keywords ignore case, identifiers do not */
  const res = P.compile('@startuml\nInterface I\nClass B Extends A Implements I\nClass A\n@enduml');
  eq(errs(res).length, 0, 'capitalized keywords (Class/Interface/Extends/Implements) parse cleanly');
  eq(res.model.byId.get('A').kind, 'class', 'capitalized declarations still resolve the right kind');
}
{
  const res = P.compile('@startuml\nclass A\nclass B\nA "1" *-- "0..*" B : owns\n@enduml');
  const rel = res.model.relations[0];
  eq(rel.cardL, '1', 'left multiplicity');
  eq(rel.cardR, '0..*', 'right multiplicity');
  eq(rel.label, 'owns', 'label');
  eq(rel.cls.decoL, 'diamond', 'composition diamond');
  svgSane(res, 'class-cards');
}
{
  const res = P.compile('@startuml\npackage P1 {\n class A\n}\nclass B\nA --> B\n@enduml');
  eq(errs(res).length, 0, 'package parse clean');
  svgSane(res, 'class-package');
}
{
  const res = P.compile('@startuml\nclass A\nnote right of A : hello\nnote left of Zed : nope\n@enduml');
  ok(has(res, 'error', /'Zed' which is not declared/), 'note to undeclared class errors');
  svgSane(res, 'class-note');
}

/* ---------- object diagrams ---------- */
{
  const res = P.compile('@startuml\nobject o1 {\n  x = 1\n}\nobject o2\no1 --> o2 : link\no1 : y = 2\n@enduml');
  eq(res.type, 'object', 'object type');
  eq(errs(res).length, 0, 'object clean');
  eq(res.model.objects[0].fields.length, 2, 'fields via block and colon');
  svgSane(res, 'object');
}
{
  /* the exact motivating example: capitalized "Object" + colon-style fields
     with unquoted values (dates), links declared before their targets */
  const res = P.compile([
    '@startuml',
    'Object Library {', 'name: "dummy"', 'address: "dummy"', '}', '',
    'Object Bookone {', 'tittle: "not important"', 'pages: 10', 'release: 01/01/2001', '}', '',
    'Object Author {', 'name: "dummy"', 'email: "dummy@dummy.com"', '}', '',
    'Object Booktwo {', 'tittle: "not important"', 'pages: 20', 'release: 01/01/2001', '}', '',
    'Object Bookthree {', 'tittle: "not important"', 'pages: 30', 'release: 01/01/2001', '}', '',
    'Booktwo --> Author :wrote', 'Bookthree --> Author :wrote', 'Bookone --> Author :wrote', '',
    'Library --> Bookone :has', 'Library --> Booktwo :has', 'Library --> Bookthree:has',
    '@enduml'
  ].join('\n'));
  eq(res.type, 'object', 'capitalized "Object" is still detected as an object diagram');
  eq(errs(res).length, 0, 'capitalized Object + colon fields parse cleanly');
  eq(res.model.objects.length, 5, 'all five objects parsed');
  svgSane(res, 'object-capitalized-library');
}

/* ---------- sequence diagrams ---------- */
{
  const res = P.compile('@startuml\nactor U\nparticipant "The UI" as UI\nU -> UI : click\nUI --> U : done\n@enduml');
  eq(res.type, 'sequence', 'sequence type');
  eq(errs(res).length, 0, 'sequence clean');
  eq(res.model.parts.length, 2, 'two participants');
  eq(res.model.parts[1].label, 'The UI', 'display name');
  svgSane(res, 'sequence');
}
{
  const res = P.compile('@startuml\nA -> B : x\nend\n@enduml');
  ok(has(res, 'error', /'end' without a matching/), 'stray end detected');
}
{
  const res = P.compile('@startuml\nalt cond\nA -> B : x\n@enduml');
  ok(has(res, 'error', /never closed/), 'unclosed alt detected');
}
{
  const res = P.compile('@startuml\nA -> B ++ : go\nB --> A -- : ok\nreturn nothing\n@enduml');
  ok(has(res, 'warning', /return: no activation/), 'return without ++ activation warns');
}
{
  /* regression: `activate X` as the very first statement must silently
     auto-create X, exactly like a message's first mention does — real
     PlantUML accepts this without complaint */
  const res = P.compile('@startuml\nactivate A\nA -> B : x\ndeactivate A\n@enduml');
  eq(errs(res).length, 0, 'activate as the first statement is not an error');
  ok(res.model.byId.has('A'), 'the participant is created');
}
{
  const res = P.compile('@startuml\ndeactivate A\n@enduml');
  ok(has(res, 'warning', /no active activation/), 'deactivate with nothing to deactivate warns (participants are auto-created silently, like a first message)');
  eq(errs(res).length, 0, 'a lone deactivate is not an error — activate/deactivate/destroy auto-create their participant like a message does');
}
{
  const res = P.compile('@startuml\nautonumber\nA -> B : one\nA -> B : two\n@enduml');
  ok(res.svg.indexOf('1: one') >= 0 && res.svg.indexOf('2: two') >= 0, 'autonumber prefixes messages');
}
{
  const res = P.compile('@startuml\nA -> A : self\nalt ok\nA -> B : m\nelse ko\nB --> A : n\nend\nnote over A,B : both\n== Phase ==\n... later ...\n@enduml');
  eq(errs(res).length, 0, 'sequence features clean');
  svgSane(res, 'sequence-rich');
}

/* ---------- use case diagrams ---------- */
{
  const res = P.compile('@startuml\nactor U\nusecase "Do it" as UC\nU --> UC\n@enduml');
  eq(res.type, 'usecase', 'usecase type');
  eq(errs(res).length, 0, 'usecase clean');
  svgSane(res, 'usecase');
}
{
  const res = P.compile('@startuml\n:Member: --> (Borrow)\n(Borrow) ..> (Auth) : include\n@enduml');
  eq(errs(res).length, 0, 'shorthand refs clean');
  eq(res.model.byId.get('Member').kind, 'actor', ':x: is actor');
  eq(res.model.byId.get('Borrow').kind, 'usecase', '(x) is usecase');
  eq(res.model.edges[1].stereo, 'include', 'include stereotype');
  svgSane(res, 'usecase-short');
}
{
  const res = P.compile('@startuml\nactor A\nrectangle "Sys" {\n usecase U1\n}\nA --> U1\n@enduml');
  eq(errs(res).length, 0, 'boundary clean');
  svgSane(res, 'usecase-boundary');
}
{
  const res = P.compile('@startuml\nactor A\n(B) --> C\n@enduml');
  ok(has(res, 'info', /created as a use case/), 'bare implicit name info');
}
{
  const res = P.compile('@startuml\nactor A\nusecase B\nA --> B : <<include>>\n@enduml');
  ok(has(res, 'warning', /dotted arrow/), 'include on solid arrow warns');
}

/* ---------- state diagrams ---------- */
{
  const res = P.compile('@startuml\n[*] --> Idle\nIdle --> Run : start\nRun --> [*]\n@enduml');
  eq(res.type, 'state', 'state type');
  eq(errs(res).length, 0, 'state clean');
  svgSane(res, 'state');
}
{
  const res = P.compile('@startuml\n[*] --> A\nstate Orphan\n@enduml');
  ok(has(res, 'warning', /unreachable/), 'unreachable state warned');
}
{
  const res = P.compile('@startuml\nstate A\nA --> B\n@enduml');
  ok(has(res, 'warning', /No initial state/), 'missing initial state warned');
}
{
  const res = P.compile('@startuml\n[*] --> Active\nstate Active {\n [*] --> Warm\n Warm --> Cold : x\n}\nActive --> [*]\n@enduml');
  eq(errs(res).length, 0, 'composite state clean');
  ok(!has(res, 'warning', /unreachable/), 'composite children reachable');
  svgSane(res, 'state-composite');
}
{
  const res = P.compile('@startuml\n[*] --> A\nA --> c1\nstate c1 <<choice>>\nc1 --> B : [yes]\nc1 --> C : [no]\nB --> [*]\nC --> [*]\n@enduml');
  eq(errs(res).length, 0, 'choice pseudo state clean');
  svgSane(res, 'state-choice');
}
{
  const res = P.compile('@startuml\n[*] --> A\nA <-- B\n@enduml');
  const tr = res.model.trans.filter(t => t.from === 'B');
  eq(tr.length, 1, 'reversed arrow B --> A parsed with B as source');
}

/* ---------- examples all compile clean ---------- */
P.EXAMPLES.forEach(ex => {
  if (ex.name.indexOf('Broken') === 0) {
    const res = P.compile(ex.code, { strict: true });
    ok(errs(res).length >= 3, 'broken example has several errors (got ' + errs(res).length + ')');
    svgSane(res, ex.name);
    return;
  }
  const res = P.compile(ex.code, { strict: true });
  eq(errs(res).length, 0, ex.name + ': no errors' + (errs(res).length ? ' — first: ' + errs(res)[0].message : ''));
  eq(warns(res).length, 0, ex.name + ': no warnings' + (warns(res).length ? ' — first: ' + warns(res)[0].message : ''));
  if (ex.type) eq(res.type, ex.type, ex.name + ': detected as ' + ex.type);
  if (ex.name !== 'Blank') svgSane(res, ex.name);
});

/* ---------- robustness: mangled inputs must never throw ---------- */
{
  let seed = 42;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const garbage = ['{{{{', '}}}', 'class', '-> ->', ': : :', '"unclosed', 'note of', '[*] [*]', 'alt alt alt',
    'a --> --> b', 'object }{', '((()))', 'state {', '@startuml @enduml', '\\n\\n\\n', '== ==', '||||', '...'];
  garbage.forEach((g, i) => {
    try { P.compile(g, { strict: true }); pass++; }
    catch (e) { fail++; console.error('FAIL: garbage input ' + i + ' threw: ' + e.message); }
  });
  P.EXAMPLES.forEach(ex => {
    const lines = ex.code.split('\n');
    for (let k = 0; k < 6; k++) {
      const mutated = lines.filter(() => rnd() > 0.3).join('\n');
      try { P.compile(mutated, { strict: true }); pass++; }
      catch (e) { fail++; console.error('FAIL: mutated ' + ex.name + ' threw: ' + e.message + '\n---\n' + mutated + '\n---'); }
    }
  });
}

/* ---------- editor services: completion context ---------- */
{
  const cc = P.completionContext;
  eq(cc('cla', 3).mode, 'stmt', 'line start → stmt context');
  eq(cc('cla', 3).prefix, 'cla', 'prefix captured');
  eq(cc('A --> Bo', 8).mode, 'ident', 'after arrow → ident context');
  eq(cc('note right of Ca', 16).mode, 'ident', 'after of → ident context');
  eq(cc('A -> B : some mess', 18).mode, 'none', 'inside message label → none');
  eq(cc('class "My na', 12).mode, 'none', 'inside quotes → none');
  eq(cc('A --', 4).mode, 'none', 'typing the arrow → none');
  eq(cc('class B extends A', 17).mode, 'ident', 'after extends → ident');
}
{
  const res = P.compile('@startuml\nclass Car\nclass Wheel\nCar *-- Wheel\n@enduml');
  const ids = P.collectIdents(res.model, res.type);
  ok(ids.some(x => x.name === 'Car') && ids.some(x => x.name === 'Wheel'), 'collectIdents finds classes');
  const comp = P.completionsFor({ mode: 'ident', prefix: 'Ca', start: 0 }, 'class', ids);
  ok(comp.length === 1 && comp[0].insert === 'Car', 'ident completion filtered by prefix');
  const stmt = P.completionsFor({ mode: 'stmt', prefix: 'cl', start: 0 }, 'class', ids);
  ok(stmt.some(c => c.insert === 'class '), 'stmt completion offers class keyword');
  ok(!stmt.some(c => c.label === 'participant'), 'no sequence keywords in class type');
}
{
  const seq = P.compile('@startuml\nparticipant "Web UI" as W\nAlice -> W : hi\n@enduml');
  const ids = P.collectIdents(seq.model, 'sequence');
  const w = ids.filter(x => x.name === 'W')[0];
  ok(w && w.insert === 'W', 'sequence alias inserted bare');
  const uc = P.compile('@startuml\n:Some Person: --> (Do a thing)\n@enduml');
  const uids = P.collectIdents(uc.model, 'usecase');
  ok(uids.some(x => x.insert === ':Some Person:'), 'actor with spaces inserted as :…:');
  ok(uids.some(x => x.insert === '(Do a thing)'), 'usecase with spaces inserted as (…)');
}

/* ---------- quick fixes & columns ---------- */
{
  const res = P.compile('@startuml\nclas Vehicle\n@enduml');
  const d = res.diagnostics.filter(x => /did you mean/.test(x.message))[0];
  ok(d && d.fix && d.fix.find === 'clas' && d.fix.replace === 'class', 'typo diagnostic carries a fix');
  ok(d.col === 1 && d.len === 4, 'typo diagnostic has column + length (got col ' + d.col + ' len ' + d.len + ')');
}
{
  const res = P.compile('class A\n');
  const s = res.diagnostics.filter(x => /Missing @startuml/.test(x.message))[0];
  const e = res.diagnostics.filter(x => /Missing @enduml/.test(x.message))[0];
  ok(s && s.fix && s.fix.insertTop === '@startuml', '@startuml fix present');
  ok(e && e.fix && e.fix.append === '@enduml', '@enduml fix present');
}
{
  const res = P.compile('@startuml\nclass A\n  note left of Zed : x\n@enduml');
  const d = res.diagnostics.filter(x => /Zed/.test(x.message))[0];
  ok(d && d.col === 16 && d.len === 3, 'note-target column respects indentation (got col ' + (d && d.col) + ')');
}

/* ---------- self loops (reflexive associations) ---------- */
{
  const res = P.compile('@startuml\nclass Personne\nPersonne "0..1" --> "*" Personne : encadre\n@enduml');
  ok(errs(res).length === 0, 'class self-loop: no errors');
  svgSane(res, 'class self-loop');
  ok(res.svg.includes('encadre'), 'class self-loop: label rendered');
  ok((res.svg.match(/<path/g) || []).length >= 1, 'class self-loop: loop path drawn');
  ok(res.svg.includes('0..1') && res.svg.includes('*'), 'class self-loop: both multiplicities rendered');
}
{
  const res = P.compile('@startuml\nobject o1\no1 --> o1 : lien\n@enduml');
  svgSane(res, 'object self-link');
  ok(res.svg.includes('lien'), 'object self-link: label rendered');
  ok((res.svg.match(/<path/g) || []).length >= 1, 'object self-link: loop path drawn');
}
{
  const res = P.compile('@startuml\nclass N\nN --> N : a\nN --> N : b\n@enduml');
  svgSane(res, 'stacked self-loops');
  ok(res.svg.includes('>a<') && res.svg.includes('>b<'), 'stacked self-loops: both labels rendered');
  ok((res.svg.match(/<path/g) || []).length >= 2, 'stacked self-loops: two loop paths');
}
{
  const res = P.compile('@startuml\n[*] --> S\nS --> S : tick\n@enduml');
  svgSane(res, 'state self-transition (regression)');
  ok(res.svg.includes('tick'), 'state self-transition: label still rendered');
}

/* ---------- codegen: template engine ---------- */
{
  eq(P.tmplRender('Hello {{name}}!', { name: 'World' }), 'Hello World!', 'plain var interpolation');
  eq(P.tmplRender('{{missing}}', {}), '', 'missing var renders empty');
  eq(P.tmplRender('a{{#if x}}b{{/if}}c', { x: true }), 'abc', 'if true renders body');
  eq(P.tmplRender('a{{#if x}}b{{/if}}c', { x: false }), 'ac', 'if false skips body');
  eq(P.tmplRender('{{#if x}}yes{{else}}no{{/if}}', { x: false }), 'no', 'if/else picks else branch');
  eq(P.tmplRender('{{#unless x}}yes{{/unless}}', { x: false }), 'yes', 'unless negates');
  eq(P.tmplRender('{{#if !x}}yes{{/if}}', { x: false }), 'yes', 'leading ! negates an if condition');
  eq(P.tmplRender('{{#each items}}[{{.}}]{{/each}}', { items: ['a', 'b'] }), '[a][b]', 'each over primitives via {{.}}');
  eq(P.tmplRender('{{#each items}}{{name}}{{#unless @last}},{{/unless}}{{/each}}', { items: [{ name: 'x' }, { name: 'y' }] }), 'x,y', 'each over objects with @last');
  eq(P.tmplRender('{{#each xs}}{{outer}}-{{.}} {{/each}}', { outer: 'O', xs: [1, 2] }), 'O-1 O-2 ', 'inner scope falls back to outer scope for unresolved names');
  eq(P.tmplRender('{{#each a}}{{#each b}}{{x}}{{y}}{{/each}}{{/each}}',
    { a: [{ b: [{ x: 1, y: 2 }] }] }), '12', 'nested each');
  var standalone = P.tmplRender('before\n{{#if x}}\nmid\n{{/if}}\nafter', { x: true });
  eq(standalone, 'before\nmid\nafter', 'standalone block tags consume their own line (no ragged blank lines)');
}

/* ---------- codegen: member signature parsing ---------- */
{
  var m1 = P.parseMemberSignature('speed: int');
  eq(m1.isMethod, false, 'attribute detected');
  eq(m1.name, 'speed', 'attribute name');
  eq(m1.type, 'int', 'attribute type');
  var m2 = P.parseMemberSignature('drive(m: Member, dist: int): Loan');
  eq(m2.isMethod, true, 'method detected');
  eq(m2.params.length, 2, 'method params count');
  eq(m2.params[0].name, 'm', 'first param name');
  eq(m2.returnType, 'Loan', 'method return type');
  var m3 = P.parseMemberSignature('process(data: Map<String, Integer>): void');
  eq(m3.params.length, 1, 'generic type with internal comma is not split (Map<String, Integer>)');
  eq(m3.params[0].type, 'Map<String, Integer>', 'generic param type preserved whole');
  var m4 = P.parseMemberSignature('count: int = 0');
  eq(m4.defaultValue, '0', 'default value captured');
  var m5 = P.parseMemberSignature('RED');
  eq(m5.name, 'RED', 'bare enum literal parses as a name');
}

/* ---------- codegen: type mapping ---------- */
{
  eq(P.toPyType('int'), 'int', 'int -> int');
  eq(P.toPyType('String'), 'str', 'String -> str');
  eq(P.toPyType('boolean'), 'bool', 'boolean -> bool');
  eq(P.toPyType('void'), 'None', 'void -> None');
  eq(P.toPyType('List<Book>'), 'List[Book]', 'List<X> -> List[X]');
  eq(P.toPyType('Map<String, Integer>'), 'Dict[str, int]', 'Map<K,V> -> Dict[K, V]');
  eq(P.camelToSnake('createLoan'), 'create_loan', 'camelCase -> snake_case');
  eq(P.camelToSnake('checkOutBook'), 'check_out_book', 'multi-word camelCase -> snake_case');
}

/* ---------- codegen: Java & Python generation ---------- */
var CODEGEN_LIBRARY = [
  '@startuml',
  'interface Borrowable {', '  +checkOut(m: Member): Loan', '  +return(): void', '}',
  'abstract class Media {', '  #title: String', '  #year: int', '  +{abstract} describe(): String', '}',
  'class Book extends Media implements Borrowable {', '  -isbn: String', '  -pages: int', '  +describe(): String', '}',
  'enum Genre {', '  NOVEL', '  ESSAY', '}',
  'class Library {', '  -name: String', '  +register(m: Member): void', '}',
  'class Foo {', '  -class: int', '  +import(): void', '}',
  '@enduml'
].join('\n');
{
  const res = P.compile(CODEGEN_LIBRARY, { type: 'class' });
  eq(errs(res).length, 0, 'codegen source diagram is itself well-formed');

  const gm = P.classGenModel(res.model);
  eq(gm.classes.length, 6, 'one gen-model entry per top-level class/interface/enum');
  const book = gm.classes.filter(c => c.name === 'Book')[0];
  eq(book.superclass, 'Media', "Book's superclass resolved");
  eq(book.interfaces[0], 'Borrowable', "Book's interface resolved");
  ok(book.methods.some(m => m.name === 'checkOut'), 'Book gains an inherited-interface stub for checkOut');
  ok(book.methods.some(m => m.name === 'return_'), 'the stub for a reserved-word method name is itself escaped');
  ok(!book.methods.find(m => m.name === 'checkOut').bodiless, 'the injected stub has a body (bodiless=false)');
  eq(book.javaCtorParamsStr, 'String title, int year, String isbn, int pages', "Book's constructor threads Media's fields first, then its own");
  ok(book.hasSuperCtorArgs, 'Book must call super(...)');
  eq(book.superCallArgsStr, 'title, year', 'super(...) call forwards exactly the inherited fields');

  const foo = gm.classes.filter(c => c.name === 'Foo')[0];
  eq(foo.attributes[0].name, 'class_', "a Java-reserved attribute name ('class') is escaped");
  eq(foo.methods[0].name, 'import_', "a Java-reserved method name ('import') is escaped");

  const java = P.genCode(res.model, P.JAVA_TEMPLATE, 'java');
  eq(java.length, 6, 'one Java file per class');
  const bookJava = java.filter(f => f.className === 'Book')[0];
  ok(bookJava.code.includes('super(title, year);'), 'Book.java calls super(title, year)');
  ok(bookJava.code.includes('public Loan checkOut(Member m)'), 'Book.java implements the interface method');
  ok(bookJava.code.includes('public void return_()'), 'Book.java uses the escaped name for the reserved word');
  ok(!/\{\{|\}\}/.test(bookJava.code), 'no leftover template markers in Java output');
  const braceBalance = (bookJava.code.match(/\{/g) || []).length - (bookJava.code.match(/\}/g) || []).length;
  eq(braceBalance, 0, 'Book.java has balanced braces');

  const py = P.genCode(res.model, P.PYTHON_TEMPLATE, 'python');
  eq(py.length, 6, 'one Python file per class');
  const bookPy = py.filter(f => f.className === 'Book')[0];
  eq(bookPy.filename, 'book.py', 'Python filename is snake_case');
  ok(bookPy.code.includes('class Book(Media, Borrowable):'), 'book.py declares both bases');
  ok(bookPy.code.includes('from media import Media'), 'book.py imports its superclass');
  ok(bookPy.code.includes('from borrowable import Borrowable'), 'book.py imports its interface');
  ok(bookPy.code.includes('super().__init__(title, year)'), 'book.py chains to the superclass constructor');
  ok(!/\{\{|\}\}/.test(bookPy.code), 'no leftover template markers in Python output');
  const mediaPy = py.filter(f => f.className === 'Media')[0];
  ok(mediaPy.code.includes('from abc import ABC, abstractmethod'), 'media.py (abstract class) imports ABC');
  ok(mediaPy.code.includes('class Media(ABC):'), 'media.py actually derives from ABC, or @abstractmethod is a no-op');
  const genrePy = py.filter(f => f.className === 'Genre')[0];
  ok(genrePy.code.includes('from enum import Enum, auto') && genrePy.code.includes('NOVEL = auto()'), 'genre.py is a proper Python Enum');
}
{
  /* the generator must never throw on any of the corpus / examples, even
     though it only makes sense for class diagrams */
  P.EXAMPLES.forEach(ex => {
    const res = P.compile(ex.code, { strict: true });
    if (res.type !== 'class' || !res.model) return;
    try {
      P.genCode(res.model, P.JAVA_TEMPLATE, 'java');
      P.genCode(res.model, P.PYTHON_TEMPLATE, 'python');
      pass++;
    } catch (e) { fail++; console.error('FAIL: codegen threw on ' + ex.name + ': ' + e.message); }
  });
}

/* ---------- graphical editing: text-surgical transforms ---------- */
{
  const r1 = P.renameIdentifier('@startuml\nclass Car\nCar --> Wheel\n@enduml', 'Car', 'Vehicle');
  ok(!r1.error, 'rename succeeds when the identifier exists');
  eq(r1.text, '@startuml\nclass Vehicle\nVehicle --> Wheel\n@enduml', 'rename replaces the declaration and every reference');

  const r2 = P.renameIdentifier('@startuml\nclass A\nnote right of A : "A" says hello\n@enduml', 'A', 'B');
  ok(r2.text.includes('note right of B : "A" says hello'), 'rename touches the unquoted reference but leaves the quoted label text untouched');

  const r3 = P.renameIdentifier("@startuml\n' this mentions A in prose\nclass A\n@enduml", 'A', 'B');
  ok(r3.text.includes("' this mentions A in prose"), 'rename leaves whole-line comments untouched');
  ok(r3.text.includes('class B'), 'rename still applies to the real declaration');

  const r4 = P.renameIdentifier('@startuml\nclass A\n@enduml', 'A', 'not valid!');
  ok(!!r4.error, 'rename rejects a new name that is not a valid identifier');

  const r5 = P.renameIdentifier('@startuml\nclass A\n@enduml', 'Zzz', 'B');
  ok(!!r5.error, 'rename reports when the old identifier is not found');

  const r6 = P.renameIdentifier('@startuml\nclass Foobar\n@enduml', 'Foo', 'Baz');
  ok(!!r6.error, 'rename does not match a substring of a longer identifier (word boundary)');
}
{
  const empty = P.extractPosOverrides('@startuml\nclass A\n@enduml');
  eq(Object.keys(empty).length, 0, 'no @pos lines -> no overrides');

  const one = P.extractPosOverrides("@startuml\nclass A\n' @pos A 120,45.5\n@enduml");
  eq(one.A.x, 120, '@pos x parsed');
  eq(one.A.y, 45.5, '@pos y parsed (decimal)');

  const withInsert = P.upsertPosOverride('@startuml\nclass A\n@enduml', 'A', 10, 20);
  ok(withInsert.includes("' @pos A 10,20"), 'upsert inserts a new @pos line');
  ok(/^@startuml$/m.test(withInsert.split('\n')[0]), 'upsert keeps @startuml as the first line');

  const updated = P.upsertPosOverride(withInsert, 'A', 30, 40);
  const again = P.extractPosOverrides(updated);
  eq(again.A.x, 30, 'upsert on an existing id replaces it in place (x)');
  eq(again.A.y, 40, 'upsert on an existing id replaces it in place (y)');
  eq((updated.match(/@pos A/g) || []).length, 1, 'upsert never duplicates the line for the same id');
}

/* ---------- graphical editing: SVG hit-test markup + drag persistence ---------- */
{
  const res = P.compile('@startuml\nclass A\nclass B\nA --> B\n@enduml');
  ok(/data-node="A"[^>]*data-line="2"/.test(res.svg), 'class node A carries data-node + its declaration line');
  ok(/data-draggable="1"/.test(res.svg), 'a top-level class is marked draggable');
}
{
  const res = P.compile('@startuml\npackage P {\n  class A\n}\nclass B\nA --> B\n@enduml');
  const gA = /<g class="pu-node" data-node="A"[^>]*>/.exec(res.svg)[0];
  ok(gA.includes('data-draggable="0"'), 'a class inside a package is not draggable in this version');
  const gB = /<g class="pu-node" data-node="B"[^>]*>/.exec(res.svg)[0];
  ok(gB.includes('data-draggable="1"'), 'a top-level class next to a package is still draggable');
}
{
  const res = P.compile("@startuml\nclass A\nclass B\nA --> B\n' @pos B 500,500\n@enduml");
  eq(errs(res).length, 0, 'a @pos comment line does not affect validity');
  const gB = /<g class="pu-node" data-node="B"[^>]*>/.exec(res.svg)[0];
  const x = +/data-x="([\d.]+)"/.exec(gB)[1], y = +/data-y="([\d.]+)"/.exec(gB)[1];
  ok(Math.abs(x - 500) < 2 && Math.abs(y - 500) < 2, 'the overridden node is actually placed at the requested position (got ' + x + ',' + y + ')');
  ok(res.width > 500 && res.height > 500, 'the SVG bounding box grows to fit a manually-dragged-far node');
  svgSane(res, 'class with position override');
}
{
  /* dragging must never throw, even for edge cases the layout wasn't
     designed around (unknown id, negative coordinates, sequence diagrams
     which do not support dragging at all) */
  const cases = [
    "@startuml\nclass A\n' @pos Nope 10,10\n@enduml",
    "@startuml\nclass A\n' @pos A -300,-300\n@enduml",
    "@startuml\nAlice -> Bob : hi\n' @pos Alice 10,10\n@enduml"
  ];
  cases.forEach((c, i) => {
    try { const r = P.compile(c, { strict: true }); svgSane(r, 'drag-edge-case-' + i); }
    catch (e) { fail++; console.error('FAIL: drag edge case ' + i + ' threw: ' + e.message); }
  });
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
