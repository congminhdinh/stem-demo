# part_servo: a micro servo of the SG90 kind (N18 R4.7): the blue case (22.8 × 12.2 × 22.7 mm) with its mounting tabs and screws, the
# gear housing and the white output spline on top, the three-core lead; and on the spline `servo_horn`, which the view turns by the
# servo's angle: the single-arm white horn and the kit's arm (armLengthCm along +x, armWidthCm wide, its upper half drawn as a yellow
# perforated beam), and at the arm's tip the scenario's flag: `flag_mast` (shown when a goal asks for the servo's angle) and
# `flag_pennant`, which the view slides up the mast from `extras.low` to `extras.high` (m) as the arm turns towards the goal's angle.
# Origin: the servo's shaft at the arm's mount height (the kit's servo mount); the case hangs below, under the deck.

import math

CASE = (2.28, 1.22, 2.27)
SHAFT_OFFSET = 0.59


def build(lib, tex, kit, col):
    s = kit['servo']
    arm_len, arm_w, arm_h = s['arm_len'], s['arm_w'], s['arm_h']
    deck_rel = s['deck_rel']  # the deck's top, relative to the mount height (cm, negative)
    root = lib.empty('part_servo', col=col)
    blue = lib.material('servo_blue', '#2a5ed0', roughness=0.3, coat=0.2)
    white = lib.material('abs_white', '#f4f4f1', roughness=0.45)
    yellow = lib.material('beam_yellow', '#ffc21a', metallic=0.35, roughness=0.34)
    steel = lib.material('steel', '#c5cad1', metallic=1.0, roughness=0.24)
    flag = lib.material('flag_blue', '#1f6bff', roughness=0.7, double_sided=True)
    mast = lib.material('mast_white', '#f7f7f5', metallic=0.2, roughness=0.3)
    brown = lib.material('wire_brown', '#6b3b1f', roughness=0.5)
    red = lib.material('wire_red', '#d1262b', roughness=0.5)
    orange = lib.material('wire_orange', '#f08a18', roughness=0.5)

    cx = -SHAFT_OFFSET
    case_top = deck_rel
    statics = [lib.box('servo_case', CASE, at=(cx, 0, case_top - CASE[2] / 2), material=blue, bevel=0.08, col=col, parent=root)]
    tabs = lib.box('servo_tabs', (3.2, CASE[1], 0.25), at=(cx, 0, case_top - 0.2 - 0.125 - 0.25), material=blue, bevel=0.04, col=col)
    lib.apply_modifiers(tabs)
    for side in (-1, 1):
        lib.boolean(tabs, lib.cylinder('tab_hole', 0.1, 1, at=(cx + side * 1.38, 0, case_top - 0.57), segments=10, col=col))
    tabs.parent = root
    statics.append(tabs)
    for side in (-1, 1):
        statics.append(lib.cylinder('tab_screw', 0.14, 0.1, at=(cx + side * 1.38, 0, case_top - 0.75), material=steel, segments=10, col=col, parent=root))
    statics.append(lib.cylinder('gear_housing', 0.6, 0.32, at=(0, 0, case_top + 0.16), material=blue, segments=28, col=col, parent=root, bevel=0.05))
    statics.append(lib.cylinder('gear_bump', 0.32, 0.22, at=(-0.62, 0, case_top + 0.11), material=blue, segments=20, col=col, parent=root, bevel=0.04))
    statics.append(lib.cylinder('spline', 0.24, 0.18, at=(0, 0, case_top + 0.41), material=white, segments=18, col=col, parent=root))
    # The lead leaves the case's rear end: three cores side by side.
    for k, m in enumerate((brown, red, orange)):
        y = (k - 1) * 0.11
        statics.append(lib.tube(f'servo_lead_{k}', [(cx - CASE[0] / 2 + 0.05, y, case_top - 2.0), (cx - CASE[0] / 2 - 0.6, y, case_top - 2.05), (cx - CASE[0] / 2 - 1.3, y, case_top - 1.6)], 0.055, material=m, col=col, parent=root))
    lib.join(statics, 'servo_static')

    # The horn and the arm, turned by the view about the shaft.
    horn = lib.empty('servo_horn', parent=root, col=col)
    horn_z = case_top + 0.5
    outline = [(math.cos(a) * 0.36, math.sin(a) * 0.36) for a in [math.pi / 2 + i * math.pi / 10 for i in range(11)]] + [(1.5, -0.17), (1.5, 0.17)]
    outline = outline[:11] + [(1.5, -0.17), (1.55, 0.0), (1.5, 0.17)]
    horn_mesh = lib.polygon_prism('horn', outline, 0.16, at=(0, 0, horn_z), material=white, col=col, parent=horn, bevel=0.03)
    horn_parts = [horn_mesh, lib.cylinder('horn_screw', 0.13, 0.08, at=(0, 0, horn_z + 0.2), material=steel, segments=12, col=col, parent=horn)]
    # The beam: the arm's upper half, rounded ends, holes on a 1 cm pitch (an array of cutters and a boolean).
    beam_h = min(arm_h / 2, 0.7)
    beam_z0 = horn_z + 0.16
    length = arm_len + 0.4
    ends = [(arm_len - arm_w / 2 + math.cos(a) * arm_w / 2, math.sin(a) * arm_w / 2) for a in [-math.pi / 2 + i * math.pi / 8 for i in range(9)]]
    starts = [(-0.4 + arm_w / 2 + math.cos(a) * arm_w / 2, math.sin(a) * arm_w / 2) for a in [math.pi / 2 + i * math.pi / 8 for i in range(9)]]
    beam = lib.polygon_prism('beam', ends + starts, beam_h, at=(0, 0, beam_z0), material=yellow, col=col, parent=horn, bevel=0.05)
    lib.apply_modifiers(beam)
    holes = lib.cylinder('beam_holes', 0.2, 2.0, at=(1.0, 0, beam_z0), segments=12, col=col)
    count = int((arm_len - 1.0) // 1.0)
    lib.add_array(holes, count, (1.0, 0, 0))
    lib.apply_modifiers(holes)
    lib.boolean(beam, holes)
    horn_parts.append(beam)
    horn_parts.append(lib.cylinder('beam_screw', 0.16, 0.1, at=(0, 0, beam_z0 + beam_h + 0.05), material=steel, segments=12, col=col, parent=horn))
    lib.join(horn_parts, 'servo_arm')

    # The flag at the tip: a mast with a finial, and the pennant that slides up it.
    tip = arm_len - arm_w / 2
    mast_node = lib.empty('flag_mast', parent=horn, at=(tip, 0, beam_z0 + beam_h), col=col)
    height = 11.0
    rod = lib.cylinder('mast_rod', 0.12, height, at=(0, 0, height / 2), material=mast, segments=12, col=col, parent=mast_node)
    finial = lib.sphere('mast_finial', 0.24, at=(0, 0, height + 0.12), material=lib.material('finial_gold', '#e2bd5f', metallic=1.0, roughness=0.25), segments=16, rings=8, col=col, parent=mast_node)
    clamp = lib.cylinder('mast_clamp', 0.28, 0.4, at=(0, 0, 0.2), material=yellow, segments=14, col=col, parent=mast_node)
    lib.join([rod, finial, clamp], 'mast')
    pennant_h, pennant_l = 4.6, 7.4
    pennant_node = lib.empty('flag_pennant', parent=mast_node, at=(0, 0, height - 0.35), col=col)
    pennant_node['low'] = lib.cm(0.6 + pennant_h)
    pennant_node['high'] = lib.cm(height - 0.35)
    import bmesh
    bm = bmesh.new()
    cols, rows = 12, 4
    grid = []
    for i in range(cols + 1):
        u = i / cols
        line = []
        for j in range(rows + 1):
            v = j / rows
            # A swallow-tailed pennant, flying back towards the pivot, with a gentle wave.
            half = pennant_h / 2 * (1 - 0.25 * u)
            z = -pennant_h / 2 + (v - 0.5) * 2 * half
            notch = 0.7 * (1 - abs(v - 0.5) * 2) if u > 0.999 else 0
            x = -(u * pennant_l - notch * u)
            y = 0.18 * math.sin(u * math.pi * 1.6) * u
            line.append(bm.verts.new(lib.cm(x - 0.14, y, z)))
        grid.append(line)
    for i in range(cols):
        for j in range(rows):
            bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
    cloth = lib.mesh_from_bmesh('pennant', bm, flag, col, pennant_node)
    solid = cloth.modifiers.new('Solidify', 'SOLIDIFY')
    solid.thickness = lib.cm(0.04)
    lib.apply_modifiers(cloth)
    lib.smooth_by_angle(cloth, 60)
    return root
