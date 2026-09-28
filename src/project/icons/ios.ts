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
 * An Icon Composer bundle, installed beside the asset catalog. It deliberately shares the app
 * icon set's name, because a target declares a single `ASSETCATALOG_COMPILER_APPICON_NAME`. Only
 * one of the two can exist, so setting either one clears the other.
 */
export const IOS_LAYERED_APP_ICON_PATH = `App/${IOS_APP_ICON_SET_NAME}.icon`;

/** The single entry an iOS app icon set needs; Xcode derives every other size from it. */
const APP_ICON = {
  name: 'AppIcon-512@2x.png',
  idiom: 'universal',
  size: 1024,
} as const;

const DEFAULT_BACKGROUND_COLOR = '#ffffff';

// `xcode` only recognizes a handful of extensions and types the rest as `unknown`. A `.icon`
// typed that way is copied in as an opaque directory and never reaches actool, giving no icon
// and no build error.
const LAYERED_APP_ICON_FILE_TYPE = 'folder.iconcomposer.icon';

const APP_ICON_NAME_BUILD_SETTING = 'ASSETCATALOG_COMPILER_APPICON_NAME';

/**
 * Set the app icon from a single source image, written as an app icon set. Clears any layered
 * app icon.
 *
 * @param source path to the app icon
 * @param backgroundColor the color transparency is flattened onto. The App Store rejects icons
 *   with an alpha channel, so this is baked into the pixels instead of kept as a separate layer.
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
 * Set the app icon from an Icon Composer `.icon` bundle, the only way to provide a dark or
 * tinted appearance. The bundle is copied in verbatim; nothing here writes `icon.json`.
 *
 * Clears the app icon set. actool back-deploys flattened icons from the bundle, so older iOS
 * versions stay covered, but building needs Xcode 26+.
 *
 * @param source path to the `.icon` bundle
 * @returns the installed bundle, which Xcode treats as a single file
 */
export async function setLayeredAppIcon(
  source: string,
  project: MobileProject,
): Promise<string[]> {
  await assertLayeredAppIconBundle(source);

  const dest = join(iosRoot(project), IOS_LAYERED_APP_ICON_PATH);

  // Remove first rather than copying over the top, or a layer dropped since the last install
  // would be left behind in Assets/ and still compiled.
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
 * Delete the bundle and remove it from the Xcode project. Unregistering goes through the VFS, so
 * the caller has to commit afterwards. `clearAdaptiveIcon` only unlinks and needs no commit.
 */
async function removeLayeredAppIcon(project: MobileProject): Promise<void> {
  await project.ios?.removeResourceFile(
    IOS_LAYERED_APP_ICON_PATH,
    LAYERED_APP_ICON_FILE_TYPE,
  );

  await remove(join(iosRoot(project), IOS_LAYERED_APP_ICON_PATH));
}

/**
 * Check the source really is a `.icon` bundle before anything is copied. The check is shallow,
 * since Icon Composer authors these. Without it, a wrong path installs cleanly and only shows up
 * later as an app with no icon.
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

  // Setting a layered app icon deletes the set, so the template's copy may be gone.
  const parsed = (await pathExists(contentsJsonPath))
    ? JSON.parse(await readFile(contentsJsonPath, { encoding: 'utf-8' }))
    : { images: [], info: { version: 1, author: 'xcode' } };

  // NOTE: this drops every other image the catalog listed and deletes the files. Dark and tinted
  // variants would have to coexist here rather than replace each other, so for those use
  // `setLayeredAppIcon`.
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
 * Point the target at the app icon and flush the project. Every exported function ends here, so
 * callers never have to commit themselves.
 *
 * Setting the build property is usually a no-op, since the Capacitor template already sets it,
 * but not every project does.
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
