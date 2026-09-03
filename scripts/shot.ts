// Screenshot a Bones URL at an iPhone viewport: bun run scripts/shot.ts <url> <out.png>
import { chromium } from 'playwright';
const [url, out] = [process.argv[2] ?? 'http://localhost:5199/bones/#medium-12', process.argv[3] ?? 'shot.png'];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !document.querySelector('.dealing'), null, { timeout: 30_000 });
await page.waitForTimeout(200);
await page.screenshot({ path: out });
await browser.close();
console.log(out);
