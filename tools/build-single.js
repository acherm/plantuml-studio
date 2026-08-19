#!/usr/bin/env node
/* Builds: dist/puml-core.cjs (for tests), plantuml-studio.html (standalone), dist/artifact.html (fragment for Claude Artifact).
   Custom edition: --extra <file.js> appends a JS file to the core (e.g. course
   examples pushed into P.EXAMPLES) and --out <path> writes ONLY that standalone
   HTML, leaving the default outputs (and the pristine dist/puml-core.cjs) untouched. */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

const args = process.argv.slice(2);
const argOf = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const extraFile = argOf('--extra');
const outFile = argOf('--out');

const CORE_FILES = ['pre.js', 'layout.js', 'classdiag.js', 'sequence.js', 'usecase.js', 'state.js', 'editor.js', 'main.js'];
let core = CORE_FILES.map(f => fs.readFileSync(path.join(root, 'src/core', f), 'utf8')).join('\n');
if (extraFile) core += '\n' + fs.readFileSync(extraFile, 'utf8');

const shell = fs.readFileSync(path.join(root, 'src/shell.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/style.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8');

function assemble(tpl) {
  return tpl
    .replace('/*__CSS__*/', () => css)
    .replace('//__CORE__', () => core)
    .replace('//__APP__', () => app);
}

const body = assemble(shell);
const standalone = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n</head>\n<body>\n' + body + '\n</body>\n</html>\n';

if (outFile) {
  fs.writeFileSync(outFile, standalone);
  console.log('built ' + outFile + ' (' + (standalone.length / 1024).toFixed(0) + ' KB)'
              + (extraFile ? ' [extra: ' + path.basename(extraFile) + ']' : ''));
} else {
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist/puml-core.cjs'), core);
  fs.writeFileSync(path.join(root, 'plantuml-studio.html'), standalone);
  fs.writeFileSync(path.join(root, 'index.html'), standalone); /* GitHub Pages entry point */
  fs.writeFileSync(path.join(root, 'dist/artifact.html'), body);
  console.log('built plantuml-studio.html + index.html (' + (standalone.length / 1024).toFixed(0) + ' KB), dist/artifact.html, dist/puml-core.cjs');
}
