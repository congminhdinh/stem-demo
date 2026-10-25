# prop_cone: a traffic cone (N18 R4.7) on its square base, 8 × 8 cm and 12 cm tall, orange with two white reflective bands. Origin: the
# middle of the base; the view scales it to a small obstacle box of the scenario (the base fills the box's footprint).


def build(lib, tex, kit, col, wood):
    root = lib.empty('prop_cone', col=col)
    orange = lib.material('cone_orange', '#ff6a14', roughness=0.48)
    white = lib.material('cone_white', '#f5f6f7', metallic=0.2, roughness=0.2)
    base = lib.box('cone_base', (8, 8, 0.7), at=(0, 0, 0.35), material=orange, bevel=0.25, col=col, parent=root)
    body = lib.lathe('cone_body', [(3.05, 0.6), (3.05, 0.9), (2.6, 1.0), (0.62, 11.6), (0.45, 12.0), (0.0, 12.0)], material=orange, segments=40, col=col, parent=root)
    bands = []
    for z0, z1 in ((4.6, 6.0), (7.8, 8.9)):
        r0 = 2.6 - (2.6 - 0.62) * (z0 - 1.0) / 10.6 + 0.03
        r1 = 2.6 - (2.6 - 0.62) * (z1 - 1.0) / 10.6 + 0.03
        bands.append(lib.lathe('cone_band', [(r0, z0), (r1, z1)], material=white, segments=40, col=col, parent=root))
    lib.join([base, body] + bands, 'cone')
    return root
