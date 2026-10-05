import type { ProjectDocument } from '../../core/circuit/document';
import type { DeviceRegistry } from '../../core/devices/registry';
import {
  openLastProject,
  type Notice,
  type ProgramCheck,
  type ProjectRepository,
} from '../../core/persistence/project-repository';
import { createTemplateProject } from '../../samples/templates';
import type { Launch } from './launch';

export type Startup =
  | {
      kind: 'editor';
      document: ProjectDocument;
      notice: Notice | null;
      /** Where edits are autosaved; null when nothing is saved this session. */
      saveTo: ProjectRepository | null;
    }
  | { kind: 'launch-error'; problem: string };

/**
 * What the app opens for its launch (S1, plan §7, §9.2).
 * - Standalone: the last project, as before S1 (`openLastProject`), saved as it is edited.
 * - Embedded lab: the template, fresh on every launch. The repository is
 *   never even created, so a lab can neither show nor replace the
 *   standalone last project, and its edits are not kept (CourseService D-17).
 * - Broken launch: nothing is opened, so a bad link is never mistaken for a lab.
 */
export async function openAtStartup(
  launch: Launch,
  options: {
    openRepository(): ProjectRepository;
    registry: DeviceRegistry;
    newId(): string;
    canOpenProgram: ProgramCheck;
  },
): Promise<Startup> {
  switch (launch.mode) {
    case 'invalid':
      return { kind: 'launch-error', problem: launch.problem };
    case 'embed':
      return { kind: 'editor', document: createTemplateProject(launch.template), notice: null, saveTo: null };
    case 'standalone': {
      const repository = options.openRepository();
      const opened = await openLastProject(repository, options.registry, {
        sample: () => createTemplateProject('blink'),
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
