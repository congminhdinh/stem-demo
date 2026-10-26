/* global window, document, location, performance, setTimeout, PerformanceObserver, EventTarget, MessageChannel, HTMLCanvasElement, ImageBitmap, HTMLImageElement, OffscreenCanvas */
// N18 P2: the in-page probe of scripts/bench-robot3d.mjs (`pnpm bench:robot3d`), injected into every frame before the page's own scripts
// (Playwright's addInitScript); it acts only in the robot lab's frame (`lab=robot`). It reads the production build from outside, with no
// flag in the product: three's own devtools seam (`__THREE_DEVTOOLS__`: every WebGLRenderer, Scene and Loader says it was made), React's
// (`__REACT_DEVTOOLS_GLOBAL_HOOK__`: every commit of every root, production builds too), and wrappers of the browser's WebGL, canvas and
// animation-frame functions. The harness reads it through `window.__p2` (string expressions: scripts/ is linted for Node).
//
//   frames     each main render (renderer.render to the screen): when it began, how long its call took on the main thread (three's
//              scene walk, uniforms, the GL calls; the GPU's or SwiftShader's raster work is not in it), its draws to the screen and to
//              off-screen targets (the shadow map), renderer.info's calls and triangles
//   animation  every animation frame (the first requestAnimationFrame callback of a timestamp), and the main thread's time from it to a
//              message posted then: the frame's callbacks, their microtasks (the run session's ticks are microtasks of the run store's
//              callback), style, layout and paint
//   tasks      long tasks (> 50 ms) and long animation frames with their scripts
//   react      commits per renderer (react-dom, @react-three/fiber, …)
//   contexts   WebGL contexts made and lost (R3F loses its context when a canvas unmounts)
//   loading    each GLTFLoader.parse (fetch excluded), each compileAsync, the first main render and the first that drew the scene, the
//              resource timings; each also as a performance mark (`p2:…`), which a Chromium trace shows on its timeline
//   inventory  (on demand) the scene's meshes, materials, textures, shadow maps and environment, and an estimate of the GPU memory they
//              take with the drawing buffer
(() => {
  if (!/[?&]lab=robot(&|$)/.test(location.search)) return;
  const now = () => performance.now();
  // The renderers are counted, and the latest one, its scene and camera are held weakly (fix round 1, M6): the probe keeps no dead
  // renderer alive, so the switches' heap is the lab's.
  const live = (ref) => ref?.deref() ?? null;
  const state = {
    renderersMade: 0,
    renderer: null,
    scene: null,
    camera: null,
    frames: [],
    offscreenRenders: { count: 0, ms: 0 },
    animation: [],
    busy: [],
    longTasks: [],
    longFrames: [],
    commits: [],
    rendererNames: {},
    contexts: { made: 0, lost: 0 },
    parses: [],
    compiles: [],
    firstRender: null,
    firstSceneRender: null,
    watch: null,
    tagLayout: null,
    tagChanges: [],
    draws: { screen: 0, offscreen: 0 },
  };

  // React's devtools seam: every commit of every root (react-dom's, R3F's reconciler's), in production builds too.
  let rendererCount = 0;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    isDisabled: false,
    supportsFiber: true,
    renderers: new Map(),
    inject(internals) {
      rendererCount += 1;
      this.renderers.set(rendererCount, internals);
      state.rendererNames[rendererCount] = internals.rendererPackageName ?? `renderer-${rendererCount}`;
      return rendererCount;
    },
    onCommitFiberRoot(id) {
      state.commits.push([now(), id]);
    },
    onPostCommitFiberRoot() {},
    onCommitFiberUnmount() {},
    setStrictMode() {},
    checkDCE() {},
  };

  // WebGL: the draws to the screen and to off-screen targets (each context's bound framebuffer), and the contexts made and lost.
  const bound = new WeakMap();
  const counted = new WeakSet();
  for (const Context of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
    if (!Context) continue;
    const bind = Context.prototype.bindFramebuffer;
    Context.prototype.bindFramebuffer = function (target, framebuffer) {
      if (target === this.FRAMEBUFFER || target === this.DRAW_FRAMEBUFFER) bound.set(this, framebuffer);
      return bind.call(this, target, framebuffer);
    };
    for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements']) {
      const draw = Context.prototype[name];
      if (!draw) continue;
      Context.prototype[name] = function (...rest) {
        if (bound.get(this)) state.draws.offscreen += 1;
        else state.draws.screen += 1;
        return draw.apply(this, rest);
      };
    }
  }
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
    const context = getContext.call(this, kind, ...rest);
    if (context && /webgl/.test(kind) && !counted.has(context)) {
      counted.add(context);
      state.contexts.made += 1;
      this.addEventListener('webglcontextlost', () => (state.contexts.lost += 1), { once: true });
    }
    return context;
  };

  // three's devtools seam: the renderer (its render and compileAsync timed), and each GLTFLoader (its parse timed: decoding included).
  const hookRenderer = (renderer) => {
    state.renderersMade += 1;
    if (state.rendererMadeAt === undefined) {
      state.rendererMadeAt = now();
      performance.mark('p2:renderer');
    }
    const render = renderer.render;
    renderer.render = function (scene, camera) {
      const target = renderer.getRenderTarget();
      const begin = now();
      const [screen, offscreen] = [state.draws.screen, state.draws.offscreen];
      const result = render.call(this, scene, camera);
      const ms = now() - begin;
      if (target === null) {
        if (live(state.renderer) !== renderer) state.renderer = new WeakRef(renderer);
        if (live(state.scene) !== scene) state.scene = new WeakRef(scene);
        if (live(state.camera) !== camera) state.camera = new WeakRef(camera);
        const { calls, triangles } = renderer.info.render;
        state.frames.push([begin, ms, state.draws.screen - screen, state.draws.offscreen - offscreen, calls, triangles]);
        if (state.firstRender === null) {
          state.firstRender = { at: begin, ms, programs: renderer.info.programs?.length ?? null };
          performance.mark('p2:first-render');
        }
        // The first render that drew something to the screen (an empty scene is drawn while the models are still loading).
        if (state.firstSceneRender === null && state.draws.screen - screen > 0) {
          state.firstSceneRender = { at: begin, ms, draws: state.draws.screen - screen, programs: renderer.info.programs?.length ?? null };
          performance.mark('p2:first-scene-render');
        }
        // The zones' tags' layout (R4.7's ZoneTags): which spot each tag took this frame; a change from the last frame is counted, a
        // tag that jumps between spots with nothing moving much (no hysteresis) shows as many changes a second.
        if (state.tagScene !== scene || !state.tagGroup || !state.tagGroup.parent) {
          state.tagScene = scene;
          state.tagGroup = scene.getObjectByName('zone-tags') ?? null;
        }
        const tags = state.tagGroup;
        if (tags) {
          let layout = '';
          tags.traverse((node) => {
            if (node.isSprite) layout += node.visible ? `${node.center.x.toFixed(3)},${node.position.y.toFixed(3)};` : 'h;';
          });
          if (state.tagLayout !== null && layout !== state.tagLayout) state.tagChanges.push(begin);
          state.tagLayout = layout;
        }
        const watch = state.watch;
        if (watch && watch.at === null) {
          const robot = scene.getObjectByName('robot');
          const e = robot ? robot.matrixWorld.elements : null;
          if (e && watch.from === null) watch.from = [e[12], e[13], e[14]];
          else if (e && Math.abs(e[12] - watch.from[0]) + Math.abs(e[13] - watch.from[1]) + Math.abs(e[14] - watch.from[2]) > 1e-5) watch.at = now();
        }
      } else {
        state.offscreenRenders.count += 1;
        state.offscreenRenders.ms += ms;
      }
      return result;
    };
    const compileAsync = renderer.compileAsync;
    if (compileAsync) {
      renderer.compileAsync = function (...rest) {
        const begin = now();
        const entry = { begin, end: null, programsBefore: renderer.info.programs?.length ?? null, programsAfter: null };
        state.compiles.push(entry);
        performance.mark('p2:compile-begin');
        return compileAsync.apply(this, rest).finally(() => {
          entry.end = now();
          performance.mark('p2:compile-end');
          entry.programsAfter = renderer.info.programs?.length ?? null;
        });
      };
    }
  };
  const hookLoader = (loader) => {
    if (typeof loader.parse !== 'function' || typeof loader.setMeshoptDecoder !== 'function') return;
    const parse = loader.parse;
    loader.parse = function (data, path, onLoad, onError) {
      const entry = { begin: now(), end: null, bytes: data?.byteLength ?? null };
      state.parses.push(entry);
      performance.mark('p2:parse-begin');
      return parse.call(
        this,
        data,
        path,
        (gltf) => {
          entry.end = now();
          performance.mark('p2:parse-end');
          onLoad(gltf);
        },
        onError,
      );
    };
  };
  const devtools = new EventTarget();
  devtools.addEventListener('observe', (event) => {
    const made = event.detail;
    if (made?.isWebGLRenderer) hookRenderer(made);
    else if (made && typeof made.setMeshoptDecoder === 'function') hookLoader(made);
  });
  window.__THREE_DEVTOOLS__ = devtools;

  // Animation frames, and the main thread's time from the first callback of each to a message posted then (it runs after the frame).
  const requestFrame = window.requestAnimationFrame.bind(window);
  const channel = new MessageChannel();
  let frameStamp = -1;
  let frameBegan = null;
  channel.port1.onmessage = () => {
    if (frameBegan !== null) state.busy.push([frameBegan, now() - frameBegan]);
    frameBegan = null;
  };
  window.requestAnimationFrame = (callback) =>
    requestFrame((stamp) => {
      if (stamp !== frameStamp) {
        frameStamp = stamp;
        state.animation.push(stamp);
        if (frameBegan === null) {
          frameBegan = now();
          channel.port2.postMessage(0);
        }
      }
      callback(stamp);
    });

  // Long tasks and long animation frames (with the scripts they ran).
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) state.longTasks.push([entry.startTime, entry.duration]);
    }).observe({ type: 'longtask', buffered: true });
  } catch {
    // no long tasks in this browser
  }
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        state.longFrames.push({
          start: entry.startTime,
          duration: entry.duration,
          blocking: entry.blockingDuration,
          render: entry.renderStart ? entry.startTime + entry.duration - entry.renderStart : 0,
          scripts: (entry.scripts ?? []).map((script) => ({ duration: script.duration, invoker: script.invoker, url: script.sourceURL, fn: script.sourceFunctionName, at: script.sourceCharPosition })),
        });
      }
    }).observe({ type: 'long-animation-frame', buffered: true });
  } catch {
    // no long animation frames in this browser
  }

  const sorted = (values) => [...values].sort((a, b) => a - b);
  const quantile = (values, q) => {
    if (values.length === 0) return null;
    const ordered = sorted(values);
    return ordered[Math.min(ordered.length - 1, Math.max(0, Math.ceil(ordered.length * q) - 1))];
  };
  const stats = (values) =>
    values.length === 0
      ? null
      : { n: values.length, mean: values.reduce((a, b) => a + b, 0) / values.length, p50: quantile(values, 0.5), p95: quantile(values, 0.95), p99: quantile(values, 0.99), max: Math.max(...values) };

  /** The bytes a texture takes on the GPU (estimated: its image's pixels × 4 B, or its data's bytes; mipmaps add a third). */
  const textureBytes = (texture) => {
    const image = texture.image ?? texture.source?.data;
    let bytes = 0;
    if (texture.isCubeTexture && Array.isArray(image)) {
      for (const face of image) bytes += (face?.width ?? 0) * (face?.height ?? 0) * 4;
    } else if (image?.data?.byteLength !== undefined) {
      bytes = image.data.byteLength;
    } else if (image && image.width) {
      const perTexel = texture.type === 1016 /* HalfFloatType */ ? 8 : texture.type === 1015 /* FloatType */ ? 16 : 4;
      bytes = image.width * image.height * perTexel;
    }
    const mipmapped = texture.generateMipmaps !== false && (texture.minFilter === 1008 || texture.minFilter === 1005 || texture.minFilter === 1007 || texture.minFilter === 1004);
    return Math.round(bytes * (mipmapped ? 4 / 3 : 1));
  };
  const imageKind = (texture) => {
    const image = texture.image;
    if (!image) return 'none';
    if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) return 'ImageBitmap';
    if (image instanceof HTMLCanvasElement || (typeof OffscreenCanvas !== 'undefined' && image instanceof OffscreenCanvas)) return 'canvas';
    if (image instanceof HTMLImageElement) return 'img';
    if (image.data) return 'data';
    return 'other';
  };

  window.__p2 = {
    state,
    /** The latest of every series, so that a window can be cut from them: begin() then summary(). */
    mark() {
      return { at: now(), frames: state.frames.length, animation: state.animation.length, busy: state.busy.length, longTasks: state.longTasks.length, longFrames: state.longFrames.length, commits: state.commits.length, tagChanges: state.tagChanges.length };
    },
    begin() {
      this.from = this.mark();
      return this.from;
    },
    /** Empties every series: a soak keeps one window of them at a time, so that the probe's own arrays do not grow the heap it measures. */
    trim() {
      for (const key of ['frames', 'animation', 'busy', 'longTasks', 'longFrames', 'commits', 'tagChanges']) state[key].length = 0;
      this.from = this.mark();
    },
    /** What happened since begin(): frames, their times and draws, the main thread, long tasks, React commits. */
    summary() {
      const from = this.from ?? { at: 0, frames: 0, animation: 0, busy: 0, longTasks: 0, longFrames: 0, commits: 0 };
      const seconds = (now() - from.at) / 1000;
      const frames = state.frames.slice(from.frames);
      const intervals = frames.slice(1).map((frame, i) => frame[0] - frames[i][0]);
      const animation = state.animation.slice(from.animation);
      const animationIntervals = animation.slice(1).map((stamp, i) => stamp - animation[i]);
      const commits = {};
      for (const [, id] of state.commits.slice(from.commits)) {
        const name = state.rendererNames[id] ?? String(id);
        commits[name] = (commits[name] ?? 0) + 1;
      }
      const longTasks = state.longTasks.slice(from.longTasks);
      const longFrames = state.longFrames.slice(from.longFrames);
      const last = frames.at(-1);
      return {
        seconds,
        framesDrawn: frames.length,
        frameMs: stats(intervals),
        renderCallMs: stats(frames.map((frame) => frame[1])),
        drawsScreen: stats(frames.map((frame) => frame[2])),
        drawsOffscreen: stats(frames.map((frame) => frame[3])),
        calls: last ? last[4] : null,
        triangles: last ? last[5] : null,
        animationFrames: animation.length,
        animationFrameMs: stats(animationIntervals),
        busyMs: stats(state.busy.slice(from.busy).map(([, ms]) => ms)),
        longTasks: { count: longTasks.length, over100: longTasks.filter(([, ms]) => ms > 100).length, maxMs: longTasks.length ? Math.max(...longTasks.map(([, ms]) => ms)) : 0, totalMs: longTasks.reduce((sum, [, ms]) => sum + ms, 0) },
        longFrames: longFrames.slice(0, 12),
        commits,
        tagSpotChanges: state.tagChanges.length - (from.tagChanges ?? 0),
        renderer: this.rendererInfo(),
        contexts: { ...state.contexts, live: state.contexts.made - state.contexts.lost },
      };
    },
    rendererInfo() {
      const renderer = live(state.renderer);
      if (!renderer) return null;
      const gl = renderer.getContext();
      return {
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
        programs: renderer.info.programs?.length ?? null,
        pixelRatio: renderer.getPixelRatio(),
        drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
        antialias: gl.getContextAttributes()?.antialias ?? null,
        samples: gl.getParameter(gl.SAMPLES),
        shadowMap: { enabled: renderer.shadowMap.enabled, autoUpdate: renderer.shadowMap.autoUpdate, type: renderer.shadowMap.type },
        parallelCompile: gl.getExtension('KHR_parallel_shader_compile') !== null,
        maxAnisotropy: renderer.capabilities.getMaxAnisotropy(),
        rendererName: (() => {
          const debug = gl.getExtension('WEBGL_debug_renderer_info');
          return debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
        })(),
      };
    },
    /** The loading timeline of this frame (ms since its navigation began): resources, GLTF parses, compiles, the first render. */
    loading() {
      const resources = performance
        .getEntriesByType('resource')
        .filter((entry) => /\.(js|glb|wasm|css|woff2?)(\?|$)/.test(entry.name))
        .map((entry) => ({ name: entry.name.replace(/^.*\/(assets|robot3d)\//, '$1/').replace(/\?.*$/, ''), start: entry.startTime, end: entry.responseEnd, transfer: entry.transferSize, encoded: entry.encodedBodySize, decoded: entry.decodedBodySize }));
      const navigation = performance.getEntriesByType('navigation')[0];
      return {
        navigation: navigation ? { responseEnd: navigation.responseEnd, domContentLoaded: navigation.domContentLoadedEventEnd, load: navigation.loadEventEnd } : null,
        resources,
        timeOrigin: performance.timeOrigin,
        entryTypes: PerformanceObserver.supportedEntryTypes ?? null,
        renderersMade: state.renderersMade,
        rendererMadeAt: state.rendererMadeAt ?? null,
        parses: state.parses,
        compiles: state.compiles,
        firstRender: state.firstRender,
        firstSceneRender: state.firstSceneRender,
        offscreenRenders: state.offscreenRenders,
        longTasks: state.longTasks.map(([start, ms]) => ({ start, ms })),
        longFrames: state.longFrames.filter((frame) => frame.duration > 100).slice(0, 20),
      };
    },
    /** What the scene holds and an estimate of the GPU memory it takes (textures, geometry, shadow maps, environment, drawing buffer). */
    inventory() {
      const [scene, renderer] = [live(state.scene), live(state.renderer)];
      if (!scene || !renderer) return null;
      const geometries = new Set();
      const materials = new Set();
      const textures = new Map();
      const counts = { objects: 0, meshes: 0, visibleMeshes: 0, castShadow: 0, sprites: 0, lights: 0, shadowLights: 0, instanced: 0 };
      // Per top group (the robot, the arena, the zones' tags): visible meshes, shadow casters, triangles.
      const byGroup = {};
      const groupOf = (node) => {
        for (let up = node; up; up = up.parent) if (up.name === 'robot' || up.name === 'arena-gltf' || up.name === 'zone-tags') return up.name;
        return 'other';
      };
      const materialTypes = {};
      const shadowMaps = [];
      const addTexture = (texture, where) => {
        if (texture && texture.isTexture && !textures.has(texture)) textures.set(texture, where);
      };
      scene.traverse((node) => {
        counts.objects += 1;
        if (node.isLight) {
          counts.lights += 1;
          if (node.castShadow && node.shadow) {
            counts.shadowLights += 1;
            const size = node.shadow.mapSize;
            shadowMaps.push({ width: size.x, height: size.y, radius: node.shadow.radius, autoUpdate: node.shadow.autoUpdate, bytes: size.x * size.y * 4 });
          }
        }
        if (node.isSprite) counts.sprites += 1;
        if (node.isMesh || node.isSprite || node.isLine || node.isPoints) {
          if (node.isMesh) counts.meshes += 1;
          if (node.isInstancedMesh) counts.instanced += 1;
          let visible = true;
          for (let up = node; up; up = up.parent) visible &&= up.visible;
          if (visible && node.isMesh) counts.visibleMeshes += 1;
          if (node.castShadow && visible) counts.castShadow += 1;
          if (visible && (node.isMesh || node.isSprite)) {
            const group = (byGroup[groupOf(node)] ??= { visible: 0, castShadow: 0, triangles: 0 });
            group.visible += 1;
            if (node.castShadow) group.castShadow += 1;
            const geometry = node.geometry;
            if (geometry) group.triangles += Math.round((geometry.index ? geometry.index.count : (geometry.attributes?.position?.count ?? 0)) / 3);
          }
          if (node.geometry) geometries.add(node.geometry);
          for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
            if (!material) continue;
            if (!materials.has(material)) {
              materials.add(material);
              materialTypes[material.type] = (materialTypes[material.type] ?? 0) + 1;
            }
            for (const value of Object.values(material)) addTexture(value, material.type);
          }
        }
      });
      addTexture(scene.environment, 'environment');
      addTexture(scene.background, 'background');
      let geometryBytes = 0;
      let vertices = 0;
      const buffers = new Set();
      for (const geometry of geometries) {
        for (const attribute of Object.values(geometry.attributes ?? {})) {
          const array = attribute.isInterleavedBufferAttribute ? attribute.data.array : attribute.array;
          if (array && !buffers.has(array)) {
            buffers.add(array);
            geometryBytes += array.byteLength;
          }
        }
        if (geometry.index && !buffers.has(geometry.index.array)) {
          buffers.add(geometry.index.array);
          geometryBytes += geometry.index.array.byteLength;
        }
        vertices += geometry.attributes?.position?.count ?? 0;
      }
      const textureList = [...textures.entries()].map(([texture, where]) => {
        const image = texture.image ?? {};
        return { name: texture.name || where, width: image.width ?? null, height: image.height ?? null, kind: imageKind(texture), anisotropy: texture.anisotropy, mipmaps: texture.generateMipmaps, bytes: textureBytes(texture) };
      });
      const textureBytesTotal = textureList.reduce((sum, texture) => sum + texture.bytes, 0);
      const gl = renderer.getContext();
      const [width, height] = [gl.drawingBufferWidth, gl.drawingBufferHeight];
      const samples = gl.getParameter(gl.SAMPLES) || (gl.getContextAttributes()?.antialias ? 4 : 0);
      // The canvas's colour and depth-stencil buffers, and with MSAA their multisampled copies.
      const drawingBufferBytes = width * height * 8 * (1 + (samples || 0));
      const shadowBytes = shadowMaps.reduce((sum, map) => sum + map.bytes, 0);
      return {
        counts,
        byGroup,
        materialTypes,
        materials: materials.size,
        geometries: geometries.size,
        vertices,
        textures: textureList.sort((a, b) => b.bytes - a.bytes),
        shadowMaps,
        environment: scene.environment ? { width: scene.environment.image?.width ?? null, height: scene.environment.image?.height ?? null } : null,
        gpuBytes: { geometry: geometryBytes, textures: textureBytesTotal, shadowMaps: shadowBytes, drawingBuffer: drawingBufferBytes, total: geometryBytes + textureBytesTotal + shadowBytes + drawingBufferBytes },
        rendererInfo: this.rendererInfo(),
      };
    },
    /**
     * Clicks `selector` and resolves with the ms from the click to the end of the first main render that drew the robot's group moved
     * from where it stood (the "Run → moving" of robot plan §5), or null after `timeoutMs`.
     */
    clickAndWatch(selector, timeoutMs) {
      const robot = live(state.scene)?.getObjectByName('robot');
      const at = robot ? robot.matrixWorld.elements : null;
      const watch = { from: at ? [at[12], at[13], at[14]] : null, at: null, start: now() };
      state.watch = watch;
      document.querySelector(selector)?.click();
      return new Promise((resolve) => {
        const look = () => {
          if (watch.at !== null) resolve(watch.at - watch.start);
          else if (now() - watch.start > timeoutMs) resolve(null);
          else setTimeout(look, 4);
        };
        look();
      });
    },
  };
  document.addEventListener?.('visibilitychange', () => {
    frameBegan = null;
  });
})();
