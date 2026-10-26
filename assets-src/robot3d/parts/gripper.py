# The gripper of ref-uno-gripper@0 (N19 E6): a 2-DOF arm on the car's nose, every size from the gripper kit (build.py `gripper_kit`, which
# reads src/core/hardware/kits/ref-uno-gripper.kit.json and the rover kit), so that what is drawn is what the physics builds (N19 B1,
# src/core/world/robot/gripper.ts). Its parts, each a root `part_gripper_*` whose origin is the joint the view turns it about:
#
#   part_gripper_bracket  the lift servo's mount, static on the chassis (origin: the GR1 mount, the boom's pivot): an aluminium side
#                         bracket each side hung from the top deck, the lift servo (an MG90S of the lab's own drawing: blue case, the
#                         label's recess, the brass spline) between the plates with its spline on the pivot, and `gripper_link`, the
#                         parallelogram's lower links, which the view turns by the boom's elevation about their own pivot `extras.drop`
#                         m under the boom's (a parallelogram: the carriage stays level, plan D-G6).
#   part_gripper_boom     the aluminium U-bracket the lift servo turns (origin: the pivot; the boom along +x at elevation 0): two arms
#                         at y = ±boomHalfSpanCm, outside the 12 cm body, the cross bar at the tip the carriage hangs on, the servo's
#                         horn and the shaft to the left arm.
#   part_gripper_carriage the claw's carriage at the boom's tip (origin: the tip; always level): two black anodised plates round the
#                         physics' carriage box (u ±0.5, v ±2.6, w ±0.6 cm, ADR 0004 §2), the claw servo upside down on the top plate
#                         (its spline down into the gear train between the plates), the hinge pins, and the ears and the cross tube
#                         where the lower links pivot.
#   part_gripper_jaw_l/_r a finger (origin: its hinge at (fingerHingeUCm, ±fingerHingeVCm); the finger straight ahead along +x): an
#                         aluminium plate fingerLengthCm long, fingerThicknessCm thick and jawHeightCm high with its inner half a
#                         ribbed rubber pad, exactly the physics' finger box. The view turns each by β = fingerOpenDeg − 0.445·θ.
#   part_gripper_ir       the IR module (origin: the kit's irClaw mount on the carriage, looking along +x): a small black board with
#                         its emitter and receiver lenses, its trimmer and its comparator, flush with the carriage's front.
#   part_gripper_color    the TCS34725 module (origin: the kit's color1 mount): a purple board with the sensor and its white LED. The
#                         LED lights through the material's emissive map (`extras.glow`, the cell it lights); the view sets its
#                         strength while the sensor runs, and a halo at `extras.led` (its face, m, three.js's frame).
#   part_ultrasonic_riser two brass standoffs under the ultrasonic's bracket foot: the gripper kit mounts the ranger `extras.height` m
#                         higher than the reference kit the ultrasonic part is modelled to (`extras.drop`: from the mount to the foot).
#
# One material for all of it (fix of nothing yet: the draw budget, N19 plan §3): `gripper_atlas`, a 256² base-colour atlas of flat
# swatches and two circuit-board patterns, a metallic-roughness atlas of the same layout (aluminium and steel metal, plastics and rubber
# not), and a glow mask (the LED). Each part's surfaces take their swatch by their uvs, so a moving part is one draw. Original work: no
# vendor's logo or text, no imported mesh.

import math

import bmesh
import bpy
import numpy as np

ATLAS = 256
CELL = 32
COLS = ATLAS // CELL

# Swatches: (cell index, sRGB colour, roughness, metallic).
SWATCH = {
    'alu': (0, '#c2c7ce', 0.32, 1.0),
    'steel': (1, '#d3d7dc', 0.22, 1.0),
    'brass': (2, '#d2a94c', 0.3, 1.0),
    'servo_blue': (3, '#2a5ed0', 0.34, 0.0),
    'label': (4, '#e6e5df', 0.6, 0.0),
    'abs_black': (5, '#1d1f23', 0.45, 0.0),
    'abs_white': (6, '#f2f2ee', 0.42, 0.0),
    'rubber': (7, '#26282c', 0.9, 0.0),
    'lens_blue': (8, '#6d8fe0', 0.08, 0.0),
    'lens_black': (9, '#0b0c0f', 0.1, 0.0),
    'trimmer': (10, '#2a6fe8', 0.4, 0.0),
    'gold': (11, '#e2bd5f', 0.25, 1.0),
    'chip': (12, '#141518', 0.6, 0.0),
    'led': (13, '#efe0a2', 0.2, 0.0),
    'wire_brown': (14, '#6b3b1f', 0.5, 0.0),
    'wire_red': (15, '#d1262b', 0.5, 0.0),
    'wire_orange': (16, '#f08a18', 0.5, 0.0),
    'anodised': (17, '#2c3036', 0.38, 0.85),
    'smd': (18, '#d6d1c4', 0.5, 0.0),
    'ind_red': (19, '#e0302a', 0.3, 0.0),
    'pcb_black_edge': (20, '#1b1d21', 0.45, 0.0),
    'pcb_purple_edge': (21, '#5b2a86', 0.45, 0.0),
    'nylon': (22, '#ece6d6', 0.55, 0.0),
    'window': (23, '#3a2a1c', 0.15, 0.0),
    'servo_seam': (24, '#1b3f96', 0.4, 0.0),
}
# Circuit-board patterns: (x, y from the top, width, height) in atlas pixels.
REGION = {'pcb_black': (0, 128, 128, 64), 'pcb_purple': (128, 128, 128, 64)}

