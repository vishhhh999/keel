"""Builds the Keel logo files. Run: python3 build_logo.py /path/to/CabinetGrotesk-Extrabold.ttf
Cabinet Grotesk is licensed by Fontshare (ITF Free Font License). The font file is not in this repo.
"""
import sys, re
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

HULL, BONE, BUOY = "#0E2A2F", "#F3EEE4", "#FF5B1F"
font = TTFont(sys.argv[1]); gs = font.getGlyphSet(); cmap = font.getBestCmap(); upm = font["head"].unitsPerEm
TEXT, TRACK = "keel", -0.015

def outline(text, size, x0=0.0):
    """returns (path d, width, ymin, ymax) in px at font-size `size`, baseline y=0, y down."""
    x = x0; ds = []; ymin = 1e9; ymax = -1e9; s = size / upm
    for ch in text:
        g = gs[cmap[ord(ch)]]
        pen = SVGPathPen(gs, ntos=lambda v: f"{v:.2f}".rstrip("0").rstrip("."))
        g.draw(TransformPen(pen, (s, 0, 0, -s, x, 0))); ds.append(pen.getCommands())
        bp = BoundsPen(gs); g.draw(bp)
        if bp.bounds: ymin = min(ymin, -bp.bounds[3] * s); ymax = max(ymax, -bp.bounds[1] * s)
        x += font["hmtx"][cmap[ord(ch)]][0] * s + TRACK * size
    return " ".join(ds), x - TRACK * size - x0, ymin, ymax

# --- the mark: a circle cut at the waterline. The top half tips (the signal moves), the bottom half stays level (the stream holds).
import math
R, GAP, TILT = 46, 12, -18
def _mark_parts():
    # coordinates: flat edge of the top half sits at y=0; bottom half starts at y=GAP
    a = math.radians(TILT); lift = R * abs(math.sin(a)) - GAP + 4   # keep the dipped corner clear of the bottom half
    top = f'<g transform="translate(0 {-lift:.2f}) rotate({TILT})"><path d="M{-R} 0A{R} {R} 0 0 1 {R} 0Z" fill="{{dome}}"/></g>'
    bottom = f'<path d="M{-R} {GAP}H{R}A{R} {R} 0 0 1 {-R} {GAP}Z" fill="{{keel}}"/>'
    # bbox of the whole mark
    ytop = -lift - (R * math.cos(a) + 0) - R * 0   # top of rotated arc ~ -(R) lifted; use sampling instead
    pts = []
    for t in range(0, 181, 3):
        th = math.radians(t); x, y = R * math.cos(th), -R * math.sin(th)
        pts.append((x * math.cos(a) - y * math.sin(a), x * math.sin(a) + y * math.cos(a) - lift))
    for x in (-R, R): pts.append((x * math.cos(a), x * math.sin(a) - lift))
    x0 = min(p[0] for p in pts); x1 = max(p[0] for p in pts); y0 = min(p[1] for p in pts)
    y1 = GAP + R
    return top, bottom, (min(x0, -R), y0, max(x1, R), y1)
_top, _bottom, BB = _mark_parts()
MW, MH = BB[2] - BB[0], BB[3] - BB[1]
def mark(dome, keel, ox=0.0, oy=0.0, scale=1.0):
    return f'<g transform="translate({ox - BB[0]*scale:.2f} {oy - BB[1]*scale:.2f}) scale({scale})">' + _top.format(dome=dome) + _bottom.format(keel=keel) + '</g>'

d, w, ymin, ymax = outline(TEXT, 100)
def lockup(dome, keel, fg_text, bg=None, pad=0):
    M = 86.0; sc = M / MH; mw = MW * sc; gap = 24
    xh = 50.0                                   # x-height at size 100
    cy = -xh / 2                                # centre the mark on the x-height band
    my = cy - M / 2
    top = min(my, ymin); bot = max(my + M, ymax)
    W = mw + gap + w; Ht = bot - top
    vb = f"{-pad} {top-pad:.1f} {W+2*pad:.1f} {Ht+2*pad:.1f}"
    bgr = f'<rect x="{-pad}" y="{top-pad:.1f}" width="{W+2*pad:.1f}" height="{Ht+2*pad:.1f}" fill="{bg}"/>' if bg else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}">{bgr}'
            f'{mark(dome, keel, 0, my, sc)}<path transform="translate({mw+gap:.1f} 0)" d="{d}" fill="{fg_text}"/></svg>')

def save(name, s): open(name, "w").write(s)
save("keel-lockup.svg", lockup(BUOY, HULL, HULL))
save("keel-lockup-on-dark.svg", lockup(BUOY, BONE, BONE))
save("keel-lockup-on-orange.svg", lockup(HULL, HULL, HULL))
save("keel-lockup-mono-dark.svg", lockup(HULL, HULL, HULL))
save("keel-lockup-mono-light.svg", lockup(BONE, BONE, BONE))
def only_mark(dome, keel, bg=None, pad=0):
    W, Hh = MW + 2*pad, MH + 2*pad
    r = f'<rect width="{W:.1f}" height="{Hh:.1f}" fill="{bg}"/>' if bg else ""
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.1f} {Hh:.1f}">{r}{mark(dome, keel, pad, pad)}</svg>'
save("keel-mark.svg", only_mark(BUOY, HULL))
save("keel-mark-on-dark.svg", only_mark(BUOY, BONE))
save("keel-favicon.svg", only_mark(BUOY, HULL, BONE, 14))
save("keel-wordmark.svg", f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 {ymin:.1f} {w:.1f} {ymax-ymin:.1f}"><path d="{d}" fill="{HULL}"/></svg>')
S = 512 * 0.56 / MH
save("keel-icon.svg", f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="116" fill="{HULL}"/>' + mark(BUOY, BONE, (512 - MW*S)/2, (512 - MH*S)/2, S) + '</svg>')
print("mark", round(MW), round(MH))
