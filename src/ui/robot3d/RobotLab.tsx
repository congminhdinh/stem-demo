import type { ReactNode } from 'react';
import { robotTemplates, type RobotTemplateKey } from '../../samples/robot-templates';
import { useText } from '../i18n/text';
import './RobotLab.css';

// The robot lab (`lab=robot`, N18 R4.1): a SHELL, loaded on its own with React.lazy (App.tsx) so that no other lab pays for it.
// It holds the places the rest of N18 plugs into: the viewport (R4.2 puts the 3D scene in it, over the world of R3.x), the program
// (the block editor App builds, with the uno blocks of R2.2) and, later, the scenario's goals and the checks of R6. Nothing in
// this file may import `three`, `@react-three/*` or the world engine until R4.2 does it on purpose: that is what keeps the Blockly
// and Yolo:Bit labs free of 3D bytes (e2e/robot-bundle.spec.ts watches the network for it).

export type RobotLabProps = {
  /** The scenario the lab was launched with. */
  template: RobotTemplateKey;
  /** The block editor and what belongs with it, built by App from the stores. */
  program: ReactNode;
  /** What App tells the learner about the project it opened (a program that could not be opened, no saving), shown in the header. */
  notices?: ReactNode;
};

export default function RobotLab({ template, program, notices = null }: RobotLabProps) {
  const t = useText();
  return (
    <>
      <header className="app-header">
        <h1>{t('lab.title.robot')}</h1>
        <h2 className="robot-scenario" data-testid="robot-scenario">
          {t(robotTemplates[template].titleKey)}
        </h2>
        {notices}
      </header>
      <main className="workspace robot-lab" data-testid="robot-lab" data-scenario={template}>
        <section className="canvas-region robot-viewport" aria-label={t('robot.viewport')} data-testid="robot-viewport">
          <p className="robot-viewport-placeholder">{t('robot.viewport.placeholder')}</p>
        </section>
        {program}
      </main>
    </>
  );
}
