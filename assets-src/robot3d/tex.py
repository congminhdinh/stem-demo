# Procedural textures of the robot lab's 3D assets (N18 R4.7), drawn with numpy inside Blender: wood grain, plywood plies, circuit
# boards, cardboard, warning stripes, a transducer's grille. Original work, no image from anywhere else. Every function returns an
# (h, w, 4) float array of sRGB values in [0, 1], rows from the top, and is seeded, so a build is reproducible.

import numpy as np


def _rng(seed):
    return np.random.default_rng(seed)


def _smooth(t):
    return t * t * (3 - 2 * t)


def value_noise(w, h, cells_x, cells_y, seed):
    """Periodic value noise: a random lattice of cells_x × cells_y, smoothly interpolated; wraps on both edges."""
    lattice = _rng(seed).random((cells_y, cells_x))
    fx = np.arange(w) / w * cells_x
    fy = np.arange(h) / h * cells_y
    x0 = np.floor(fx).astype(int)
    y0 = np.floor(fy).astype(int)
    tx = _smooth(fx - x0)[None, :]
    ty = _smooth(fy - y0)[:, None]
    x1 = (x0 + 1) % cells_x
    y1 = (y0 + 1) % cells_y
    x0 %= cells_x
    y0 %= cells_y
    a = lattice[np.ix_(y0, x0)]
    b = lattice[np.ix_(y0, x1)]
    c = lattice[np.ix_(y1, x0)]
    d = lattice[np.ix_(y1, x1)]
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty


def fbm(w, h, cells_x, cells_y, seed, octaves=4, gain=0.5):
    total = np.zeros((h, w))
    amplitude, norm = 1.0, 0.0
    for o in range(octaves):
        total += value_noise(w, h, cells_x << o, cells_y << o, seed + o * 101) * amplitude
        norm += amplitude
        amplitude *= gain
    return total / norm


def rgb(hex_value):
    hex_value = hex_value.lstrip('#')
    return np.array([int(hex_value[i:i + 2], 16) / 255 for i in (0, 2, 4)])


def _rgba(colour):
    out = np.ones((*colour.shape[:2], 4))
    out[..., :3] = np.clip(colour, 0, 1)
    return out


def wood(w, h, light, dark, seed, lines=8, warp=2.0, fibre=0.35):
    """Flat-sawn wood: grain lines running along u (the rows' direction), warped by noise, with fine fibres; tileable."""
    n = fbm(w, h, 3, 2, seed, octaves=3)
    f = fbm(w, h, 2, 64, seed + 7, octaves=2)
    y = np.arange(h)[:, None] / h
    g = y * lines + n * warp
    t = g - np.floor(g)
    late = np.clip(1 - np.abs(t - 0.5) * 3.2, 0, 1) ** 1.8
    shade = np.clip(late * 0.85 + (f - 0.5) * fibre * 2, 0, 1)[..., None]
    return _rgba(rgb(light) * (1 - shade) + rgb(dark) * shade)


def plies(w, h, layers, light, dark):
    """Plywood's edge: `layers` plies down the rows, alternately long grain and end grain, with dark glue lines."""
    y = (np.arange(h) + 0.5) / h * layers
    ply = np.floor(y).astype(int)
    within = y - ply
    base = np.where((ply % 2 == 0)[:, None], rgb(light), rgb(light) * 0.55 + rgb(dark) * 0.45)
    glue = ((within < 0.07) | (within > 0.93))[:, None]
    row = np.where(glue, rgb(dark) * 0.8, base)
    speck = fbm(w, h, 16, 4, 5, octaves=2)[..., None]
    return _rgba(np.repeat(row[:, None, :], w, axis=1) * (0.94 + speck * 0.12))


def stripes(w, h, a, b, count, slant=1.0):
    """Diagonal warning stripes of colours a and b, `count` pairs across the width."""
    x = np.arange(w)[None, :] / w
    y = np.arange(h)[:, None] / h
    t = (x * count + y * slant * count * h / w) % 1
    mask = (t < 0.5)[..., None]
    return _rgba(np.where(mask, rgb(a), rgb(b)))


def bands(w, h, colours, widths):
    """Horizontal bands down the rows (a tin's label, a pole's paint): `colours` with relative `widths`."""
    edges = np.cumsum(widths) / np.sum(widths)
    y = (np.arange(h) + 0.5) / h
    idx = np.searchsorted(edges, y)
    row = np.array([rgb(c) for c in colours])[np.clip(idx, 0, len(colours) - 1)]
    return _rgba(np.repeat(row[:, None, :], w, axis=1))


