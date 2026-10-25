import type Konva from 'konva';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { Circle, Group, Label, Layer, Line, Tag, Text } from 'react-konva';
import type { Kit, LineSensorSpec, UltrasonicSpec } from '../../core/hardware/kit';
import type { Scenario } from '../../core/scenario/scenario';
import type { RobotSnapshot } from '../../core/world/snapshot';
import { useLocale, useText } from '../i18n/text';
import { formatNumber } from './format';
import type { RobotModel } from './robot-model';
import type { RobotRunStore } from './robot-run-store';
import { robotToArena } from './robot-tools';
import type { RobotToolsStore } from './robot-tools-store';
import { idleSnapshot } from './scene-math';
import { sensorColors as colors } from './sensor-colors';
import { nextGoalZoneId, pulseLevel, sameSensorView, sectorPointsCm, SECTOR_POINTS_LENGTH, spotDrawRadiusCm } from './sensor-overlay-math';
import { arenaToStage, rayLengthCm, sameTopView, type TopViewFit } from './top-view-math';

// The sensor overlays on the 2D map (N18 R4.3), as parts/SensorOverlay.tsx draws them in the 3D view: over the cone of each ultrasonic
// sensor (a fan from the sensor to the distance it heard, with its axis ray and echo dot, which the map has drawn since R4.6, and a tag
// with the distance in cm in the learner's decimal sign), a ring on the mat at each line sensor's spot (a red disc in it where it reads
// dark), and the zone of the next unmet goal, which pulses while a run goes on and stands still with reduced motion. Like the map's moving
// layer it draws only when the picture changes (`sameTopView` and `sameSensorView`), from the store's publishes, with no React render for
// a snapshot. The readings are the snapshot's (the nearest echo, not the five rays), so the fan is an outline of the same length from the
// sensor, as in the 3D view. A reading with no echo is drawn as long as the map's ray for it (NO_ECHO_RAY_CM), not 400 cm.
// "Hiện cảm biến" (the tools store's `sensors`) turns the whole layer, and the map's ray, off.

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
};

/** Whether the learner asks the system for no motion (a browser without the query, or a test, has none). */
const reducedMotion = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(reducedMotionQuery).matches;

export function TopViewSensorsLayer({ scenario, kit, model, store, tools, fit }: TopViewSensorsProps) {
  const t = useText();
  const locale = useLocale();
  const goals = scenario.goals ?? EMPTY_GOALS;
  const idle = useMemo(() => idleSnapshot(scenario, kit), [scenario, kit]);
  const nodes = useRef<Nodes>({ layer: null, zones: new Map(), cones: [], labels: [], texts: [], spots: [] });
  // The zones goals name.
  const zones = useMemo(() => {
    const named = new Set<string>();
    for (const goal of goals) {
      if (goal.kind === 'reach-zone' || goal.kind === 'object-in-zone' || goal.kind === 'stop-in-zone') named.add(goal.zone);
      else if (goal.kind === 'checkpoints-in-order') goal.zones.forEach((zone) => named.add(zone));
      else if (goal.kind === 'servo-angle' && goal.whenInZone !== undefined) named.add(goal.whenInZone);
    }
    return scenario.arena.paint.zones.filter((zone) => named.has(zone.id)).map((zone) => ({ id: zone.id, points: zone.polygonCm.flatMap(([x, y]) => [x, y]) }));
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
        const pulse = pulseLevel(world.status === 'running', reducedMotion(), performance.now() / 1000);
        const next = nextGoalZoneId(goals, world.score.goals);
        for (const [id, zone] of n.zones) {
          const lit = id === next;
          zone.group.visible(lit);
          zone.fill.opacity(0.14 + 0.16 * pulse);
          zone.edge.opacity(0.55 + 0.4 * pulse);
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
          text.text(shownText.current('robot.ruler.cm', { value: formatNumber(reading.cm, locale, echo ? 1 : 0) }));
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
      }
      layer.setAttr('draws', Number(layer.getAttr('draws') ?? 0) + 1);
      layer.batchDraw();
    };

    const refresh = (force: boolean) => {
      const next = store.getState().latestWorld() ?? idle;
      if (!force && sameTopView(drawn, next) && sameSensorView(drawn, next, goals)) return;
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
  }, [fit, t, locale, store, tools, idle, goals, beams, spots]);

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
            <Line name="topview-goal-fill" points={zone.points} closed fill={colors.goal} opacity={0.22} perfectDrawEnabled={false} />
            <Line name="topview-goal-edge" points={zone.points} closed stroke={colors.goalEdge} strokeWidth={1.1} lineJoin="round" opacity={0.75} perfectDrawEnabled={false} />
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
    </Layer>
  );
}
