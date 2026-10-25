# Shared wood materials of the arena props (N18 R4.7): birch plywood (face grain and the edge's plies), beech for blocks, walnut for
# the table. Drawn by tex.py, original.


def birch_face(lib, tex):
    return lib.material('plywood_face', image=lib.image_from_array('birch_face', lambda: tex.wood(1024, 128, '#ead8b6', '#cfae80', 21, lines=5, warp=1.6, fibre=0.3)), roughness=0.62)


def birch_edge(lib, tex):
    return lib.material('plywood_edge', image=lib.image_from_array('birch_plies', lambda: tex.plies(32, 128, 7, '#eedfc2', '#a88458')), roughness=0.78)


def beech(lib, tex):
    return lib.material('beech', image=lib.image_from_array('beech', lambda: tex.wood(256, 256, '#e2b98a', '#c08e5c', 25, lines=7, warp=2.4)), roughness=0.55)


def walnut(lib, tex):
    return lib.material('walnut', image=lib.image_from_array('walnut', lambda: tex.wood(512, 512, '#6d4a31', '#3b2618', 31, lines=12, warp=2.8, fibre=0.4)), roughness=0.42, coat=0.35)


def face_uvs(lib, obj, size, faces):
    """Uvs of a box (size cm) by the axis each face looks along: `faces` maps an axis to (u axis, v axis, u length, v length)."""
    import bpy
    me = obj.data
    uv = me.uv_layers.get('UVMap') or me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        n = poly.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        ua, va, ul, vl = faces[ax]
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co / lib.CM
            uv.data[li].uv = ((co[ua] + size[ua] / 2) / ul, (co[va] + size[va] / 2) / vl)
