# N18 P2 spike: A/B variants for the P2 audit (p2-audit.md §4), applied to a worktree, built, then reverted with git checkout (never committed).
import sys
root, variant = sys.argv[1], sys.argv[2]
def patch(path, old, new):
    p = root + '/' + path
    s = open(p).read()
    assert old in s, (path, old[:60])
    open(p, 'w').write(s.replace(old, new))
if variant in ('framing-cache', 'framing'):
    # The free view's pose kept per scene and inputs: the HUD toggling between two heights frames once per height.
    patch('src/ui/robot3d/camera-studio.ts',
          "export function freeViewPose(span: ArenaSpan, scene: FreeViewScene, fovDeg: number, aspect: number, rect: SafeRect = VIEW_SAFE_RECT, minRobot = 0): CameraPose {",
          "const freeViewCache = new WeakMap<FreeViewScene, Map<string, CameraPose>>();\nexport function freeViewPose(span: ArenaSpan, scene: FreeViewScene, fovDeg: number, aspect: number, rect: SafeRect = VIEW_SAFE_RECT, minRobot = 0): CameraPose {\n  const key = JSON.stringify([span, fovDeg, aspect, rect, minRobot]);\n  let cache = freeViewCache.get(scene);\n  if (!cache) {\n    cache = new Map();\n    freeViewCache.set(scene, cache);\n  }\n  const known = cache.get(key);\n  if (known) return known;\n  const made = freeViewPoseOf(span, scene, fovDeg, aspect, rect, minRobot);\n  cache.set(key, made);\n  return made;\n}\nfunction freeViewPoseOf(span: ArenaSpan, scene: FreeViewScene, fovDeg: number, aspect: number, rect: SafeRect, minRobot: number): CameraPose {")
    if variant == 'framing':
        # framePoints' fit test with its axes once per pose, no array per point, the first point outside ending it (the same arithmetic:
        # the same poses, spikes/p2-perf3d/framing-fast.mjs).
        import re
        spike = open(root + '/spikes/p2-perf3d/framing-fast.mjs').read()
        slow = re.search(r"const slow = `(.*?)`;", spike, re.S).group(1)
        fast = re.search(r"const fast = `(.*?)`;", spike, re.S).group(1)
        patch('src/ui/robot3d/camera-studio.ts', slow, fast)
elif variant == 'mat-aniso-low':
    # The mat's colour map filtered anisotropically on the high tier only (as R4.7 did for the GLB textures).
    patch('src/ui/robot3d/parts/GltfArena.tsx',
          "    map.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());",
          "    map.anisotropy = low ? 1 : Math.min(8, gl.capabilities.getMaxAnisotropy());")
elif variant == 'no-shader-checks':
    # three's link and info-log queries (renderer.debug.checkShaderErrors) off in the production build: on a renderer without
    # KHR_parallel_shader_compile (SwiftShader) they make the main thread wait for every program's link at its first use.
    patch('src/ui/robot3d/Scene.tsx',
          "  useEffect(() => {\n    let live = true;\n    void gl\n      .compileAsync(scene, camera)",
          "  useEffect(() => {\n    let live = true;\n    gl.debug.checkShaderErrors = false;\n    void gl\n      .compileAsync(scene, camera)")
elif variant == 'low-dpr-075':
    # The low tier draws 0.75 of the CSS pixels each way (56 % of the pixels) and the browser scales the picture up: SwiftShader rasterises
    # every pixel on the CPU.
    patch('src/ui/robot3d/quality.ts',
          "  low: { shadows: false, dpr: 1, antialias: false, shadowMapSize: 0 },",
          "  low: { shadows: false, dpr: 0.75, antialias: false, shadowMapSize: 0 },")
elif variant == 'cap-30':
    # A run drawn every other display frame (30 fps at 60 Hz): a plain invalidate() from a publish only reaches the frame after next
    # (R4.2's finding, Scene.tsx RedrawOnChange), so dropping the priming halves the draws, and SwiftShader's raster with them.
    patch('src/ui/robot3d/Scene.tsx',
          "        if (get().internal.frames < 2) invalidate(2);",
          "        invalidate();")
else:
    raise SystemExit('unknown variant ' + variant)
print('applied', variant)
