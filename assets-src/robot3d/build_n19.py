# The N19 builds of the robot lab's 3D assets (N19 E6/E7), run by build.py's `n19`, `n19-robot` and `n19-props` modes: the gripper car's
# parts (parts/gripper.py), every size from the gripper kit as well (src/core/hardware/kits/ref-uno-gripper.kit.json), baked on the
# gripper car (the rover's parts round them, posed on its mounts, only to shade them), exported alone as robot-kit-n19.glb; and the
# pick-and-place props (props/build_props_n19.py) as arena-props-n19.glb. scripts/build-robot-assets.mjs appends them to robot-kit.glb and
# arena-props.glb, whose N18 roots it keeps byte for byte (scripts/lib/glb-splice.ts: Cycles' bake is not the same from one run to the next,
# so the rover's parts are not built again). Kept out of build.py (fix round 1, review M7) so that build.py is N18's, but for its two
# marked N19 blocks, and guards the frozen N18 roots (scripts/lib/frozen-sources.ts).

import json
import math
import os
import time

import bpy

# Set by build.py (`setup`): the repository's root, its loader of the part scripts, its placing of a part, lib and tex.
ROOT = load = place = lib = tex = None


def setup(root, loader, placer, lib_module, tex_module):
    global ROOT, load, place, lib, tex
    ROOT, load, place, lib, tex = root, loader, placer, lib_module, tex_module


def gripper_kit(reference):
    """The gripper kit's numbers the gripper's parts are drawn to (cm, robot frame), from the kit file the physics reads (N19 E6)."""
    with open(os.path.join(ROOT, 'src/core/hardware/kits/ref-uno-gripper.kit.json')) as f:
        kit = json.load(f)
    ch = kit['chassis']
    L, W, H = ch['bodyCm']
    bottom = ch['clearanceCm']
    by_kind = lambda kind: [m for m in kit['modules'] if m['kind'] == kind]
    gripper = by_kind('gripper')[0]
    us = by_kind('ultrasonic')[0]
    ref_us = reference['ultrasonic']
    # The ultrasonic part is modelled to the reference kit's height over the lower plate; a kit that mounts it higher stands its bracket
    # on standoffs (part_ultrasonic_riser): their height, and the drop from the mount to the bracket's foot.
    riser = (us['mount']['posCm'][2] - bottom) - (ref_us['at'][2] - reference['body']['bottom'])
    return {
        'raw': kit,
        'body': {'L': L, 'W': W, 'bottom': bottom, 'top': bottom + H},
        'gripper': {'mount': gripper['mount']['posCm'], 'spec': gripper['spec']},
        'ir': by_kind('ir-obstacle')[0]['mount']['posCm'],
        'color': by_kind('color-sensor')[0]['mount']['posCm'],
        'ultrasonic': {'at': us['mount']['posCm']},
        'riser': {'height': riser, 'drop': ref_us['to_plate']},
        'mods': {m['role']: m for m in kit['modules']},
        'motors': by_kind('dc-motor'),
    }


def gripper_pose(grip, roots, lift_deg, claw_deg):
    """Puts the gripper's moving parts where the view does for a lift and a claw angle (robot frame, cm): world/robot/gripper.ts's."""
    spec = grip['gripper']['spec']
    mx, my, mz = grip['gripper']['mount']
    e = math.radians(lift_deg + spec['boomElevationAtLift0Deg'])
    L = spec['boomLengthCm']
    tip = (mx + L * math.cos(e), my, mz + L * math.sin(e))
    beta = spec['fingerOpenDeg'] - spec['fingerDegPerServoDeg'] * claw_deg
    roots['boom'].location = lib.cm(mx, my, mz)
    roots['boom'].rotation_euler = (0, -e, 0)
    roots['bracket'].location = lib.cm(mx, my, mz)
    bpy.data.objects['gripper_link'].rotation_euler = (0, -e, 0)
    roots['carriage'].location = lib.cm(*tip)
    for name, side in (('jaw_l', 1), ('jaw_r', -1)):
        hinge = (tip[0] + spec['fingerHingeUCm'], tip[1] + side * spec['fingerHingeVCm'], tip[2])
        roots[name].location = lib.cm(*hinge)
        roots[name].rotation_euler = (0, 0, math.radians(side * beta))
    for name in ('ir', 'color'):
        u, v, w = grip[name]
        roots[name].location = lib.cm(tip[0] + u, tip[1] + v, tip[2] + w)
    bpy.context.view_layer.update()


