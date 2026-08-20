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
