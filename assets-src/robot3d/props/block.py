# prop_block: a beech building block (N18 R4.7), 10 cm a side, rounded edges; the view scales it to a box of the scenario.


def build(lib, tex, kit, col, wood):
    root = lib.empty('prop_block', col=col)
    mat = wood.beech(lib, tex)
    block = lib.box('block', (10, 10, 10), at=(0, 0, 5), material=mat, col=col, parent=root)
    wood.face_uvs(lib, block, (10, 10, 10), {0: (1, 2, 10, 10), 1: (0, 2, 10, 10), 2: (0, 1, 10, 10)})
    lib.add_bevel(block, 0.45, 3)
    lib.apply_modifiers(block)
    lib.smooth_by_angle(block, 35)
    return root
