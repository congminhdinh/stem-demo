# The pick-and-place props (N19 E7): what a gripper lesson's objects (`objects[].noun`, plan §4.5) and its warehouse shelf are drawn as.
# Each is modelled at a size of its own (arena-assembly.ts `MODELLED`), and the view scales it to the scenario's collider, so what is drawn
# is what the physics holds:
#
#   prop_cube       a 4 cm EVA foam cube (`cube`), its edges eased: the sides in `foam` (white with fine pores), the top in `foam_top`,
#                   whose map is `foam_marks`, a 256² atlas of the marks a learner who cannot tell the colours apart reads (plan E4: red
#                   horizontal stripes, green a grid, blue large dots; plain for yellow and any other colour), one quadrant each. The
#                   top's uvs are the plain quadrant's; the view tints both by the object's colour (body-colors.ts) and moves the map to
#                   its colour's quadrant (`extras.marks`: the uv offset of each).
#   prop_parcel     a small corrugated parcel (`parcel`) taped over its top and with a band of packing tape round it (`parcel_tape`, which
#                   the view tints by the object's colour when it has one).
#   prop_base       a beech pedestal (`base`: a plinth and the block on it), pale grain the view tints by the object's colour (painted).
#   prop_kho_shelf  a warehouse pallet rack for a wall tagged `kho-wall`: blue upright frames at the ends, orange beams at three levels,
#                   plank decks, its two bays filled with cartons flush with both faces (so it is solid wherever the wall's collider is):
#                   `kho_rack`; and above it, outside the collider, a sign "KHO" (the zone's word, drawn as strokes, no font) on two posts:
#                   the node `kho_sign`, on the rack's top. Modelled for a 40 × 4 × 12 cm wall: the view stretches the rack to the wall, the
#                   sign evenly by the wall's height.
#
# Origin of each: the middle of its base. Original work: no logo, no imported image.

import math

import numpy as np

CUBE = 4.0
PARCEL = (6.0, 6.0, 5.0)
BASE = (6.0, 6.0, 4.0)
SHELF = (40.0, 4.0, 12.0)  # length (x), thickness (y), height; the sign stands above
SIGN_RISE = 5.5


def _planar_top(obj, lib, size, rect):
    """The faces looking up of a box `size` (cm, x × y) mapped onto `rect` (u0, v0, u1, v1) of their image."""
    me = obj.data
    uv = me.uv_layers.get('UVMap') or me.uv_layers.new(name='UVMap')
    u0, v0, u1, v1 = rect
    for poly in me.polygons:
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co / lib.CM
            s = min(1.0, max(0.0, co.x / size[0] + 0.5))
            t = min(1.0, max(0.0, co.y / size[1] + 0.5))
            uv.data[li].uv = (u0 + s * (u1 - u0), v0 + t * (v1 - v0))


def _marks(size=256):
    """The marks atlas: four quadrants of `size` / 2 (plain, red stripes, green grid, blue dots), a fine foam grain over all; values multiply
    the colour the view tints the top with, so a mark is the cube's own colour, darker."""
    half = size // 2
    grain = 0.96 + 0.04 * np.random.default_rng(71).random((size, size))
    out = np.ones((size, size, 4))
    y, x = (np.mgrid[0:half, 0:half] + 0.5) / half
    inset = 0.1  # clear of the eased edge
    inside = (x > inset) & (x < 1 - inset) & (y > inset) & (y < 1 - inset)
    stripes = inside & (((y - inset) / (1 - 2 * inset) * 4) % 1 < 0.42)
    grid = inside & ((((x - inset) / (1 - 2 * inset) * 3 + 0.5) % 1 < 0.2) | (((y - inset) / (1 - 2 * inset) * 3 + 0.5) % 1 < 0.2))
    dots = np.zeros_like(inside)
    for cx in (0.3, 0.7):
        for cy in (0.3, 0.7):
            dots |= np.hypot(x - cx, y - cy) < 0.15
    # Supersampled edges: each mark's mask averaged with its neighbours (a one-pixel soft edge).
    soft = lambda m: (m.astype(float) + np.roll(m, 1, 0) + np.roll(m, -1, 0) + np.roll(m, 1, 1) + np.roll(m, -1, 1)) / 5
    quads = {(0, 0): np.zeros((half, half)), (0, 1): soft(stripes), (1, 0): soft(grid), (1, 1): soft(dots)}
    for (row, col), mask in quads.items():
        shade = 1.0 - 0.5 * mask
        out[row * half:(row + 1) * half, col * half:(col + 1) * half, :3] = (shade * grain[row * half:(row + 1) * half, col * half:(col + 1) * half])[..., None]
    return out


