// Optional real-browser regression check against a running Vite/preview server.
// Install Playwright separately and set PLAYWRIGHT_MODULE to its index.mjs when
// it is outside node_modules. CHROMIUM_PATH can select a system browser.
// Camera responses are fixtures: real transport coexistence still needs manual validation.
import assert from 'node:assert/strict';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--no-sandbox'],
});
let checks = 0;
const check = (condition, message) => {
  assert.ok(condition, message);
  checks++;
  console.log(`PASS ${message}`);
};
try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 }, serviceWorkers: 'block' });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (/\/(?:camera|additional-camera)\/(?:stream|snapshot)$/.test(path)) {
      return route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#204030"/></svg>',
      });
    }
    const body = path.endsWith('/auth/status')
      ? { auth_enabled: false, requires_setup: false }
      : path.includes('token')
        ? { token: 'browser-token', expires_in: 3600 }
        : path.endsWith('/additional-camera/status')
          ? { configured: true, enabled: true, friendly_name: 'Overhead', frames_recent: true }
          : path.endsWith('/camera/status')
            ? { active: true, stalled: false }
            : /\/printers\/1$/.test(path)
              ? { id: 1, name: 'Browser printer', camera_rotation: 90 }
              : path.endsWith('/printers/1/status')
                ? { state: 'IDLE', connected: true }
                : path.includes('color')
                  ? { colors: {}, by_material: {} }
                  : {};
    return route.fulfill({ json: body });
  });
  await page.goto(`${process.env.BOTH_CAMERA_ORIGIN || 'http://localhost:4178'}/camera/1/both`);
  const root = page.locator('[data-camera-viewer="both:1"]');
  const primary = root.locator('[data-camera-pane="primary"]');
  const extra = root.locator('[data-camera-pane="additional"]');
  await extra
    .locator('img')
    .waitFor()
    .catch(async (error) => {
      console.error('Browser errors:', errors);
      console.error('Page:', await page.locator('body').innerText());
      throw error;
    });
  await primary.locator('img').waitFor();
  const layout = async () => ({ primary: await primary.boundingBox(), extra: await extra.boundingBox() });
  const containedPrimary = async () => {
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    return primary.locator('img').evaluate((img) => {
      const frame = img.parentElement.getBoundingClientRect();
      const image = img.getBoundingClientRect();
      return (
        image.left >= frame.left - 1 &&
        image.right <= frame.right + 1 &&
        image.top >= frame.top - 1 &&
        image.bottom <= frame.bottom + 1
      );
    });
  };
  let box = await layout();
  check(
    Math.abs(box.primary.y - box.extra.y) < 2 && box.extra.x > box.primary.x,
    'wide viewer places Primary left and Additional right',
  );
  check(await containedPrimary(), 'rotated Primary image fits the wide pane at 100%');
  await root.evaluate((el) => {
    el.style.width = '480px';
    el.style.height = '720px';
  });
  box = await layout();
  check(
    Math.abs(box.primary.x - box.extra.x) < 2 && box.extra.y > box.primary.y,
    '480px viewer stacks on a 1360px desktop',
  );
  check(await containedPrimary(), 'rotated Primary image fits the narrow pane at 100%');
  check(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    'narrow viewer has no horizontal document overflow',
  );
  await root.evaluate((el) => {
    el.style.width = '640px';
  });
  box = await layout();
  check(Math.abs(box.primary.y - box.extra.y) < 2, '640px viewer uses two columns');
  await root.evaluate((el) => {
    el.style.width = '639px';
  });
  box = await layout();
  check(box.extra.y > box.primary.y, '639px viewer stacks');
  const before = await extra.locator('img').getAttribute('src');
  await extra.locator('img').evaluate((el) => {
    window.__bothExtraImage = el;
  });
  await root.getByTitle('Fullscreen', { exact: true }).click();
  await page.waitForFunction(() => document.fullscreenElement?.getAttribute('data-camera-viewer') === 'both:1');
  box = await layout();
  check(Math.abs(box.primary.y - box.extra.y) < 2, 'combined fullscreen expands and reflows both panes');
  check(
    (await extra.locator('img').evaluate((el) => el === window.__bothExtraImage)) &&
      (await extra.locator('img').getAttribute('src')) === before,
    'fullscreen preserves the Additional request and image',
  );
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(() => !document.fullscreenElement);
  box = await layout();
  check(box.extra.y > box.primary.y, 'leaving fullscreen restores narrow viewer geometry and stacking');
  await root.evaluate((el) => {
    el.style.width = '';
    el.style.height = '';
  });
  await page.setViewportSize({ width: 390, height: 844 });
  box = await layout();
  check(box.extra.y > box.primary.y, 'mobile popup stacks');
  check(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    'mobile popup has no horizontal overflow',
  );
  check(errors.length === 0, `no browser runtime errors (${errors.join('; ')})`);
  console.log(`${checks} browser checks passed`);
} finally {
  await browser.close();
}
