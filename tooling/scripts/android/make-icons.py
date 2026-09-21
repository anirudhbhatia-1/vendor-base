#!/usr/bin/env python3
"""Solid-colour role icons with block-letter initials, written without PIL.

The Android shells need an icon each; this draws a 1024x1024 PNG with a 5x7
bitmap font so the four test apps are told apart on a phone. Deliberate
placeholders: the launch icons are the design team's.
"""
import struct, sys, zlib

FONT = {
 'N': ["10001","11001","10101","10011","10001","10001","10001"],
 'S': ["01111","10000","10000","01110","00001","00001","11110"],
 'V': ["10001","10001","10001","10001","10001","01010","00100"],
 'D': ["11110","10001","10001","10001","10001","10001","11110"],
 'P': ["11110","10001","10001","11110","10000","10000","10000"],
 'O': ["01110","10001","10001","10001","10001","10001","01110"],
}

def hexrgb(value):
    value = value.lstrip('#'); return tuple(int(value[i:i+2], 16) for i in (0, 2, 4))

def png(path, size, background, ink, text):
    bg, fg = hexrgb(background), hexrgb(ink)
    cell = size // (len(text) * 6 + 2)  # glyph width 5 + gap 1, plus margins
    glyph_w, glyph_h = 5 * cell, 7 * cell
    total_w = len(text) * 6 * cell - cell
    x0 = (size - total_w) // 2
    y0 = (size - glyph_h) // 2
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            colour = bg
            gx = x - x0; gy = y - y0
            if 0 <= gy < glyph_h and 0 <= gx < total_w:
                index, within = divmod(gx, 6 * cell)
                if within < glyph_w and index < len(text):
                    glyph = FONT.get(text[index])
                    if glyph and glyph[gy // cell][within // cell] == '1':
                        colour = fg
            row.extend(colour)
        rows.append(bytes(row))
    raw = b''.join(rows)
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)
    with open(path, 'wb') as out:
        out.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))

if __name__ == '__main__':
    path, background, ink, text = sys.argv[1:5]
    png(path, 1024, background, ink, text)