def build_cube(lib, tex, kit, col, wood):
    root = lib.empty('prop_cube', col=col)
    # Where each palette colour's marks are: the uv offset from the plain quadrant (top left) to its own.
    root['marks'] = {'red': [0.5, 0.0], 'green': [0.0, -0.5], 'blue': [0.5, -0.5]}
    pores = lib.image_from_array('foam_pores', lambda: tex.speckle(64, 64, '#f4f4f4', 72, amount=0.05, cells=16))
    foam = lib.material('foam', image=pores, roughness=0.78)
    top = lib.material('foam_top', image=lib.image_from_array('foam_marks', _marks), roughness=0.78)
    cube = lib.box('cube', (CUBE, CUBE, CUBE), at=(0, 0, CUBE / 2), material=foam, col=col, parent=root)
    cube.data.materials.append(top)
    lib.add_bevel(cube, 0.28, 3)
    lib.apply_modifiers(cube)
    lib.box_uv(cube, scale_cm=2.0)
    me = cube.data
    flat = CUBE / 2 - 0.28
    tops = [poly for poly in me.polygons if poly.normal.z > 0.999 and all(abs(me.vertices[i].co.x / lib.CM) <= flat + 1e-4 and abs(me.vertices[i].co.y / lib.CM) <= flat + 1e-4 for i in poly.vertices)]
    for poly in tops:
        poly.material_index = 1
    uv = me.uv_layers['UVMap']
    for poly in tops:
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co / lib.CM
            s = co.x / (2 * flat) + 0.5
            t = co.y / (2 * flat) + 0.5
            uv.data[li].uv = (s * 0.5, 0.5 + t * 0.5)
    lib.smooth_by_angle(cube, 35)
    return root


def build_parcel(lib, tex, kit, col, wood):
    root = lib.empty('prop_parcel', col=col)
    sx, sy, sz = PARCEL
    board = lib.material('cardboard', image=lib.image_from_array('cardboard', lambda: tex.cardboard(256, 256, 41)), roughness=0.9)
    # Kraft packing tape, darker and glossier than the board (fix round 1, review M3: the board's own tan read as a dent).
    tape = lib.material('parcel_tape', '#9a6a35', roughness=0.2)
    box = lib.box('parcel', PARCEL, at=(0, 0, sz / 2), material=board, col=col, parent=root)
    wood.face_uvs(lib, box, PARCEL, {0: (1, 2, 20, 20), 1: (0, 2, 20, 20), 2: (0, 1, 20, 20)})
    lib.add_bevel(box, 0.18, 2)
    lib.apply_modifiers(box)
    parts = [box]
    # The tape: across the top over the seam and down both ends, and a band round the middle.
    band = 1.2
    parts.append(lib.box('tape_top', (sx + 0.06, band, 0.03), at=(0, 0, sz + 0.015), material=tape, col=col, parent=root))
    for side in (-1, 1):
        parts.append(lib.box('tape_end', (0.03, band, sz * 0.55), at=(side * (sx / 2 + 0.015), 0, sz - sz * 0.275), material=tape, col=col, parent=root))
    ring = lib.box('tape_band', (sx + 0.06, sy + 0.06, band * 0.8), at=(0, 0, sz * 0.42), material=tape, col=col, parent=root)
    lib.boolean(ring, lib.box('tape_band_hole', (sx - 0.1, sy - 0.1, band * 2), at=(0, 0, sz * 0.42), col=col))
    parts.append(ring)
    lib.join(parts, 'parcel')
    return root


