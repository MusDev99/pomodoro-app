// Static checks for the PWA files — run with `node --test tests/*.test.js`.
// The app is hosted under a subpath on GitHub Pages, so every path must be relative.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

/** The SHELL array from sw.js, without executing the worker. */
function shellPaths() {
  const m = read('sw.js').match(/const SHELL = \[([\s\S]*?)\];/);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

test('manifest is valid JSON with relative scope and existing PNG icons', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'));
  manifest.icons.forEach((icon) => {
    assert.ok(!icon.src.startsWith('/'), `${icon.src} must be relative`);
    const png = fs.readFileSync(path.join(root, icon.src));
    assert.equal(png.subarray(1, 4).toString(), 'PNG', `${icon.src} is a PNG`);
  });
});

test('service worker caches every app file, using relative paths that exist', () => {
  const shell = shellPaths();
  ['./index.html', './app.js', './store.js', './timer-core.js', './style.css'].forEach((f) => {
    assert.ok(shell.includes(f), `${f} is cached`);
  });
  shell.forEach((p) => {
    assert.ok(p.startsWith('./'), `${p} must be relative`);
    assert.ok(fs.existsSync(path.join(root, p)), `${p} exists`);
  });
});

test('index.html loads scripts with relative paths and app.js registers sw.js relatively', () => {
  const html = read('index.html');
  [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((u) => !/^(https?:|#)/.test(u))
    .forEach((u) => assert.ok(!u.startsWith('/'), `${u} must be relative`));
  assert.match(read('app.js'), /serviceWorker\.register\('sw\.js'\)/);
  assert.doesNotMatch(read('app.js'), /fetch\(['`]\/api/);
});
