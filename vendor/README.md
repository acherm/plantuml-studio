# Vendored third-party files

These files are **not** covered by this repository's MIT license. They are
unmodified builds fetched on 2026-08-19 from the official js-plantuml demo site
<https://plantuml.github.io/plantuml/js-plantuml/> (PlantUML compiled to
JavaScript with TeaVM; engine version at fetch time: `1.2026.7beta12`).

- `plantuml.js` — PlantUML engine, TeaVM build.
  Copyright the PlantUML authors, <https://github.com/plantuml/plantuml>.
  PlantUML is distributed under its own licenses (GPL by default; see
  <https://plantuml.com/license>).
- `viz-global.js` — Viz.js (GraphViz compiled to WebAssembly), bundled by the
  js-plantuml build. Viz.js is MIT-licensed,
  <https://github.com/mdaines/viz-js>. GraphViz is EPL-licensed.

SHA-256 at vendoring time:

```
ad704263c221adb09be6678bc9e3f563aadd61e21caad7a2d2844faa272c39eb  plantuml.js
ef2cd8a08b5cf8b65e3634131052b41870ff30bb6fb23e23a87fd09d44666cba  viz-global.js
```

They are loaded **lazily and optionally** by the app (the "PlantUML β" renderer
tab) and by `tests/conformance.html`; PlantUML Studio itself works without them.
To update: re-download the two files from the URL above and refresh the hashes
and version here.
