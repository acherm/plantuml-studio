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
state diagrams — the "Studio" render tab only, not "PlantUML β": see below):
click a shape to select it and jump the editor to its declaration line;
double-click its name to rename it everywhere it's referenced — class/object/state
names are renamed as identifiers (word-boundary, string labels untouched), use
case/actor free-text names (`(Borrow a book)`, `:Some Actor:`) are renamed as
labels instead; drag it to reposition it, saved as an ordinary `' @pos Name x,y`
comment (invisible to real PlantUML, honored only by this editor's layout). The
diagram stays a pure function of the text — dragging never creates a separate
model, it rewrites the source and recompiles, the same way every other edit here
works. This is node-level editing (rename/move/navigate a class, object, use
case, state, or note); editing an individual attribute or an association
graphically — as opposed to selecting the class and editing its text — isn't
implemented yet.

**Code generation** (class diagrams → Java or Python, `Code` in the toolbar):
inheritance and interface realization become `extends`/`implements`
(Python: multiple inheritance + `ABC`/`@abstractmethod`), constructors chain to
their superclass and thread inherited/associated fields through `super(...)`, a
concrete class picks up stub overrides for any inherited interface/abstract
method it doesn't itself declare, reserved words (`return`, `class`, …) are
escaped automatically. **Associations** (composition `*--`, aggregation `o--`,
directed `-->`, and plain `--`) become typed fields on the owning side —
to-many multiplicities become `List<X>`/`List[X]` initialized empty in the
constructor, not passed as an argument; dependency (`..>`) is skipped, since
it's a "uses", not a "has-a". The Java and Python templates are a small,
editable Mustache-like text format (`{{name}}`, `{{#each attributes}}`,
`{{#if isAbstract}}`) — edit either one live in the modal; per-class output
regenerates as you type, in either the template or the diagram. **Download
project (.zip)** exports a complete, buildable project — `pom.xml` +
`src/main/java/*.java` for Java (`mvn compile` works unmodified), or
`pyproject.toml` + `.python-version` + flat `*.py` + `main.py` for Python, laid
out exactly like `uv init` produces (`uv run main.py` works unmodified, offline,
zero config). Both verified against the real toolchains (`javac`, `mvn compile`,
`uv sync`/`uv run`, `python3 -c "import ast; ast.parse(...)"`), not just
"looks right" — that caught several real bugs (reserved-word collisions, missing
constructor chaining, `@abstractmethod` silently doing nothing without `ABC`,
missing imports for both sibling classes and well-known JDK types like `Date`).

### Where "List" comes from in the generated code

Two independent mechanisms are involved, and only one of them is editable from
the template pane in the UI — worth knowing before you go looking for `List`
in the wrong place:

- **The field's type** (`List<Media>` in Java, `List[Media]` in Python) is
  decided in `src/core/codegen.js`, not the template, from two sources:
  - **Hand-typed in the diagram** — e.g. `-books: List<Book>` — passed through
    largely unchanged for Java; for Python, `toPyType()` (`codegen.js`,
    `toPyType`) recognizes `List`/`ArrayList`/`LinkedList`/`Collection`
    case-insensitively and maps to `List[...]` (same function also handles
    `Set`/`Map`). This is the general Java→Python type mapper, also used for
    method parameters and return types.
  - **Derived from an association arrow** — a composition/aggregation/
    directed/plain association whose far-end multiplicity is to-many (see
    `isManyCard()`) becomes a collection field. The exact strings
    `'List<' + targetName + '>'` and `'List[' + targetName + ']'` are built
    directly in the assoc-field block inside `classGenModel()` (PASS 1.5) —
    this does **not** go through `toPyType()`, since the target is always a
    plain class name. This is the line to change if you want a different
    collection type (e.g. `Set<X>`) for association-derived fields.

  Either way, by the time the template runs, `{{type}}`/`{{pyType}}` are
  already resolved strings — editing the template box cannot change *which*
  collection type gets chosen, only how a given `{{type}}` is laid out on the
  page.

- **Whether the `List` *import* is emitted** is a separate decision:
  `needsJavaCollections` (true if any instance attribute is a to-many
  collection) and `needsTyping` (true if any attribute or method parameter's
  `pyType` matches `List[`/`Set[`/`Dict[`) are booleans computed in JS and
  handed to the template as flags. But the import line's actual **text** —
  `import java.util.List;` / `from typing import List, Set, Dict` — is plain
  text sitting inside `P.JAVA_TEMPLATE`/`P.PYTHON_TEMPLATE`, gated by
  `{{#if needsJavaCollections}}`/`{{#if needsTyping}}`. That part genuinely
  is template text: open the Code modal and edit those two lines directly to
  change or add an import, no source edit required.

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
  grammar, SVG primitives, `@pos`/rename/label text-surgery helpers), `layout.js`
  (layered graph layout with containers, cycle breaking, drag-position
  overrides), one parser+renderer per diagram family, `editor.js` (completion),
  `zip.js` (dependency-free ZIP writer, STORE method), `codegen.js` (template
  engine + class-diagram → Java/Python generation + Maven/uv project scaffolding),
  `main.js` (`PUML.compile`, examples, syntax reference)
- `src/app.js` / `src/style.css` / `src/shell.html` — editor UI (highlighting,
  gutter, problems panel, pan/zoom preview, click/drag/rename on the diagram,
  code-generation modal, exports, help modal, light/dark)
- `tools/build-single.js` — builds `plantuml-studio.html` (standalone),
  `dist/artifact.html` (fragment for Claude Artifacts), `dist/puml-core.cjs` (tests)
- `tests/test.js` — 455 assertions incl. seeded mutation fuzzing (must never throw)
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
