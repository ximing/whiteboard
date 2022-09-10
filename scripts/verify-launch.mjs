import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'packages/app/dist');
const scratch = process.env.SCRATCH;
if (!scratch) {
  console.error('SCRATCH is required');
  process.exit(1);
}
fs.mkdirSync(scratch, { recursive: true });

const LIGHT = [213, 224, 228];
const DARK = [16, 24, 32];

function checkDist() {
  const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  const lines = [];
  if (!html.includes('Serve this folder over HTTP')) lines.push('missing file:// serve hint');
  if (!html.includes('type="module"')) lines.push('entry is not an ES module');
  if (!/src="\.\/assets\/[^"]+\.js"/.test(html)) lines.push('script URL is not relative');
  if (/src="\/assets\//.test(html) || /href="\/assets\//.test(html)) lines.push('asset URL is absolute');
  const jsFiles = fs.readdirSync(path.join(dist, 'assets')).filter((name) => name.endsWith('.js'));
  if (jsFiles.length === 0) lines.push('no javascript asset');
  for (const name of jsFiles) {
    const source = fs.readFileSync(path.join(dist, 'assets', name), 'utf8');
    if (source.includes('module.exports') || /\brequire\(/.test(source)) lines.push(`${name} uses Node require`);
  }
  return lines;
}

function serve(dir) {
  const rootDir = path.resolve(dir);
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.svg': 'image/svg+xml',
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const decoded = decodeURIComponent(url.pathname);
    const rel = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
    const file = path.resolve(rootDir, rel);
    if (!file.startsWith(rootDir + path.sep) && file !== rootDir) {
      res.writeHead(403);
      res.end();
      return;
    }
    fs.readFile(file, (error, data) => {
      if (error) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, url: `http://127.0.0.1:${address.port}/` });
    });
  });
}

function delta(pixel, color) {
  return Math.abs(pixel[0] - color[0]) + Math.abs(pixel[1] - color[1]) + Math.abs(pixel[2] - color[2]);
}

