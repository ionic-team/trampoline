import { readFile, rmSync, writeFile } from '@ionic/utils-fs';
import { join } from 'path';
import sharp from 'sharp';

import type { MobileProject } from '../project';

export const IOS_APP_ICON_SET_NAME = 'AppIcon';
export const IOS_APP_ICON_SET_PATH = `App/Assets.xcassets/${IOS_APP_ICON_SET_NAME}.appiconset`;

/** The single entry an iOS app icon set needs; Xcode derives every other size from it. */
const APP_ICON = {
  name: 'AppIcon-512@2x.png',
  idiom: 'universal',
  size: 1024,
} as const;

const DEFAULT_BACKGROUND_COLOR = '#ffffff';

/**
 * Generate the app icon set from one source image.
 *
 * @param source path to the app icon
 * @param backgroundColor what transparency is flattened onto. The App Store rejects icons with
 *   an alpha channel, so this is baked into the pixels rather than kept as a separate layer.
 * @returns the files written
 */
export async function generateAppIcon(
  source: string,
  project: MobileProject,
  backgroundColor = DEFAULT_BACKGROUND_COLOR,
): Promise<string[]> {
  const iosDir = project.config.ios?.path;

  if (!iosDir) {
    throw new Error('No ios project found');
  }

  const assetsPath = join(iosDir, IOS_APP_ICON_SET_PATH);
  const dest = join(assetsPath, APP_ICON.name);

  await sharp(source)
    .resize(APP_ICON.size, APP_ICON.size)
    .png()
    .flatten({ background: backgroundColor })
    .toFile(dest);

  await updateContentsJson(assetsPath);

  return [dest];
}

async function updateContentsJson(assetsPath: string): Promise<void> {
  const contentsJsonPath = join(assetsPath, 'Contents.json');
  const parsed = JSON.parse(
    await readFile(contentsJsonPath, { encoding: 'utf-8' }),
  );

  // NOTE: this drops every other image the catalog listed, and deletes the files. That is
  // existing behaviour, and it is what a `.icon` bundle or a dark/tinted appearance variant will
  // collide with - both need entries to coexist here rather than be replaced.
  for (const image of parsed.images ?? []) {
    if (image.filename && image.filename !== APP_ICON.name) {
      rmSync(join(assetsPath, image.filename));
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
