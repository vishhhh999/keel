"""Outline the KEEL wordmark from Panchang ExtraBold into SVG paths, and build the lockup.

Panchang is licensed by Fontshare (ITF Free Font License). The font file is not part of this
repo. Running this script needs a local copy: pass its path as the first argument.
"""
import sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

font_path = sys.argv[1]
font = TTFont(font_path)
gs = font.getGlyphSet()
cmap = font.getBestCmap()
upm = font["head"].unitsPerEm
hmtx = font["hmtx"]

text = "KEEL"
tracking = -0.01  # em
x = 0.0
paths = []
rows = []
for ch in text:
    name = cmap[ord(ch)]
    pen = SVGPathPen(gs)
    # flip Y for SVG, scale to 1 unit == 1 em
    tp = TransformPen(pen, (1 / upm, 0, 0, -1 / upm, x, 0))
    gs[name].draw(tp)
    paths.append(pen.getCommands())
    adv = hmtx[name][0] / upm
    rows.append((ch, round(x, 4), round(adv, 4)))
    x += adv + tracking

os2 = font["OS/2"]
cap = getattr(os2, "sCapHeight", 0.7 * upm) / upm
print("cap height (em):", round(cap, 4), "advance total:", round(x, 4))
for r in rows:
    print(r)

# Wordmark SVG: 1000 units per em for readability
S = 1000
def scale(d):
    import re
    def f(m):
        return str(round(float(m.group(0)) * S, 1))
    return re.sub(r"-?\d+\.?\d*(?:e-?\d+)?", f, d)

d = " ".join(scale(p) for p in paths)
w = round(x * S)
h = round(cap * S)
pad = 0
svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 {-h} {w} {h}" width="{w}" height="{h}"><path d="{d}" fill="currentColor"/></svg>'
open("wordmark.svg", "w").write(svg)

# Lockup: wordmark followed by the level line that grows out of the L's foot.
# L foot thickness is measured from the glyph below.
L = gs[cmap[ord("L")]]
from fontTools.pens.boundsPen import BoundsPen
bp = BoundsPen(gs)
L.draw(bp)
print("L bounds (font units):", bp.bounds)
open("wordmark_meta.txt", "w").write(f"w={w} h={h} cap={cap} L_bounds={bp.bounds} upm={upm}\n")