async function runOnce(browser, url, label) {
  const lines = [];
  const log = (message) => {
    lines.push(message);
    console.log(`[${label}] ${message}`);
  };
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  let failed = null;
  try {
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('canvas[data-ready="true"]');
    const metrics = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      const dpr = window.devicePixelRatio || 1;
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      const ctx = canvas.getContext('2d');
      const points = [];
      for (let y = 40; y <= vh - 40; y += Math.floor((vh - 80) / 4)) {
        for (let x = 40; x <= vw - 40; x += Math.floor((vw - 80) / 5)) {
          const pixel = ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data;
          points.push([pixel[0], pixel[1], pixel[2], pixel[3]]);
        }
      }
      return {
        cw: canvas.width,
        ch: canvas.height,
        expectW: Math.round(vw * dpr),
        expectH: Math.round(vh * dpr),
        dpr,
        vw,
        vh,
        points,
      };
    });
    log(`canvas ${metrics.cw}x${metrics.ch} viewport ${metrics.vw}x${metrics.vh} dpr ${metrics.dpr} expected ${metrics.expectW}x${metrics.expectH}`);
    if (metrics.cw !== metrics.expectW || metrics.ch !== metrics.expectH) {
      throw new Error(`canvas bitmap ${metrics.cw}x${metrics.ch} is not the viewport times devicePixelRatio`);
    }
    if (metrics.cw === 300 && metrics.ch === 150) throw new Error('canvas is the default 300x150 bitmap');
    const painted = metrics.points.filter((pixel) => delta(pixel, LIGHT) <= 3);
    log(`background samples ${painted.length}/${metrics.points.length} match the light canvas`);
    if (painted.length < metrics.points.length - 1) throw new Error('canvas background does not cover the surface');

    await page.mouse.move(240, 360);
    await page.mouse.down();
    for (let x = 255; x <= 640; x += 20) await page.mouse.move(x, 360);
    await page.mouse.up();
    await page.waitForFunction(() => {
      const raw = localStorage.getItem('plume.board.v1');
      return !!raw && JSON.parse(raw).objects.some((object) => object.type === 'stroke');
    });
    const ink = await scan(page, LIGHT);
    log(`pen drag changed ${ink} pixels along the stroke`);
    if (ink < 8) throw new Error('pen drag did not change pixels along the stroke');

    await page.click('[data-tool="rect"]');
    await page.mouse.move(260, 150);
    await page.mouse.down();
    await page.mouse.move(480, 310, { steps: 10 });
    await page.mouse.up();
    await page.click('[data-tool="ellipse"]');
    await page.mouse.move(540, 170);
    await page.mouse.down();
    await page.mouse.move(760, 340, { steps: 10 });
    await page.mouse.up();
    await page.click('[data-tool="connector"]');
    await page.mouse.click(370, 230);
    await page.mouse.click(650, 255);
    await page.waitForFunction(() => {
      const raw = localStorage.getItem('plume.board.v1');
      if (!raw) return false;
      const objects = JSON.parse(raw).objects;
      const kinds = objects.map((object) => (object.type === 'shape' ? object.kind : object.type));
      return kinds.includes('stroke') && kinds.includes('rect') && kinds.includes('ellipse') && kinds.includes('connector');
    });
    const lightShot = path.join(scratch, `${label}-light.png`);
    await page.screenshot({ path: lightShot });
    log(`light screenshot ${lightShot}`);

    const beforeTheme = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      const pixel = canvas.getContext('2d').getImageData(8, 8, 1, 1).data;
      return [pixel[0], pixel[1], pixel[2]];
    });
    await page.click('[data-testid="theme-toggle"]');
    await page.waitForFunction(() => {
      const raw = localStorage.getItem('plume.board.v1');
      return document.documentElement.dataset.theme === 'dark' && !!raw && JSON.parse(raw).theme === 'dark';
    });
    const afterTheme = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      const pixel = canvas.getContext('2d').getImageData(8, 8, 1, 1).data;
      return [pixel[0], pixel[1], pixel[2]];
    });
    log(`theme background ${beforeTheme.join(',')} -> ${afterTheme.join(',')}`);
    if (delta(beforeTheme, afterTheme) < 40) throw new Error('theme toggle did not change the canvas background');
    if (delta(afterTheme, DARK) > 3) throw new Error(`dark canvas pixel ${afterTheme.join(',')} is not the theme background`);
    const darkShot = path.join(scratch, `${label}-dark.png`);
    await page.screenshot({ path: darkShot });
    log(`dark screenshot ${darkShot}`);

    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('canvas[data-ready="true"]');
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    const restored = await scan(page, DARK);
    log(`after reload, ${restored} stroke pixels differ from the dark background`);
    if (restored < 8) throw new Error('stroke was not restored after reload');
    const shot = path.join(scratch, `${label}.png`);
    await page.screenshot({ path: shot });
    log(`screenshot ${shot}`);
    if (errors.length) throw new Error(`page errors:\n${errors.join('\n')}`);
    log('PASS');
  } catch (error) {
    failed = error;
    if (errors.length) log(errors.join('\n'));
    log(`FAIL ${error.stack ?? error.message}`);
    try {
      await page.screenshot({ path: path.join(scratch, `${label}-fail.png`) });
    } catch {
      /* The page may already be closed. */
    }
  } finally {
    fs.writeFileSync(path.join(scratch, `${label}.log`), `${lines.join('\n')}\n`);
    await context.close();
  }
  if (failed) throw failed;
}

async function scan(page, background) {
  return page.evaluate((bg) => {
    const canvas = document.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    let changed = 0;
    for (let x = 280; x <= 600; x += 10) {
      for (let y = 352; y <= 368; y += 2) {
        const pixel = ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data;
        const distance = Math.abs(pixel[0] - bg[0]) + Math.abs(pixel[1] - bg[1]) + Math.abs(pixel[2] - bg[2]);
        if (distance > 80) changed += 1;
      }
    }
    return changed;
  }, background);
}

const distProblems = checkDist();
if (distProblems.length) {
  console.error(distProblems.join('\n'));
  process.exit(1);
}
console.log('dist entry is a relative ES module with a file:// serve hint');

let playwright;
try {
  playwright = await import('playwright');
} catch (error) {
  const message = `playwright import failed\n${error.stack ?? error.message}\n`;
  fs.writeFileSync(path.join(scratch, 'playwright-failure.log'), message);
  console.error(message);
  process.exit(1);
}

const { server, url } = await serve(dist);
console.log(`serving ${url}`);
let browser;
try {
  browser = await playwright.chromium.launch({ headless: true });
  await runOnce(browser, url, 'launch-1');
  await browser.close();
  browser = await playwright.chromium.launch({ headless: true });
  await runOnce(browser, url, 'launch-2');
} catch (error) {
  const message = `${error.stack ?? error.message}\n`;
  fs.appendFileSync(path.join(scratch, 'playwright-failure.log'), message);
  console.error(message);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

if (process.exitCode) process.exit(process.exitCode);
