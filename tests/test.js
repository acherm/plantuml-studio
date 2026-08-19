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
  const res = P.compile('@startuml\ndeactivate A\n@enduml');
  ok(has(res, 'error', /has not appeared yet/), 'deactivate unknown participant');
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

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
