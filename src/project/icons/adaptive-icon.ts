import { mkdirp, pathExists, unlink, writeFile } from '@ionic/utils-fs';
import { join } from 'path';

import type { XmlFile } from '../xml';
import type { MobileProject } from '../project';

/** The layers an `<adaptive-icon>` can declare. Android treats all of them as optional. */
export type AdaptiveIconLayer = 'foreground' | 'background' | 'monochrome';

const ADAPTIVE_ICON_DIR = 'mipmap-anydpi-v26';

// Both descriptors get the same content. ic_launcher_round.xml is only read on API 25, and
// adaptive icons need API 26, but the template ships it, so keep the two in sync.
const DESCRIPTOR_FILES = ['ic_launcher.xml', 'ic_launcher_round.xml'];

const EMPTY = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"/>
`;

/**
 * The project's `mipmap-anydpi-v26/ic_launcher.xml` and `ic_launcher_round.xml` descriptors.
 *
 * Each write replaces a whole layer element, so layers written by something else survive. A
 * wrapper such as 0.5.0's `<background><inset android:inset="16.7%"/></background>` is replaced
 * outright, rather than having its drawable swapped inside the inset.
 */
export class AdaptiveIconDescriptor {
  private constructor(private readonly files: XmlFile[]) {}

  /** Open both descriptors, creating either if it is missing. */
  static async open(project: MobileProject): Promise<AdaptiveIconDescriptor> {
    const dir = join(resRoot(project), ADAPTIVE_ICON_DIR);

    if (!(await pathExists(dir))) {
      await mkdirp(dir);
    }

    const files: XmlFile[] = [];

    for (const name of DESCRIPTOR_FILES) {
      const path = join(dir, name);

      // XmlFile.load() reads from disk, so the file has to exist before it can be opened.
      if (!(await pathExists(path))) {
        await writeFile(path, EMPTY);
      }

      files.push(
        await openXml(project, join(ADAPTIVE_ICON_DIR, name), 'adaptive-icon'),
      );
    }

    return new AdaptiveIconDescriptor(files);
  }

  /** Delete both descriptors. API 26+ then falls back to the legacy launcher PNGs. */
  static async remove(project: MobileProject): Promise<void> {
    for (const name of DESCRIPTOR_FILES) {
      const path = join(resRoot(project), ADAPTIVE_ICON_DIR, name);

      // Close it in the VFS first, or the next commit writes the in-memory copy back to disk.
      const open = project.vfs.get(path);
      if (open) {
        project.vfs.close(open);
      }

      if (await pathExists(path)) {
        await unlink(path);
      }
    }
  }

  setLayer(layer: AdaptiveIconLayer, drawable: string): void {
    const fragment = `<${layer} android:drawable="${drawable}"/>`;

    for (const file of this.files) {
      const target = `adaptive-icon/${layer}`;

      if (file.find(target)?.length) {
        file.replaceFragment(target, fragment);
      } else {
        file.injectFragment('adaptive-icon', fragment);
      }
    }
  }
}

/** Absolute path to the project's `res` directory. */
export function resRoot(project: MobileProject): string {
  const root = project.android?.getResourcesRoot();

  if (!root) {
    throw new Error('No android project found');
  }

  return root;
}

/**
 * Open a resource XML file, failing if its root element isn't `expectedRoot`.
 *
 * `XmlFile.load()` never rejects. A parse failure is logged and leaves an empty document, and an
 * empty file parses as `<root />`. In both cases every xpath matches nothing, so edits are
 * dropped while the caller is told the write succeeded. Checking the root turns that into an
 * error instead.
 */
export async function openXml(
  project: MobileProject,
  relativePath: string,
  expectedRoot: string,
): Promise<XmlFile> {
  const file = project.android?.getResourceXmlFile(relativePath);

  if (!file) {
    throw new Error(`No android project found; cannot open ${relativePath}`);
  }

  await file.load();

  const root = file.getDocumentElement()?.nodeName;

  if (root !== expectedRoot) {
    throw new Error(
      `${relativePath} is not a <${expectedRoot}> document (found ${root ? `<${root}>` : 'nothing parseable'})`,
    );
  }

  return file;
}
