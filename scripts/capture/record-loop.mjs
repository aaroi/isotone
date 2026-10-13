// Records docs/assets/loop.gif: variants, then a pinned note, then an agent
// picking the note up and closing it, on the hosted demo build.
//
//   pnpm build:demo && python3 -m http.server 4190 --directory demo-dist &
//   node scripts/capture/record-loop.mjs http://127.0.0.1:4190/ docs/assets/loop.gif
//
// Needs Chrome (see cdp.mjs) and ffmpeg on PATH.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, sleep } from './cdp.mjs';

const [url, gif] = process.argv.slice(2);
const outDir = mkdtempSync(join(tmpdir(), 'isotone-loop-'));
const W = 920, H = 620;
const b = await launch({ width: W, height: H, scale: 2 });
await b.goto(url);
// No tour: the recording shows the panel on its own.
await b.eval(`localStorage.setItem('isotone-demo-tour', 'seen')`);
await b.goto(url);
// Demo scaffolding out, a visible pointer in.
await b.eval(`(() => {
  document.querySelector('.demo-bar')?.remove();
  document.querySelector('.app').style.minHeight = '100dvh';
  const c = document.createElement('div');
  c.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M5 3l14 8-6 1.5L10 19z" fill="#fff" stroke="#000" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  c.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transform:translate(-200px,-200px);filter:drop-shadow(0 1px 2px rgb(0 0 0 / .5))';
  document.body.append(c);
  addEventListener('mousemove', (e) => { c.style.transform = 'translate(' + (e.clientX - 5) + 'px,' + (e.clientY - 3) + 'px)'; }, true);
})()`);
const root = `document.querySelector('[data-isotone=demo]').shadowRoot`;
const center = (expr) => b.eval(`(() => { const r = (${expr}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
const inPanel = (sel) => center(`${root}.querySelector('${sel}')`);
let pos = [W * 0.55, H * 0.55];
async function glide([x, y], ms = 650) {
  const steps = Math.max(8, Math.round(ms / 16));
  const [x0, y0] = pos;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, e = t < .5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    await b.move(x0 + (x - x0) * e, y0 + (y - y0) * e); await sleep(16);
  }
  pos = [x, y];
}
async function clickAt(target, pause = 450) { await glide(target); await sleep(120); await b.click(...target); await sleep(pause); }

const frames = [];
b.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
  frames.push({ data, t: metadata.timestamp });
  b.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
});
await b.move(...pos);
await sleep(300);
await b.send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1 });
await sleep(600);

// 1. Variants: open the panel, try a layout, spacing and a colour.
// Hovering the launcher fans out the rail; Variants opens on its own.
await glide(await inPanel('.isotone-fab'), 700); await sleep(450);
await clickAt(await inPanel('[aria-label="Variants"]'), 600);
await clickAt(await inPanel('[aria-label="Feature"]'), 750);
await clickAt(await inPanel('[aria-label="Sidebar"]'), 750);
await clickAt(await inPanel('[aria-label="Spacious"]'), 650);
await clickAt(await inPanel('[aria-label="Green"]'), 850);

// 2. Feedback: close variants, pin a card, write the note.
await clickAt(await inPanel('[aria-label="Variants"]'), 300);
await clickAt(await inPanel('[aria-label="Feedback"]'), 700);
await clickAt(await inPanel('[aria-label="Select elements"]'), 500);
// Aim at the card's own padding so the whole card is pinned.
const card = await b.eval(`(() => { const r = document.querySelector('#overview-cards article:nth-child(2)').getBoundingClientRect(); return [r.right - 28, r.top + r.height * 0.55]; })()`);
await glide(card, 900); await sleep(450);
await b.click(...card); await sleep(600);
await b.type('Make this number stand out more'); await sleep(400);
await b.key('Enter', 'Enter', 13); await sleep(700);
await b.key('Escape', 'Escape', 27); await sleep(300);
await glide([W * 0.3, H * 0.86], 700); await sleep(300);

// 3. The demo's pretend agent picks the note up (isotone --working) about
// 1.6s after it's sent, then closes it (--done) about 5s later.
await sleep(7600);

await b.send('Page.stopScreencast');
b.close();
frames.forEach((f, i) => { writeFileSync(`${outDir}/f${String(i).padStart(5, '0')}.jpg`, Buffer.from(f.data, 'base64')); });
const lines = ['ffconcat version 1.0'];
frames.forEach((f, i) => {
  lines.push(`file f${String(i).padStart(5, '0')}.jpg`);
  lines.push(`duration ${Math.max(0.016, ((frames[i + 1]?.t ?? f.t + 1) - f.t)).toFixed(3)}`);
});
lines.push(`file f${String(frames.length - 1).padStart(5, '0')}.jpg`);
writeFileSync(`${outDir}/frames.txt`, lines.join('\n'));
// 1.3x speed, 12 fps, 880 wide, one shared palette.
execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(outDir, 'frames.txt'), '-vf',
  'setpts=PTS/1.3,fps=12,scale=880:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle',
  '-loop', '0', gif]);
rmSync(outDir, { recursive: true, force: true });
console.log(`${frames.length} frames over ${(frames.at(-1).t - frames[0].t).toFixed(1)}s -> ${gif}`);
