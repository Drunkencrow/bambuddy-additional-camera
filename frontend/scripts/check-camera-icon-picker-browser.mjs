// Run against a production preview. Uses fixture APIs; never changes real configurations.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const origin = process.env.CAMERA_ICON_ORIGIN || 'http://127.0.0.1:4178';
const config = {
  id: 1, printer_id: 1, friendly_name: 'Review camera', enabled: true, camera_type: 'mjpeg',
  camera_url: 'http://camera/video', snapshot_url: null, rotation: 0,
  additional_icon: 'camera-plus', both_icon: 'dual-camera', created_at: '', updated_at: '',
};
try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 }, serviceWorkers: 'block' });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/additional-camera')) {
      if (route.request().method() === 'PUT') Object.assign(config, route.request().postDataJSON());
      return route.fulfill({ json: config });
    }
    const body = path.endsWith('/auth/status') ? { auth_enabled: false, requires_setup: false }
      : path === '/api/v1/printers/' ? [{ id: 1, name: 'Review printer' }]
      : /\/(settings|settings\/ui-preferences|version|status|usage|summary)$/.test(path) ? {}
      : path.includes('color') ? { colors: {}, by_material: {} }
      : path.includes('token') ? { token: 'review' }
      : [];
    await route.fulfill({ json: body });
  });
  await page.goto(`${origin}/settings?tab=additional-cameras`);
  const card = page.getByRole('region', { name: 'Review printer' });
  await card.waitFor().catch(async (error) => {
    console.error('Browser errors:', errors);
    console.error('Page:', await page.locator('body').innerText());
    throw error;
  });
  const additional = card.getByRole('combobox', { name: 'Additional Camera Icon', exact: true });
  const both = card.getByRole('combobox', { name: 'Both Cameras Icon', exact: true });
  const fields = ['Friendly Name', 'Enabled', 'Camera Type', 'Camera URL', 'Snapshot URL (optional)', 'Rotation'];
  const bounds = async () => Promise.all([
    ...fields.map(name => card.getByLabel(name, { exact: false })), additional, both,
    card.getByRole('button', { name: 'Test Camera', exact: true }),
  ].map(control => control.boundingBox()));
  const verifyDesktop = async () => {
    const [friendly, enabled, type, url, snapshot, rotation, icon, bothIcon, buttons] = await bounds();
    assert.ok(Math.abs(friendly.y - type.y) < 1);
    assert.ok(enabled.y > friendly.y + friendly.height);
    assert.ok(type.x > friendly.x + friendly.width);
    assert.ok(Math.abs(friendly.width - type.width) < 1);
    for (const field of [url, snapshot]) {
      assert.ok(Math.abs(field.x - friendly.x) < 1);
      assert.ok(Math.abs(field.width - (type.x + type.width - friendly.x)) < 1);
    }
    assert.ok(Math.abs(rotation.y - icon.y) < 1);
    assert.ok(Math.abs(icon.x - type.x) < 1);
    assert.ok(Math.abs(rotation.width - icon.width) < 1);
    assert.ok(bothIcon.y > icon.y + icon.height);
    assert.ok(buttons.y > bothIcon.y + bothIcon.height);
  };
  await verifyDesktop();
  await page.setViewportSize({ width: 1000, height: 1000 });
  await verifyDesktop();
  await page.setViewportSize({ width: 1360, height: 1000 });
  await additional.focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  assert.match(await additional.innerText(), /Video \+ Plus/);
  assert.match(await both.innerText(), /Dual Cameras/);
  await additional.press('Enter');
  await additional.press('End');
  await additional.press('Escape');
  assert.match(await additional.innerText(), /Video \+ Plus/);
  await additional.press('Enter');
  await additional.press('Tab');
  assert.equal(await additional.getAttribute('aria-expanded'), 'false');
  assert.equal(await both.evaluate(el => el === document.activeElement), true);
  for (const [control, count] of [[additional, 7], [both, 4]]) {
    await control.click();
    const options = card.getByRole('listbox').getByRole('option');
    assert.equal(await options.count(), count);
    const names = await options.allTextContents();
    await control.press('Escape');
    for (const name of names) {
      await control.click();
      const option = card.getByRole('option', { name, exact: true });
      const box = await option.locator('svg').first().boundingBox();
      const rem = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
      assert.ok(Math.abs(box.width - rem) < 0.1); assert.ok(Math.abs(box.height - rem) < 0.1);
      await option.click();
      assert.equal((await control.innerText()).trim(), name.trim());
      assert.equal(await control.locator('svg').count(), 2);
    }
  }
  await card.getByRole('button', { name: 'Save', exact: true }).click();
  await card.getByText('Additional Camera saved', { exact: true }).waitFor();
  await page.reload();
  await card.waitFor();
  assert.match(await additional.innerText(), /Board Camera/);
  assert.match(await both.innerText(), /Split Camera View/);
  await page.screenshot({ path: '/tmp/camera-icon-picker-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const mobile = await bounds();
  for (let index = 1; index < mobile.length; index++) {
    assert.ok(mobile[index].y >= mobile[index - 1].y + mobile[index - 1].height);
  }
  const [friendly, , type, url, snapshot, rotation, icon] = mobile;
  for (const field of [type, url, snapshot, rotation, icon]) {
    assert.ok(Math.abs(field.x - friendly.x) < 1);
    assert.ok(Math.abs(field.width - friendly.width) < 1);
  }
  const a = await additional.boundingBox();
  const b = await both.boundingBox();
  assert.ok(b.y > a.y + a.height);
  assert.ok(Math.abs(a.width - b.width) < 1);
  assert.ok(a.height <= 42);
  await additional.click();
  assert.equal(await card.getByRole('listbox').getByRole('option').count(), 7);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: '/tmp/camera-icon-picker-mobile.png', fullPage: true });
  await additional.press('Escape');
  assert.deepEqual(errors, []);
  console.log('PASS: all 11 SVG options and selected previews, combobox keyboard navigation and dismissal, independent groups, save/reload, desktop/tablet equal columns, full-width URLs, mobile stacking, no runtime errors');
} finally {
  await browser.close();
}
