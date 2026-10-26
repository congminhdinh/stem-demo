import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { BoxGeometry, Color, Float32BufferAttribute, MeshLambertMaterial, MeshStandardMaterial, PlaneGeometry, Vector2 } from 'three';
import type { Scenario } from '../../../core/scenario/scenario';
import type { RobotSnapshot } from '../../../core/world/snapshot';
import type { RobotAssets } from '../assets/robot-assets';
import type { TextureSet } from '../assets/textures';
import { ArenaView } from '../ArenaView';
import { robot3dColors as colors } from '../colors';
import type { CameraMode } from '../camera';
import type { CardEdge, HudCorner, ToolsCorner } from '../hud-corner';
import type { TierLook } from '../lighting/look';
import { arenaToThree, writePose } from '../scene-math';
import { assembleArena, MAT_THICKNESS_M } from './arena-assembly';
import type { MatLabels } from './mat-paint';
import { createMatTextures, type MatTextures } from './mat-textures';
import { tapeRibbon } from './tape-ribbon';
import { ZoneTags, type RobotTagBox } from './ZoneTags';

// The arena in the 3D view from the modelled props (N18 R4.7): the mat (a canvas painted from the scenario's vector paint, as the line
// sensors read it, with its printed borders; the zones' names and numbers float over it as tags, ZoneTags.tsx; its roughness and its baked contact shading painted from the same data; the
// paper's fibres as a tiled normal map on the high tier), on a thin board whose edge shows, the tape's thin body over its paint
// (tape-ribbon.ts), and the props of arena-assembly.ts. The
// moving bodies' poses are read from the world in the frame callback.

type GltfArenaProps = {
  assets: RobotAssets;
  /** The plan view ("Nhìn từ trên") hides what hangs over the mat. */
  planView: boolean;
  scenario: Scenario;
  view: () => RobotSnapshot;
  look: TierLook;
  shadows: boolean;
  textures: TextureSet;
  labels: MatLabels;
  viewForward: readonly [number, number];
  /** N19 E4/E5 (ruling 8): the objects' colours in the round shown (round-colors.ts), null for the arena's own. */
  objectColors: Readonly<Record<string, string>> | null;
  /** The zones' tags (ZoneTags.tsx): shown once the view's first frame is drawn, laid out round the robot and what floats over the view. */
  tags: { ready: boolean; mode: CameraMode; overlays: { hud: HudCorner | null; card: CardEdge | null; tools: ToolsCorner | null }; robot: RobotTagBox };
};

/** The mat's canvases (mat-textures.ts), as sharp as the renderer allows; null where a 2D canvas cannot be made. */
function useMatTextures(scenario: Scenario, low: boolean): MatTextures | null {
  const gl = useThree((state) => state.gl);
  const made = useMemo(() => createMatTextures(scenario, low, { maxTextureSize: gl.capabilities.maxTextureSize, maxAnisotropy: gl.capabilities.getMaxAnisotropy() }), [scenario, gl, low]);
  useEffect(() => () => made?.dispose(), [made]);
  return made;
}

