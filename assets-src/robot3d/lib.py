# Shared helpers of the robot lab's 3D assets (N18 R4.7), run inside Blender 5.2 (bpy, bmesh, numpy).
#
# Every part and prop is modelled by a script in parts/ or props/ that calls these helpers; build.py runs them all in one Blender
# session and exports the GLBs to public/robot3d/. Authoring frame: Blender's own, which is the kit's robot frame (x forward, y left,
# z up); the glTF exporter turns it into three.js's (x, z, -y), as the 3D view maps kit mounts (src/ui/robot3d/scene-math.ts).
# Lengths are written in centimetres (`cm(...)`) and stored in metres. Everything here is original modelling: no imported mesh,
# no downloaded texture. Textures are drawn with numpy (wood grain, circuit boards, plies, cardboard) and ambient occlusion is
# baked with Cycles into each mesh's vertex colours (COLOR_0, which glTF multiplies into the base colour).

import math

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

CM = 0.01

# The level of detail being built: 'high' (the high tier's files) or 'low' (robot-kit-low.glb, arena-props-low.glb: half the segments,
# one-segment bevels, the smallest bevels left out), set by build.py before the scripts run.
DETAIL = 'high'


def seg(n):
    """Segments of a round part for the level of detail being built."""
    return n if DETAIL == 'high' else max(min(n, 6), int(round(n * 0.5)))


def cm(*values):
    """Centimetres to metres: a number, or a vector."""
    if len(values) == 1:
        return values[0] * CM
    return Vector([v * CM for v in values])


# ---------------------------------------------------------------------------------------------------------------- scene


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _materials.clear()
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1.0
    if scene.world is None:
        scene.world = bpy.data.worlds.new('World')
    return scene


def collection(name):
    found = bpy.data.collections.get(name)
    if found is None:
        found = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(found)
    return found


def empty(name, parent=None, at=(0, 0, 0), col=None):
    """A node of the exported tree: a part's root or a moving joint. `at` in cm."""
    node = bpy.data.objects.new(name, None)
    node.empty_display_size = 0.01
    node.location = cm(*at)
    (col or bpy.context.scene.collection).objects.link(node)
    if parent is not None:
        node.parent = parent
    return node


def link(obj, col=None, parent=None):
    (col or bpy.context.scene.collection).objects.link(obj)
    if parent is not None:
        obj.parent = parent
    return obj


def mesh_from_bmesh(name, bm, material=None, col=None, parent=None, at=(0, 0, 0)):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    obj.location = cm(*at)
    if material is not None:
        me.materials.append(material)
    return link(obj, col, parent)


# ------------------------------------------------------------------------------------------------------------ primitives