# The geometry of the physics' gripper bodies that the kit does not name (ADR 0004 §2; N19 B1 world/robot/gripper.ts): the carriage box,
# the boom's side plates and its cross bar. Half extents, cm.
CARRIAGE_HALF = {'u': 0.5, 'v': 2.6, 'w': 0.6}
BOOM_PLATE_HALF = {'across': 0.2, 'up': 0.5}
BOOM_BAR_HALF = 0.3
# The parallelogram's lower link: its pivots this far under the boom's, on the chassis and on the carriage (drawing only, cm).
LINK_DROP = 1.0
# MG90S (cm): the case, the spline's offset from the case's middle along its length, the tabs.
MG90S = {'case': (2.28, 1.22, 2.27), 'shaft': 0.59, 'tabs': (3.25, 0.25), 'tabs_below_top': 0.2}


def _cell_uv(name):
    index = SWATCH[name][0]
    col, row = index % COLS, index // COLS
    return ((col + 0.5) / COLS, 1 - (row + 0.5) / COLS)


def _draw_atlas(tex):
    img = np.ones((ATLAS, ATLAS, 4))
    for name, (index, colour, _, _) in SWATCH.items():
        col, row = index % COLS, index // COLS
        img[row * CELL:(row + 1) * CELL, col * CELL:(col + 1) * CELL, :3] = tex.rgb(colour)
    boards = {
        'pcb_black': tex.pcb(128, 64, '#1b1d21', '#2c3036', '#d2c08a', '#d9dde2', 61, traces=18, pad_rows=((0.06, 0.2, 0.06, 0.8, 3),)),
        'pcb_purple': tex.pcb(128, 64, '#5b2a86', '#7440a4', '#d8c48c', '#efe9f4', 62, traces=18, pads=((0.08, 0.2, 0.05), (0.08, 0.8, 0.05)), pad_rows=((0.94, 0.12, 0.94, 0.88, 4),)),
    }
    for name, (x, y, w, h) in REGION.items():
        img[y:y + h, x:x + w] = boards[name]
    return img


def _draw_mr():
    img = np.zeros((ATLAS, ATLAS, 4))
    img[..., 3] = 1
    img[..., 1] = 0.45
    for name, (index, _, rough, metal) in SWATCH.items():
        col, row = index % COLS, index // COLS
        img[row * CELL:(row + 1) * CELL, col * CELL:(col + 1) * CELL, 1] = rough
        img[row * CELL:(row + 1) * CELL, col * CELL:(col + 1) * CELL, 2] = metal
    for x, y, w, h in REGION.values():
        img[y:y + h, x:x + w, 1] = 0.42
        img[y:y + h, x:x + w, 2] = 0.0
    return img


GLOW = 32


def _draw_glow():
    """The glow mask, ATLAS / GLOW times smaller than the atlas: white under the LED's swatch only."""
    img = np.zeros((GLOW, GLOW, 4))
    img[..., 3] = 1
    index = SWATCH['led'][0]
    col, row = index % COLS, index // COLS
    k = GLOW // COLS
    img[row * k:(row + 1) * k, col * k:(col + 1) * k, :3] = 1.0
    return img


