/** Gera os ícones PNG do app (tela de início do celular e notificações) a partir da logo. */
import sharp from "sharp";
import path from "node:path";

const OUT = path.join(import.meta.dirname, "..", "public");
const funnel = (fill: string) =>
  `<g fill="${fill}" stroke="${fill}" stroke-width="4" stroke-linejoin="round"><rect x="2" y="2" width="60" height="15" rx="7.5" stroke="none"/><path d="M12 23 H52 L45 34 H19 Z"/><path d="M24 40 H40 L35.5 50 H28.5 Z"/></g>`;

/** Logo centralizada ocupando `scale` do quadro, sobre fundo opcional. */
const art = (bg: string | null, fill: string, scale: number, rounded = false) => {
  const s = 64 * scale;
  const off = (64 - s) / 2;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${bg ? `<rect width="64" height="64" ${rounded ? 'rx="14"' : ""} fill="${bg}"/>` : ""}<g transform="translate(${off} ${off + s * 0.07}) scale(${scale})">${funnel(fill)}</g></svg>`,
  );
};

const jobs: [string, Buffer, number][] = [
  ["icon-192.png", art("#ffffff", "#00A878", 0.72), 192],
  ["icon-512.png", art("#ffffff", "#00A878", 0.72), 512],
  // "maskable": o sistema recorta em círculo/forma própria, então a logo fica dentro da zona segura (80%).
  ["icon-maskable-512.png", art("#008A65", "#ffffff", 0.56), 512],
  ["apple-touch-icon.png", art("#ffffff", "#00A878", 0.7), 180],
  // Ícone pequeno da barra de status do Android: só a silhueta branca em fundo transparente.
  ["badge-96.png", art(null, "#ffffff", 0.86), 96],
];

for (const [name, svg, size] of jobs) {
  await sharp(svg, { density: 600 }).resize(size, size).png().toFile(path.join(OUT, name));
  console.log("ok", name);
}
