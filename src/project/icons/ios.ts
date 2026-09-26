import {
  copy,
  pathExists,
  readFile,
  remove,
  rmSync,
  stat,
  writeFile,
} from '@ionic/utils-fs';
import { join } from 'path';
import sharp from 'sharp';

import { assertParentDirs } from '../util/fs';
import type { MobileProject } from '../project';

export const IOS_APP_ICON_SET_NAME = 'AppIcon';
export const IOS_APP_ICON_SET_PATH = `App/Assets.xcassets/${IOS_APP_ICON_SET_NAME}.appiconset`;

/**
 * An Icon Composer bundle, installed beside the asset catalog. It shares the app icon set's name
 * on purpose: a target declares one `ASSETCATALOG_COMPILER_APPICON_NAME`, so only one of the two
 * may exist, and setting either clears the other.
 */
export const IOS_LAYERED_APP_ICON_PATH = `App/${IOS_APP_ICON_SET_NAME}.icon`;

/** The single entry an iOS app icon set needs; Xcode derives every other size from it. */
const APP_ICON = {
  name: 'AppIcon-512@2x.png',
  idiom: 'universal',
  size: 1024,
} as const;

const DEFAULT_BACKGROUND_COLOR = '#ffffff';

// `xcode` knows a handful of extensions and calls the rest `unknown`. A `.icon` labelled that way
// is copied in as an opaque directory and never reaches actool - no icon, and no build error.
const LAYERED_APP_ICON_FILE_TYPE = 'folder.iconcomposer.icon';

const APP_ICON_NAME_BUILD_SETTING = 'ASSETCATALOG_COMPILER_APPICON_NAME';

/**
 * Set the app icon from one source image, written as an app icon set.
 *
 * The flat tier. Clears any layered app icon.
 *
 * @param source path to the app icon
 * @param backgroundColor what transparency is flattened onto. The App Store rejects icons with
 *   an alpha channel, so this is baked into the pixels rather than kept as a separate layer.
 * @returns the files written
 */
export async function setAppIcon(
  source: string,
  project: MobileProject,
  backgroundColor = DEFAULT_BACKGROUND_COLOR,
): Promise<string[]> {
  const assetsPath = join(iosRoot(project), IOS_APP_ICON_SET_PATH);
  const dest = join(assetsPath, APP_ICON.name);

  await removeLayeredAppIcon(project);

  await assertParentDirs(dest);

  await sharp(source)
    .resize(APP_ICON.size, APP_ICON.size)
    .png()
    .flatten({ background: backgroundColor })
    .toFile(dest);

  await updateContentsJson(assetsPath);

  await commit(project);

  return [dest];
}

/**
 * Set the app icon from an Icon Composer `.icon` bundle.
 *
 * The layered tier, and the only way to express a dark or tinted appearance. The bundle is copied
 * in verbatim - nothing here writes `icon.json`. Clears the app icon set; actool back-deploys
 * flattened icons from the bundle, so older iOS stays covered. Needs Xcode 26+ to build.
 *
 * @param source path to the `.icon` bundle
 * @returns the installed bundle, which is one file to Xcode whatever it contains
 */
export async function setLayeredAppIcon(
  source: string,
  project: MobileProject,
): Promise<string[]> {
  await assertLayeredAppIconBundle(source);

  const dest = join(iosRoot(project), IOS_LAYERED_APP_ICON_PATH);

  // Removed first, not merged into: `copy` would leave a layer dropped since the last install
  // sitting in Assets/, still being compiled.
  await remove(dest);
  await copy(source, dest);

  await remove(join(iosRoot(project), IOS_APP_ICON_SET_PATH));

  await project.ios?.addResourceFile(
    IOS_LAYERED_APP_ICON_PATH,
    LAYERED_APP_ICON_FILE_TYPE,
  );

  await commit(project);

  return [dest];
}

/**
 * Delete the bundle and drop it from the project. Unregistering goes through the VFS, so - unlike
 * `clearAdaptiveIcon`, which only unlinks - the caller has to commit.
 */
async function removeLayeredAppIcon(project: MobileProject): Promise<void> {
  await project.ios?.removeResourceFile(
    IOS_LAYERED_APP_ICON_PATH,
    LAYERED_APP_ICON_FILE_TYPE,
  );

  await remove(join(iosRoot(project), IOS_LAYERED_APP_ICON_PATH));
}

/**
 * Prove we were handed a `.icon` bundle before anything is copied. Shallow - Icon Composer
 * authored it - but a wrong path otherwise installs cleanly and surfaces as an app with no icon.
 */
async function assertLayeredAppIconBundle(source: string): Promise<void> {
  if (!(await pathExists(source))) {
    throw new Error(`No .icon bundle at ${source}`);
  }

  if (!(await stat(source)).isDirectory()) {
    throw new Error(
      `${source} is not a .icon bundle; a .icon is a directory, not a file`,
    );
  }

  const manifest = join(source, 'icon.json');

  if (!(await pathExists(manifest))) {
    throw new Error(`${source} is not a .icon bundle; it has no icon.json`);
  }

  let parsed: any;

  try {
    parsed = JSON.parse(await readFile(manifest, { encoding: 'utf-8' }));
  } catch (e) {
    throw new Error(`${manifest} is not valid JSON: ${(e as Error).message}`);
  }

  if (!parsed?.groups || !parsed?.['supported-platforms']) {
    throw new Error(
      `${manifest} is missing "groups" or "supported-platforms"; Icon Composer requires both`,
    );
  }
}

/** Absolute path to the iOS project directory. */
function iosRoot(project: MobileProject): string {
  const root = project.config.ios?.path;

  if (!root) {
    throw new Error('No ios project found');
  }

  return root;
}

async function updateContentsJson(assetsPath: string): Promise<void> {
  const contentsJsonPath = join(assetsPath, 'Contents.json');

  // Setting a layered app icon deletes the set, so the template's copy may well be gone.
  const parsed = (await pathExists(contentsJsonPath))
    ? JSON.parse(await readFile(contentsJsonPath, { encoding: 'utf-8' }))
    : { images: [], info: { version: 1, author: 'xcode' } };

  // NOTE: this drops every other image the catalog listed, and deletes the files. Dark and tinted
  // variants would need to coexist here rather than be replaced - use `setLayeredAppIcon` for those.
  for (const image of parsed.images ?? []) {
    if (image.filename && image.filename !== APP_ICON.name) {
      rmSync(join(assetsPath, image.filename), { force: true });
    }
  }

  parsed.images = [
    {
      idiom: APP_ICON.idiom,
      size: `${APP_ICON.size}x${APP_ICON.size}`,
      filename: APP_ICON.name,
      platform: 'ios',
    },
  ];

  await writeFile(contentsJsonPath, JSON.stringify(parsed, null, 2));
}

/**
 * Point the target at the app icon and flush the project. Every public function ends here, so
 * each is self-contained and a caller never has to remember to commit.
 *
 * Usually a no-op - the Capacitor template already sets this - but not every project does.
 */
async function commit(project: MobileProject): Promise<void> {
  if (project.ios?.getAppTarget()) {
    project.ios.setBuildProperty(
      null,
      null,
      APP_ICON_NAME_BUILD_SETTING,
      IOS_APP_ICON_SET_NAME,
    );
  }

  await project.commit();
}
