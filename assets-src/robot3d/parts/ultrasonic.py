# part_ultrasonic: an ultrasonic ranger of the HC-SR04 kind (N18 R4.7): two silver transducers Ø16 mm, 26 mm apart, with woven grilles,
# on a blue 45 × 20 mm board with its crystal and four header pins, held by a black acrylic bracket on the lower plate. Origin: the
# middle of the transducers' front faces (the kit's sensor mount), facing +x: nothing stands in front of the mount, so the robot's
# nose is where the physics' body ends.


def build(lib, tex, kit, col):
    below = kit['ultrasonic']['to_plate']  # from the mount down to the lower plate's top (cm)
    root = lib.empty('part_ultrasonic', col=col)
    blue = lib.material('pcb_blue', image=lib.image_from_array('pcb_blue', tex.pcb(256, 112, '#1a4aa6', '#2f66c4', '#d8d2c0', '#eef2f6', 52, traces=30,
                                                                                    outlines=((0.04, 0.08, 0.36, 0.92), (0.64, 0.08, 0.96, 0.92)), pads=((0.5, 0.86, 0.02),))), roughness=0.36, coat=0.25)
    can = lib.material('transducer_can', '#e6e9ee', metallic=0.55, roughness=0.32)
    grille = lib.material('grille', image=lib.image_from_array('grille', tex.grille(128, 22)), metallic=0.4, roughness=0.55)
    dark = lib.material('abs_black', '#1d1f23', roughness=0.42)
    gold = lib.material('gold', '#e2bd5f', metallic=1.0, roughness=0.24)
    acrylic = lib.material('acrylic_black', '#141518', roughness=0.12)
    steel = lib.material('steel', '#c5cad1', metallic=1.0, roughness=0.24)

    statics = []
    pcb = lib.box('us_pcb', (0.16, 4.5, 2.0), at=(-1.28, 0, 0), material=blue, bevel=0.03, segments=1, col=col, parent=root)
    lib.planar_uv(pcb, (4.5, 2.0), axis='X')
    statics.append(pcb)
    for side in (-1, 1):
        y = side * 1.3
        statics.append(lib.lathe(f'us_can_{side}', [(0.0, -1.2), (0.8, -1.2), (0.8, -0.08), (0.74, 0.0), (0.66, 0.0), (0.66, -0.06)], at=(0, y, 0), axis='X', material=can, segments=40, col=col, parent=root))
        face = lib.cylinder(f'us_grille_{side}', 0.66, 0.02, at=(-0.07, y, 0), axis='X', material=grille, segments=40, col=col, parent=root)
        lib.planar_uv(face, (1.32, 1.32), axis='X')
        statics.append(face)
    statics.append(lib.box('us_crystal', (0.3, 1.0, 0.4), at=(-1.05, 0, 0.62), material=steel, bevel=0.15, segments=3, col=col, parent=root))
    statics.append(lib.box('us_header', (0.25, 1.02, 0.25), at=(-1.28, 0, -1.12), material=dark, col=col, parent=root))
    pin = lib.box('us_pin', (0.06, 0.06, 0.6), at=(-1.28, -0.381, -1.45), material=gold, col=col, parent=root)
    lib.add_array(pin, 4, (0, 0.254, 0))
    statics.append(pin)
    # The bracket: an upright behind the board and a foot on the lower plate, two screws through each.
    statics.append(lib.box('us_bracket', (0.3, 5.2, below + 1.1), at=(-1.51, 0, -below + (below + 1.1) / 2), material=acrylic, bevel=0.04, col=col, parent=root))
    statics.append(lib.box('us_bracket_foot', (1.6, 5.2, 0.3), at=(-2.36, 0, -below + 0.15), material=acrylic, bevel=0.04, col=col, parent=root))
    for side in (-1, 1):
        statics.append(lib.cylinder('us_screw', 0.18, 0.1, at=(-1.15, side * 2.0, 0.0), axis='X', material=steel, segments=12, col=col, parent=root))
    lib.join(statics, 'ultrasonic_static')
    return root