def box(name, size, at=(0, 0, 0), material=None, bevel=0.0, segments=2, col=None, parent=None):
    """A box of `size` (cm: along x, y, z) centred at `at` (cm), its edges rounded by `bevel` (cm) with a bevel modifier."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=cm(*size), verts=bm.verts)
    obj = mesh_from_bmesh(name, bm, material, col, parent, at)
    if bevel > 0:
        add_bevel(obj, bevel, segments)
    return obj


def cylinder(name, radius, depth, at=(0, 0, 0), axis='Z', material=None, segments=32, bevel=0.0, bevel_segments=2, col=None, parent=None, radius_top=None):
    """A cylinder (or a cone frustum, `radius_top`) along `axis`, centred at `at`; sizes in cm."""
    segments = seg(segments)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segments, radius1=cm(radius), radius2=cm(radius if radius_top is None else radius_top), depth=cm(depth))
    rotation = {'Z': Matrix.Identity(3), 'X': Matrix.Rotation(math.pi / 2, 3, 'Y'), 'Y': Matrix.Rotation(math.pi / 2, 3, 'X')}[axis]
    bmesh.ops.rotate(bm, verts=bm.verts, matrix=rotation)
    obj = mesh_from_bmesh(name, bm, material, col, parent, at)
    if bevel > 0:
        add_bevel(obj, bevel, bevel_segments, limit='ANGLE')
    smooth_by_angle(obj, 40)
    return obj


def sphere(name, radius, at=(0, 0, 0), material=None, segments=32, rings=16, col=None, parent=None):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg(segments), v_segments=seg(rings), radius=cm(radius))
    obj = mesh_from_bmesh(name, bm, material, col, parent, at)
    smooth_by_angle(obj, 80)
    return obj


def lathe(name, profile, at=(0, 0, 0), axis='Z', material=None, segments=48, col=None, parent=None, angle=2 * math.pi):
    """Spins a profile of (radius, height) points (cm) about the axis: rims, caps, cans, cones. Uses bmesh spin."""
    segments = seg(segments)
    bm = bmesh.new()
    verts = [bm.verts.new(cm(r, 0, h)) for r, h in profile]
    edges = [bm.edges.new((verts[i], verts[i + 1])) for i in range(len(verts) - 1)]
    full = abs(angle - 2 * math.pi) < 1e-6
    bmesh.ops.spin(bm, geom=verts + edges, cent=(0, 0, 0), axis=(0, 0, 1), angle=angle, steps=segments, use_merge=full)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    if not full:
        # A partial turn of a closed section: close its two ends.
        bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary], sides=12)
    rotation = {'Z': Matrix.Identity(3), 'X': Matrix.Rotation(math.pi / 2, 3, 'Y'), 'Y': Matrix.Rotation(-math.pi / 2, 3, 'X')}[axis]
    bmesh.ops.rotate(bm, verts=bm.verts, matrix=rotation)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    obj = mesh_from_bmesh(name, bm, material, col, parent, at)
    smooth_by_angle(obj, 50)
    return obj


def polygon_prism(name, outline, height, at=(0, 0, 0), material=None, col=None, parent=None, bevel=0.0):
    """Extrudes a 2D outline (cm, in the x-y plane, counter-clockwise) up by `height` (cm) from z = 0."""
    bm = bmesh.new()
    verts = [bm.verts.new(cm(x, y, 0)) for x, y in outline]
    face = bm.faces.new(verts)
    if face.normal.z < 0:
        face.normal_flip()
    extruded = bmesh.ops.extrude_face_region(bm, geom=[face])
    moved = [g for g in extruded['geom'] if isinstance(g, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=moved, vec=(0, 0, cm(height)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    obj = mesh_from_bmesh(name, bm, material, col, parent, at)
    if bevel > 0:
        add_bevel(obj, bevel, 2)
    return obj


def rounded_rect(lx, ly, r, steps=6):
    """The outline of a rounded rectangle (cm), centred, counter-clockwise."""
    points = []
    hx, hy = lx / 2, ly / 2
    for cx, cy, start in ((hx - r, -hy + r, -90), (hx - r, hy - r, 0), (-hx + r, hy - r, 90), (-hx + r, -hy + r, 180)):
        for i in range(steps + 1):
            a = math.radians(start + 90 * i / steps)
            points.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return points


def tube(name, points, radius, material=None, col=None, parent=None, resolution=8, bevel_resolution=4):
    """A wire or pipe along a smooth curve through `points` (cm): a curve object with a round bevel, converted to a mesh."""
    curve = bpy.data.curves.new(name, 'CURVE')
    curve.dimensions = '3D'
    curve.resolution_u = resolution if DETAIL == 'high' else max(2, resolution // 2)
    curve.bevel_depth = cm(radius)
    curve.bevel_resolution = bevel_resolution if DETAIL == 'high' else 1
    curve.use_fill_caps = True
    spline = curve.splines.new('NURBS' if len(points) > 2 else 'POLY')
    spline.points.add(len(points) - 1)
    for p, xyz in zip(spline.points, points):
        p.co = (*cm(*xyz), 1)
    if len(points) > 2:
        spline.use_endpoint_u = True
        spline.order_u = min(4, len(points))
    obj = bpy.data.objects.new(name, curve)
    link(obj, col, parent)
    mesh = to_mesh(obj)
    if material is not None:
        mesh.data.materials.clear()
        mesh.data.materials.append(material)
    smooth_by_angle(mesh, 60)
    return mesh


def to_mesh(obj):
    """Converts a curve (or applies an object's modifiers) into a plain mesh object with the same name and parent."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    me = bpy.data.meshes.new_from_object(evaluated)
    name, parent, matrix, cols = obj.name, obj.parent, obj.matrix_basis.copy(), list(obj.users_collection)
    bpy.data.objects.remove(obj)
    new = bpy.data.objects.new(name, me)
    new.matrix_basis = matrix
    for c in cols:
        c.objects.link(new)
    new.parent = parent
    return new


# ------------------------------------------------------------------------------------------------------------- modifiers


def add_bevel(obj, width, segments=2, limit='ANGLE', angle=40):
    if DETAIL != 'high':
        if width < 0.06:
            return None
        segments = 1
    mod = obj.modifiers.new('Bevel', 'BEVEL')
    mod.width = cm(width)
    mod.segments = segments
    mod.limit_method = limit
    if limit == 'ANGLE':
        mod.angle_limit = math.radians(angle)
    mod.harden_normals = False
    return mod


def add_array(obj, count, offset, name='Array'):
    """An array modifier repeating the object `count` times, each `offset` (cm vector) on."""
    mod = obj.modifiers.new(name, 'ARRAY')
    mod.count = count
    mod.use_relative_offset = False
    mod.use_constant_offset = True
    mod.constant_offset_displace = cm(*offset)
    return mod


def boolean(target, cutter, operation='DIFFERENCE', solver='EXACT'):
    """Cuts (or unions) `cutter` from `target` with a boolean modifier, applies it and deletes the cutter."""
    mod = target.modifiers.new('Boolean', 'BOOLEAN')
    mod.operation = operation
    mod.solver = solver
    mod.object = cutter
    apply_modifiers(target)
    bpy.data.objects.remove(cutter)
    return target


def apply_modifiers(obj):
    if not obj.modifiers:
        return obj
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    me = bpy.data.meshes.new_from_object(evaluated)
    old = obj.data
    obj.modifiers.clear()
    obj.data = me
    if old.users == 0:
        bpy.data.meshes.remove(old)
    return obj


def smooth_by_angle(obj, degrees=35):
    """Smooth shading, with edges sharper than `degrees` kept sharp."""
    if obj.type != 'MESH':
        return obj
    for poly in obj.data.polygons:
        poly.use_smooth = True
    obj.data.set_sharp_from_angle(angle=math.radians(degrees))
    return obj


def join(objects, name):
    """Joins meshes (modifiers applied) into one object named `name`, keeping the first one's parent and transform."""
    objects = [apply_modifiers(o) for o in objects if o is not None]
    bpy.context.view_layer.update()
    if len(objects) == 1:
        objects[0].name = name
        return objects[0]
    base = objects[0]
    inverse = base.matrix_world.inverted()
    bm = bmesh.new()
    materials = []
    for obj in objects:
        temp = bmesh.new()
        temp.from_mesh(obj.data)
        bmesh.ops.transform(temp, matrix=inverse @ obj.matrix_world, verts=temp.verts)
        remap = []
        for slot in obj.data.materials:
            if slot not in materials:
                materials.append(slot)
            remap.append(materials.index(slot))
        for face in temp.faces:
            face.material_index = remap[face.material_index] if remap else 0
        me = bpy.data.meshes.new('tmp')
        temp.to_mesh(me)
        temp.free()
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for material in materials:
        me.materials.append(material)
    joined = bpy.data.objects.new(name, me)
    for c in base.users_collection:
        c.objects.link(joined)
    world = base.matrix_world.copy()
    joined.parent = base.parent
    joined.matrix_world = world
    for obj in objects:
        bpy.data.objects.remove(obj)
    for poly in me.polygons:
        poly.use_smooth = True
    return joined


# ------------------------------------------------------------------------------------------------------------- materials


def srgb_to_linear(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_color(value):
    value = value.lstrip('#')
    return tuple(srgb_to_linear(int(value[i:i + 2], 16)) for i in (0, 2, 4)) + (1.0,)


_materials = {}


def material(name, color='#ffffff', metallic=0.0, roughness=0.5, image=None, emission=None, emission_strength=0.0, alpha=1.0, coat=0.0, normal_image=None, normal_strength=1.0, double_sided=False):
    """A Principled BSDF material (glTF metallic-roughness): `color` sRGB hex, an optional base-colour `image` (bpy image), an
    optional emission, alpha (blend) and coat. Materials are shared by name: a second call with the same name returns the first."""
    if name in _materials:
        return _materials[name]
    mat = bpy.data.materials.new(name)
    mat.use_backface_culling = not double_sided
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = next(n for n in nodes if n.bl_idname == 'ShaderNodeBsdfPrincipled')
    bsdf.inputs['Base Color'].default_value = hex_color(color)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    if image is not None:
        tex = nodes.new('ShaderNodeTexImage')
        tex.image = image
        links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    if normal_image is not None:
        tex = nodes.new('ShaderNodeTexImage')
        tex.image = normal_image
        normal_image.colorspace_settings.name = 'Non-Color'
        nm = nodes.new('ShaderNodeNormalMap')
        nm.inputs['Strength'].default_value = normal_strength
        links.new(tex.outputs['Color'], nm.inputs['Color'])
        links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    if emission is not None:
        bsdf.inputs['Emission Color'].default_value = hex_color(emission)
        bsdf.inputs['Emission Strength'].default_value = emission_strength
    if alpha < 1.0:
        bsdf.inputs['Alpha'].default_value = alpha
        mat.surface_render_method = 'BLENDED'
    if coat > 0:
        bsdf.inputs['Coat Weight'].default_value = coat
        bsdf.inputs['Coat Roughness'].default_value = 0.08
    _materials[name] = mat
    return mat


def image_from_array(name, pixels):
    """A packed bpy image from an (h, w, 4) float array in [0, 1] (sRGB colour values; rows from the top), or the image already made
    under that name (`pixels` may be a function that draws it, called only when needed)."""
    if name in bpy.data.images:
        return bpy.data.images[name]
    if callable(pixels):
        pixels = pixels()
    h, w = pixels.shape[:2]
    img = bpy.data.images.new(name, width=w, height=h, alpha=False)
    img.pixels.foreach_set(np.ascontiguousarray(pixels[::-1]).astype(np.float32).ravel())
    img.file_format = 'PNG'
    img.pack()
    return img


# ------------------------------------------------------------------------------------------------------------------ uvs


def box_uv(obj, scale_cm=10.0):
    """Box-projected uvs in world centimetres / `scale_cm`: a texture tile covers `scale_cm` of any face, so wood grain and board
    patterns keep their size on parts of any size. The projection axis of each face is its normal's largest component."""
    bpy.context.view_layer.update()
    me = obj.data
    uv = me.uv_layers.get('UVMap') or me.uv_layers.new(name='UVMap')
    matrix = obj.matrix_world
    for poly in me.polygons:
        n = poly.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for li in poly.loop_indices:
            co = matrix @ me.vertices[me.loops[li].vertex_index].co / CM
            if ax == 0:
                u, v = co.y, co.z
            elif ax == 1:
                u, v = co.x, co.z
            else:
                u, v = co.x, co.y
            uv.data[li].uv = (u / scale_cm, v / scale_cm)
    return obj


def planar_uv(obj, size_cm, axis='Z', origin=(0, 0)):
    """Uvs projected along `axis`, the part's `size_cm` (u, v) mapped onto the unit square: one texture across a board."""
    me = obj.data
    uv = me.uv_layers.get('UVMap') or me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co / CM
            a, b = {'Z': (co.x, co.y), 'X': (co.y, co.z), 'Y': (co.x, co.z)}[axis]
            uv.data[li].uv = ((a - origin[0]) / size_cm[0] + 0.5, (b - origin[1]) / size_cm[1] + 0.5)
    return obj


# --------------------------------------------------------------------------------------------------------- ambient light


def bake_ao(objects, distance_cm=2.0, samples=48, floor=0.55, gamma=1.0, ground=True):
    """Bakes ambient occlusion into each mesh's vertex colours with Cycles (a float colour attribute 'AO' on the face corners), every
    other object in the scene occluding, and an optional ground plane under z = 0 for the bake only. The result is remapped so the
    darkest crevice keeps `floor` of the light: AO multiplies the base colour (glTF COLOR_0), never to black."""
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = samples
    scene.world.light_settings.distance = cm(distance_cm)
    helper = None
    if ground:
        bm = bmesh.new()
        bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=40.0)
        helper = mesh_from_bmesh('__bake_ground', bm)
    meshes = [o for o in objects if o.type == 'MESH']
    for obj in meshes:
        me = obj.data
        if 'AO' in me.color_attributes:
            me.color_attributes.remove(me.color_attributes['AO'])
        attr = me.color_attributes.new('AO', 'FLOAT_COLOR', 'CORNER')
        me.color_attributes.active_color = attr
        me.color_attributes.render_color_index = me.color_attributes.active_color_index
    for obj in meshes:
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.bake(type='AO', target='VERTEX_COLORS', use_clear=True, margin=0)
        attr = obj.data.color_attributes['AO']
        values = np.empty(len(attr.data) * 4, dtype=np.float32)
        attr.data.foreach_get('color', values)
        values = values.reshape(-1, 4)
        ao = np.clip(values[:, 0], 0.0, 1.0) ** gamma
        shade = floor + (1.0 - floor) * ao
        values[:, 0] = shade
        values[:, 1] = shade
        values[:, 2] = shade
        values[:, 3] = 1.0
        attr.data.foreach_set('color', values.ravel())
    if helper is not None:
        bpy.data.objects.remove(helper)


def unlit_color(obj, colors):
    """Writes per-corner colours (a function of the corner's world position in cm → (r, g, b) linear) into 'AO': the studio's gradient."""
    me = obj.data
    if 'AO' in me.color_attributes:
        me.color_attributes.remove(me.color_attributes['AO'])
    attr = me.color_attributes.new('AO', 'FLOAT_COLOR', 'CORNER')
    me.color_attributes.active_color = attr
    for li, loop in enumerate(me.loops):
        co = obj.matrix_world @ me.vertices[loop.vertex_index].co / CM
        r, g, b = colors(co)
        attr.data[li].color = (r, g, b, 1.0)


# ---------------------------------------------------------------------------------------------------------------- export


def _compress_colors():
    """The exporter writes COLOR_0 as normalised 16-bit values outside meshopt; ambient occlusion needs 8 bits, and meshopt packs them
    well. Patches the add-on's attribute gatherer for this session: colour attributes go through the same meshopt path as positions."""
    import numpy as np
    from io_scene_gltf2.blender.exp import primitive_attributes as pa
    from io_scene_gltf2.blender.exp.accessors import array_to_accessor
    from io_scene_gltf2.io.com import constants
    original = pa.__dict__['__gather_attribute']
    if getattr(original, '_patched', False):
        return

    def gather(blender_primitive, attribute, export_settings):
        data = blender_primitive['attributes'][attribute]
        if attribute.startswith('COLOR_') and data['component_type'] == constants.ComponentType.UnsignedShort:
            values = np.clip(data['data'], 0, 1)
            if values.shape[1] == 4:
                values = values.copy()
                values[:, 3] = 1.0
            packed = np.ascontiguousarray((values * 255 + 0.5).astype(np.uint8))
            return {attribute: array_to_accessor(attribute, packed, export_settings, component_type=constants.ComponentType.UnsignedByte, data_type=data['data_type'], normalized=True)}
        return original(blender_primitive, attribute, export_settings)

    gather._patched = True
    pa.__dict__['__gather_attribute'] = gather


def export_glb(path, roots):
    """Exports the trees under `roots` (and nothing else) to a binary glTF: meshopt-compressed geometry, WebP images, the 'AO'
    colours as COLOR_0, no cameras or lights, y up."""
    _compress_colors()
    bpy.ops.object.select_all(action='DESELECT')
    for root in roots:
        for obj in [root, *root.children_recursive]:
            obj.select_set(True)
    kwargs = dict(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_materials='EXPORT',
        export_image_format='WEBP',
        export_image_quality=88,
        export_vertex_color='NAME',
        export_vertex_color_name='AO',
        export_all_vertex_colors=False,
        export_cameras=False,
        export_lights=False,
        export_extras=True,
        export_animations=False,
        export_copyright='STEM Studio robot lab, original work',
    )
    try:
        bpy.ops.export_scene.gltf(**kwargs, export_meshopt_compression_enable=True, export_meshopt_extension='EXT_meshopt_compression')
    except TypeError:
        bpy.ops.export_scene.gltf(**kwargs)
