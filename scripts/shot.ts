// Screenshot a Bones URL: bun run scripts/shot.ts <url> <out.png> [width height [placeN]]
// Default is an iPhone viewport at 2x; pass e.g. 1100 800 for a desktop window.
// placeN > 0 plays the first N tiles of the engine's solution before shooting.
import { chromium } from 'playwright';
import { generate } from '../src/engine/index';
import { search } from '../src/engine/solve';
import { anchorOf, placedOrientation } from '../src/ui/state';
import type { Difficulty } from '../src/engine/types';
const [url, out] = [process.argv[2] ?? 'http://localhost:5199/bones/#medium-12', process.argv[3] ?? 'shot.png'];
const width = Number(process.argv[4] ?? 390);
const height = Number(process.argv[5] ?? 844);
const placeN = Number(process.argv[6] ?? 0);
const mobile = width < 600;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile });
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !document.querySelector('.dealing'), null, { timeout: 30_000 });
await page.waitForTimeout(200);
if (placeN > 0) {
  const m = /^#(easy|medium|hard)-(\d+)$/.exec(new URL(url).hash);
  if (!m) throw new Error('placeN needs a #difficulty-seed hash');
  const puzzle = generate(m[1] as Difficulty, Number(m[2]));
  const solution = search(puzzle, { limit: 1, maxNodes: 4_000_000 }).boards[0] ?? [];
  const board = await page.locator('.board').boundingBox();
  if (!board) throw new Error('no board');
  for (const placement of solution.slice(0, placeN)) {
    const turns = placedOrientation(placement);
    const anchor = anchorOf(placement);
    for (let k = 0; k < turns; k++) {
      const b = await page.locator(`.tray [data-tile="${placement.domino}"]`).boundingBox();
      if (!b) break;
      await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      await page.waitForTimeout(40);
    }
    const b = await page.locator(`.tray [data-tile="${placement.domino}"]`).boundingBox();
    if (!b) continue;
    const from: [number, number] = [b.x + b.width / 2, b.y + b.height / 2];
    const to: [number, number] = [board.x + (anchor.c + 0.5) * (board.width / puzzle.cols), board.y + (anchor.r + 0.5) * (board.height / puzzle.rows)];
    await page.mouse.move(from[0], from[1]);
    await page.mouse.down();
    for (let k = 1; k <= 8; k++) await page.mouse.move(from[0] + ((to[0] - from[0]) * k) / 8, from[1] + ((to[1] - from[1]) * k) / 8);
    await page.mouse.up();
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(150);
}
await page.screenshot({ path: out });
await browser.close();
console.log(out);
