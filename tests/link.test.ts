/**
 * The document in a link (B-FILE-08).
 *
 * Two things are pinned. That every string comes back — the stampers' glyphs,
 * but also whatever someone pasted, because a link that drops a character is
 * a link that lies. And the byte layout itself, byte for byte: links already
 * sent are decoded by whatever this file says, so a change here that passes
 * the round trips can still break every one of them.
 */

import { describe, expect, it } from 'vitest';
import { decodeDocument, encodeDocument, fold, unfold } from '../src/core/io/link.ts';

const DIAGRAM = `
┌──────────────┐        ┌──────────────┐
│   Browser    │───────▶│   Vite dev   │
│  (React 19)  │        │   server     │
└──────┬───────┘        └──────┬───────┘
       │                       │
       │ keeps on every edit   │ serves /src
       ▼                       ▼
┌──────────────┐        ┌──────────────┐
│ localStorage │        │  main.tsx    │
│  ascii-writer│◀───────│  restore()   │
└──────────────┘        └──────┬───────┘
                               │
                 ╭─────────────┴──────────────╮
                 │  store.ts · keepDocument() │
                 ╰────────────────────────────╯
`.trim();

const roundTrip = async (text: string): Promise<string> =>
  decodeDocument(await encodeDocument(text));

describe('a link round-trips the document', () => {
  it('a diagram, in every charset', async () => {
    const all = [
      '┌─┬─┐├─┼─┤└─┴─┘│',
      '╭─╮╰─╯',
      '┏━┳━┓┣━╋━┫┗━┻━┛┃',
      '╔═╦═╗╠═╬═╣╚═╩═╝║╪╫',
      '▲▼◀▶△▽◁▷ ← ↑ → ↓',
      '█▀▄░▒▓ ● ○ ◆',
    ].join('\n');
    expect(await roundTrip(DIAGRAM)).toBe(DIAGRAM);
    expect(await roundTrip(all)).toBe(all);
  });

  it('plain text, the empty document, and a lone line feed', async () => {
    for (const text of ['hello, world', '', '\n', 'two\nlines\n\nand a blank']) {
      expect(await roundTrip(text)).toBe(text);
    }
  });

  it('whatever was pasted: accents, CJK, emoji, and the escape byte itself', async () => {
    const text = 'café — 東京 — 🎉 — \u007f —   — ⇒ ✓';
    expect(await roundTrip(text)).toBe(text);
  });
});

describe('the byte layout is frozen', () => {
  it('one byte for the Box Drawing block, two for blocks and arrows', () => {
    expect([...fold('a')]).toEqual([0x61]);
    expect([...fold('─')]).toEqual([0x80]);
    expect([...fold('╿')]).toEqual([0xff]);
    expect([...fold('▀')]).toEqual([0x7f, 0x00]);
    expect([...fold('█')]).toEqual([0x7f, 0x08]);
    expect([...fold('◿')]).toEqual([0x7f, 0x7f]);
    expect([...fold('←')]).toEqual([0x7f, 0x80]);
    expect([...fold('→')]).toEqual([0x7f, 0x82]);
    expect([...fold('\u007f')]).toEqual([0x7f, 0xc0]);
    expect([...fold('é')]).toEqual([0x7f, 0xc3, 0xa9]);
    expect([...fold('🎉')]).toEqual([0x7f, 0xf0, 0x9f, 0x8e, 0x89]);
  });

  it('and refuses what it could not have written', () => {
    expect(() => unfold(Uint8Array.from([0x7f]))).toThrow();
    expect(() => unfold(Uint8Array.from([0x7f, 0xc1]))).toThrow();
    expect(() => unfold(Uint8Array.from([0x7f, 0xc3]))).toThrow();
    expect(() => unfold(Uint8Array.from([0x7f, 0xff, 0x00, 0x00, 0x00]))).toThrow();
  });

  it('a payload that is not one is an error, not a blank page', async () => {
    await expect(decodeDocument('not a payload!')).rejects.toThrow();
    await expect(decodeDocument('AAAAAAAA')).rejects.toThrow();
  });
});

describe('the link is short', () => {
  it('uses only characters every link survives', async () => {
    expect(await encodeDocument(DIAGRAM)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('folding beats deflating the UTF-8, which beats base64, which beats percent-encoding', async () => {
    const payload = await encodeDocument(DIAGRAM);
    const utf8 = new TextEncoder().encode(DIAGRAM);
    const deflated = new Uint8Array(
      await new Response(
        new Blob([utf8 as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw')),
      ).arrayBuffer(),
    );
    // base64 is four characters per three bytes; the payload drops its padding.
    const base64 = Math.ceil(utf8.length / 3) * 4;

    expect(payload.length).toBeLessThan(Math.ceil(deflated.length / 3) * 4);
    expect(Math.ceil(deflated.length / 3) * 4).toBeLessThan(base64);
    expect(base64).toBeLessThan(encodeURIComponent(DIAGRAM).length);
    // The measured figures in link.ts, give or take a deflate version.
    expect(payload.length).toBeLessThan(330);
  });
});