def build_gripper(kit, grip):
    """N19 E6: the gripper's parts on the gripper car, baked there, returned alone (the rover's parts round them are only shade)."""
    col = lib.collection('robot')
    context = []
    # The car's other parts where the view puts them on the gripper kit: what shades the bracket.
    for name, script, fn in [
        ('chassis', 'parts/chassis.py', 'build'),
        ('board', 'parts/board.py', 'build'),
        ('tt_motor', 'parts/tt_motor.py', 'build'),
        ('wheel', 'parts/wheel.py', 'build'),
        ('caster', 'parts/caster.py', 'build'),
        ('ultrasonic', 'parts/ultrasonic.py', 'build'),
        ('line_bar', 'parts/line_bar.py', 'build'),
        ('line_leds', 'parts/line_bar.py', 'build_leds'),
    ]:
        root = getattr(load(script), fn)(lib, tex, kit, col)
        context.append((name, root))
    b = grip['body']
    shade = dict(context)
    left = next(m for m in grip['motors'] if m['mount']['posCm'][1] > 0)
    place(shade['tt_motor'], left['mount']['posCm'])
    place(shade['wheel'], left['mount']['posCm'])
    # The board where the view puts it on a car without a servo arm: the rover's place (fix round 1, review I3; build_robot's).
    place(shade['board'], (-1.685, 0, b['top']))
    place(shade['caster'], grip['raw']['chassis']['casterCm'])
    place(shade['ultrasonic'], grip['ultrasonic']['at'])
    place(shade['line_bar'], kit['line']['at'])
    place(shade['line_leds'], (b['L'] / 2 - 0.05, 0, b['top']))
    gripper = load('parts/gripper.py')
    started = time.time()
    roots = {
        'bracket': gripper.build_bracket(lib, tex, grip, col),
        'boom': gripper.build_boom(lib, tex, grip, col),
        'carriage': gripper.build_carriage(lib, tex, grip, col),
        'jaw_l': gripper.build_jaw(lib, tex, grip, col, 1),
        'jaw_r': gripper.build_jaw(lib, tex, grip, col, -1),
        'ir': gripper.build_ir(lib, tex, grip, col),
        'color': gripper.build_color(lib, tex, grip, col),
        'riser': gripper.build_riser(lib, tex, grip, col),
    }
    print(f'part gripper: {time.time() - started:.1f} s')
    us = grip['ultrasonic']['at']
    place(roots['riser'], (us[0], us[1], us[2] - grip['riser']['drop']))
    meshes = lambda root: [o for o in [root, *root.children_recursive] if o.type == 'MESH']
    moving = [o for name in ('boom', 'carriage', 'jaw_l', 'jaw_r', 'ir', 'color') for o in meshes(roots[name])] + [o for o in bpy.data.objects['gripper_link'].children_recursive if o.type == 'MESH']
    static = [o for o in meshes(roots['bracket']) + meshes(roots['riser']) if o not in moving]
    # The bracket and the riser shaded by the car round them and by the arm at setup()'s pose (lift 90°, claw open), the floor under all.
    gripper_pose(grip, roots, 90, 0)
    started = time.time()
    lib.bake_ao(static, distance_cm=1.6, samples=32, floor=0.5)
    # What moves shaded by the gripper alone, the arm halfway up: no shade of the car or the floor that would stay on a part as it moves.
    hidden = [o for _, root in context for o in [root, *root.children_recursive]]
    for obj in hidden:
        obj.hide_render = True
    gripper_pose(grip, roots, 45, 0)
    lib.bake_ao(moving, distance_cm=1.6, samples=32, floor=0.5, ground=False)
    print(f'gripper ao: {time.time() - started:.1f} s, {len(static) + len(moving)} meshes')
    for _, root in context:
        for obj in [root, *root.children_recursive]:
            bpy.data.objects.remove(obj)
    # Exported at the pose the view starts from (it puts every part itself): every joint at rest.
    bpy.data.objects['gripper_link'].rotation_euler = (0, 0, 0)
    for root in roots.values():
        root.rotation_euler = (0, 0, 0)
    return list(roots.values())


def build(what, kit, suffix, out):
    """The N19 roots of a level of detail: the gripper car's parts and the pick-and-place props, each in a GLB of its own."""
    if what in ('n19', 'n19-robot'):
        lib.reset()
        roots = build_gripper(kit, gripper_kit(kit))
        lib.export_glb(os.path.join(out, f'robot-kit-n19{suffix}.glb'), roots)
    if what in ('n19', 'n19-props'):
        lib.reset()
        roots = load('props/build_props_n19.py').build_all(lib, tex, kit)
        lib.export_glb(os.path.join(out, f'arena-props-n19{suffix}.glb'), roots)
