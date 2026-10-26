import type Konva from 'konva';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { Circle, Group, Label, Layer, Line, Tag, Text } from 'react-konva';
import { useStore } from 'zustand';
import type { ColorSensorSpec, IrObstacleSpec, Kit, LineSensorSpec, UltrasonicSpec } from '../../core/hardware/kit';
import type { Scenario } from '../../core/scenario/scenario';
import type { RobotSnapshot } from '../../core/world/snapshot';
import { useLocale, useText } from '../i18n/text';
import { formatNumber } from './format';
import { gripperStateOf } from './gripper-pose';
import type { RobotModel } from './robot-model';
import type { RobotRunStore } from './robot-run-store';
import { robotToArena } from './robot-tools';
import type { RobotToolsStore } from './robot-tools-store';
import { shownObjectColors } from './round-colors';
import { idleSnapshot } from './scene-math';
import { readingTints, sensorColors as colors } from './sensor-colors';
import { goalZoneIds, highlightColor, nextGoalZoneId, pulseLevel, sameSensorView, sectorPointsCm, SECTOR_POINTS_LENGTH, shownColor, spotDrawRadiusCm } from './sensor-overlay-math';
import { createGripperTopView, gripperTopViewInto } from './top-view-gripper';
import { arenaToStage, rayLengthCm, sameTopView, type TopViewFit } from './top-view-math';

// The sensor overlays on the 2D map (N18 R4.3), as parts/SensorOverlay.tsx draws them in the 3D view: over the cone of each ultrasonic
// sensor (a fan from the sensor to the distance it heard, with its axis ray and echo dot, which the map has drawn since R4.6, and a tag
// with the distance in cm in the learner's decimal sign), a ring on the mat at each line sensor's spot (a red disc in it where it reads
// dark), and the zone of the next unmet goal, which pulses while a run goes on and stands still with reduced motion. Like the map's moving
// layer it draws only when the picture changes (`sameTopView` and `sameSensorView`), from the store's publishes, with no React render for
// a snapshot. The readings are the snapshot's (the distance the sensor heard, the shortest of its five rays', not the rays), so the fan is an outline of the same length from the
// sensor, as in the 3D view. A reading with no echo is drawn as long as the map's ray for it (NO_ECHO_RAY_CM) and says "không thấy vật", as the 3D view does.
// "Hiện cảm biến" (the tools store's `sensors`) turns the whole layer, and the map's ray, off. N19 E4: on a gripper car, the IR sensor's
// beam between the jaws (its range, faint until it sees something, then strong with a dot at its end), the colour sensor's ray to what it
// meets and a spot there tinted with the colour its counts read (a ring alone for "không rõ"), both from the carriage where the boom holds
// it, and a tag under the jaws that says them ("IR: có vật", "Màu: đỏ").

const EMPTY_GOALS: Scenario['goals'] = [];
const reducedMotionQuery = '(prefers-reduced-motion: reduce)';
const labelFont = '"Be Vietnam Pro", system-ui, sans-serif';

export type TopViewSensorsProps = {
  scenario: Pick<Scenario, 'arena' | 'start'> & Partial<Pick<Scenario, 'goals'>>;
  kit: Kit;
  model: RobotModel;
  store: RobotRunStore;
  tools?: RobotToolsStore | undefined;
  fit: TopViewFit;
};

type Nodes = {
  layer: Konva.Layer | null;
  zones: Map<string, { group: Konva.Group; fill: Konva.Line; edge: Konva.Line }>;
  cones: (Konva.Line | null)[];
  labels: (Konva.Label | null)[];
  texts: (Konva.Text | null)[];
  spots: (Konva.Circle | null)[];
  /** N19 E4: the gripper car's IR beam and the dot at its end, the colour sensor's ray and spot, and their tag. */
  ir: { beam: Konva.Line | null; end: Konva.Circle | null };
  color: { ray: Konva.Line | null; spot: Konva.Circle | null };
  gripperLabel: Konva.Label | null;
  gripperText: Konva.Text | null;
};