def atlas_material(lib, tex):
    """The gripper's one material (made once a session): base colour, metallic-roughness and glow from the atlas."""
    found = bpy.data.materials.get('gripper_atlas')
    if found is not None:
        return found
    base = lib.image_from_array('gripper_atlas', lambda: _draw_atlas(tex))
    mr = lib.image_from_array('gripper_atlas_mr', _draw_mr)
    mr.colorspace_settings.name = 'Non-Color'
    glow = lib.image_from_array('gripper_atlas_glow', _draw_glow)
    mat = bpy.data.materials.new('gripper_atlas')
    mat.use_backface_culling = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = next(n for n in nodes if n.bl_idname == 'ShaderNodeBsdfPrincipled')
    t_base = nodes.new('ShaderNodeTexImage')
    t_base.image = base
    links.new(t_base.outputs['Color'], bsdf.inputs['Base Color'])
    t_mr = nodes.new('ShaderNodeTexImage')
    t_mr.image = mr
    split = nodes.new('ShaderNodeSeparateColor')
    links.new(t_mr.outputs['Color'], split.inputs['Color'])
    links.new(split.outputs['Green'], bsdf.inputs['Roughness'])
    links.new(split.outputs['Blue'], bsdf.inputs['Metallic'])
    t_glow = nodes.new('ShaderNodeTexImage')
    t_glow.image = glow
    t_glow.interpolation = 'Closest'
    links.new(t_glow.outputs['Color'], bsdf.inputs['Emission Color'])
    bsdf.inputs['Emission Strength'].default_value = 1.0
    return mat


def _uv_layer(obj):
    me = obj.data
    return me.uv_layers.get('UVMap') or me.uv_layers.new(name='UVMap')


def paint(obj, name, lib=None):
    """Every corner of `obj` on the swatch `name`."""
    uv = _uv_layer(obj)
    u, v = _cell_uv(name)
    for loop in uv.data:
        loop.uv = (u, v)
    return obj


def paint_board(obj, region, size, axis, edge):
    """A circuit board box: its face looking along +`axis` shows the region's pattern across its `size` (cm), every other face `edge`."""
    me = obj.data
    uv = _uv_layer(obj)
    x, y, w, h = REGION[region]
    eu, ev = _cell_uv(edge)
    ai = 'xyz'.index(axis)
    pa, pb = [i for i in range(3) if i != ai]
    for poly in me.polygons:
        front = poly.normal[ai] > 0.5
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co / 0.01
            if front:
                s = min(1.0, max(0.0, co[pa] / size[0] + 0.5))
                t = min(1.0, max(0.0, co[pb] / size[1] + 0.5))
                # Two pixels in from the region's edge: nothing of the neighbour bleeds in.
                uv.data[li].uv = ((x + 2 + s * (w - 4)) / ATLAS, 1 - (y + 2 + (1 - t) * (h - 4)) / ATLAS)
            else:
                uv.data[li].uv = (eu, ev)
    return obj


def _gk(kit):
    return kit['gripper']


def _servo(lib, mat, col, parent, prefix, frame_at, frame_rot, spline_parts=True, label_side=1):
    """An MG90S in a frame of its own (spline up along +z at the origin, the case below it, its length along x, the spline at its +x end,
    the label's recess on the ±y side `label_side`), put at `frame_at` (cm) turned by `frame_rot` (Euler, rad) under `parent`. Returns
    the frame (to remove once joined) and its meshes (to join)."""
    frame = lib.empty(prefix + '_frame', parent=parent, at=frame_at, col=col)
    frame.rotation_euler = frame_rot
    cx = -MG90S['shaft']
    L, W, H = MG90S['case']
    tab_len, tab_t = MG90S['tabs']
    out = []
    case = lib.box(prefix + '_case', (L, W, H), at=(cx, 0, -H / 2), material=mat, bevel=0.06, segments=1, col=col, parent=frame)
    lib.apply_modifiers(case)
    # The label's recess on the +y side, the label in it (no text).
    lib.boolean(case, lib.box(prefix + '_recess', (L - 0.5, 0.06, H - 0.95), at=(cx - 0.05, label_side * W / 2, -H / 2 - 0.12), col=col, parent=frame))
    paint(case, 'servo_blue')
    out.append(case)
    out.append(paint(lib.box(prefix + '_label', (L - 0.56, 0.01, H - 1.01), at=(cx - 0.05, label_side * (W / 2 - 0.025), -H / 2 - 0.12), material=mat, col=col, parent=frame), 'label'))
    # The seam of the bottom cover and its four screws (the case's far end: up, on the claw servo).
    out.append(paint(lib.box(prefix + '_seam', (L + 0.012, W + 0.012, 0.05), at=(cx, 0, -H + 0.42), material=mat, col=col, parent=frame), 'servo_seam'))
    for sx in (-1, 1) if lib.DETAIL == 'high' else ():
        for sy in (-1, 1):
            out.append(paint(lib.cylinder(prefix + '_cover_screw', 0.07, 0.03, at=(cx + sx * (L / 2 - 0.22), sy * (W / 2 - 0.2), -H - 0.01), material=mat, segments=6, col=col, parent=frame), 'steel'))
    tabs = lib.box(prefix + '_tabs', (tab_len, W - 0.04, tab_t), at=(cx, 0, -MG90S['tabs_below_top'] - tab_t / 2), material=mat, col=col, parent=frame)
    out.append(paint(tabs, 'servo_blue'))
    for side in (-1, 1):
        out.append(paint(lib.cylinder(prefix + '_tab_screw', 0.13, 0.08, at=(cx + side * 1.38, 0, -MG90S['tabs_below_top'] + 0.04), material=mat, segments=8, col=col, parent=frame), 'steel'))
    out.append(paint(lib.cylinder(prefix + '_housing', 0.58, 0.32, at=(0, 0, 0.16), material=mat, segments=16, col=col, parent=frame), 'servo_blue'))
    out.append(paint(lib.cylinder(prefix + '_bump', 0.3, 0.2, at=(-0.62, 0, 0.1), material=mat, segments=10, col=col, parent=frame), 'servo_blue'))
    if spline_parts:
        out.append(paint(lib.cylinder(prefix + '_spline', 0.24, 0.2, at=(0, 0, 0.42), material=mat, segments=12, col=col, parent=frame), 'brass'))
    return frame, out


