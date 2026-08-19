# PlantUML Studio

A self-contained, offline PlantUML editor with **live well-formedness checking** and
**graphical rendering** — a single HTML file, no server, no Java, no network.
Built for teaching UML: precise diagnostics (with line numbers and "did you mean…?"
suggestions) matter as much as the picture.

**Live: <https://blog.mathieuacher.com/plantuml-studio/>** — or open
`plantuml-studio.html` in any browser. That's the whole app.

Supported diagram types (a well-defined subset of PlantUML, reimplemented in JS):

- **Class** — class/abstract/interface/enum/annotation, members with visibility &
  `{static}`/`{abstract}`, extends/implements, all arrow kinds (`--|>`, `..|>`, `-->`,
  `*--`, `o--`, `..>`), multiplicities, labels, packages, notes
- **Object** — objects, fields (block or `o : f = v`), links, notes
- **Sequence** — participants/actor/database…, sync/async/dashed messages, `++`/`--`,
  activate/deactivate/destroy/return, alt/opt/loop/par/break/critical/group, notes,
  ref, dividers, delays, autonumber, hide footbox
- **Use case** — actors, use cases (`(…)`, `:…:` shorthands), rectangle boundaries,
  «include»/«extend», actor generalization
- **State** — `[*]` initial/final, transitions, composite states, choice/fork/join,
  internal descriptions, notes, plus reachability & missing-initial-state warnings

Validation: syntax errors with suggestions, duplicate declarations, unclosed blocks,
references to undeclared elements, unbalanced fragments, activation misuse,
unreachable states, missing `@startuml`/`@enduml`, and more. The diagram type is
auto-detected (overridable in the toolbar).

## Layout

- `src/core/*.js` — pure, DOM-free engine: `pre.js` (preprocess, detection, arrow
  grammar, SVG primitives), `layout.js` (layered graph layout with containers +
  cycle breaking), one parser+renderer per diagram family, `main.js`
  (`PUML.compile`, examples, syntax reference)
- `src/app.js` / `src/style.css` / `src/shell.html` — editor UI (highlighting,
  gutter, problems panel, pan/zoom preview, exports, help modal, light/dark)
- `tools/build-single.js` — builds `plantuml-studio.html` (standalone),
  `dist/artifact.html` (fragment for Claude Artifacts), `dist/puml-core.cjs` (tests)
- `tests/test.js` — 239 assertions incl. seeded mutation fuzzing (must never throw)

## Build & test

```sh
node tools/build-single.js
node tests/test.js
```

## Notes

- The text is the single source of truth; the SVG is recomputed on every edit.
- `#ex=3` in the URL loads example 3 (used by the screenshot tests).
- skinparam/themes/preprocessor (`!include`, `!define`) are accepted or flagged but
  not interpreted — this is deliberate: the tool checks models, not styling.
