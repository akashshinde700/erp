/**
 * ForgeERP PWA icon generator.
 * Renders the brand SVG (deep-emerald factory mark, matching the app's
 * oklch(0.44 0.105 166) primary) into every size the manifest needs:
 *   icon-192, icon-512, icon-maskable-512 (80% safe zone), apple-touch-icon (180), icon-32.
 * Run: bun scripts/gen-icons.mjs
 */
import sharp from 'sharp'
import { mkdirSync } from 'node:fs'

const OUT = 'public/icons'
mkdirSync(OUT, { recursive: true })

const glyph = (scale = 1) => `
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
    <path d="M112 400V232l92 61.33V232l92 61.33V232l92 61.33V400Z" fill="#ffffff"/>
    <rect x="136" y="112" width="52" height="104" rx="10" fill="#ffffff"/>
    <circle cx="162" cy="88" r="10" fill="#ffffff" opacity="0.85"/>
    <circle cx="162" cy="58" r="7" fill="#ffffff" opacity="0.55"/>
  </g>`

const svg = (inner) => Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0b8f6d"/>
      <stop offset="1" stop-color="#045c47"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  ${inner}
</svg>`)

// Regular icons: rounded-square look comes from the OS masking "any" purpose
// icons — render full-bleed gradient with the glyph at ~62% for balance.
const jobs = [
  ['icon-192.png', 192, glyph(0.62)],
  ['icon-512.png', 512, glyph(0.62)],
  ['icon-32.png', 32, glyph(0.62)],
  ['apple-touch-icon.png', 180, glyph(0.6)],
  // Maskable: glyph confined to the 80% safe zone (never clipped by circular masks)
  ['icon-maskable-512.png', 512, glyph(0.5)],
]

for (const [name, size, inner] of jobs) {
  await sharp(svg(inner)).resize(size, size).png().toFile(`${OUT}/${name}`)
  console.log(`✓ ${OUT}/${name} (${size}×${size})`)
}
console.log('done')
