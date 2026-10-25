# prop_studio: the room around the table (N18 R4.7): a floor disc and a dome, 14 m across, with a soft gradient in their vertex colours
# (fix round 1: a light warm-grey floor, a shade darker round the table, fading into the same pale backdrop the dome rises from): a
# seamless photo studio with no horizon and no edge. The view draws it unlit, the table's soft shadow on it, and its fog fades the floor
# into it.

import math

import bmesh


def build(lib, tex, kit, col, wood):
    root = lib.empty('prop_studio', col=col)
    mat = lib.material('studio', '#ffffff', roughness=1.0)
    floor_c = (0.74, 0.76, 0.79)
    sky_c = (0.86, 0.89, 0.93)
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, segments=64, radius=14.0)
    floor = lib.mesh_from_bmesh('studio_floor', bm, mat, col, root, at=(0, 0, -75.0))
    sub = floor.modifiers.new('Subdivide', 'SUBSURF')
    sub.levels = 2
    sub.subdivision_type = 'SIMPLE'
    lib.apply_modifiers(floor)

    def floor_colour(co):
        r = math.hypot(co.x, co.y) / 1400.0
        t = min(1.0, r ** 0.8)
        return tuple(a * (1 - t) + b * t for a, b in zip((0.62, 0.64, 0.67), floor_c))

    lib.unlit_color(floor, floor_colour)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=24, radius=14.0)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -0.2], context='VERTS')
    bmesh.ops.reverse_faces(bm, faces=bm.faces)
    dome = lib.mesh_from_bmesh('studio_dome', bm, mat, col, root, at=(0, 0, -75.0))

    def dome_colour(co):
        t = max(0.0, min(1.0, (co.z + 75.0) / 600.0)) ** 0.6
        return tuple(a * (1 - t) + b * t for a, b in zip(floor_c, sky_c))

    lib.unlit_color(dome, dome_colour)
    return root
