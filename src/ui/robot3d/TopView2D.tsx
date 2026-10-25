import type Konva from 'konva';
import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { Arrow, Circle, Group, Image as KonvaImage, Layer, Line, Rect, Stage, Text } from 'react-konva';
import type { Kit } from '../../core/hardware/kit';
import type { Scenario } from '../../core/scenario/scenario';
import type { Arena, PaintZone } from '../../core/world/arena/arena-schema';
import type { RobotSnapshot } from '../../core/world/snapshot';
import { CM_PER_M } from '../../core/world/units';
import { useElementSize } from '../canvas/use-element-size';
import { useText } from '../i18n/text';
import { groundTextureSize, paintGround } from './ground-paint';
import { lineSeesDark, type RobotModel } from './robot-model';
import type { RobotRunStore } from './robot-run-store';
import type { RobotToolsStore } from './robot-tools-store';
import { idleSnapshot } from './scene-math';
import { topViewColors as colors } from './top-view-colors';
import { fitTopView, movingBodies, rayLengthCm, robotPartCm, sameTopView, scaleBar, treadOffsetCm, wheelRadIndex, type MovingBody, type StageMargins } from './top-view-math';
import { TopViewToolsLayer, useTopViewPointer } from './TopViewTools';
import type { ViewFallbackReason } from './webgl-support';

// The robot lab's 2D top view (N18 R4.6): what stands in for the 3D scene on a computer that cannot draw WebGL, while the browser has
// taken its WebGL context away, and when the learner asks for it. It reads the same snapshot the 3D scene does (the run store's
// `latestWorld()`), so the run, the check, the HUD and the controls neither know nor care which view is up, and switching between them
// never touches the simulation.
//
// It draws, in the arena's own centimetres: the mat with its paint (the very `paintGround` of the 3D floor), the walls and the fixed
// bodies; and on a second layer what moves: the pushed bodies, the robot (outline, wheels, heading arrow, line-sensor dots lit on dark,
// the servo's arm, the LEDs) and the ultrasonic ray to its hit. A world group flips the stage's y once, so a position is the snapshot's
// (xCm, yCm) and a turn is its yawDeg as they are. It draws only when the picture changes (`sameTopView`): the second layer's nodes are
// moved from the store's publishes and its `batchDraw` runs once per animation frame at most, with no React render for a snapshot.
// The layers are not hit-tested; N18 R4.8: the view tools (the ruler, the move tool) read the pointer on the container and draw on a layer
// of their own (TopViewTools.tsx).

export type TopView2DProps = {
  scenario: Pick<Scenario, 'arena' | 'start'>;
  kit: Kit;
  model: RobotModel;
  store: RobotRunStore;
  /** A zone's name painted on the mat (the learner's words), or null. */
  zoneLabel: (zone: PaintZone) => string | null;
  /** Why this view is up (tests and the E2E read it); null when it is only a view the learner chose. */
  reason?: ViewFallbackReason | null;
  /** N18 R4.8: the view tools, which work on the map as in the 3D view. */
  tools?: RobotToolsStore;
};

/** Room left around the arena, px: the scale bar sits under it, and the view button over the stage's corner clear of it (28 px + 10). */
const MARGINS: StageMargins = { left: 14, right: 14, top: 14, bottom: 40 };
/** The sharpest the mat is painted, px along a side of its canvas (browsers allow more; this is plenty for a 2D map). */
const MAX_MAT_PX = 4096;
const labelFont = '"Be Vietnam Pro", system-ui, sans-serif';

/** The mat's paint on a canvas of the sharpness the stage shows it at (quantised, so that dragging the separator repaints rarely). */
function useMat(arena: Arena, scale: number | null, zoneLabel: TopView2DProps['zoneLabel']): HTMLCanvasElement | null {
  const ratio = typeof window === 'undefined' ? 1 : Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const wanted = scale === null ? null : Math.ceil(scale * ratio * 2) / 2;
  return useMemo(() => {
    if (wanted === null) return null;
    const pxPerCm = Math.min(wanted, groundTextureSize(arena.ground.sizeCm, MAX_MAT_PX).pxPerCm);
    const [widthCm, depthCm] = arena.ground.sizeCm;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(widthCm * pxPerCm);
    canvas.height = Math.ceil(depthCm * pxPerCm);
    const ctx = canvas.getContext('2d');
    if (ctx === null) return null;
    paintGround(ctx, arena, { pxPerCm, zoneLabel });
    return canvas;
  }, [arena, wanted, zoneLabel]);
}

/** The nodes the run moves, by the part they are. */
type Nodes = {
  layer: Konva.Layer | null;
  robot: Konva.Group | null;
  treads: (Konva.Rect | null)[];
  lineDots: (Konva.Circle | null)[];
  rays: (Konva.Line | null)[];
  hits: (Konva.Circle | null)[];
  arms: (Konva.Group | null)[];
  leds: (Konva.Circle | null)[];
  moving: Map<string, Konva.Group>;
  draws: number;
};

