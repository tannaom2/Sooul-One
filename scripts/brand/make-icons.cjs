// Renders the SooulOne monogram and share card with the site's own font, then packs favicon.ico.
// Run from the repo root: node <this file>
const fs = require("fs");
const path = require("path");

const { chromium } = require(path.resolve("node_modules/playwright"));

// Inlined: a page set with setContent is about:blank, which can't load file:// fonts.
const inline = (f) => `data:font/woff2;base64,${fs.readFileSync(path.resolve("public/fonts", f)).toString("base64")}`;
const FONT = inline("bricolage-grotesque-latin-v1.woff2");
const BODY = inline("public-sans-latin-v1.woff2");
const OUT = "public";
const face = `@font-face{font-family:B;src:url("${FONT}");font-weight:600 800}@font-face{font-family:P;src:url("${BODY}");font-weight:400 700}`;

// Tile: ink square, cream S, turmeric bar. `pad` shrinks the art for maskable icons.
const tile = (size, pad = 0, rounded = true) => {
  const art = size * (1 - pad * 2);
  return `<!doctype html><style>${face}html,body{margin:0;background:transparent}
.t{width:${size}px;height:${size}px;background:#241c15;border-radius:${rounded ? Math.round(size * 0.14) : 0}px;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden}
.s{font-family:B;font-weight:800;color:#f2ede4;font-size:${Math.round(art * 0.8)}px;line-height:1;transform:translateY(-${Math.round(art * 0.05)}px)}
.b{position:absolute;left:50%;transform:translateX(-50%);bottom:${Math.round(size * pad + art * 0.13)}px;width:${Math.round(art * 0.36)}px;height:${Math.max(2, Math.round(art * 0.075))}px;background:#e8a317;border-radius:${Math.max(1, Math.round(art * 0.03))}px}
</style><div class="t"><span class="s">S</span><span class="b"></span></div>`;
};

const og = `<!doctype html><style>${face}html,body{margin:0}
.c{width:1200px;height:630px;background:#f2ede4;display:flex;flex-direction:column;justify-content:center;padding:0 96px;box-sizing:border-box;position:relative;font-family:P;color:#241c15}
.w{font-family:B;font-weight:800;font-size:120px;letter-spacing:-0.03em;line-height:1}
.l{margin-top:28px;font-size:40px;color:#5b4f45;max-width:880px;line-height:1.3}
.r{position:absolute;left:96px;bottom:72px;display:flex;gap:14px}.r i{display:block;width:88px;height:12px;border-radius:4px}
.m{position:absolute;right:96px;top:84px;width:132px;height:132px;background:#241c15;border-radius:18px;display:flex;align-items:center;justify-content:center}
.m b{font-family:B;font-weight:800;color:#f2ede4;font-size:104px;line-height:1;transform:translateY(-6px)}
.m u{position:absolute;bottom:18px;left:42px;width:48px;height:10px;background:#e8a317;border-radius:4px}</style>
<div class="c"><div class="m"><b>S</b><u></u></div><div class="w">SooulOne</div><div class="l">Healthy snacks and daily gummies. Every label, in full, before you buy.</div>
<div class="r"><i style="background:#e8a317"></i><i style="background:#b5477e"></i><i style="background:#2e7fbf"></i><i style="background:#1f5c4d"></i></div></div>`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const shot = async (html, w, h, file) => {
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(html);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(OUT, file), omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
  };
  // Apple rounds the corners itself, so its icon is a full square.
  await shot(tile(16), 16, 16, "favicon-16x16.png");
  await shot(tile(32), 32, 32, "favicon-32x32.png");
  await shot(tile(48), 48, 48, "icon-48.tmp.png");
  await shot(tile(180, 0, false), 180, 180, "apple-touch-icon.png");
  await shot(tile(192), 192, 192, "android-chrome-192x192.png");
  await shot(tile(512), 512, 512, "android-chrome-512x512.png");
  // Maskable: full-bleed square, art inside the central safe zone.
  await shot(tile(512, 0.12, false), 512, 512, "android-chrome-maskable-512x512.png");
  await shot(og, 1200, 630, "og-default.png");
  await browser.close();

  // favicon.ico holding the 16, 32 and 48 PNGs (PNG-in-ICO, read by every current browser).
  const files = [
    [16, "favicon-16x16.png"],
    [32, "favicon-32x32.png"],
    [48, "icon-48.tmp.png"],
  ];
  const imgs = files.map(([, f]) => fs.readFileSync(path.join(OUT, f)));
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(imgs.length, 4);
  let offset = 6 + 16 * imgs.length;
  const dir = imgs.map((img, i) => {
    const n = files[i][0];
    const e = Buffer.alloc(16);
    e.writeUInt8(n, 0);
    e.writeUInt8(n, 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(img.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += img.length;
    return e;
  });
  fs.writeFileSync(path.join(OUT, "favicon.ico"), Buffer.concat([head, ...dir, ...imgs]));
  fs.unlinkSync(path.join(OUT, "icon-48.tmp.png"));
  console.log("icons done");
})();
