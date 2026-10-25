# part_chassis: the robot's frame (N18 R4.7). Two perforated orange anodised-aluminium plates (Meccano style: Ø4.2 mm holes on a
# 12 mm grid, made with an array of hole cutters and one boolean), the kit's body box exactly (15 × 12 cm, from the 1.5 cm clearance
# to 6.5 cm), held by four brass hex standoffs through the corner holes with pan-head screws; between the plates the battery holder
# with two 18650-size cells and the motor driver with its heatsink and screw terminals. Origin: the robot's origin on the floor under
# the middle of the body. The top plate has the opening for the servo at the reference kit's servo mount.

PITCH = 1.2
HOLE_R = 0.21
PLATE_T = 0.2


def plate(lib, name, body, z, material, col, parent, cutouts=()):
    L, W = body['L'], body['W']
    obj = lib.polygon_prism(name, lib.rounded_rect(L, W, 0.9), PLATE_T, at=(0, 0, z), material=material, col=col, parent=parent)
    lib.add_bevel(obj, 0.05, 2)
    lib.apply_modifiers(obj)
    nx = int((L - 1.6) // PITCH)
    ny = int((W - 1.6) // PITCH)
    x0 = -nx * PITCH / 2
    y0 = -ny * PITCH / 2
    cutter = lib.cylinder(name + '_holes', HOLE_R, 1.0, at=(x0, y0, z + PLATE_T / 2), segments=8, col=col)
    lib.add_array(cutter, nx + 1, (PITCH, 0, 0))
    lib.add_array(cutter, ny + 1, (0, PITCH, 0), name='Array2')
    lib.apply_modifiers(cutter)
    for cx, cy, lx, ly in cutouts:
        box = lib.box(name + '_cut', (lx, ly, 1.0), at=(cx, cy, z + PLATE_T / 2), col=col)
        lib.boolean(cutter, box, operation='UNION')
    lib.boolean(obj, cutter)
    lib.smooth_by_angle(obj, 30)
    return obj, (x0, y0, nx, ny)


def screw_head(lib, name, at, material, col, parent, down=False):
    s = -1 if down else 1
    head = lib.lathe(name, [(0.0, 0.0), (0.31, 0.0), (0.31, 0.04 * s), (0.26, 0.11 * s), (0.14, 0.15 * s), (0.0, 0.16 * s)], at=at, material=material, segments=12, col=col, parent=parent)
    slot = lib.box(name + '_slot', (0.5, 0.07, 0.2), at=(at[0], at[1], at[2] + 0.16 * s), col=col)
    slot2 = lib.box(name + '_slot2', (0.07, 0.5, 0.2), at=(at[0], at[1], at[2] + 0.16 * s), col=col)
    lib.boolean(slot, slot2, operation='UNION')
    lib.boolean(head, slot)
    return head


def build(lib, tex, kit, col):
    body = kit['body']
    L, W, bottom, top = body['L'], body['W'], body['bottom'], body['top']
    root = lib.empty('part_chassis', col=col)

    orange = lib.material('anodised_orange', '#f26419', metallic=0.65, roughness=0.34)
    brass = lib.material('brass', '#d2a94c', metallic=1.0, roughness=0.3)
    steel = lib.material('steel', '#c5cad1', metallic=1.0, roughness=0.24)
    black = lib.material('abs_black', '#1d1f23', roughness=0.42)
    cell_wrap = lib.material('cell_wrap', '#2a62d6', metallic=0.15, roughness=0.32)
    terminal = lib.material('terminal_blue', '#1e6be0', roughness=0.42)
    heatsink = lib.material('heatsink', '#26292e', metallic=0.85, roughness=0.42)
    pcb_red = lib.material('pcb_red', image=lib.image_from_array('pcb_red', tex.pcb(160, 160, '#a61e25', '#c63a3d', '#d9c58f', '#f2ece6', 54, traces=26, outlines=((0.08, 0.08, 0.5, 0.92), (0.6, 0.1, 0.92, 0.9)))), roughness=0.38)

    servo = kit['servo']
    cut = (servo['x'] - 0.59, servo['y'], 2.4, 1.36)
    lower, (x0, y0, nx, ny) = plate(lib, 'chassis_plate_lower', body, bottom, orange, col, root)
    upper, _ = plate(lib, 'chassis_plate_upper', body, top - PLATE_T, orange, col, root, cutouts=[cut])

    # Standoffs through the corner holes, a screw head over and under each.
    hardware = []
    corners = [(x0 + i * PITCH, y0 + j * PITCH) for i in (0, nx) for j in (0, ny)]
    for k, (x, y) in enumerate(corners):
        hardware.append(lib.cylinder(f'standoff_{k}', 0.33, top - bottom - 2 * PLATE_T, at=(x, y, (top + bottom) / 2), material=brass, segments=6, col=col, parent=root, bevel=0.03, bevel_segments=1))
        hardware.append(screw_head(lib, f'screw_top_{k}', (x, y, top), steel, col, root))
        hardware.append(screw_head(lib, f'screw_bottom_{k}', (x, y, bottom), steel, col, root, down=True))
    lib.join(hardware[0::3], 'chassis_standoffs')
    lib.join([h for i, h in enumerate(hardware) if i % 3 != 0], 'chassis_screws')

    # The battery holder between the plates: an open black box, two cells with their caps and the springs at the ends.
    floor = bottom + PLATE_T
    hl, hw, hh = 7.6, 4.0, 1.5
    hx = 0.9
    shell = lib.box('battery_shell', (hl, hw, hh), at=(hx, 0, floor + hh / 2), material=black, bevel=0.08)
    lib.apply_modifiers(shell)
    inner = lib.box('battery_inner', (hl - 0.5, hw - 0.4, hh), at=(hx, 0, floor + hh / 2 + 0.25), col=col)
    lib.boolean(shell, inner)
    shell.parent = root
    parts = [shell]
    for side in (-1, 1):
        y = side * 0.95
        zc = floor + 0.25 + 0.9
        parts.append(lib.cylinder(f'cell_{side}', 0.9, hl - 0.9, at=(hx, y, zc), axis='X', material=cell_wrap, segments=28, col=col, parent=root, bevel=0.06))
        parts.append(lib.cylinder(f'cell_cap_{side}', 0.62, 0.08, at=(hx + (hl - 0.9) / 2 + 0.04, y, zc), axis='X', material=steel, segments=20, col=col, parent=root))
        parts.append(lib.cylinder(f'cell_nub_{side}', 0.3, 0.12, at=(hx + (hl - 0.9) / 2 + 0.12, y, zc), axis='X', material=steel, segments=14, col=col, parent=root))
        for end in (-1, 1):
            parts.append(lib.cylinder(f'spring_{side}_{end}', 0.35, 0.25, at=(hx + end * (hl / 2 - 0.37), y, zc), axis='X', material=steel, segments=12, col=col, parent=root))
    lib.join(parts, 'chassis_battery')

    # The motor driver at the back: a red board on standoffs, its finned heatsink, two blue screw terminals with their screws.
    dx, dz = -L / 2 + 2.2, floor + 0.45
    driver = [lib.box('driver_pcb', (3.2, 3.2, 0.16), at=(dx, 0, dz + 0.08), material=pcb_red, bevel=0.03, col=col, parent=root)]
    lib.planar_uv(driver[0], (3.2, 3.2))
    for sx in (-1.3, 1.3):
        for sy in (-1.3, 1.3):
            driver.append(lib.cylinder('driver_standoff', 0.18, 0.45, at=(dx + sx, sy, floor + 0.225), material=brass, segments=6, col=col, parent=root))
    base = lib.box('heatsink_base', (1.6, 1.5, 0.15), at=(dx + 0.4, 0, dz + 0.235), material=heatsink, col=col, parent=root)
    fin = lib.box('heatsink_fin', (1.6, 0.09, 1.1), at=(dx + 0.4, -0.66, dz + 0.31 + 0.55), material=heatsink, col=col, parent=root)
    lib.add_array(fin, 7, (0, 0.22, 0))
    driver += [base, fin]
    for side in (-1, 1):
        driver.append(lib.box('terminal', (0.75, 1.0, 0.85), at=(dx - 1.1, side * 0.9, dz + 0.16 + 0.425), material=terminal, bevel=0.06, col=col, parent=root))
        for k in (-1, 1):
            driver.append(lib.cylinder('terminal_screw', 0.13, 0.08, at=(dx - 1.1, side * 0.9 + k * 0.25, dz + 0.16 + 0.89), material=steel, segments=10, col=col, parent=root))
    lib.join(driver, 'chassis_driver')
    return root