const emptyNodes = (): Nodes => ({ layer: null, robot: null, treads: [], lineDots: [], rays: [], hits: [], arms: [], leds: [], moving: new Map(), draws: 0 });

export function TopView2D({ scenario, kit, model, store, zoneLabel, reason = null, tools }: TopView2DProps) {
  const t = useText();
  const containerRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(containerRef);
  const { arena } = scenario;
  const [widthCm, depthCm] = arena.ground.sizeCm;
  const idle = useMemo(() => idleSnapshot(scenario, kit), [scenario, kit]);
  const moving = useMemo(() => movingBodies(arena), [arena]);
  const fit = size !== null && size.width > 0 && size.height > 0 ? fitTopView([widthCm, depthCm], size, MARGINS) : null;
  const mat = useMat(arena, fit?.scale ?? null, zoneLabel);
  const nodes = useRef<Nodes>(emptyNodes());
  const shown = fit !== null;
  useTopViewPointer(containerRef, tools, store, scenario, kit, fit);

  // The part nodes, by index: the ref callbacks keep them where `apply` finds them.
  const setNode = useCallback(<K extends 'treads' | 'lineDots' | 'rays' | 'hits' | 'arms' | 'leds'>(list: K, index: number) => (node: Nodes[K][number]) => {
    (nodes.current[list] as (typeof node)[])[index] = node;
  }, []);

  // Puts every moving node where `world` has it, and asks for the draw. Only the second layer is drawn: the mat is not touched.
  const apply = useCallback(
    (world: RobotSnapshot) => {
      const n = nodes.current;
      const { robot } = world;
      n.robot?.position({ x: robot.xCm, y: robot.yCm });
      n.robot?.rotation(robot.yawDeg);
      model.wheels.forEach((wheel, i) => n.treads[i]?.x(treadOffsetCm(wheel.radiusM * CM_PER_M, robot.wheelRad[wheelRadIndex(wheel)])));
      model.lineSensors.forEach((sensor, i) => {
        const dot = n.lineDots[i];
        const dark = lineSeesDark(world, sensor.sensorIndex);
        dot?.fill(dark ? colors.lineDark : colors.lineLight);
        dot?.setAttr('dark', dark);
      });
      model.ultrasonics.forEach((ultrasonic, i) => {
        const reading = world.sensors.find((sensor) => sensor.kind === 'ultrasonic' && sensor.role === ultrasonic.role);
        const ray = n.rays[i];
        const hit = n.hits[i];
        if (reading?.kind !== 'ultrasonic') {
          ray?.visible(false);
          hit?.visible(false);
          return;
        }
        const [x, y] = robotPartCm(ultrasonic.position);
        // The sensor's beam is five rays (its axis and the four edges of its cone, core/world/sensors/ultrasonic.ts) and its reading is the
        // nearest echo of the five. The map draws one ray, along the axis, to that distance: when the nearest echo came from a ray at the
        // cone's edge (a wall's corner beside the axis), the dot at the end is where the reading says, not where the axis ray would hit.
        const echo = reading.hitId !== null;
        const length = rayLengthCm(reading.cm, echo);
        const end = [x + length * Math.cos(ultrasonic.yawRad), y + length * Math.sin(ultrasonic.yawRad)] as const;
        ray?.points([x, y, end[0], end[1]]);
        ray?.dash(echo ? [] : [1.6, 1.2]);
        ray?.opacity(echo ? 0.95 : 0.45);
        ray?.setAttrs({ lengthCm: reading.cm, echo });
        ray?.visible(true);
        hit?.position({ x: end[0], y: end[1] });
        hit?.visible(echo);
      });
      model.servos.forEach((servo, i) => n.arms[i]?.rotation(servo.mountYawDeg + (robot.servoDeg[servo.role] ?? 0)));
      model.leds.forEach((led, i) => {
        const lit = world.leds[led.role] === true;
        n.leds[i]?.fill(lit ? colors.ledOn : colors.ledOff);
        n.leds[i]?.setAttr('lit', lit);
      });
      for (const object of world.objects) {
        n.moving.get(object.id)?.position({ x: object.pose.xCm, y: object.pose.yCm }).rotation(object.pose.yawDeg);
      }
      n.draws += 1;
      n.layer?.setAttr('draws', n.draws);
      n.layer?.batchDraw();
    },
    [model],
  );

  // Follows the store: a publish or a change of its state draws the world if (and only if) the picture changed. The first call draws the
  // world as it is now, also when the stage has just been made (it measures its container before the first paint) or made again.
  useLayoutEffect(() => {
    if (!shown) return undefined;
    let drawn: RobotSnapshot | null = null;
    const refresh = (force: boolean) => {
      const next = store.getState().latestWorld() ?? idle;
      if (!force && sameTopView(drawn, next)) return;
      drawn = next;
      apply(next);
    };
    refresh(true);
    const stopPublishes = store.getState().onPublish(() => refresh(false));
    const stopState = store.subscribe(() => refresh(false));
    return () => {
      stopPublishes();
      stopState();
    };
  }, [shown, store, idle, apply]);

  const world = fit && { x: fit.originX, y: fit.originY, scaleX: fit.scale, scaleY: -fit.scale };
  const bar = fit && scaleBar(fit.scale);
  const barY = fit && Math.min(fit.originY + 17, (size?.height ?? 0) - 10);

  return (
    <div ref={containerRef} className="robot-topview" role="img" aria-label={t('robot.topview.label')} data-testid="robot-topview" data-reason={reason ?? 'chosen'}>
      {fit && world && bar && size && (
        <Stage width={size.width} height={size.height} listening={false}>
          <Layer listening={false}>
            <Group {...world} name="topview-mat">
              <Rect x={-0.6} y={-0.6} width={widthCm + 1.2} height={depthCm + 1.2} fill={colors.slab} />
              {mat ? <KonvaImage image={mat} x={0} y={depthCm} width={widthCm} height={depthCm} scaleY={-1} /> : <Rect width={widthCm} height={depthCm} fill={arena.ground.color} />}
              {arena.walls.map((wall, i) => (
                <Group key={wall.id ?? `#wall-${i}`} name="topview-wall">
                  <Line points={[...wall.fromCm, ...wall.toCm]} stroke={colors.wallEdge} strokeWidth={wall.thicknessCm + 0.6} lineCap="square" />
                  <Line points={[...wall.fromCm, ...wall.toCm]} stroke={colors.wall} strokeWidth={wall.thicknessCm} lineCap="square" />
                </Group>
              ))}
              {arena.boxes.map((box, i) =>
                box.body === 'fixed' ? (
                  <Rect
                    key={box.id ?? `#box-${i}`}
                    name="topview-fixed"
                    x={box.centerCm[0]}
                    y={box.centerCm[1]}
                    width={box.sizeCm[0]}
                    height={box.sizeCm[1]}
                    offsetX={box.sizeCm[0] / 2}
                    offsetY={box.sizeCm[1] / 2}
                    rotation={box.yawDeg}
                    fill={colors.box}
                    stroke={colors.bodyEdge}
                    strokeWidth={0.25}
                  />
                ) : null,
              )}
              {arena.cylinders.map((cylinder, i) =>
                cylinder.body === 'fixed' ? (
                  <Circle
                    key={cylinder.id ?? `#cylinder-${i}`}
                    name="topview-fixed"
                    x={cylinder.centerCm[0]}
                    y={cylinder.centerCm[1]}
                    radius={cylinder.radiusCm}
                    fill={colors.cylinder}
                    stroke={colors.bodyEdge}
                    strokeWidth={0.25}
                  />
                ) : null,
              )}
            </Group>
            {/* The scale bar: 10 cm at this scale, under the arena's lower left corner. */}
            <Group name="topview-scale" x={fit.originX} y={barY ?? 0} cm={bar.cm} lengthPx={bar.lengthPx}>
              <Line points={[0, 0, bar.lengthPx, 0]} stroke={colors.scale} strokeWidth={2} />
              <Line points={[0, -4, 0, 4]} stroke={colors.scale} strokeWidth={2} />
              <Line points={[bar.lengthPx, -4, bar.lengthPx, 4]} stroke={colors.scale} strokeWidth={2} />
              <Text x={bar.lengthPx + 8} y={-7} text={t('robot.topview.scale')} fontSize={12} fontFamily={labelFont} fill={colors.scale} />
            </Group>
          </Layer>
          <Layer
            listening={false}
            ref={(layer) => {
              nodes.current.layer = layer;
            }}
          >
            <Group {...world} name="topview-world">
              {moving.map((body) => (
                <Group
                  key={body.id}
                  name="topview-object"
                  objectId={body.id}
                  ref={(group) => {
                    if (group) nodes.current.moving.set(body.id, group);
                    else nodes.current.moving.delete(body.id);
                  }}
                >
                  <MovingShape body={body} />
                </Group>
              ))}
              <Group
                name="topview-robot"
                ref={(group) => {
                  nodes.current.robot = group;
                }}
              >
                <RobotParts model={model} setNode={setNode} />
              </Group>
            </Group>
          </Layer>
          {tools && <TopViewToolsLayer tools={tools} kit={kit} fit={fit} />}
        </Stage>
      )}
    </div>
  );
}

