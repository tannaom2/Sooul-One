/**
 * Pack illustrations for demo products: a stand-up pouch (snacks, sweets), a
 * gift box (hampers) or a gummy jar (supplements), in the brand's colour with
 * the product name, net quantity and veg mark. SVG, written to
 * public/demo-assets/ at setup and deleted at teardown.
 */
import type { DemoProduct } from "./catalogue";

const ACCENT: Record<DemoProduct["brand"], { main: string; soft: string; ink: string; label: string }> = {
  "the-true-store": { main: "#e8a317", soft: "#fbf1dc", ink: "#3b2a07", label: "THE TRUE STORE" },
  "woman-axis": { main: "#b5477e", soft: "#f7e6ef", ink: "#3d1229", label: "WOMAN AXIS" },
  "kids-vault": { main: "#2e7fbf", soft: "#e2eff9", ink: "#0d2a42", label: "KIDS VAULT" },
  "man-rituals": { main: "#1f5c4d", soft: "#e1eeea", ink: "#0b241e", label: "MAN RITUALS" },
};

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Greedy word wrap into at most `lines` lines of about `width` characters. */
function wrap(text: string, width: number, lines: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if ((line + " " + word).trim().length > width && line) {
      out.push(line);
      line = word;
    } else line = (line + " " + word).trim();
  }
  if (line) out.push(line);
  if (out.length > lines) return [...out.slice(0, lines - 1), out.slice(lines - 1).join(" ")];
  return out;
}

const vegMark = (x: number, y: number) =>
  `<rect x="${x}" y="${y}" width="34" height="34" rx="3" fill="#fff" stroke="#1b7f3b" stroke-width="3"/><circle cx="${x + 17}" cy="${y + 17}" r="9" fill="#1b7f3b"/>`;

function title(p: DemoProduct, cx: number, top: number, width: number, size: number, color: string): string {
  return wrap(p.name, width, 3)
    .map((l, i) => `<text x="${cx}" y="${top + i * size * 1.18}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="800" font-size="${size}" fill="${color}">${escape(l)}</text>`)
    .join("");
}

function pouch(p: DemoProduct): string {
  const c = ACCENT[p.brand];
  return `
  <path d="M250 150 Q400 128 550 150 L585 640 Q400 668 215 640 Z" fill="#fff" stroke="${c.ink}" stroke-opacity=".12" stroke-width="3"/>
  <path d="M250 150 Q400 128 550 150 L556 232 Q400 212 244 232 Z" fill="${c.main}"/>
  <path d="M262 176 Q400 158 538 176" stroke="#fff" stroke-opacity=".55" stroke-width="3" fill="none" stroke-dasharray="6 7"/>
  <text x="400" y="212" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="22" letter-spacing="5" fill="#fff">${c.label}</text>
  ${title(p, 400, 330, 16, 40, c.ink)}
  <rect x="300" y="480" width="200" height="4" rx="2" fill="${c.main}" opacity=".7"/>
  <text x="400" y="530" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="22" fill="${c.ink}" opacity=".8">${escape(p.category)}</text>
  <text x="400" y="600" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="26" fill="${c.ink}">${escape(p.netQuantity)}</text>
  ${p.isVeg ? vegMark(505, 570) : ""}`;
}

function box(p: DemoProduct): string {
  const c = ACCENT[p.brand];
  return `
  <path d="M170 300 L400 230 L630 300 L400 370 Z" fill="${c.main}"/>
  <path d="M170 300 L400 370 L400 660 L170 590 Z" fill="#c9a26b"/>
  <path d="M630 300 L400 370 L400 660 L630 590 Z" fill="#b48a52"/>
  <path d="M285 265 L515 335 L515 380 L285 310 Z" fill="#fff" opacity=".9"/>
  <path d="M385 235 L415 235 L415 660 L385 650 Z" fill="${c.main}" opacity=".85"/>
  <circle cx="400" cy="232" r="26" fill="${c.main}" stroke="#fff" stroke-width="4"/>
  <g transform="translate(0,0)">${title(p, 400, 470, 18, 34, "#fff")}</g>
  <text x="400" y="610" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="22" letter-spacing="4" fill="#fff">${c.label}</text>`;
}

function jar(p: DemoProduct): string {
  const c = ACCENT[p.brand];
  const gummies = [[330, 610], [370, 628], [420, 616], [466, 630], [350, 580], [445, 590]]
    .map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="17" fill="${c.main}" opacity="${0.55 + (i % 3) * 0.15}"/>`).join("");
  return `
  <rect x="290" y="150" width="220" height="70" rx="14" fill="${c.ink}"/>
  <rect x="290" y="150" width="220" height="16" rx="8" fill="#fff" opacity=".12"/>
  <path d="M258 230 Q258 212 280 212 L520 212 Q542 212 542 230 L560 640 Q560 668 530 668 L270 668 Q240 668 240 640 Z" fill="#fff" stroke="${c.ink}" stroke-opacity=".12" stroke-width="3"/>
  ${gummies}
  <rect x="252" y="270" width="296" height="270" rx="10" fill="${c.soft}"/>
  <rect x="252" y="270" width="296" height="54" rx="10" fill="${c.main}"/>
  <text x="400" y="306" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="21" letter-spacing="5" fill="#fff">${c.label}</text>
  ${title(p, 400, 372, 15, 30, c.ink)}
  <text x="400" y="516" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="21" fill="${c.ink}">${escape(p.netQuantity)}</text>
  ${p.isVeg ? vegMark(500, 486) : ""}`;
}

export function packArt(p: DemoProduct): string {
  const c = ACCENT[p.brand];
  const body = p.type === "HEALTH_SUPPLEMENT" ? jar(p) : p.category === "Gifting & Hampers" ? box(p) : pouch(p);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" width="800" height="800" role="img" aria-label="${escape(p.name)} pack">
  <rect width="800" height="800" fill="${c.soft}"/>
  <circle cx="660" cy="130" r="210" fill="${c.main}" opacity=".08"/>
  <circle cx="120" cy="720" r="170" fill="${c.main}" opacity=".07"/>
  <ellipse cx="400" cy="690" rx="230" ry="26" fill="${c.ink}" opacity=".10"/>
  ${body}
</svg>`;
}