def _pale_wood(tex):
    """A pale grain that keeps its tint (the view's colour, or beech's): fine and even (fix round 1, review M4: a single wave on a 6 cm face)."""
    return tex.wood(256, 256, '#f6f2ea', '#e2d8c6', 27, lines=12, warp=0.7, fibre=0.25)


def build_base(lib, tex, kit, col, wood):
    """A pedestal (fix round 1, review M4: it read as a second cube): a plinth the collider's full footprint, the block on it inset."""
    root = lib.empty('prop_base', col=col)
    sx, sy, sz = BASE
    mat = lib.material('base_wood', '#e8c49a', image=lib.image_from_array('pale_wood', lambda: _pale_wood(tex)), roughness=0.58)
    plinth_h, inset = 0.6, 0.3
    parts = []
    for name, size, z in (('base_plinth', (sx, sy, plinth_h), plinth_h / 2), ('base_block', (sx - 2 * inset, sy - 2 * inset, sz - plinth_h), plinth_h + (sz - plinth_h) / 2)):
        block = lib.box(name, size, at=(0, 0, z), material=mat, col=col, parent=root)
        wood.face_uvs(lib, block, size, {0: (1, 2, 8, 8), 1: (0, 2, 8, 8), 2: (0, 1, 8, 8)})
        lib.add_bevel(block, 0.12 if name == 'base_plinth' else 0.25, 2)
        lib.apply_modifiers(block)
        lib.smooth_by_angle(block, 35)
        parts.append(block)
    lib.join(parts, 'base')
    return root


def _kho_sign(tex, w, h):
    """The sign's face: KHO in white strokes on blue inside a thin white border, drawn 4× and averaged."""
    n = 4
    W, H = w * n, h * n
    y, x = (np.mgrid[0:H, 0:W] + 0.5)
    x = x / H  # in units of the sign's height
    y = 1 - y / H
    aspect = W / H
    edge = np.minimum.reduce([x, y, aspect - x, 1 - y])
    frame = (edge < 0.07) & (edge > 0.035)
    stroke = 0.13
    mask = frame.copy()
    # Letters 0.6 tall, from y 0.2 to 0.8, centred.
    lo, hi = 0.2, 0.8
    width = 0.46
    gap = 0.16
    x0 = (aspect - (3 * width + 2 * gap)) / 2

    def seg(ax, ay, bx, by):
        px, py = x - ax, y - ay
        dx, dy = bx - ax, by - ay
        t = np.clip((px * dx + py * dy) / (dx * dx + dy * dy), 0, 1)
        return np.hypot(px - t * dx, py - t * dy) < stroke / 2

    k = x0
    mask |= seg(k + stroke / 2, lo, k + stroke / 2, hi)
    mask |= seg(k + stroke / 2, 0.5, k + width, hi)
    mask |= seg(k + stroke * 0.9, 0.56, k + width, lo)
    hx = x0 + width + gap
    mask |= seg(hx + stroke / 2, lo, hx + stroke / 2, hi) | seg(hx + width - stroke / 2, lo, hx + width - stroke / 2, hi) | seg(hx, 0.5, hx + width, 0.5)
    ox = hx + width + gap + width / 2
    r = np.hypot((x - ox) / (width / 2 - stroke / 2), (y - 0.5) / ((hi - lo) / 2 - stroke / 2))
    mask |= (r > 1 - stroke / (width - stroke)) & (r < 1 + stroke / (width - stroke))
    m = mask.astype(float).reshape(h, n, w, n).mean(axis=(1, 3))[..., None]
    out = np.ones((h, w, 4))
    out[..., :3] = tex.rgb('#1f5fd6') * (1 - m) + tex.rgb('#f7f8fa') * m
    return out