def _stadium(length, radius, steps=6):
    """A flat bar's outline (cm): from x = 0 to `length`, rounded ends of `radius` centred on both ends, counter-clockwise."""
    pts = []
    for i in range(steps + 1):
        a = -math.pi / 2 + math.pi * i / steps
        pts.append((length + radius * math.cos(a), radius * math.sin(a)))
    for i in range(steps + 1):
        a = math.pi / 2 + math.pi * i / steps
        pts.append((radius * math.cos(a), radius * math.sin(a)))
    return pts


def _bar_xz(lib, mat, col, parent, name, length, radius, thickness, y, swatch, holes=()):
    """A flat bar in the x-z plane (its outline `_stadium`), `thickness` across y centred on `y`; with round holes (x, r) through it."""
    bar = lib.polygon_prism(name, _stadium(length, radius, steps=lib.seg(6)), thickness, material=mat, col=col, parent=parent)
    # Built in x-y, up along z: turned so that it lies in x-z, its thickness along y.
    bar.data.transform(__import__('mathutils').Matrix.Rotation(math.pi / 2, 4, 'X'))
    bar.data.transform(__import__('mathutils').Matrix.Translation(lib.cm(0, y + thickness / 2, 0)))
    for hx, hr in holes:
        lib.boolean(bar, lib.cylinder(name + '_hole', hr, thickness * 4, at=(hx, y, 0), axis='Y', segments=10, col=col))
    lib.smooth_by_angle(bar, 30)
    return paint(bar, swatch)


