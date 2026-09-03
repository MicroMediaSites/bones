/**
 * End-to-end play test: open the deployed (or any) Bones build in headless
 * Chromium on a phone-sized viewport, deal N puzzles per difficulty, solve
 * each with the engine, and play the solution through the page's real
 * pointer handlers — tap-to-rotate, then a finger drag from the hand onto
 * the board. A puzzle counts only if every tile and cell was on screen with
 * no page scroll at the start, and the Solved panel appeared at the end.
 *
 *   bun run scripts/playtest-live.ts [url] [easy=15] [medium=0] [hard=0]
 *
 * Default url is the GitHub Pages deployment. Exit code 1 on any failure.
 */
import { chromium, type Page } from 'playwright';
import { generate } from '../src/engine/index';
import { search } from '../src/engine/solve';
import { anchorOf, placedOrientation } from '../src/ui/state';
import type { Difficulty } from '../src/engine/types';

const url = process.argv[2] ?? 'https://micromediasites.github.io/bones/';
const counts: Record<Difficulty, number> = {
  easy: Number(process.argv[3] ?? 15),
  medium: Number(process.argv[4] ?? 0),
  hard: Number(process.argv[5] ?? 0),
};

interface Box { x: number; y: number; width: number; height: number }
const centre = (b: Box): [number, number] => [b.x + b.width / 2, b.y + b.height / 2];

async function allOnScreen(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const rects = [...document.querySelectorAll('.tray .tile, .cell')].map((e) => e.getBoundingClientRect());
    const inside = rects.every((r) => r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight);
    const noScroll = document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight;
    return rects.length > 0 && inside && noScroll;
  });
}

async function tileBox(page: Page, tile: number): Promise<Box> {
  const box = await page.locator(`.tray [data-tile="${tile}"]`).boundingBox();
  if (!box) throw new Error(`tile ${tile} not in hand`);
  return box;
}

async function drag(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  for (let k = 1; k <= 8; k++) {
    await page.mouse.move(from[0] + ((to[0] - from[0]) * k) / 8, from[1] + ((to[1] - from[1]) * k) / 8);
  }
  await page.mouse.up();
}

async function playOne(page: Page, difficulty: Difficulty, first: boolean): Promise<string> {
  await page.getByRole('button', { name: first ? new RegExp(`^${difficulty}$`, 'i') : /^New puzzle$/ }).last().click();
  await page.waitForFunction(() => !document.querySelector('.dealing') && document.querySelectorAll('.tray .tile').length > 0, null, { timeout: 30_000 });
  await page.waitForTimeout(120);
  const hash = await page.evaluate(() => location.hash);
  const m = new RegExp(`^#${difficulty}-(\\d+)$`).exec(hash);
  if (!m) throw new Error(`unexpected hash ${hash}`);
  const seed = Number(m[1]);
  const puzzle = generate(difficulty, seed);
  const solution = search(puzzle, { limit: 1, maxNodes: 4_000_000 }).boards[0];
  if (!solution) throw new Error(`seed ${seed}: engine found no solution`);
  const handCount = await page.locator('.tray .tile').count();
  if (handCount !== puzzle.dominoes.length) throw new Error(`seed ${seed}: page shows ${handCount} tiles, engine dealt ${puzzle.dominoes.length}`);
  const onScreen = await allOnScreen(page);
  if (!onScreen) throw new Error(`seed ${seed}: a tile or cell is off screen, or the page scrolls`);

  const board = await page.locator('.board').boundingBox();
  if (!board) throw new Error('no board');
  const cw = board.width / puzzle.cols;
  const ch = board.height / puzzle.rows;
  for (const placement of solution) {
    const turns = placedOrientation(placement);
    const anchor = anchorOf(placement);
    for (let k = 0; k < turns; k++) {
      const [x, y] = centre(await tileBox(page, placement.domino));
      await page.mouse.click(x, y);
      await page.waitForTimeout(40);
    }
    const target: [number, number] = [board.x + (anchor.c + 0.5) * cw, board.y + (anchor.r + 0.5) * ch];
    await drag(page, centre(await tileBox(page, placement.domino)), target);
    await page.waitForTimeout(40);
    if ((await page.locator(`.tray [data-tile="${placement.domino}"]`).count()) > 0) {
      throw new Error(`seed ${seed}: tile ${placement.domino} did not place at (${anchor.r},${anchor.c})`);
    }
  }
  await page.waitForTimeout(80);
  const solved = await page.evaluate(() => /Solved/.test(document.body.innerText));
  if (!solved) throw new Error(`seed ${seed}: every tile placed but no Solved panel`);
  const free = await page.locator('.cell.free').count();
  return `${difficulty} seed ${seed}: ${puzzle.dominoes.length} tiles, ${free} free cells, solved`;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
await page.goto(url, { waitUntil: 'networkidle' });
const build = await page.evaluate(() => [...document.scripts].map((s) => s.src).find((s) => /assets\/index-/.test(s)) ?? 'inline');
console.log(`build ${build}`);
let failures = 0;
let streak = 0;
for (const difficulty of ['easy', 'medium', 'hard'] as Difficulty[]) {
  for (let i = 0; i < counts[difficulty]; i++) {
    if (i === 0 && (await page.getByRole('button', { name: /^Exit$/ }).count()) > 0) await page.getByRole('button', { name: /^Exit$/ }).click();
    try {
      console.log(await playOne(page, difficulty, i === 0));
      streak++;
    } catch (e) {
      failures++;
      streak = 0;
      console.log(`FAIL ${(e as Error).message}`);
      await page.screenshot({ path: `playtest-fail-${difficulty}-${i}.png` });
      await page.goto(url, { waitUntil: 'networkidle' });
    }
  }
}
await browser.close();
console.log(`${failures === 0 ? 'ALL PASSED' : failures + ' FAILED'} — longest streak ${streak}`);
process.exit(failures === 0 ? 0 : 1);
