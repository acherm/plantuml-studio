/* Conformance corpus: snippets inside Studio's documented subset, plus invalid ones.
   ours: verdict expected from PUML.compile ('ok' = no errors, 'error' = at least one). */
var CONF_CORPUS = [
  /* ---- valid, inside the subset ---- */
  { name: 'class minimal', ours: 'ok', code: '@startuml\nclass A\n@enduml' },
  { name: 'class members+vis', ours: 'ok', code: '@startuml\nclass Car {\n  -speed: int\n  +drive(): void\n  #brand: String\n  ~tag: int\n}\n@enduml' },
  { name: 'class inheritance', ours: 'ok', code: '@startuml\nclass A\nclass B\nA <|-- B\n@enduml' },
  { name: 'class realization', ours: 'ok', code: '@startuml\ninterface I\nclass C\nC ..|> I\n@enduml' },
  { name: 'class composition+cards', ours: 'ok', code: '@startuml\nclass A\nclass B\nA "1" *-- "0..*" B : owns\n@enduml' },
  { name: 'class extends inline', ours: 'ok', code: '@startuml\nclass B extends A implements I\n@enduml' },
  { name: 'class package', ours: 'ok', code: '@startuml\npackage P {\n  class X\n}\nclass Y\nX --> Y\n@enduml' },
  { name: 'class enum', ours: 'ok', code: '@startuml\nenum Color {\n  RED\n  GREEN\n}\n@enduml' },
  { name: 'class static/abstract members', ours: 'ok', code: '@startuml\nabstract class S {\n  {static} +count: int\n  {abstract} +area(): double\n}\n@enduml' },
  { name: 'class note', ours: 'ok', code: '@startuml\nclass A\nnote right of A : hello\n@enduml' },
  { name: 'object basic', ours: 'ok', code: '@startuml\nobject o1 {\n  x = 1\n}\nobject o2\no1 --> o2 : link\n@enduml' },
  { name: 'sequence basic', ours: 'ok', code: '@startuml\nAlice -> Bob : hi\nBob --> Alice : yo\n@enduml' },
  { name: 'sequence participants', ours: 'ok', code: '@startuml\nactor U\nparticipant "The UI" as UI\ndatabase D\nU -> UI : go\nUI ->> D : async\n@enduml' },
  { name: 'sequence activation', ours: 'ok', code: '@startuml\nA -> B ++ : call\nB --> A -- : done\n@enduml' },
  { name: 'sequence alt/loop', ours: 'ok', code: '@startuml\nalt cond\n  A -> B : x\nelse other\n  A -> B : y\nend\nloop 3 times\n  B -> A : z\nend\n@enduml' },
  { name: 'sequence note/divider/delay', ours: 'ok', code: '@startuml\nA -> B : m\nnote over A,B : both\n== Phase ==\n... later ...\n@enduml' },
  { name: 'sequence autonumber+return', ours: 'ok', code: '@startuml\nautonumber\nA -> B ++ : req\nreturn resp\n@enduml' },
  { name: 'usecase basic', ours: 'ok', code: '@startuml\nactor U\nusecase "Do it" as UC\nU --> UC\n@enduml' },
  { name: 'usecase shorthands+include', ours: 'ok', code: '@startuml\n:Member: --> (Borrow)\n(Borrow) ..> (Auth) : include\n@enduml' },
  { name: 'usecase boundary', ours: 'ok', code: '@startuml\nactor A\nrectangle "Sys" {\n  usecase U1\n}\nA --> U1\n@enduml' },
  { name: 'state basic', ours: 'ok', code: '@startuml\n[*] --> Idle\nIdle --> Run : start\nRun --> [*]\n@enduml' },
  { name: 'state composite', ours: 'ok', code: '@startuml\n[*] --> Active\nstate Active {\n  [*] --> Warm\n  Warm --> Cold : x\n}\nActive --> [*]\n@enduml' },
  { name: 'state choice', ours: 'ok', code: '@startuml\n[*] --> A\nstate c1 <<choice>>\nA --> c1\nc1 --> B : [yes]\nc1 --> C : [no]\nB --> [*]\nC --> [*]\n@enduml' },
  { name: 'state description', ours: 'ok', code: '@startuml\n[*] --> S\nS : doing things\nS --> [*]\n@enduml' },
  { name: 'title + comments', ours: 'ok', code: "@startuml\ntitle Hello\n' a comment\nclass A\n@enduml" },

  /* ---- invalid or misspelled ---- */
  { name: 'typo clas', ours: 'error', code: '@startuml\nclas Foo\n@enduml' },
  { name: 'unclosed class brace', ours: 'error', code: '@startuml\nclass A {\n  +x: int\n@enduml' },
  { name: 'stray end', ours: 'error', code: '@startuml\nA -> B : x\nend\n@enduml' },
  { name: 'unclosed alt', ours: 'error', code: '@startuml\nalt cond\nA -> B : x\n@enduml' },
  { name: 'garbage line', ours: 'error', code: '@startuml\nclass A\nthis is not plantuml at all\n@enduml' },
  { name: 'note to nowhere', ours: 'error', code: '@startuml\nclass A\nnote left of Zed : nope\n@enduml' },
  { name: 'duplicate class', ours: 'error', code: '@startuml\nclass A\nclass A\n@enduml' }
];
if (typeof module !== 'undefined' && module.exports) module.exports = CONF_CORPUS;
