# Things on the table round the arena (N18 R4.7), never on the mat: prop_ball (a yellow foam ball), prop_crate (a stackable parts crate,
# its side slots cut by an array of cutters and a boolean) and prop_tape (a roll of masking tape).


def build_ball(lib, tex, kit, col, wood):
    root = lib.empty('prop_ball', col=col)
    foam = lib.material('foam_yellow', '#ffd21c', roughness=0.62)
    ball = lib.sphere('ball', 3.5, at=(0, 0, 3.5), material=foam, segments=32, rings=16, col=col, parent=root)
    return root


def build_crate(lib, tex, kit, col, wood):
    root = lib.empty('prop_crate', col=col)
    blue = lib.material('crate_blue', '#2f6fe0', roughness=0.4)
    outer = lib.box('crate', (30, 20, 12), at=(0, 0, 6), material=blue, bevel=0.5, col=col, parent=root)
    lib.apply_modifiers(outer)
    lib.boolean(outer, lib.box('crate_inner', (28.4, 18.4, 12), at=(0, 0, 6.8), col=col))
    for axis in ('x', 'y'):
        n, step, length = (6, 4.2, 2.6) if axis == 'x' else (4, 3.8, 2.4)
        cutter = lib.box('slot', (length, 40, 6) if axis == 'x' else (40, length, 6), at=((-(n - 1) * step / 2, 0, 6.5) if axis == 'x' else (0, -(n - 1) * step / 2, 6.5)), col=col)
        lib.add_array(cutter, n, (step, 0, 0) if axis == 'x' else (0, step, 0))
        lib.apply_modifiers(cutter)
        lib.boolean(outer, cutter)
    lib.smooth_by_angle(outer, 35)
    return root


def build_tape(lib, tex, kit, col, wood):
    root = lib.empty('prop_tape', col=col)
    paper = lib.material('masking_tape', '#e9dcb4', roughness=0.7)
    core = lib.material('tape_core', '#9b7a4f', roughness=0.8)
    lib.lathe('tape_roll', [(3.6, 0.0), (5.2, 0.0), (5.25, 0.1), (5.25, 2.4), (5.2, 2.5), (3.6, 2.5)], material=paper, segments=48, col=col, parent=root)
    lib.lathe('tape_core', [(3.6, 2.5), (3.3, 2.5), (3.3, 0.0), (3.6, 0.0)], material=core, segments=48, col=col, parent=root)
    return root