export function TopViewSensorsLayer({ scenario, kit, model, store, tools, fit }: TopViewSensorsProps) {
  const t = useText();
  const locale = useLocale();
  const goals = scenario.goals ?? EMPTY_GOALS;
  const idle = useMemo(() => idleSnapshot(scenario, kit), [scenario, kit]);
  // Whether the learner asks the system for no motion: the query is made once here (a media query list is live: `matches` is always the
  // current answer, and a browser without the query, or a test, has none).
  const motion = useMemo(() => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(reducedMotionQuery) : null), []);
  const nodes = useRef<Nodes>({ layer: null, zones: new Map(), cones: [], labels: [], texts: [], spots: [], ir: { beam: null, end: null }, color: { ray: null, spot: null }, gripperLabel: null, gripperText: null });
  // The zones goals name (N19 E4/E5: a placed object's too).
  const zones = useMemo(() => {
    const named = goalZoneIds(goals);
    return scenario.arena.paint.zones.filter((zone) => named.has(zone.id)).map((zone) => ({ id: zone.id, points: zone.polygonCm.flatMap(([x, y]) => [x, y]), color: highlightColor(zone.color) }));
  }, [goals, scenario.arena.paint.zones]);
  // The sensors, from the kit: where each is mounted, how wide its cone, how big its spot. The cones' points are written in place by
  // `apply` and keep these very arrays, so a React render never puts a fan back to nothing.
  const beams = useMemo(
    () =>
      model.ultrasonics.flatMap((ultrasonic) => {
        const module = kit.modules.find((candidate) => candidate.role === ultrasonic.role);
        if (module === undefined) return [];
        return [{ role: ultrasonic.role, mount: module.mount, halfDeg: (module.spec as unknown as UltrasonicSpec).coneHalfDeg, points: new Array<number>(SECTOR_POINTS_LENGTH).fill(0) }];
      }),
    [kit, model],
  );
  const spots = useMemo(
    () => model.lineSensors.map((sensor) => ({ role: sensor.role, sensorIndex: sensor.sensorIndex, radiusCm: spotDrawRadiusCm((kit.modules.find((module) => module.role === sensor.role)?.spec as unknown as LineSensorSpec | undefined)?.spotRadiusCm) })),
    [kit, model],
  );
  // N19 E4: the sensors on the gripper's carriage: where each sits on it (cm: u forward, v left) and how far it reaches.
  const carried = useMemo(() => {
    const gripper = model.gripper;
    if (gripper === null) return null;
    const rider = (sensor: { role: string; position: readonly [number, number, number]; sensorIndex: number } | null) => {
      const module = sensor === null ? undefined : kit.modules.find((candidate) => candidate.role === sensor.role);
      if (sensor === null || module === undefined) return null;
      const rangeCm = (module.spec as unknown as IrObstacleSpec | ColorSensorSpec).rangeCm;
      return { role: sensor.role, sensorIndex: sensor.sensorIndex, uCm: sensor.position[0] * 100, vCm: 0 - sensor.position[2] * 100, yawDeg: module.mount.yawDeg, rangeCm };
    };
    return { gripper, ir: rider(gripper.ir), color: rider(gripper.color), view: createGripperTopView(), irPoints: [0, 0, 0, 0], colorPoints: [0, 0, 0, 0] };
  }, [kit, model]);
  // N19 E4/E5: the objects' colours a goal placed by colour reads: the round shown's (round-colors.ts), else the arena's own.
  const roundColors = useStore(store, shownObjectColors);
  const objectColors = useMemo(
    () => roundColors ?? Object.freeze(Object.fromEntries(scenario.arena.objects.flatMap((object) => (object.color === undefined ? [] : [[object.id, object.color] as const])))),
    [roundColors, scenario.arena.objects],
  );
  const shownFit = useRef(fit);
  const shownText = useRef(t);

  useLayoutEffect(() => {
    shownFit.current = fit;
    shownText.current = t;
    const n = nodes.current;
    const layer = n.layer;
    if (layer === null) return undefined;
    let drawn: RobotSnapshot | null = null;

    const apply = (world: RobotSnapshot) => {
      const on = tools?.getState().sensors ?? true;
      layer.visible(on);
      if (on) {
        const pulse = pulseLevel(world.status === 'running', motion?.matches === true, performance.now() / 1000);
        const next = nextGoalZoneId(goals, world.score.goals, objectColors);
        for (const [id, zone] of n.zones) {
          const lit = id === next;
          zone.group.visible(lit);
          zone.fill.opacity(0.18 + 0.12 * pulse);
          zone.edge.opacity(0.6 + 0.3 * pulse);
        }
        beams.forEach((beam, i) => {
          const cone = n.cones[i];
          const label = n.labels[i];
          const text = n.texts[i];
          let reading: Extract<RobotSnapshot['sensors'][number], { kind: 'ultrasonic' }> | null = null;
          for (const sensor of world.sensors) {
            if (sensor.kind === 'ultrasonic' && sensor.role === beam.role) reading = sensor;
          }
          if (reading === null || !cone || !label || !text) {
            cone?.visible(false);
            label?.visible(false);
            return;
          }
          const echo = reading.hitId !== null;
          const length = rayLengthCm(reading.cm, echo);
          const origin = robotToArena(world.robot, [beam.mount.posCm[0], beam.mount.posCm[1]]);
          const heading = world.robot.yawDeg + beam.mount.yawDeg;
          sectorPointsCm(beam.points, origin.xCm, origin.yCm, heading, beam.halfDeg, length);
          cone.opacity(echo ? 1 : 0.5);
          cone.visible(true);
          const end = arenaToStage(shownFit.current, { xCm: origin.xCm + length * Math.cos((heading * Math.PI) / 180), yCm: origin.yCm + length * Math.sin((heading * Math.PI) / 180) });
          // The heard distance, or "không thấy vật" with no echo (the same words as the 3D tag and the pin table).
          text.text(echo ? shownText.current('robot.ruler.cm', { value: formatNumber(reading.cm, locale, 1) }) : shownText.current('robot.pins.ultra.noEcho'));
          label.position({ x: end.x, y: end.y - 10 });
          label.offsetX(label.width() / 2);
          label.visible(true);
        });
        spots.forEach((spot, i) => {
          const circle = n.spots[i];
          const reading = world.sensors[spot.sensorIndex];
          if (!circle) return;
          if (reading?.kind !== 'line-sensor' || reading.spotCm === null) {
            circle.visible(false);
            return;
          }
          circle.position({ x: reading.spotCm[0], y: reading.spotCm[1] });
          circle.fillEnabled(reading.dark);
          circle.stroke(reading.dark ? colors.spotDark : colors.spotLight);
          circle.setAttr('dark', reading.dark);
          circle.visible(true);
        });
        if (carried !== null) drawCarried(world);
      }
      layer.setAttr('draws', Number(layer.getAttr('draws') ?? 0) + 1);
      layer.batchDraw();
    };

    /** N19 E4: the IR beam, the colour sensor's ray and spot, and their tag, from the carriage where the boom holds it now. */
    const drawCarried = (world: RobotSnapshot) => {
      if (carried === null) return;
      const top = gripperTopViewInto(carried.view, carried.gripper, gripperStateOf(world));
      const { ir, color } = carried;
      const lines: string[] = [];
      // A sensor's place on the arena and its heading (the carriage is level: it faces the robot's way).
      const place = (sensor: NonNullable<typeof ir>) => ({
        origin: robotToArena(world.robot, [top.tipXCm + sensor.uCm, top.midYCm + sensor.vCm]),
        heading: ((world.robot.yawDeg + sensor.yawDeg) * Math.PI) / 180,
      });
      const irReading = ir === null ? undefined : world.sensors[ir.sensorIndex];
      if (ir !== null && irReading?.kind === 'ir-obstacle') {
        const { origin, heading } = place(ir);
        const [x1, y1] = [origin.xCm + ir.rangeCm * Math.cos(heading), origin.yCm + ir.rangeCm * Math.sin(heading)];
        // In place: the node's own array (its prop), so that a render of the map never puts the beam back.
        const beam = carried.irPoints;
        [beam[0], beam[1], beam[2], beam[3]] = [origin.xCm, origin.yCm, x1, y1];
        n.ir.beam?.points(beam);
        n.ir.beam?.opacity(irReading.detected ? 1 : 0.4);
        n.ir.beam?.strokeWidth(irReading.detected ? 0.55 : 0.3);
        n.ir.beam?.setAttrs({ detected: irReading.detected, hitId: irReading.hitId });
        n.ir.beam?.visible(true);
        n.ir.end?.position({ x: x1, y: y1 });
        n.ir.end?.visible(irReading.detected);
        lines.push(shownText.current('robot.overlay.ir', { state: shownText.current(irReading.detected ? 'robot.pins.ir.seen' : 'robot.pins.ir.clear') }));
      } else {
        n.ir.beam?.visible(false);
        n.ir.end?.visible(false);
      }
      const colorReading = color === null ? undefined : world.sensors[color.sensorIndex];
      if (color !== null && colorReading?.kind === 'color-sensor') {
        const { origin, heading } = place(color);
        const reach = colorReading.distanceCm ?? color.rangeCm;
        const [x1, y1] = [origin.xCm + reach * Math.cos(heading), origin.yCm + reach * Math.sin(heading)];
        const ray = carried.colorPoints;
        [ray[0], ray[1], ray[2], ray[3]] = [origin.xCm, origin.yCm, x1, y1];
        n.color.ray?.points(ray);
        n.color.ray?.dash(colorReading.hitId === null ? [0.5, 0.4] : []);
        n.color.ray?.visible(true);
        const read = shownColor(colorReading);
        const tint = read === null ? null : readingTints[read];
        n.color.spot?.position({ x: x1, y: y1 });
        n.color.spot?.fill(tint ?? colors.spotRing);
        n.color.spot?.fillEnabled(tint !== null);
        n.color.spot?.setAttrs({ color: read, hitId: colorReading.hitId });
        n.color.spot?.visible(colorReading.hitId !== null);
        lines.push(shownText.current('robot.overlay.color', { color: read === null ? shownText.current('robot.pins.color.noReading') : shownText.current(`robot.color.${read}`) }));
      } else {
        n.color.ray?.visible(false);
        n.color.spot?.visible(false);
      }
      const label = n.gripperLabel;
      const text = n.gripperText;
      if (label === null || text === null || lines.length === 0) {
        label?.visible(false);
        return;
      }
      // Under the jaws' tips on the screen, pointing up at them: clear of the ultrasonic's tag, which stands over its ray's end.
      const reach = top.hingeXCm + carried.gripper.finger.lengthM * 100;
      const at = arenaToStage(shownFit.current, robotToArena(world.robot, [reach, top.midYCm]));
      text.text(lines.join('\n'));
      label.position({ x: at.x, y: at.y + 12 });
      label.offsetX(label.width() / 2);
      label.visible(true);
    };

    const refresh = (force: boolean) => {
      const next = store.getState().latestWorld() ?? idle;
      if (!force && sameTopView(drawn, next) && sameSensorView(drawn, next, goals, objectColors)) return;
      drawn = next;
      apply(next);
    };
    refresh(true);
    const stopPublishes = store.getState().onPublish(() => refresh(false));
    const stopState = store.subscribe(() => refresh(false));
    const stopTools = tools?.subscribe((state, previous) => {
      if (state.sensors !== previous.sensors) refresh(true);
    });
    return () => {
      stopPublishes();
      stopState();
      stopTools?.();
    };
  }, [fit, t, locale, store, tools, idle, goals, beams, spots, motion, carried, objectColors]);

  const world = { x: fit.originX, y: fit.originY, scaleX: fit.scale, scaleY: -fit.scale };
  return (
    <Layer
      listening={false}
      name="topview-sensors"
      ref={(layer) => {
        nodes.current.layer = layer;
      }}
    >
      <Group {...world} name="topview-sensors-world">
        {zones.map((zone) => (
          <Group
            key={zone.id}
            name="topview-goal"
            zoneId={zone.id}
            visible={false}
            ref={(group) => {
              const found = nodes.current.zones;
              if (group === null) {
                found.delete(zone.id);
                return;
              }
              const [fill, edge] = group.getChildren() as [Konva.Line, Konva.Line];
              found.set(zone.id, { group, fill, edge });
            }}
          >
            <Line name="topview-goal-fill" points={zone.points} closed fill={zone.color} opacity={0.24} perfectDrawEnabled={false} />
            <Line name="topview-goal-edge" points={zone.points} closed stroke={zone.color} strokeWidth={1.1} lineJoin="round" opacity={0.8} perfectDrawEnabled={false} />
          </Group>
        ))}
        {beams.map((beam, i) => (
          <Line
            key={beam.role}
            ref={(node) => {
              nodes.current.cones[i] = node;
            }}
            name="topview-cone"
            role={beam.role}
            points={beam.points}
            closed
            fill={colors.coneFill}
            stroke={colors.ray}
            strokeWidth={0.35}
            lineJoin="round"
            opacity={1}
            visible={false}
            perfectDrawEnabled={false}
          />
        ))}
        {spots.map((spot, i) => (
          <Circle
            key={spot.role}
            ref={(node) => {
              nodes.current.spots[i] = node;
            }}
            name="topview-spot"
            role={spot.role}
            dark={false}
            radius={spot.radiusCm}
            fill={colors.spotDark}
            fillEnabled={false}
            stroke={colors.spotLight}
            strokeWidth={0.45}
            visible={false}
          />
        ))}
        {carried?.ir && (
          <>
            <Line
              ref={(node) => {
                nodes.current.ir.beam = node;
              }}
              name="topview-ir"
              role={carried.ir.role}
              points={carried.irPoints}
              stroke={colors.ir}
              strokeWidth={0.3}
              lineCap="round"
              opacity={0.4}
              visible={false}
              perfectDrawEnabled={false}
            />
            <Circle
              ref={(node) => {
                nodes.current.ir.end = node;
              }}
              name="topview-ir-end"
              role={carried.ir.role}
              radius={0.45}
              fill={colors.ir}
              visible={false}
            />
          </>
        )}
        {carried?.color && (
          <>
            <Line
              ref={(node) => {
                nodes.current.color.ray = node;
              }}
              name="topview-color-ray"
              role={carried.color.role}
              points={carried.colorPoints}
              stroke={colors.spotRing}
              strokeWidth={0.18}
              opacity={0.7}
              visible={false}
              perfectDrawEnabled={false}
            />
            <Circle
              ref={(node) => {
                nodes.current.color.spot = node;
              }}
              name="topview-color-spot"
              role={carried.color.role}
              radius={0.8}
              fill={colors.spotRing}
              fillEnabled={false}
              stroke={colors.spotRing}
              strokeWidth={0.25}
              visible={false}
            />
          </>
        )}
      </Group>
      {beams.map((beam, i) => (
        <Label
          key={beam.role}
          ref={(node) => {
            nodes.current.labels[i] = node;
          }}
          name="topview-sensor-label"
          role={beam.role}
          visible={false}
        >
          <Tag fill={colors.labelBackground} stroke={colors.labelBorder} strokeWidth={1.5} cornerRadius={8} pointerDirection="down" pointerWidth={7} pointerHeight={5} />
          <Text
            ref={(node) => {
              nodes.current.texts[i] = node;
            }}
            text=""
            fontFamily={labelFont}
            fontSize={12}
            fontStyle="700"
            padding={4}
            fill={colors.labelText}
          />
        </Label>
      ))}
      {carried && (carried.ir || carried.color) && (
        <Label
          ref={(node) => {
            nodes.current.gripperLabel = node;
          }}
          name="topview-gripper-label"
          visible={false}
        >
          <Tag fill={colors.labelBackground} stroke={colors.labelBorder} strokeWidth={1.5} cornerRadius={8} pointerDirection="up" pointerWidth={7} pointerHeight={5} />
          <Text
            ref={(node) => {
              nodes.current.gripperText = node;
            }}
            text=""
            fontFamily={labelFont}
            fontSize={12}
            fontStyle="700"
            lineHeight={1.25}
            padding={4}
            fill={colors.labelText}
          />
        </Label>
      )}
    </Layer>
  );
}