def parking_sign(size, fg, bg, border):
    """A parking sign's face: a white P on blue inside a thin white border, drawn 4× and averaged (smooth edges)."""
    n = size * 4
    y, x = (np.mgrid[0:n, 0:n] + 0.5) / n
    y = 1 - y  # rows from the top; y up
    inset = 0.06
    frame = (np.minimum.reduce([x, y, 1 - x, 1 - y]) < inset) & (np.minimum.reduce([x, y, 1 - x, 1 - y]) > inset - 0.035)
    stem = (x >= 0.3) & (x <= 0.44) & (y >= 0.17) & (y <= 0.83)
    r = np.hypot(x - 0.47, y - 0.645)
    bowl = (x >= 0.44) & (r >= 0.08) & (r <= 0.185) | ((x >= 0.44) & (x <= 0.47) & (((y >= 0.46) & (y <= 0.565)) | ((y >= 0.725) & (y <= 0.83))))
    mask = (stem | bowl | frame).astype(np.float64)
    mask = mask.reshape(size, 4, size, 4).mean(axis=(1, 3))[..., None]
    return _rgba(rgb(bg) * (1 - mask) + rgb(fg) * mask)


def cardboard(w, h, seed):
    fibre = fbm(w, h, 24, 24, seed, octaves=3)
    flute = np.sin(np.arange(w)[None, :] / w * np.pi * 2 * 40) * 0.025
    k = (0.9 + (fibre - 0.5) * 0.22 + flute)[..., None]
    return _rgba(rgb('#c49a68') * k)


def grille(size, cells):
    """A transducer's woven metal mesh: bright wires over a dark gap."""
    t = (np.arange(size) + 0.5) / size * cells % 1
    wire = np.abs(t - 0.5) < 0.24
    u, v = np.meshgrid(wire, wire)
    over = (np.floor(np.arange(size) / size * cells)[None, :] + np.floor(np.arange(size) / size * cells)[:, None]) % 2 == 0
    lit = np.where(u & v, np.where(over, 0.82, 0.66), np.where(u | v, 0.72, 0.12))
    return _rgba(np.repeat(lit[..., None], 3, axis=2))


def pcb(w, h, base, trace, pad, silk, seed, traces=60, pads=(), outlines=(), pad_rows=()):
    """A circuit board's top: solder mask, copper traces under it (routed on a 45° grid), vias, pads and silkscreen outlines; no text.
    `pads` are (x, y, radius) in [0, 1] board units, `outlines` (x0, y0, x1, y1), `pad_rows` (x0, y0, x1, y1, count) rows of round pads."""
    rng = _rng(seed)
    layer = np.zeros((h, w), dtype=np.uint8)
    step = max(1, w // 160)

    def dot(x, y, r, kind):
        x0, x1, y0, y1 = max(0, x - r), min(w, x + r + 1), max(0, y - r), min(h, y + r + 1)
        if x0 >= x1 or y0 >= y1:
            return
        yy, xx = np.ogrid[y0:y1, x0:x1]
        mask = (xx - x) ** 2 + (yy - y) ** 2 <= r * r
        window = layer[y0:y1, x0:x1]
        window[mask & (window < kind)] = kind

    for _ in range(traces):
        x, y = rng.integers(0, w), rng.integers(0, h)
        horizontal = rng.random() < 0.5
        run = int(rng.integers(w // 10, w // 2))
        turn = int(rng.integers(0, run))
        diag = 1 if rng.random() < 0.5 else -1
        for k in range(run):
            x0, y0 = int(x), int(y)
            layer[max(0, y0):min(h, y0 + step), max(0, x0):min(w, x0 + step)] = np.maximum(layer[max(0, y0):min(h, y0 + step), max(0, x0):min(w, x0 + step)], 1)
            if k < turn:
                x, y = (x + 1, y) if horizontal else (x, y + 1)
            else:
                x, y = (x + 1, y + diag) if horizontal else (x + diag, y + 1)
            if not (0 <= x < w and 0 <= y < h):
                break
        dot(int(np.clip(x, 0, w - 1)), int(np.clip(y, 0, h - 1)), step * 2, 2)
    for px, py, r in pads:
        dot(int(px * w), int(py * h), max(1, int(r * w)), 2)
    for x0, y0, x1, y1, count in pad_rows:
        for i in range(count):
            t = (i + 0.5) / count
            dot(int((x0 + (x1 - x0) * t) * w), int((y0 + (y1 - y0) * t) * h), max(1, int(0.012 * w)), 2)
    for x0, y0, x1, y1 in outlines:
        a, b, c, d = int(x0 * w), int(y0 * h), int(x1 * w), int(y1 * h)
        s = max(1, step)
        layer[b:b + s, a:c] = 3
        layer[d - s:d, a:c] = 3
        layer[b:d, a:a + s] = 3
        layer[b:d, c - s:c] = 3
    palette = np.array([rgb(base), rgb(trace), rgb(pad), rgb(silk)])
    grain = fbm(w, h, 12, 12, seed + 3, octaves=2)[..., None]
    return _rgba(palette[layer] * (0.96 + grain * 0.08))


def speckle(w, h, colour, seed, amount=0.08, cells=32):
    n = fbm(w, h, cells, cells, seed, octaves=3)[..., None]
    return _rgba(rgb(colour) * (1 - amount + n * amount * 2))
