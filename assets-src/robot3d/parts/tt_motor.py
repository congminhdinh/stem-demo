# part_tt_motor: a TT gear motor (N18 R4.7), the hobby kit's yellow plastic gearbox (two halves with their seam, the long bolts and
# nuts that hold it), the flattened metal can with its black end cap and brass terminals, the white double-D output shaft, and the black
# acrylic bracket that holds it to the lower plate. Origin: the output shaft's axis at the wheel's centre (the kit's motor mount);
# modelled for the left side, the gearbox inboard (−y) of a wheel of the kit's width; the view mirrors it for the right.

GEARBOX = (3.7, 2.24, 1.88)
SHAFT_FROM_REAR = 1.1


def build(lib, tex, kit, col):
    W = kit['wheel']['W']
    root = lib.empty('part_tt_motor', col=col)
    yellow = lib.material('gearbox_yellow', '#f7c414', roughness=0.38)
    can = lib.material('motor_can', '#b7bdc6', metallic=1.0, roughness=0.32)
    black = lib.material('abs_black', '#1d1f23', roughness=0.42)
    acrylic = lib.material('acrylic_black', '#141518', roughness=0.12)
    steel = lib.material('steel', '#c5cad1', metallic=1.0, roughness=0.24)
    brass = lib.material('brass', '#d2a94c', metallic=1.0, roughness=0.3)
    white = lib.material('abs_white', '#f4f4f1', roughness=0.45)

    gx, gy, gz = GEARBOX
    yc = -(W / 2 + 0.1 + gy / 2)
    xc = gx / 2 - SHAFT_FROM_REAR
    # Two shell halves with a hairline seam between them.
    halves = []
    for side in (-1, 1):
        halves.append(lib.box(f'gearbox_{side}', (gx, gy / 2 - 0.02, gz), at=(xc, yc + side * (gy / 4 + 0.01), 0), material=yellow, bevel=0.16, segments=3, col=col, parent=root))
    # The shaft boss and a bearing ring on the outer face.
    halves.append(lib.cylinder('gearbox_boss', 0.55, 0.18, at=(0, yc + gy / 2 + 0.09, 0), axis='Y', material=yellow, segments=24, col=col, parent=root, bevel=0.04))
    # Long bolts through the gearbox: heads outboard, nuts inboard.
    for bx, bz in ((-0.55, -0.55), (2.05, -0.55), (2.05, 0.6)):
        halves.append(lib.cylinder('bolt_head', 0.2, 0.12, at=(bx, yc + gy / 2 + 0.06, bz), axis='Y', material=steel, segments=12, col=col, parent=root))
        halves.append(lib.cylinder('bolt_nut', 0.24, 0.16, at=(bx, yc - gy / 2 - 0.38, bz), axis='Y', material=steel, segments=6, col=col, parent=root))
    lib.join(halves, 'tt_gearbox')

    # The can: a cylinder with two flats, its end cap and terminals.
    length = 2.5
    x0 = xc + gx / 2 - 0.05
    body = lib.cylinder('motor_can', 1.0, length, at=(x0 + length / 2, yc, 0), axis='X', material=can, segments=32, col=col, parent=root, bevel=0.06)
    lib.apply_modifiers(body)
    body.scale = (1, 1, 0.76)
    end = lib.cylinder('motor_end', 0.82, 0.34, at=(x0 + length + 0.17, yc, 0), axis='X', material=black, segments=28, col=col, parent=root, bevel=0.06)
    end.scale = (1, 1, 0.8)
    tabs = [lib.box('terminal', (0.06, 0.24, 0.42), at=(x0 + length + 0.38, yc + s * 0.42, 0.12), material=brass, col=col, parent=root) for s in (-1, 1)]
    lib.join([body, end] + tabs, 'tt_can')

    # The output shaft out to the wheel's hub, and the bracket inboard.
    shaft = lib.cylinder('shaft', 0.27, 0.5, at=(0, -W / 2 - 0.05, 0), axis='Y', material=white, segments=16, col=col, parent=root)
    bracket = lib.box('bracket', (3.0, 0.3, 2.6), at=(0.95, yc - gy / 2 - 0.15, -0.35), material=acrylic, bevel=0.04, col=col, parent=root)
    foot = lib.box('bracket_foot', (3.0, 1.3, 0.3), at=(0.95, yc - gy / 2 - 0.65 + 0.15, -kit['wheel']['axle_above_plate'] + 0.15), material=acrylic, bevel=0.04, col=col, parent=root)
    lib.join([shaft], 'tt_shaft')
    lib.join([bracket, foot], 'tt_bracket')
    return root
