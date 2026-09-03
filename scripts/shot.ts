// Screenshot a Bones URL: bun run scripts/shot.ts <url> <out.png> [width height]
// Default is an iPhone viewport at 2x; pass e.g. 1100 800 for a desktop window.
import { chromium } from 'playwright';
const [url, out] = [process.argv[2] ?? 'http://localhost:5199/bones/#medium-12', process.argv[3] ?? 'shot.png'];
const width = Number(process.argv[4] ?? 390);
const height = Number(process.argv[5] ?? 844);
const mobile = width < 600;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile });
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !document.querySelector('.dealing'), null, { timeout: 30_000 });
await page.waitForTimeout(200);
await page.screenshot({ path: out });
await browser.close();
console.log(out);