def build_bracket(lib, tex, kit, col):
    g = _gk(kit)
    mat = atlas_material(lib, tex)
    root = lib.empty('part_gripper_bracket', col=col)
    mx, my, mz = g['mount']
    deck = kit['body']['top']
    half_w = kit['body']['W'] / 2
    statics = []
    # The side brackets: an upright on the chassis' side (outside it, inside the arm) and a tab over the deck with two screws in the
    # deck's holes; two bosses where the arm and the lower link pivot.
    plate_in, plate_t = half_w, 0.22
    for side in (-1, 1):
        y = side * (plate_in + plate_t / 2)
        upright = lib.box('bracket_upright', (1.6, plate_t, deck - (mz - LINK_DROP - 0.55)), at=(0, y, (deck - mz + (-LINK_DROP - 0.55)) / 2), material=mat, bevel=0.05, segments=1, col=col, parent=root)
        statics.append(paint(upright, 'alu'))
        tab = lib.box('bracket_tab', (1.7, 1.6, 0.12), at=(0.3, side * (plate_in + plate_t - 0.8), deck - mz + 0.06), material=mat, bevel=0.04, segments=1, col=col, parent=root)
        statics.append(paint(tab, 'alu'))
        for sx in (4.2, 5.4):
            statics.append(paint(lib.cylinder('bracket_screw', 0.2, 0.08, at=(sx - mx, side * 4.8, deck - mz + 0.16), material=mat, segments=8, col=col, parent=root), 'steel'))
        for z in (0.0, -LINK_DROP):
            boss = lib.cylinder('bracket_boss', 0.32, 0.14, at=(0, side * (plate_in + plate_t + 0.07), z), axis='Y', material=mat, segments=lib.seg(14), col=col, parent=root)
            statics.append(paint(boss, 'alu'))
    # The lift servo between the plates: its spline on the pivot's axis, pointing at the left arm (+y), its case towards the middle,
    # its length along the robot (spline forward), held by its tabs on an aluminium plate under the top deck.
    spline_y = half_w - 0.75
    top = spline_y - 0.52
    frame, servo = _servo(lib, mat, col, root, 'lift', (0, top, 0), (-math.pi / 2, 0, 0), label_side=-1)
    statics += servo
    # Its lead out of the case's far end, back and up through the deck to the board.
    case_end = -MG90S['shaft'] - MG90S['case'][0] / 2
    for k, swatch in enumerate(('wire_brown', 'wire_red', 'wire_orange') if lib.DETAIL == 'high' else ()):
        dz = (k - 1) * 0.1
        points = [(case_end + 0.05, top - MG90S['case'][2] + 0.35, dz), (case_end - 0.7, top - MG90S['case'][2] + 0.3, 0.25 + dz), (case_end - 1.4, top - MG90S['case'][2] + 0.1, 0.9 + dz), (case_end - 1.7, top - MG90S['case'][2], deck - 0.2 - mz + 0.05)]
        statics.append(paint(lib.tube(f'lift_lead_{k}', points, 0.05, material=mat, col=col, parent=root, resolution=4, bevel_resolution=1), swatch))
    # Held by its tabs on two aluminium posts hung from the top deck, a flange joining them under the deck.
    hanger_y = top - MG90S['tabs_below_top'] - MG90S['tabs'][1] - 0.11
    under_deck = deck - 0.2 - mz
    for sx in (-1.38 - 0.59, 1.38 - 0.59):
        statics.append(paint(lib.box('lift_post', (0.3, 0.22, under_deck + 0.61), at=(sx, hanger_y, (under_deck - 0.61) / 2), material=mat, col=col, parent=root), 'alu'))
    statics.append(paint(lib.box('lift_flange', (3.3, 0.7, 0.12), at=(-MG90S['shaft'], hanger_y + 0.24, under_deck - 0.06), material=mat, col=col, parent=root), 'alu'))
    lib.join(statics, 'gripper_bracket_static')
    bpy.data.objects.remove(frame)

    # The lower links, turned by the view about their pivot under the boom's.
    link = lib.empty('gripper_link', parent=root, at=(0, 0, -LINK_DROP), col=col)
    link['drop'] = lib.cm(LINK_DROP)
    L = g['spec']['boomLengthCm']
    span = g['spec']['boomHalfSpanCm'] + BOOM_PLATE_HALF['across']
    parts = []
    for side in (-1, 1):
        y = side * (span + 0.15)
        parts.append(_bar_xz(lib, mat, col, link, 'link_bar', L, 0.28, 0.18, y, 'alu'))
        parts.append(paint(lib.cylinder('link_pin', 0.13, 0.08, at=(0, side * (span + 0.28), 0), axis='Y', material=mat, segments=8, col=col, parent=link), 'steel'))
    lib.join(parts, 'gripper_link_bars')
    return root


