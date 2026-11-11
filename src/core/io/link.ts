/**
 * The document in a link (B-FILE-08).
 *
 * `char.tools/#<payload>`: the whole drawing rides in the fragment. A fragment
 * never leaves the browser — a static host is not asked for it and no server
 * log sees it — so the link is the document, not a key to one kept somewhere.
 *
 * The payload is the text (B-TXT-01), folded, deflated and written in
 * base64url, and each step is there for a measured reason. On a fifteen-row
 * diagram of boxes, arrows and labels (615 characters):
 *
 *     percent-encoded              2988    every box glyph is `%E2%94%80`
 *     base64 of the UTF-8          1432
 *     deflate-raw, then base64      340    repetition is what a drawing is
 *     folded first                  308    and 24 against 35 for a tiny box
 *
 *   - **Folding** gives the Box Drawing block one byte apiece, where UTF-8
 *     spends three with the first two nearly always `E2 94`. Deflate would
 *     find that repetition itself, but only after paying for it once per
 *     glyph per block; a byte is cheaper to start with. Blocks, shapes and
 *     arrows get two bytes, and anything else is escaped UTF-8, so every
 *     string round-trips, not only the ones the stampers draw.
 *   - **deflate-raw** rather than `deflate`: the zlib header and checksum are
 *     six bytes that say nothing a base64url string could have got wrong.
 *   - **base64url** rather than a wider alphabet: the fragment would allow
 *     `!$'()*,;` too, for six per cent more bits per character, and every one
 *     of them is a character that some chat client breaks a link on.
 *
 * ── The byte layout, which is frozen ─────────────────────────────────────
 *
 *     00–7E        that ASCII character
 *     80–FF        U+2500 + (byte − 80): the Box Drawing block, all of it
 *     7F  00–7F    U+2580 + n: Block Elements, then Geometric Shapes
 *     7F  80–BF    U+2190 + (n − 80): the arrows most diagrams use
 *     7F  C0       U+007F itself, which the escape byte displaced
 *     7F  C2–F4    a UTF-8 sequence, led by that byte: everything else
 *
 * A link is only as good as its decoder, so this never changes: a later
 * format announces itself with a leading character outside the base64url
 * alphabet, and a payload without one is this.
 */

const ESC = 0x7f;
const BOX = 0x2500; // ─ │ ┌ … ╿  (128 characters: one byte each)
const BLOCKS = 0x2580; // ▀ █ ░ … ◿ (128: Block Elements + Geometric Shapes)
const ARROWS = 0x2190; // ← ↑ → ↓ … ⇏ (64 of them)

const utf8 = new TextEncoder();
const strict = new TextDecoder('utf-8', { fatal: true });

/** The text as the byte stream described above. */
export function fold(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if (c < ESC) out.push(c);
    else if (c >= BOX && c < BOX + 0x80) out.push(0x80 + (c - BOX));
    else if (c >= BLOCKS && c < BLOCKS + 0x80) out.push(ESC, c - BLOCKS);
    else if (c >= ARROWS && c < ARROWS + 0x40) out.push(ESC, 0x80 + (c - ARROWS));
    else if (c === ESC) out.push(ESC, 0xc0);
    else out.push(ESC, ...utf8.encode(ch));
  }
  return Uint8Array.from(out);
}

/** How many bytes a UTF-8 sequence has, from its lead byte; 0 if it is no lead. */
function utf8Length(lead: number): number {
  if (lead >= 0xc2 && lead < 0xe0) return 2;
  if (lead >= 0xe0 && lead < 0xf0) return 3;
  if (lead >= 0xf0 && lead < 0xf5) return 4;
  return 0;
}

/** The text back. Throws on a stream this layout could not have produced. */
export function unfold(bytes: Uint8Array): string {
  const out: string[] = [];
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] ?? 0;
    if (b < ESC) {
      out.push(String.fromCharCode(b));
      continue;
    }
    if (b > ESC) {
      out.push(String.fromCharCode(BOX + (b - 0x80)));
      continue;
    }
    const n = bytes[++i];
    if (n === undefined) throw new Error('link ends inside an escape');
    if (n < 0x80) out.push(String.fromCharCode(BLOCKS + n));
    else if (n < 0xc0) out.push(String.fromCharCode(ARROWS + (n - 0x80)));
    else if (n === 0xc0) out.push(String.fromCharCode(ESC));
    else {
      const len = utf8Length(n);
      if (len === 0 || i + len > bytes.length) throw new Error('link holds a bad escape');
      out.push(strict.decode(bytes.subarray(i, i + len)));
      i += len - 1;
    }
  }
  return out.join('');
}

async function through(bytes: Uint8Array, stream: ReadableWritablePair): Promise<Uint8Array> {
  const body = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(body).arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('not a link payload');
  const b64 = s.replaceAll('-', '+').replaceAll('_', '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The payload for a document: what goes after the `#`. */
export async function encodeDocument(text: string): Promise<string> {
  return toBase64Url(await through(fold(text), new CompressionStream('deflate-raw')));
}

/** The document in a payload. Throws when the payload is not one. */
export async function decodeDocument(payload: string): Promise<string> {
  const bytes = await through(fromBase64Url(payload), new DecompressionStream('deflate-raw'));
  return unfold(bytes);
}
