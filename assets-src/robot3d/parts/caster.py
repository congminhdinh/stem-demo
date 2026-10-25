# part_caster: a ball caster (N18 R4.7): a chrome ball of the kit's casterRadiusCm in a black cup with its flange and two screws up to
# the lower plate. Origin: the ball's centre (the kit's casterCm).


def build(lib, tex, kit, col):
    r = kit['caster']['r']
    gap = kit['caster']['to_plate']  # from the ball's centre up to the lower plate's underside (cm)
    root = lib.empty('part_caster', col=col)
    chrome = lib.material('chrome', '#eef0f3', metallic=1.0, roughness=0.05)
    black = lib.material('abs_black', '#1d1f23', roughness=0.42)
    steel = lib.material('steel', '#c5cad1', metallic=1.0, roughness=0.24)
    lib.sphere('caster_ball', r, material=chrome, segments=32, rings=16, col=col, parent=root)
    cup = lib.lathe('caster_cup', [(r * 0.55, -r * 0.05), (r * 1.08, 0.0), (r * 1.22, r * 0.45), (r * 1.22, gap - 0.14), (r * 0.3, gap - 0.14)], material=black, segments=40, col=col, parent=root)
    flange = lib.box('caster_flange', (r * 3.4, r * 1.9, 0.14), at=(0, 0, gap - 0.07), material=black, bevel=0.05, col=col, parent=root)
    screws = [lib.cylinder('caster_screw', 0.22, 0.12, at=(side * r * 1.35, 0, gap - 0.2), material=steel, segments=12, col=col, parent=root) for side in (-1, 1)]
    lib.join([cup, flange] + screws, 'caster_housing')
    return root
