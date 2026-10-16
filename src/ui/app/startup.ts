import type { ProjectDocument } from '../../core/circuit/document';
import type { DeviceRegistry } from '../../core/devices/registry';
import type { ProfileCatalog } from '../../core/profiles/profile';
import {
  openLastProject,
  type Notice,
  type ProgramCheck,
  type ProjectRepository,
} from '../../core/persistence/project-repository';
import { createTemplateProject, type LabKind } from '../../samples/templates';
import type { Launch } from './launch';

export type Startup =
  | {
      kind: 'editor';
      document: ProjectDocument;
      notice: Notice | null;
      /** Where edits are autosaved; null when nothing is saved this session. */
      saveTo: ProjectRepository | null;
    }
  /** `lab`: the lab the broken launch named, if any (the error lists its templates). */
  | { kind: 'launch-error'; problem: string; lab?: LabKind };

/**
 * What the app opens for its launch (S1, plan §7, §9.2).
 * - Standalone: the last project, as before S1 (`openLastProject`), saved as it is edited.
 * - Embedded lab: the template, fresh on every launch, with the board profile of a Yolo:Bit launch (N6a S0). The repository is
 *   never even created, so a lab can neither show nor replace the
 *   standalone last project, and its edits are not kept (CourseService D-17).
 * - Broken launch: nothing is opened, so a bad link is never mistaken for a lab.
 */
export async function openAtStartup(
  launch: Launch,
  options: {
    openRepository(): ProjectRepository;
    registry: DeviceRegistry;
    /** Defaults to the production profiles; tests inject fixture profiles. */
    profiles?: ProfileCatalog;
    newId(): string;
    canOpenProgram: ProgramCheck;
  },
): Promise<Startup> {
  switch (launch.mode) {
    case 'invalid':
      return launch.lab === undefined
        ? { kind: 'launch-error', problem: launch.problem }
        : { kind: 'launch-error', problem: launch.problem, lab: launch.lab };
    case 'embed': {
      const profile = launch.lab?.profile ?? null;
      const document = createTemplateProject(launch.template, profile === null ? {} : { profile });
      return { kind: 'editor', document, notice: null, saveTo: null };
    }
    case 'standalone': {
      const repository = options.openRepository();
      const opened = await openLastProject(repository, options.registry, {
        sample: () => createTemplateProject('blink'),
        ...(options.profiles ? { profiles: options.profiles } : {}),
        newId: options.newId,
        canOpenProgram: options.canOpenProgram,
      });
      return {
        kind: 'editor',
        document: opened.document,
        notice: opened.notice,
        saveTo: opened.canSave ? repository : null,
      };
    }
  }
}
