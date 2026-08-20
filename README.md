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

Editor services: **auto-completion** (keywords per diagram type + the names of
your declared elements; triggers while typing, or Ctrl/Cmd+Space), column-precise
**error squiggles**, **hover tooltips** on problem lines, one-click **quick fixes**
("did you mean class?", missing `@startuml`/`@enduml`), and semantic colouring of
declared element names. PlantUML keywords are case-insensitive throughout
(`Object`/`OBJECT`/`object` all work), matching real PlantUML.

**Graphical editing, bi-synchronized with the text** (class, object, use case and
state diagrams): click a shape to select it and jump the editor to its
declaration line; double-click its name to rename it — every reference updates,
string labels don't; drag it to reposition it, saved as an ordinary
`' @pos Name x,y` comment (invisible to real PlantUML, honored only by this
editor's layout). The diagram stays a pure function of the text — dragging never
creates a separate model, it rewrites the source and recompiles, the same way
every other edit here works.

**Code generation** (class diagrams → Java or Python, `Code` in the toolbar):
inheritance and interface realization become `extends`/`implements`
(Python: multiple inheritance + `ABC`/`@abstractmethod`), constructors chain to
their superclass, a concrete class picks up stub overrides for any inherited
interface/abstract method it doesn't itself declare, reserved words (`return`,
`class`, …) are escaped automatically. The Java and Python templates are a
small, editable Mustache-like text format (`{{name}}`, `{{#each attributes}}`,
`{{#if isAbstract}}`) — edit either one live in the modal; per-class output
regenerates as you type, in either the template or the diagram.

## Relationship to PlantUML

This is **not** a PlantUML replacement — it is a validation-first teaching
companion that implements a documented subset. For full-fidelity rendering,
PlantUML itself now runs client-side: the official
[js-plantuml build](https://plantuml.github.io/plantuml/js-plantuml/) (TeaVM +
Viz.js, ~5.4 MB of static files) — and that build is integrated here: the
**"PlantUML β" tab** in the preview pane renders the current text with the real
engine (vendored in `vendor/`, loaded lazily; needs HTTP, not `file://`), while
diagnostics keep coming from Studio's checker. What Studio adds over the official
tooling is the feedback layer: structured line-anchored diagnostics, semantic
lint, completion — PlantUML exposes none of that.

`node tools/conformance.js` cross-tests Studio's verdicts against the vendored
official engine over a corpus (`tests/conformance-corpus.js`): it reports where
Studio accepts what PlantUML rejects (bad — `--strict` makes it fail CI) and
where Studio is stricter (usually intentional). Report lands in
`tests/conformance-report.json`. As of the vendored `1.2026.7beta12`: 41/44
cases agree, **no** case where Studio is laxer, and 3 cases of deliberate extra
strictness — PlantUML silently accepts a `clas` typo, silently auto-closes an
unclosed `alt`, and silently merges duplicate `class` declarations; Studio
reports all three, which is the point of this tool. (PlantUML keywords are
case-insensitive — `Object`, `Class Foo Extends Bar` — confirmed against the
real engine and matched here.)

## Layout

- `src/core/*.js` — pure, DOM-free engine: `pre.js` (preprocess, detection, arrow
  grammar, SVG primitives, `@pos`/rename text-surgery helpers), `layout.js`
  (layered graph layout with containers, cycle breaking, drag-position
  overrides), one parser+renderer per diagram family, `editor.js` (completion),
  `codegen.js` (template engine + class-diagram → Java/Python generation),
  `main.js` (`PUML.compile`, examples, syntax reference)
- `src/app.js` / `src/style.css` / `src/shell.html` — editor UI (highlighting,
  gutter, problems panel, pan/zoom preview, click/drag/rename on the diagram,
  code-generation modal, exports, help modal, light/dark)
- `tools/build-single.js` — builds `plantuml-studio.html` (standalone),
  `dist/artifact.html` (fragment for Claude Artifacts), `dist/puml-core.cjs` (tests)
- `tests/test.js` — 407 assertions incl. seeded mutation fuzzing (must never throw)
- `tests/conformance.html` + `tools/conformance.js` — cross-engine conformance harness
- `vendor/` — unmodified official js-plantuml build (own licenses, see `vendor/README.md`)

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
- License: MIT (see `LICENSE`); the `vendor/` files keep their upstream licenses.