def build_boom(lib, tex, kit, col):
    g = _gk(kit)
    spec = g['spec']
    mat = atlas_material(lib, tex)
    root = lib.empty('part_gripper_boom', col=col)
    L = spec['boomLengthCm']
    half_span = spec['boomHalfSpanCm']
    across = BOOM_PLATE_HALF['across']
    up = BOOM_PLATE_HALF['up']
    half_w = kit['body']['W'] / 2
    parts = []
    # The two arms: the physics' plates (L long, 2·up high, 2·across thick at y = ±half_span), rounded at both ends, two lightening holes.
    for side in (-1, 1):
        parts.append(_bar_xz(lib, mat, col, root, 'boom_arm', L, up, 2 * across, side * half_span, 'alu', holes=((L * 0.36, 0.22), (L * 0.64, 0.22))))
    # The cross bar at the tip, round in the square the physics has, out through the carriage's ears, a cap at each end.
    bar_end = half_span + across + 0.5
    parts.append(paint(lib.cylinder('boom_bar', BOOM_BAR_HALF, 2 * bar_end, at=(L, 0, 0), axis='Y', material=mat, segments=lib.seg(14), col=col, parent=root), 'steel'))
    for side in (-1, 1):
        parts.append(paint(lib.cylinder('boom_bar_cap', 0.36, 0.12, at=(L, side * (bar_end + 0.06), 0), axis='Y', material=mat, segments=lib.seg(12), col=col, parent=root), 'steel'))
    # The pivot: on the left the servo's horn on its spline and the shaft out through the bracket into the arm; on the right a shoulder
    # bolt. Both turn with the arm.
    spline_y = half_w - 0.75
    horn = lib.polygon_prism('boom_horn', [(math.cos(a) * 0.36, math.sin(a) * 0.36) for a in [math.pi / 2 + i * math.pi / 8 for i in range(9)]] + [(1.1, -0.15), (1.15, 0.0), (1.1, 0.15)], 0.15, material=mat, col=col, parent=root)
    horn.data.transform(__import__('mathutils').Matrix.Rotation(-math.pi / 2, 4, 'X'))
    horn.data.transform(__import__('mathutils').Matrix.Translation(lib.cm(0, spline_y + 0.02, 0)))
    parts.append(paint(horn, 'abs_white'))
    parts.append(paint(lib.cylinder('boom_shaft', 0.14, half_span + across - spline_y + 0.1, at=(0, (spline_y + half_span + across + 0.1) / 2, 0), axis='Y', material=mat, segments=8, col=col, parent=root), 'steel'))
    for side in (-1, 1):
        parts.append(paint(lib.cylinder('boom_pivot_cap', 0.25, 0.1, at=(0, side * (half_span + across + 0.05), 0), axis='Y', material=mat, segments=lib.seg(12), col=col, parent=root), 'steel'))
    parts.append(paint(lib.cylinder('boom_bolt', 0.14, 1.0, at=(0, -(half_span - 0.3), 0), axis='Y', material=mat, segments=8, col=col, parent=root), 'steel'))
    lib.join(parts, 'gripper_boom')
    return root


def _carriage_outline(g, steps):
    """The carriage plates' outline (cm, u-v): the physics' carriage box with a lobe round each finger hinge."""
    hu, hv = CARRIAGE_HALF['u'], CARRIAGE_HALF['v']
    hinge_u, hinge_v = g['spec']['fingerHingeUCm'], g['spec']['fingerHingeVCm']
    r = 0.32
    pts = [(-hu, -hv + 0.15), (-hu + 0.15, -hv), (hinge_u - 0.15, -hv)]
    for side in (-1, 1):
        cv = side * hinge_v
        for i in range(steps + 1):
            a = -math.pi / 2 + math.pi * i / steps
            pts.append((hinge_u + r * math.cos(a), cv + r * math.sin(a)))
    pts += [(hinge_u - 0.15, hv), (-hu + 0.15, hv), (-hu, hv - 0.15)]
    return pts


def build_carriage(lib, tex, kit, col):
    g = _gk(kit)
    spec = g['spec']
    mat = atlas_material(lib, tex)
    root = lib.empty('part_gripper_carriage', col=col)
    hu, hv, hw = CARRIAGE_HALF['u'], CARRIAGE_HALF['v'], CARRIAGE_HALF['w']
    hinge_u, hinge_v = spec['fingerHingeUCm'], spec['fingerHingeVCm']
    plate_t = 0.15
    parts = []
    outline = _carriage_outline(g, lib.seg(6))
    for z in (hw - plate_t, -hw):
        plate = lib.polygon_prism('carriage_plate', outline, plate_t, at=(0, 0, z), material=mat, col=col, parent=root)
        lib.add_bevel(plate, 0.03, 1)
        lib.apply_modifiers(plate)
        parts.append(paint(plate, 'anodised'))
    # The side blocks between the plates (the bar's bearings), the hinge pins with their caps.
    for side in (-1, 1):
        parts.append(paint(lib.box('carriage_side', (0.6, 0.3, 2 * (hw - plate_t)), at=(-0.2, side * (hv - 0.15), 0), material=mat, col=col, parent=root), 'anodised'))
        for z in (hw + 0.04, -hw - 0.04):
            parts.append(paint(lib.cylinder('hinge_cap', 0.16, 0.08, at=(hinge_u, side * hinge_v, z), material=mat, segments=lib.seg(10), col=col, parent=root), 'steel'))
    # The parallelogram's lower pivot: an ear at each end of the bar, the cross tube through them and two struts up to the carriage.
    span = spec['boomHalfSpanCm'] + BOOM_PLATE_HALF['across']
    ear_y = span + 0.35
    for side in (-1, 1):
        ear = _bar_xz(lib, mat, col, root, 'carriage_ear', LINK_DROP, 0.34, 0.2, side * ear_y, 'alu')
        ear.data.transform(__import__('mathutils').Matrix.Rotation(math.pi / 2, 4, 'Y'))
        parts.append(ear)
        parts.append(paint(lib.cylinder('carriage_strut', 0.12, 0.45, at=(-0.1, side * 1.5, -hw - 0.2), material=mat, segments=8, col=col, parent=root), 'alu'))
    parts.append(paint(lib.cylinder('carriage_tube', 0.17, 2 * (ear_y + 0.1), at=(0, 0, -LINK_DROP), axis='Y', material=mat, segments=lib.seg(12), col=col, parent=root), 'alu'))
    # The claw servo, upside down on the top plate: its tabs on the plate, its spline down into the gear train between the plates (hidden),
    # its case up, the label's recess towards the back (the chase camera), its length across the carriage.
    frame, servo = _servo(lib, mat, col, root, 'claw', (hu - MG90S['case'][1] / 2 - 0.02, -MG90S['shaft'], hw - MG90S['tabs_below_top']), (math.pi, 0, -math.pi / 2), spline_parts=False)
    parts += servo
    lib.join(parts, 'gripper_carriage')
    bpy.data.objects.remove(frame)
    return root


