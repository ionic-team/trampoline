import { mkdirp, pathExists, unlink, writeFile } from '@ionic/utils-fs';
import { join } from 'path';

import type { XmlFile } from '../xml';
import type { MobileProject } from '../project';

/** The three layers an `<adaptive-icon>` can declare. All are optional to Android. */
export type AdaptiveIconLayer = 'foreground' | 'background' | 'monochrome';

const ADAPTIVE_ICON_DIR = 'mipmap-anydpi-v26';

// Written identically. android:roundIcon is only read on API 25, below the adaptive icon's own
// API 26 floor, but the template ships both and a stale round icon is worse than a redundant one.
const DESCRIPTOR_FILES = ['ic_launcher.xml', 'ic_launcher_round.xml'];

const EMPTY = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"/>
`;

/**
 * The project's `mipmap-anydpi-v26/ic_launcher.xml` pair, as a document rather than a string.
 *
 * Every write replaces one whole element and leaves the rest alone, which cuts both ways: a layer
 * someone else added survives, and 0.5.0's `<background><inset android:inset="16.7%"/></background>`
 * is normalised away rather than having its drawable swapped inside a wrapper that keeps shrinking it.
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

      // XmlFile.load() reads from disk, so the file has to exist before it is opened.
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

      // Drop it from the VFS first, or the next commit writes the in-memory copy straight back.
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
 * Open a resource XML file and prove it is the document we think it is.
 *
 * `XmlFile.load()` never rejects - a parse failure logs and leaves an empty document, and an
 * empty file becomes `<root />`. Either way every xpath matches nothing and edits are dropped
 * while the caller is told the write succeeded. Checking the root turns that into one failure.
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
