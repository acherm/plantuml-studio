#!/usr/bin/env node
/* Builds: dist/puml-core.cjs (for tests), plantuml-studio.html (standalone), dist/artifact.html (fragment for Claude Artifact). */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

const CORE_FILES = ['pre.js', 'layout.js', 'classdiag.js', 'sequence.js', 'usecase.js', 'state.js', 'main.js'];
const core = CORE_FILES.map(f => fs.readFileSync(path.join(root, 'src/core', f), 'utf8')).join('\n');

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/puml-core.cjs'), core);

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
fs.writeFileSync(path.join(root, 'plantuml-studio.html'), standalone);
fs.writeFileSync(path.join(root, 'index.html'), standalone); /* GitHub Pages entry point */
fs.writeFileSync(path.join(root, 'dist/artifact.html'), body);
console.log('built plantuml-studio.html + index.html (' + (standalone.length / 1024).toFixed(0) + ' KB), dist/artifact.html, dist/puml-core.cjs');
