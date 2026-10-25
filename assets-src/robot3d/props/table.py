# prop_table_top and prop_table_leg: the classroom table the arena stands on (N18 R4.7): a 3 cm walnut-veneer top with a lacquered
# finish and eased edges (1 m × 1 m, the view scales it round the arena), and square steel legs 72 cm tall with plastic feet.


def build_top(lib, tex, kit, col, wood):
    root = lib.empty('prop_table_top', col=col)
    mat = wood.walnut(lib, tex)
    edge = lib.material('table_edge', '#2f2118', roughness=0.5)
    top = lib.box('table_top', (100, 100, 3), at=(0, 0, -1.5), material=mat, col=col, parent=root)
    top.data.materials.append(edge)
    for poly in top.data.polygons:
        poly.material_index = 0 if abs(poly.normal.z) > 0.5 else 1
    wood.face_uvs(lib, top, (100, 100, 3), {0: (1, 2, 50, 3), 1: (0, 2, 50, 3), 2: (0, 1, 50, 50)})
    lib.add_bevel(top, 0.4, 3)
    lib.apply_modifiers(top)
    lib.smooth_by_angle(top, 35)
    return root


def build_leg(lib, tex, kit, col, wood):
    root = lib.empty('prop_table_leg', col=col)
    steel = lib.material('leg_steel', '#2c3036', metallic=0.85, roughness=0.38)
    cap = lib.material('abs_black', '#1d1f23', roughness=0.42)
    leg = lib.box('leg_tube', (4, 4, 71), at=(0, 0, -3 - 35.5), material=steel, bevel=0.3, col=col, parent=root)
    foot = lib.box('leg_foot', (4.2, 4.2, 1.2), at=(0, 0, -74.4), material=cap, bevel=0.3, col=col, parent=root)
    lib.join([leg, foot], 'table_leg')
    return root
