import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { localDeviceDefinitions } from './core/devices/local-catalog';
import { createDeviceRegistry } from './core/devices/registry';
import type { RobotCheckResult } from './core/scenario/check-result';
import { productionProfiles } from './core/profiles';
import { createBlockPackCatalog } from './core/program/block-packs';
import { createRunSession } from './core/run/run-session';
import { createPinCapabilities } from './core/run/ybc-pin-io';
import { createOnboardCapabilities } from './core/simulation/peripherals/onboard-capabilities';
import { templateChallenge } from './samples/challenges';
import { createTemplateProject } from './samples/templates';
import { createDexieProjectRepository } from './storage/dexie-project-repository';
import { App } from './ui/app/App';
import { loadUiFont } from './ui/app/fonts';
import { createHostBridge, type RobotHostBridge } from './ui/app/host-bridge';
import { connectLabHost, loadHostProject } from './ui/app/lab-host';
import { LaunchError } from './ui/app/LaunchError';
import { parseLaunch } from './ui/app/launch';
import { openAtStartup } from './ui/app/startup';
import { installTestHooks } from './ui/app/test-hooks';
import { canOpenProgram } from './ui/blockly/editor-blocks';
import { applyEditorLocale } from './ui/blockly/locale';
import { localeOf } from './ui/i18n/locale';
import { TextProvider } from './ui/i18n/text';
import { startAutosave } from './ui/state/autosave';
import { createProjectStore } from './ui/state/project-store';
import { createRunStore } from './ui/state/run-store';

// Composition root: the only place that reads the launch URL and picks the
// local catalog and the storage implementation (B8).
const registry = createDeviceRegistry(localDeviceDefinitions);
// Which family and profile a project belongs to is decided by resolveBoardContext
// from the document's profile (YB plan §8.5); nothing here names a board type.
// The block packs are the data of every family's blocks, all of them registered
// with Blockly so any stored program loads, whatever profile is active.
const profiles = productionProfiles;
const packs = createBlockPackCatalog(registry);

// The project is chosen before anything renders: in the standalone editor the
// last project is read first, so nothing can be shown, edited or saved over
// it in the meantime; an embedded lab opens its template and never touches
// storage (S1).
const launch = parseLaunch(window.location.search);
// The UI's language is chosen once, before Blockly registers a block (N6a S5).
const locale = localeOf(launch, window.location.search);
document.documentElement.lang = locale;
applyEditorLocale(locale);

// Blockly measures block text when it draws: the font is loaded first (at most a moment, N6a S5).
const fontLoaded = loadUiFont();

const started = await openAtStartup(launch, {
  openRepository: () => createDexieProjectRepository(),
  registry,
  profiles,
  newId: () => crypto.randomUUID(),
  // Blockly, with the blocks of every pack, tells whether the editor can open a stored program.
  canOpenProgram: (blocks) => canOpenProgram(blocks, packs),
});

await fontLoaded;

const container = document.getElementById('root');
if (!container) {
  throw new Error('Missing #root element');
}
const root = createRoot(container);

if (started.kind === 'launch-error') {
  root.render(
    <StrictMode>
      <TextProvider locale={locale}>
        <LaunchError problem={started.problem} lab={started.lab} />
      </TextProvider>
    </StrictMode>,
  );
} else {
  const projectStore = createProjectStore(started.document);
  // The capabilities of a Yolo:Bit-compatible run are composed here, not inside RunSession (YB-CP amendment 1): the
  // onboard parts of YB-3 (display, buttons, light, buzzer) and the header pins of YB-4. Their capability keys do not
  // overlap, and RunSession drops whatever the run's board does not have.
  const pinCapabilities = createPinCapabilities(registry);
  const runStore = createRunStore(
    createRunSession(registry, {
      profiles,
      packs,
      capabilities: (environment) => ({ ...createOnboardCapabilities(environment), ...pinCapabilities(environment) }),
    }),
  );
  if (started.saveTo) {
    startAutosave(projectStore, started.saveTo, (error) => console.warn('The project could not be saved.', error));
  }

  // A lab launch (N6a): the template's challenge, and the stem-lab/v1 bridge when the lab is framed by the page
  // its `origin=` names. Opened on its own (a new tab), the lab works the same and talks to nobody.
  const lab = launch.mode === 'embed' ? (launch.lab ?? null) : null;
  const challenge = launch.mode === 'embed' && lab ? templateChallenge(launch.template, locale) : null;
  let bridge: RobotHostBridge | null = null;
  if (launch.mode === 'embed' && lab && lab.hostOrigin !== null && window.parent !== window) {
    const rules = { lab: lab.kind, profile: lab.profile, registry, profiles, canOpenProgram: (blocks: unknown) => canOpenProgram(blocks, packs) };
    bridge = createHostBridge({
      host: window.parent,
      hostOrigin: lab.hostOrigin,
      window,
      onLoadProject: (document) => void loadHostProject(document, { ...rules, projectStore, runStore }),
      // N18 R4.1 (plan §4.7): the robot lab says so in every message.
      ...(lab.kind === 'robot' ? { lab: 'robot' as const } : {}),
    });
    connectLabHost({ ...rules, bridge, projectStore, runStore, template: launch.template, challenge, locale });
  }

  if (import.meta.env.DEV) {
    installTestHooks(projectStore, profiles);
  }

  root.render(
    <StrictMode>
      <TextProvider locale={locale}>
        <App
          projectStore={projectStore}
          runStore={runStore}
          registry={registry}
          profiles={profiles}
          packs={packs}
          notice={started.notice}
          lab={
            launch.mode === 'embed' && lab
              ? {
                  kind: lab.kind,
                  template: launch.template,
                  challenge,
                  createTemplate: () => createTemplateProject(launch.template, lab.profile === null ? {} : { profile: lab.profile }),
                  onChecked: (result) => bridge?.checkResult(result),
                  // N18 R4.2: the robot lab's runs are its own session's; it says when one starts and ends.
                  ...(lab.kind === 'robot' ? { onRunChange: (running: boolean) => (running ? bridge?.runStarted() : bridge?.runStopped()) } : {}),
                  // N18 R6.3 (lab-embed-contract §2): beginCheck after the blocks were saved, the scored check-result (the bridge sends the
                  // pending project-changed first), endCheck in a finally; edits made meanwhile go out after the check-result.
                  ...(lab.kind === 'robot'
                    ? { robotCheck: { begin: () => bridge?.beginCheck(), result: (result: RobotCheckResult) => bridge?.robotCheckResult(result), end: () => bridge?.endCheck() } }
                    : {}),
                }
              : null
          }
        />
      </TextProvider>
    </StrictMode>,
  );
}