function MovingShape({ body }: { body: MovingBody }) {
  const fill = colors[body.colorKey];
  return body.shape === 'box' ? (
    <Rect x={-body.widthCm / 2} y={-body.depthCm / 2} width={body.widthCm} height={body.depthCm} fill={fill} stroke={colors.bodyEdge} strokeWidth={0.25} />
  ) : (
    <Circle radius={body.radiusCm} fill={fill} stroke={colors.bodyEdge} strokeWidth={0.25} />
  );
}

type SetNode = <K extends 'treads' | 'lineDots' | 'rays' | 'hits' | 'arms' | 'leds'>(list: K, index: number) => (node: Nodes[K][number]) => void;

/** The robot from above, built from the kit as the 3D one is (robot-model.ts), in its own frame: x forward, y left, cm. */
function RobotParts({ model, setNode }: { model: RobotModel; setNode: SetNode }) {
  const length = model.body.lengthM * CM_PER_M;
  const width = model.body.widthM * CM_PER_M;
  // Every prop that `apply` also sets on a node (the ray's `points`, its `visible`, the dots' `fill`…) must keep the very value it has
  // when this renders again, because react-konva sets a prop again whenever its value is not `===` the last one, and a new array each
  // render would put the ray back to a point under a resting robot (a resize, a Run click, a block edit render this component again).
  const rayStarts = useMemo(
    () =>
      model.ultrasonics.map((ultrasonic) => {
        const [x, y] = robotPartCm(ultrasonic.position);
        return [x, y, x, y];
      }),
    [model],
  );
  return (
    <>
      {/* The wheels under the body, each with a mark on its tyre that moves as the wheel rolls. */}
      {model.wheels.map((wheel, i) => {
        const [x, y] = robotPartCm(wheel.position);
        const radius = wheel.radiusM * CM_PER_M;
        const span = wheel.widthM * CM_PER_M;
        return (
          <Group key={wheel.role} name="topview-wheel" role={wheel.role} x={x} y={y}>
            <Rect x={-radius} y={-span / 2} width={radius * 2} height={span} cornerRadius={0.6} fill={colors.tyre} />
            <Rect ref={setNode('treads', i)} x={0} y={-span / 2} width={0.7} height={span} fill={colors.treadMark} />
          </Group>
        );
      })}
      <Rect name="topview-body" x={-length / 2} y={-width / 2} width={length} height={width} cornerRadius={1.6} fill={colors.chassis} stroke={colors.chassisTrim} strokeWidth={0.5} />
      {model.servos.map((servo, i) => {
        const [x, y] = robotPartCm(servo.position);
        const arm = servo.arm.lengthM * CM_PER_M;
        const armWidth = servo.arm.widthM * CM_PER_M;
        return (
          <Group key={servo.role} name="topview-servo" role={servo.role} x={x} y={y}>
            <Group ref={setNode('arms', i)} name="topview-arm" rotation={servo.mountYawDeg}>
              <Rect x={0} y={-armWidth / 2} width={arm} height={armWidth} cornerRadius={armWidth / 2} fill={colors.servoArm} stroke={colors.servoHub} strokeWidth={0.2} />
            </Group>
            <Circle radius={1} fill={colors.servoHub} />
          </Group>
        );
      })}
      {model.leds.map((led, i) => {
        const [x, y] = robotPartCm(led.position);
        return <Circle key={led.role} ref={setNode('leds', i)} name="topview-led" role={led.role} x={x} y={y} radius={0.8} fill={colors.ledOff} stroke={colors.dotRing} strokeWidth={0.2} />;
      })}
      {/* The heading: an arrow from the middle to the nose. */}
      <Arrow name="topview-heading" points={[-length * 0.2, 0, length * 0.36, 0]} pointerLength={3} pointerWidth={3.4} fill={colors.arrow} stroke={colors.arrow} strokeWidth={0.7} />
      {model.ultrasonics.map((ultrasonic, i) => {
        return (
          <Group key={ultrasonic.role}>
            <Line ref={setNode('rays', i)} name="topview-ray" role={ultrasonic.role} points={rayStarts[i]} stroke={colors.ray} strokeWidth={0.45} lineCap="round" visible={false} />
            <Circle ref={setNode('hits', i)} name="topview-ray-hit" role={ultrasonic.role} radius={1} fill={colors.rayHit} stroke={colors.dotRing} strokeWidth={0.25} visible={false} />
          </Group>
        );
      })}
      {model.lineSensors.map((sensor, i) => {
        const [x, y] = robotPartCm(sensor.position);
        return <Circle key={sensor.role} ref={setNode('lineDots', i)} name="topview-line-dot" role={sensor.role} dark={false} x={x} y={y} radius={0.9} fill={colors.lineLight} stroke={colors.dotRing} strokeWidth={0.25} />;
      })}
    </>
  );
}