export function GltfArena({ assets, planView, scenario, view, look, shadows, textures, labels, viewForward, objectColors, tags }: GltfArenaProps) {
  const mat = useMatTextures(scenario, look.detail === 'low');
  const arena = useMemo(() => {
    try {
      return assembleArena(scenario, assets.prop, { shadows, low: look.detail === 'low', blob: textures.blob, viewForward });
    } catch (error) {
      // A props file the arena cannot be built from: the simple arena, never the error boundary (that is for a canvas that fails).
      console.warn('The robot lab’s arena models could not be built; the view draws its simple arena.', error);
      return null;
    }
  }, [scenario, assets, shadows, look, textures, viewForward]);
  useEffect(() => () => arena?.dispose(), [arena]);
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    if (arena) arena.overhead.visible = !planView;
    invalidate();
  }, [arena, planView, invalidate]);
  // N19 E4/E5 (ruling 8): each recoloured object in its colour of the round shown; one frame when that changes what is shown, none else.
  useEffect(() => {
    if (arena?.paint(objectColors)) invalidate();
  }, [arena, objectColors, invalidate]);

  const [widthCm, depthCm] = scenario.arena.ground.sizeCm;
  const centre = arenaToThree(widthCm / 2, depthCm / 2, 0);
  const surface = useMemo(() => {
    const top = new PlaneGeometry(widthCm / 100, depthCm / 100);
    top.rotateX(-Math.PI / 2);
    const edge = new BoxGeometry(widthCm / 100 + 0.004, MAT_THICKNESS_M, depthCm / 100 + 0.004);
    edge.translate(0, -MAT_THICKNESS_M / 2 - 0.0001, 0);
    const colour = mat ? '#ffffff' : scenario.arena.ground.color;
    const material =
      look.detail === 'low'
        ? new MeshLambertMaterial({ name: 'mat-low', color: colour, map: mat?.map ?? null, aoMap: mat?.shading ?? null, aoMapIntensity: 1 })
        : new MeshStandardMaterial({ name: 'mat', color: colour, map: mat?.map ?? null, roughness: 0.97, roughnessMap: mat?.roughness ?? null, aoMap: mat?.shading ?? null, aoMapIntensity: 1, metalness: 0 });
    if (look.matNormal && textures.matNormal && material instanceof MeshStandardMaterial) {
      const fibres = textures.matNormal.clone();
      fibres.repeat.set(widthCm / 7, depthCm / 7);
      material.normalMap = fibres;
      material.normalScale = new Vector2(0.05, 0.05);
    }
    // On the low tier the edge's colour is in its vertices: the one shader program of every plain part.
    if (look.detail === 'low') {
      const tint = new Color(colors.matEdge);
      edge.setAttribute('color', new Float32BufferAttribute(Array.from({ length: edge.getAttribute('position').count }, () => [tint.r, tint.g, tint.b]).flat(), 3));
    }
    const edgeMaterial = look.detail === 'low' ? new MeshLambertMaterial({ name: 'mat-edge-low', vertexColors: true }) : new MeshStandardMaterial({ name: 'mat-edge', color: colors.matEdge, roughness: 0.8 });
    // The tape's body (tape-ribbon.ts): matte black vinyl, drawn with the mat edge's shader (its colour in its vertices on the low tier).
    const tape = tapeRibbon(scenario.arena);
    if (tape && look.detail === 'low') {
      const black = new Color(colors.tape);
      tape.setAttribute('color', new Float32BufferAttribute(Array.from({ length: tape.getAttribute('position').count }, () => [black.r, black.g, black.b]).flat(), 3));
    }
    const tapeMaterial = look.detail === 'low' ? new MeshLambertMaterial({ name: 'tape-low', vertexColors: true }) : new MeshStandardMaterial({ name: 'tape', color: colors.tape, roughness: 0.82 });
    return { top, edge, material, edgeMaterial, tape, tapeMaterial };
  }, [widthCm, depthCm, mat, scenario, look, textures]);
  useEffect(
    () => () => {
      surface.top.dispose();
      surface.edge.dispose();
      surface.material.normalMap?.dispose();
      surface.material.dispose();
      surface.edgeMaterial.dispose();
      surface.tape?.dispose();
      surface.tapeMaterial.dispose();
    },
    [surface],
  );

  useFrame(() => {
    if (!arena) return;
    const world = view();
    for (const object of world.objects) {
      const mover = arena.movers.get(object.id);
      if (mover) writePose(mover.node, object.pose);
    }
  });

  if (!arena) return <ArenaView arena={scenario.arena} view={view} shadows={shadows} zoneLabel={labels.zoneLabel} objectColors={objectColors} />;
  return (
    <group name="arena-gltf">
      <primitive object={arena.root} />
      <mesh geometry={surface.top} material={surface.material} position={[centre[0], 0, centre[2]]} receiveShadow={shadows} />
      <mesh geometry={surface.edge} material={surface.edgeMaterial} position={[centre[0], 0, centre[2]]} receiveShadow={shadows} />
      {surface.tape && <mesh geometry={surface.tape} material={surface.tapeMaterial} receiveShadow={shadows} />}
      {tags.ready && <ZoneTags scenario={scenario} labels={labels} view={view} mode={tags.mode} overlays={tags.overlays} robot={tags.robot} />}
    </group>
  );
}
