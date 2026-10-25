# prop_wall: an arena wall (N18 R4.7), a strip of 20 mm birch plywood 1 m long and 10 cm high, its edges eased by a bevel: the grain on
# its faces, the plies on its top and ends. Origin: the middle of its base. The view scales it to each wall of the scenario (its
# length, thickness and height); the plies stay across the thickness.

L, T, H = 100.0, 2.0, 10.0


def build(lib, tex, kit, col, wood):
    root = lib.empty('prop_wall', col=col)
    face, edge = wood.birch_face(lib, tex), wood.birch_edge(lib, tex)
    wall = lib.box('wall', (L, T, H), at=(0, 0, H / 2), material=face, col=col, parent=root)
    wall.data.materials.append(edge)
    # Faces looking along y show the grain (u along x, v up); the top, the bottom and the ends show the plies (v across the thickness).
    for poly in wall.data.polygons:
        n = poly.normal
        poly.material_index = 0 if abs(n.y) > 0.5 else 1
    wood.face_uvs(lib, wall, (L, T, H), {0: (2, 1, H, T), 1: (0, 2, L, H), 2: (0, 1, 25.0, T)})
    lib.add_bevel(wall, 0.18, 2)
    lib.apply_modifiers(wall)
    lib.smooth_by_angle(wall, 35)
    return root
