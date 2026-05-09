// Minimal no-dependency QR generator for CarryOkie manual signaling.
// Fixed model: QR Version 10, ECC L, byte mode, mask 0. Capacity: 274 data codewords.
// Byte mode overhead is 20 bits plus terminator/padding, so keep chunks below 260 bytes
// to leave room for the `chunk:i/n:` prefix and avoid edge-of-capacity scanner failures.
const VERSION = 10;
const SIZE = 17 + VERSION * 4;
const DATA_CODEWORDS = 274;
export const QR_MAX_TEXT_BYTES = 260;
const EC_CODEWORDS_PER_BLOCK = 18;
const BLOCK_SIZES = [68, 68, 69, 69];
const ALIGN = [6, 28, 50];

function pushBits(bits: number[], value: number, length: number): void {
  for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
}
function bitsToBytes(bits: number[]): number[] {
  const out = [];
  for (let i = 0; i < bits.length; i += 8)
    out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  return out;
}
function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = ((z << 1) ^ ((z >>> 7) * 0x11d)) & 0xff;
    if ((y >>> i) & 1) z ^= x;
  }
  return z;
}
function rsGenerator(degree: number): number[] {
  let poly = [1];
  let root = 1;
  for (let i = 0; i < degree; i++) {
    const next = Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= gfMul(poly[j], root);
      next[j + 1] ^= poly[j];
    }
    poly = next;
    root = gfMul(root, 2);
  }
  return poly;
}
function rsRemainder(data: number[], degree: number): number[] {
  const gen = rsGenerator(degree);
  const rem = Array(degree).fill(0);
  for (const b of data) {
    const factor = b ^ rem.shift();
    rem.push(0);
    for (let i = 0; i < degree; i++) rem[i] ^= gfMul(gen[i], factor);
  }
  return rem;
}
function encodeData(text: string): number[] {
  const bytes = [...new TextEncoder().encode(text)];
  if (bytes.length > QR_MAX_TEXT_BYTES)
    throw new Error(
      `QR chunk too large (${bytes.length} bytes). Use smaller chunks.`,
    );
  const bits = [];
  pushBits(bits, 0b0100, 4); // byte mode
  pushBits(bits, bytes.length, 16); // version 10 byte count indicator
  bytes.forEach((b) => pushBits(bits, b, 8));
  pushBits(bits, 0, Math.min(4, DATA_CODEWORDS * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = bitsToBytes(bits);
  for (let pad = 0xec; data.length < DATA_CODEWORDS; pad ^= 0xec ^ 0x11)
    data.push(pad);
  return data;
}
function makeCodewords(text: string): number[] {
  const data = encodeData(text);
  const blocks = [];
  let off = 0;
  for (const size of BLOCK_SIZES) {
    const dat = data.slice(off, off + size);
    off += size;
    blocks.push({ data: dat, ec: rsRemainder(dat, EC_CODEWORDS_PER_BLOCK) });
  }
  const out = [];
  for (let i = 0; i < Math.max(...BLOCK_SIZES); i++)
    for (const b of blocks) if (i < b.data.length) out.push(b.data[i]);
  for (let i = 0; i < EC_CODEWORDS_PER_BLOCK; i++)
    for (const b of blocks) out.push(b.ec[i]);
  return out;
}
function blankMatrix(): (boolean | null)[][] {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
}
function set(
  m: (boolean | null)[][],
  r: number,
  c: number,
  v: boolean | null,
): void {
  if (r >= 0 && r < SIZE && c >= 0 && c < SIZE) m[r][c] = !!v;
}
function reserve(
  m: (boolean | null)[][],
  r: number,
  c: number,
  v = false,
): void {
  set(m, r, c, v);
}
function addFinder(m: (boolean | null)[][], row: number, col: number): void {
  for (let r = -1; r <= 7; r++)
    for (let c = -1; c <= 7; c++) {
      const rr = row + r,
        cc = col + c;
      if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE) continue;
      const dark =
        r >= 0 &&
        r <= 6 &&
        c >= 0 &&
        c <= 6 &&
        (r === 0 ||
          r === 6 ||
          c === 0 ||
          c === 6 ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4));
      set(m, rr, cc, dark);
    }
}
function addAlignment(m: (boolean | null)[][], row: number, col: number): void {
  if (m[row][col] !== null) return;
  for (let r = -2; r <= 2; r++)
    for (let c = -2; c <= 2; c++)
      set(m, row + r, col + c, Math.max(Math.abs(r), Math.abs(c)) !== 1);
}
function bch(value: number, poly: number, shift: number): number {
  let v = value << shift;
  const top = 1 << Math.floor(Math.log2(poly));
  for (let i = Math.floor(Math.log2(v)); i >= shift; i--)
    if ((v >>> i) & 1) v ^= poly << (i - Math.floor(Math.log2(poly)));
  return (value << shift) | v;
}
function addFunctionPatterns(m: (boolean | null)[][]): void {
  addFinder(m, 0, 0);
  addFinder(m, 0, SIZE - 7);
  addFinder(m, SIZE - 7, 0);
  for (let i = 8; i < SIZE - 8; i++) {
    set(m, 6, i, i % 2 === 0);
    set(m, i, 6, i % 2 === 0);
  }
  for (const r of ALIGN) for (const c of ALIGN) addAlignment(m, r, c);
  set(m, 4 * VERSION + 9, 8, true);
  for (let i = 0; i < 9; i++) {
    reserve(m, 8, i);
    reserve(m, i, 8);
  }
  for (let i = 0; i < 8; i++) {
    reserve(m, 8, SIZE - 1 - i);
    reserve(m, SIZE - 1 - i, 8);
  }
  const versionBits = bch(VERSION, 0x1f25, 12);
  for (let i = 0; i < 18; i++) {
    const bit = ((versionBits >>> i) & 1) === 1;
    set(m, Math.floor(i / 3), SIZE - 11 + (i % 3), bit);
    set(m, SIZE - 11 + (i % 3), Math.floor(i / 3), bit);
  }
}
function placeData(m: (boolean | null)[][], codewords: number[]): void {
  const bits = [];
  codewords.forEach((b) => pushBits(bits, b, 8));
  let idx = 0,
    upward = true;
  for (let col = SIZE - 1; col >= 1; col -= 2) {
    if (col === 6) col--;
    for (let i = 0; i < SIZE; i++) {
      const row = upward ? SIZE - 1 - i : i;
      for (let c = col; c >= col - 1; c--)
        if (m[row][c] === null) {
          const raw = bits[idx++] || 0;
          const masked = raw ^ ((row + c) % 2 === 0 ? 1 : 0);
          set(m, row, c, masked);
        }
    }
    upward = !upward;
  }
}
function addFormat(m: (boolean | null)[][]): void {
  const format = bch(0b01000, 0x537, 10) ^ 0x5412; // ECC L, mask 0
  const bit = (i) => ((format >>> i) & 1) === 1;
  const a = [
    [8, 0],
    [8, 1],
    [8, 2],
    [8, 3],
    [8, 4],
    [8, 5],
    [8, 7],
    [8, 8],
    [7, 8],
    [5, 8],
    [4, 8],
    [3, 8],
    [2, 8],
    [1, 8],
    [0, 8],
  ];
  a.forEach(([r, c], i) => set(m, r, c, bit(i)));
  const b = [
    [SIZE - 1, 8],
    [SIZE - 2, 8],
    [SIZE - 3, 8],
    [SIZE - 4, 8],
    [SIZE - 5, 8],
    [SIZE - 6, 8],
    [SIZE - 7, 8],
    [8, SIZE - 8],
    [8, SIZE - 7],
    [8, SIZE - 6],
    [8, SIZE - 5],
    [8, SIZE - 4],
    [8, SIZE - 3],
    [8, SIZE - 2],
    [8, SIZE - 1],
  ];
  b.forEach(([r, c], i) => set(m, r, c, bit(i)));
}
export function qrMatrix(text: string): boolean[][] {
  const m = blankMatrix();
  addFunctionPatterns(m);
  placeData(m, makeCodewords(text));
  addFormat(m);
  return m.map((row) => row.map((v) => !!v));
}
export function qrSvg(
  text: string,
  { scale = 4, quiet = 4, title = "CarryOkie QR" } = {},
): string {
  const m = qrMatrix(text);
  const n = m.length + quiet * 2;
  const rects = [];
  m.forEach((row, r) =>
    row.forEach((v, c) => {
      if (v)
        rects.push(
          `<rect x="${c + quiet}" y="${r + quiet}" width="1" height="1"/>`,
        );
    }),
  );
  return `<svg class="qr" data-qr="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${n * scale}" height="${n * scale}" role="img" aria-label="${title}"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${rects.join("")}</g></svg>`;
}
