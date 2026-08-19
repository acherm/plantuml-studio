#!/usr/bin/env node
/* Cross-tests Studio's checker against the vendored official PlantUML engine.
   Serves the repo over localhost, drives tests/conformance.html in headless
   Chrome, and reports agreements/divergences.
   Usage: node tools/conformance.js [--strict]   (--strict: exit 1 on cases we
   accept but the official engine flags as a syntax error) */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const root = path.join(__dirname, '..');
const strict = process.argv.includes('--strict');
const CHROME = process.env.CHROME ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.cjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  const p = path.normalize(path.join(root, decodeURIComponent(req.url.split('?')[0])));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

const CHUNK = 8;

/* NOTE: the chrome child must run async — a sync exec would block this
   process's event loop and deadlock the in-process HTTP server. */
function runChunk(base, from) {
  return new Promise((resolve, reject) => {
    const url = `${base}/tests/conformance.html?from=${from}&count=${CHUNK}`;
    execFile(CHROME, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars',
      '--virtual-time-budget=120000', '--dump-dom', url
    ], { maxBuffer: 64 * 1024 * 1024, encoding: 'utf8', timeout: 180000 }, (err, dom) => {
      if (err && !dom) { reject(new Error('chrome failed at from=' + from + ': ' + err.message)); return; }
      const m = /<pre id="results">([\s\S]*?)<\/pre>/.exec(dom || '');
      if (!m || !m[1].trim()) { reject(new Error('no results in harness output at from=' + from + ' (is vendor/ present? did Chrome run?)')); return; }
      const json = m[1]
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'").replace(/&amp;/g, '&');
      resolve(JSON.parse(json));
    });
  });
}

server.listen(0, '127.0.0.1', async () => {
  const base = `http://127.0.0.1:${server.address().port}`;
  const rows = [];
  try {
    let from = 0, fullTotal = Infinity;
    while (from < fullTotal) {
      const data = await runChunk(base, from);
      fullTotal = data.fullTotal;
      rows.push(...data.results);
      from += CHUNK;
      process.stderr.write(`  …${rows.length}/${fullTotal}\n`);
    }
  } catch (e) {
    console.error('FAILED: ' + e.message);
    server.close();
    process.exit(2);
  } finally {
    server.close();
  }
  const data = { results: rows };

  const selfFail = rows.filter(r => !r.selfCheck);
  const weAcceptTheyReject = rows.filter(r => r.ours === 'ok' && r.official === 'error');
  const weRejectTheyAccept = rows.filter(r => r.ours === 'error' && r.official === 'ok');
  const crashes = rows.filter(r => r.official === 'crash');
  const agree = rows.filter(r => r.agree).length;

  console.log(`conformance: ${rows.length} cases, ${agree} agree with the official engine\n`);
  const show = (label, list, detail) => {
    if (!list.length) return;
    console.log(label);
    list.forEach(r => console.log('  - ' + r.name + (detail && r.officialText ? '\n      official: ' + r.officialText.slice(0, 160) : '')));
    console.log('');
  };
  show('SELF-CHECK FAILURES (Studio verdict differs from the corpus expectation):', selfFail);
  show('WE ACCEPT / OFFICIAL REJECTS (most serious — Studio may be too lax):', weAcceptTheyReject, true);
  show('WE REJECT / OFFICIAL ACCEPTS (Studio is stricter — often intentional):', weRejectTheyAccept);
  show('OFFICIAL ENGINE CRASHED OR TIMED OUT:', crashes);

  fs.writeFileSync(path.join(root, 'tests', 'conformance-report.json'), JSON.stringify(data, null, 2));
  console.log('report: tests/conformance-report.json');

  if (selfFail.length || (strict && weAcceptTheyReject.length)) process.exit(1);
});
