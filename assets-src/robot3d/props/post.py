# prop_post: a striped marker pole (N18 R4.7), radius 4 cm, 20 cm tall, painted in red and white bands on a weighted black foot of the
# pole's own radius (fix round 1: nothing wider than the cylinder the physics builds). The view scales it to a tall cylinder of the scenario.


def build(lib, tex, kit, col, wood):
    root = lib.empty('prop_post', col=col)
    paint = lib.material('post_paint', image=lib.image_from_array('post_bands', lambda: tex.bands(8, 128, ['#e23b32', '#f6f6f4'] * 4, [1] * 8)), roughness=0.35)
    foot = lib.material('rubber', '#1b1c1f', roughness=0.84)
    pole = lib.lathe('post_pole', [(0.0, 1.0), (4.0, 1.0), (4.0, 19.6), (3.7, 20.0), (0.0, 20.0)], material=paint, segments=40, col=col, parent=root)
    me = pole.data
    uv = me.uv_layers.get('UVMap') or me.uv_layers.new(name='UVMap')
    import math
    for poly in me.polygons:
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co / lib.CM
            uv.data[li].uv = ((math.atan2(co.y, co.x) / (2 * math.pi)) % 1, (co.z - 1.0) / 19.0)
    base = lib.lathe('post_foot', [(0.0, 0.0), (4.0, 0.0), (4.0, 1.05), (0.0, 1.05)], material=foot, segments=40, col=col, parent=root)
    lib.join([pole, base], 'post')
    return root
