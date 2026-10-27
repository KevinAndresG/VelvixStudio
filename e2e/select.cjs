// Home: select projects and delete them in bulk (only touches the two it creates).
const { _electron } = require('../node_modules/playwright-core');
const APP = require('path').resolve(__dirname, '..'), S = process.argv[2] || __dirname;
(async () => {
  const app = await _electron.launch({ executablePath: require(APP + '/node_modules/electron'), args: [APP], cwd: APP });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForSelector('.new-card', { timeout: 20000 });
  const ids = ['zzsel1', 'zzsel2'];
  await page.evaluate(async (ids) => { for (const id of ids) await window.api.saveProject({ id, name: 'SEL-TEST ' + id, width: 1920, height: 1080, clips: [], tracks: [], media: [], updatedAt: Date.now(), createdAt: Date.now() }); }, ids);
  await page.reload(); await page.waitForSelector('.new-card');
  const before = await page.evaluate(() => window.api.listProjects().then((l) => l.length));
  await page.fill('.search input', 'SEL-TEST');
  await page.click('.proj-head button:has-text("Seleccionar")');
  await page.click('.proj-head button:has-text("Seleccionar todo")');
  const n = await page.locator('.proj.selected').count();
  await page.screenshot({ path: S + '/sel.png' });
  await page.click('.proj-head button:has-text("Eliminar")');
  await page.click('.modal-actions .btn.danger');
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => window.api.listProjects().then((l) => l.map((p) => p.id)));
  console.log({ selected: n, removed: before - after.length, gone: ids.every((i) => !after.includes(i)), errors });
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