def build_jaw(lib, tex, kit, col, side):
    """A finger, its hinge at the origin, straight ahead along +x; `side` +1 the left one (its pad on −y, the inner side), −1 the right."""
    g = _gk(kit)
    spec = g['spec']
    mat = atlas_material(lib, tex)
    root = lib.empty('part_gripper_jaw_l' if side > 0 else 'part_gripper_jaw_r', col=col)
    length, thick, height = spec['fingerLengthCm'], spec['fingerThicknessCm'], spec['jawHeightCm']
    pad_t = 0.18
    inner = -side  # the pad's side
    # The plate: outer part of the finger box, its tip tapered on the outer face; the root a tongue between the carriage's plates.
    plate_from = inner * (thick / 2 - pad_t)
    plate_to = -inner * thick / 2
    y0, y1 = min(plate_from, plate_to), max(plate_from, plate_to)
    outer = plate_to
    outline = [(0.45, y0), (length, y0), (length, y1), (0.45, y1)]
    if side > 0:
        outline = [(0.45, y0), (length, y0), (length, y0 + 0.08), (length - 0.5, y1), (0.45, y1)]
    else:
        outline = [(0.45, y0), (length - 0.5, y0), (length, y1 - 0.08), (length, y1), (0.45, y1)]
    plate = lib.polygon_prism('jaw_plate', outline, height, at=(0, 0, -height / 2), material=mat, col=col, parent=root)
    lib.add_bevel(plate, 0.04, 1)
    lib.apply_modifiers(plate)
    lib.boolean(plate, lib.box('jaw_slot', (2.0, 1.0, 0.36), at=(2.6, outer, 0.0), col=col))
    parts = [paint(plate, 'alu')]
    tongue_h = 2 * (CARRIAGE_HALF['w'] - 0.15) - 0.04
    tongue = lib.polygon_prism('jaw_tongue', [(math.cos(a) * 0.3, math.sin(a) * 0.3) for a in [math.pi / 2 + i * math.pi / 6 for i in range(7)]] + [(0.5, -0.2), (0.5, 0.2)], tongue_h, at=(0, 0, -tongue_h / 2), material=mat, col=col, parent=root)
    parts.append(paint(tongue, 'alu'))
    # The ribbed rubber pad on the inner face: its ribs' tops exactly the finger box's inner face.
    ribs = 9
    pad_y_out = inner * (thick / 2 - pad_t)
    pad_y_mid = inner * (thick / 2 - 0.08)
    pad_y_in = inner * thick / 2
    pad = lib.box('jaw_pad', (length - 1.05, abs(pad_y_mid - pad_y_out), height - 0.2), at=(0.95 + (length - 1.05) / 2, (pad_y_out + pad_y_mid) / 2, 0), material=mat, col=col, parent=root)
    parts.append(paint(pad, 'rubber'))
    pitch = (length - 1.15) / ribs
    for i in range(ribs):
        rib = lib.box('jaw_rib', (pitch * 0.5, abs(pad_y_in - pad_y_mid), height - 0.24), at=(1.05 + pitch * (i + 0.5), (pad_y_in + pad_y_mid) / 2, 0), material=mat, col=col, parent=root)
        parts.append(paint(rib, 'rubber'))
    lib.join(parts, 'gripper_jaw')
    return root


