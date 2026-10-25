# prop_cardboard: a cardboard box (N18 R4.7), 20 × 20 × 15 cm: corrugated board, the seam of its top flaps, and a strip of brown
# packing tape over the seam and down both ends. Origin: the middle of its base.


def build(lib, tex, kit, col, wood):
    root = lib.empty('prop_cardboard', col=col)
    board = lib.material('cardboard', image=lib.image_from_array('cardboard', lambda: tex.cardboard(256, 256, 41)), roughness=0.9)
    tape = lib.material('packing_tape', '#c79a5e', roughness=0.22, alpha=0.9)
    seam = lib.material('cardboard_seam', '#6e5233', roughness=0.9)
    box = lib.box('box', (20, 20, 15), at=(0, 0, 7.5), material=board, col=col, parent=root)
    wood.face_uvs(lib, box, (20, 20, 15), {0: (1, 2, 20, 20), 1: (0, 2, 20, 20), 2: (0, 1, 20, 20)})
    lib.add_bevel(box, 0.35, 2)
    lib.apply_modifiers(box)
    parts = [box, lib.box('seam', (20.02, 0.12, 0.05), at=(0, 0, 15.0), material=seam, col=col, parent=root)]
    parts.append(lib.box('tape_top', (20.4, 5.0, 0.04), at=(0, 0, 15.04), material=tape, col=col, parent=root))
    for side in (-1, 1):
        parts.append(lib.box('tape_end', (0.04, 5.0, 6.0), at=(side * 10.2, 0, 15 - 3.0), material=tape, col=col, parent=root))
    lib.join(parts, 'cardboard_box')
    return root