def build_shelf(lib, tex, kit, col, wood):
    root = lib.empty('prop_kho_shelf', col=col)
    L, T, H = SHELF
    blue = lib.material('rack_blue', '#1f4fb4', metallic=0.4, roughness=0.42)
    orange = lib.material('rack_orange', '#f07a1a', metallic=0.4, roughness=0.4)
    deck = wood.beech(lib, tex)
    board = lib.material('cardboard', image=lib.image_from_array('cardboard', lambda: tex.cardboard(256, 256, 41)), roughness=0.9)
    face = lib.material('kho_sign', image=lib.image_from_array('kho_sign', lambda: _kho_sign(tex, 192, 64)), roughness=0.32)
    post = 0.5
    parts = []
    levels = (0.0, 5.8, H - 0.6)
    for side in (-1, 1):
        for depth in (-1, 1):
            parts.append(lib.box('rack_post', (post, post, H), at=(side * (L / 2 - post / 2), depth * (T / 2 - post / 2), H / 2), material=blue, bevel=0.05, segments=1, col=col, parent=root))
        for z in (H / 3, 2 * H / 3):
            parts.append(lib.box('rack_brace', (0.2, T - 2 * post, 0.25), at=(side * (L / 2 - post / 2), 0, z), material=blue, col=col, parent=root))
    for z in levels:
        for depth in (-1, 1):
            parts.append(lib.box('rack_beam', (L - 2 * post, 0.3, 0.6), at=(0, depth * (T / 2 - 0.15), z + 0.3), material=orange, bevel=0.04, segments=1, col=col, parent=root))
        deck_board = lib.box('rack_deck', (L - 2 * post, T - 0.6, 0.18), at=(0, 0, z + 0.51), material=deck, col=col, parent=root)
        lib.box_uv(deck_board, scale_cm=12.0)
        parts.append(deck_board)
    # Cartons in each bay of the two lower levels, flush with both faces (the wall's collider is solid there).
    bay = (L - 2 * post) / 2
    for level in (0, 1):
        z0 = levels[level] + 0.6
        height = levels[level + 1] - z0 - 0.12
        for b in (-1, 1):
            for k, (w, offset) in enumerate(((bay * 0.52 - 0.2, -bay * 0.24), (bay * 0.48 - 0.2, bay * 0.26))):
                hh = height * (0.98 if (k + level + (b > 0)) % 2 == 0 else 0.86)
                carton = lib.box('rack_carton', (w, T, hh), at=(b * bay / 2 + offset, 0, z0 + hh / 2), material=board, col=col, parent=root)
                lib.box_uv(carton, scale_cm=20.0)
                # Square-edged (no bevel, fix round 1): the props' file had 1.5 KB left of its budget with the base's plinth.
                parts.append(carton)
    lib.join(parts, 'kho_rack')
    # The sign above the rack, on two posts from its top beams: a node `kho_sign` on the rack's top (the view scales it evenly, by the
    # wall's height, whatever the wall's length and thickness: fix round 1, review M5).
    sign = lib.empty('kho_sign', parent=root, at=(0, 0, H), col=col)
    sign_w, sign_h = 15.0, 5.0
    parts = []
    for side in (-1, 1):
        parts.append(lib.cylinder('sign_post', 0.22, SIGN_RISE, at=(side * (sign_w / 2 - 1.2), 0, SIGN_RISE / 2), material=blue, segments=10, col=col, parent=sign))
    plate = lib.box('kho_plate', (sign_w, 0.3, sign_h), at=(0, 0, SIGN_RISE + sign_h / 2 - 0.6), material=face, bevel=0.2, segments=2, col=col, parent=sign)
    lib.apply_modifiers(plate)
    me = plate.data
    uv = me.uv_layers.get('UVMap') or me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        both = abs(poly.normal.y) > 0.5
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co / lib.CM
            # The word reads on both faces (u along x seen from the front, -y; mirrored on the back).
            u = (co.x / sign_w + 0.5) if poly.normal.y < 0 else (0.5 - co.x / sign_w)
            uv.data[li].uv = (u, co.z / sign_h + 0.5) if both else (0.01, 0.5)
    parts.append(plate)
    lib.join(parts, 'kho_sign_board')
    return root