def build_ir(lib, tex, kit, col):
    mat = atlas_material(lib, tex)
    root = lib.empty('part_gripper_ir', col=col)
    parts = []
    pcb = lib.box('ir_pcb', (0.08, 1.1, 0.76), at=(0.04, 0, 0), material=mat, col=col, parent=root)
    parts.append(paint_board(pcb, 'pcb_black', (1.1, 0.76), 'x', 'pcb_black_edge'))
    parts.append(paint(lib.box('ir_housing', (0.1, 0.92, 0.36), at=(0.13, 0, 0.16), material=mat, bevel=0.02, segments=1, col=col, parent=root), 'abs_black'))
    # Emitter (the inner one, towards the middle of the claw) and receiver lenses, flush with the carriage's front.
    for y, swatch in ((-0.22, 'lens_blue'), (0.22, 'lens_black')):
        parts.append(paint(lib.cylinder('ir_lens', 0.14, 0.03, at=(0.185, y, 0.16), axis='X', material=mat, segments=lib.seg(12), col=col, parent=root), swatch))
    parts.append(paint(lib.box('ir_trimmer', (0.1, 0.3, 0.26), at=(0.13, 0.3, -0.2), material=mat, col=col, parent=root), 'trimmer'))
    parts.append(paint(lib.box('ir_trimmer_slot', (0.02, 0.18, 0.04), at=(0.19, 0.3, -0.2), material=mat, col=col, parent=root), 'abs_white'))
    parts.append(paint(lib.box('ir_comparator', (0.06, 0.3, 0.18), at=(0.11, -0.22, -0.2), material=mat, col=col, parent=root), 'chip'))
    parts.append(paint(lib.box('ir_indicator', (0.05, 0.08, 0.06), at=(0.105, -0.45, -0.28), material=mat, col=col, parent=root), 'ind_red'))
    lib.join(parts, 'gripper_ir')
    return root


def build_color(lib, tex, kit, col):
    mat = atlas_material(lib, tex)
    root = lib.empty('part_gripper_color', col=col)
    # The LED's swatch in the atlas (u, v): the cell the material's glow lights.
    root['glow'] = list(_cell_uv('led'))
    # Where the LED's face is, from the module's origin, in three.js's frame (m: forward, up, the robot's right): the view's halo.
    root['led'] = [lib.cm(0.16), lib.cm(0.04), lib.cm(0.24)]
    parts = []
    pcb = lib.box('color_pcb', (0.08, 1.1, 0.76), at=(0.04, 0, 0), material=mat, col=col, parent=root)
    parts.append(paint_board(pcb, 'pcb_purple', (1.1, 0.76), 'x', 'pcb_purple_edge'))
    # The sensor (towards the middle of the claw) with its window, the white LED beside it, two SMD parts.
    parts.append(paint(lib.box('color_chip', (0.06, 0.22, 0.26), at=(0.11, 0.2, 0.04), material=mat, col=col, parent=root), 'chip'))
    parts.append(paint(lib.box('color_window', (0.01, 0.1, 0.12), at=(0.145, 0.2, 0.04), material=mat, col=col, parent=root), 'window'))
    parts.append(paint(lib.box('color_led_body', (0.06, 0.46, 0.4), at=(0.11, -0.24, 0.04), material=mat, col=col, parent=root), 'smd'))
    parts.append(paint(lib.box('color_led', (0.02, 0.38, 0.32), at=(0.15, -0.24, 0.04), material=mat, col=col, parent=root), 'led'))
    for y in (-0.3, 0.3):
        parts.append(paint(lib.box('color_smd', (0.04, 0.16, 0.08), at=(0.1, y, -0.26), material=mat, col=col, parent=root), 'smd'))
    lib.join(parts, 'gripper_color')
    return root


def build_riser(lib, tex, kit, col):
    """Two brass standoffs under the ultrasonic's bracket foot, for a kit that mounts the ranger higher than the reference kit."""
    root = lib.empty('part_ultrasonic_riser', col=col)
    brass = lib.material('brass', '#d2a94c', metallic=1.0, roughness=0.3)
    height = max(0.05, kit['riser']['height'])
    root['height'] = lib.cm(height)
    root['drop'] = lib.cm(kit['riser']['drop'])
    parts = []
    for side in (-1, 1):
        parts.append(lib.cylinder('riser_standoff', 0.25, height, at=(-2.36 + 0.55, side * 2.0, -height / 2), material=brass, segments=6, col=col, parent=root, bevel=0.03, bevel_segments=1))
    lib.join(parts, 'ultrasonic_riser')
    return root
