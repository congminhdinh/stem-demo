# prop_fence_post and prop_fence_rail: a low white PVC pipe fence (N18 R4.7) for the table's edge, outside the arena: posts on round
# weighted feet with T fittings, and rails 1 m long that the view cuts to length (scaled along x only, so the pipe stays round).


def build_post(lib, tex, kit, col, wood):
    root = lib.empty('prop_fence_post', col=col)
    pvc = lib.material('pvc_white', '#f3f5f7', roughness=0.3)
    grey = lib.material('pvc_grey', '#9aa3ad', roughness=0.5)
    parts = [
        lib.lathe('post_foot', [(0.0, 0.0), (1.7, 0.0), (1.7, 0.3), (1.15, 0.7), (0.95, 1.1), (0.0, 1.1)], material=grey, segments=32, col=col, parent=root),
        lib.cylinder('post_pipe', 0.8, 15.0, at=(0, 0, 8.4), material=pvc, segments=24, col=col, parent=root),
    ]
    for z in (6.0, 14.0):
        parts.append(lib.cylinder('tee', 1.05, 3.0, at=(0, 0, z), material=pvc, segments=24, col=col, parent=root, bevel=0.15))
        parts.append(lib.cylinder('tee_arm', 1.0, 3.6, at=(0, 0, z), axis='X', material=pvc, segments=24, col=col, parent=root, bevel=0.15))
    parts.append(lib.cylinder('post_cap', 1.05, 0.8, at=(0, 0, 16.2), material=pvc, segments=24, col=col, parent=root, bevel=0.25))
    lib.join(parts, 'fence_post')
    return root


def build_rail(lib, tex, kit, col, wood):
    root = lib.empty('prop_fence_rail', col=col)
    pvc = lib.material('pvc_white', '#f3f5f7', roughness=0.3)
    lib.cylinder('rail', 0.8, 100.0, at=(0, 0, 0), axis='X', material=pvc, segments=24, col=col, parent=root)
    return root
