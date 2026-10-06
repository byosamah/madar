function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** A colour as a hue (0 to 359), a saturation and a lightness (0 to 100), as in CSS hsl(). */
export type Hsl = readonly [number, number, number];

/** The shapes of a generated "render" on a 1600 x 900 canvas: the sky from top to bottom, 5 building blocks and the ground. */
export type Scene = {
  sky: readonly [Hsl, Hsl];
  blocks: { x: number; y: number; width: number; height: number; fill: Hsl }[];
  ground: { y: number; fill: Hsl };
};

/** The scene of one picture. renderSvg draws it, and the test office of madar-test draws it as a PNG (scripts/seed-pictures.ts). */
export function sceneOf(hue: number, variant: number): Scene {
  const blocks = [0, 1, 2, 3, 4].map((i) => {
    const width = 150 + ((i * 53 + variant * 31) % 90);
    const height = 260 + ((i * 97 + variant * 61) % 380);
    const fill: Hsl = i % 2 === 0 ? [(hue + 190) % 360, 35, 60] : [hue, 18, 32];
    return { x: 180 + i * 260, y: 820 - height, width, height, fill };
  });
  return { sky: [[hue, 45, 78], [(hue + 30) % 360, 50, 92]], blocks, ground: { y: 820, fill: [hue, 12, 22] } };
}

const hsl = ([h, s, l]: Hsl) => `hsl(${h} ${s}% ${l}%)`;

/** A simple generated "render": sky, building blocks, ground and a title. */
export function renderSvg(title: string, subtitle: string, hue: number, variant: number): string {
  const scene = sceneOf(hue, variant);
  const blocks = scene.blocks
    .map((block) => `<rect x="${block.x}" y="${block.y}" width="${block.width}" height="${block.height}" fill="${hsl(block.fill)}"/>`)
    .join('');
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">',
    `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hsl(scene.sky[0])}"/><stop offset="1" stop-color="${hsl(scene.sky[1])}"/></linearGradient></defs>`,
    '<rect width="1600" height="900" fill="url(#sky)"/>',
    blocks,
    `<rect y="${scene.ground.y}" width="1600" height="${900 - scene.ground.y}" fill="${hsl(scene.ground.fill)}"/>`,
    `<text x="64" y="96" font-family="Inter, Arial, sans-serif" font-size="44" font-weight="700" fill="#1D1D1F">${escapeXml(title)}</text>`,
    `<text x="64" y="146" font-family="Inter, Arial, sans-serif" font-size="28" fill="#1D1D1F" fill-opacity="0.72">${escapeXml(subtitle)}</text>`,
    '</svg>',
  ].join('');
}

/** A one-page landscape PDF with plain ASCII text. The cross-reference offsets are exact, so PDF viewers open it. */
export function drawingPdf(lines: string[]): string {
  const safe = lines.map((line) => line.replace(/[^\x20-\x7E]/g, '').replace(/[()\\]/g, ''));
  const text = safe.map((line, i) => `BT /F1 ${i === 0 ? 20 : 12} Tf 56 ${540 - i * 28} Td (${line}) Tj ET`).join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}
