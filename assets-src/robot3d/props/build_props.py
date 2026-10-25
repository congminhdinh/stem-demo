# Builds every arena prop (N18 R4.7) into the collection 'props', each at its own spot on a grid so they do not shade each other while
# their ambient occlusion is baked, the floor under each. Called by build.py.

import importlib.util
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def _load(name):
    spec = importlib.util.spec_from_file_location('prop_' + name, os.path.join(HERE, name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def build_all(lib, tex, kit):
    col = lib.collection('props')
    wood = _load('wood')
    builders = [
        ('wall', 'build'), ('block', 'build'), ('cardboard_box', 'build'), ('marker', 'build'), ('tin_can', 'build'), ('post', 'build'),
        ('barrier', 'build'), ('garage', 'build_roof'), ('garage', 'build_sign'), ('dock', 'build'), ('fence', 'build_post'),
        ('fence', 'build_rail'), ('table', 'build_top'), ('table', 'build_leg'), ('table_props', 'build_ball'),
        ('table_props', 'build_crate'), ('table_props', 'build_tape'), ('banner', 'build'),
    ]
    roots = []
    for i, (module, fn) in enumerate(builders):
        root = getattr(_load(module), fn)(lib, tex, kit, col, wood)
        root.location = lib.cm((i % 6) * 150.0, (i // 6) * 150.0, 0)
        roots.append(root)
    import bpy
    bpy.context.view_layer.update()
    lib.bake_ao([o for r in roots for o in r.children_recursive if o.type == 'MESH' and o.data.materials and o.data.materials[0].name not in ('polycarbonate',)], distance_cm=4.0, samples=32, floor=0.55, ground=True)
    studio = _load('studio').build(lib, tex, kit, col, wood)
    roots.append(studio)
    return roots
