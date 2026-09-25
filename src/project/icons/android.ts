import { pathExists, unlink, writeFile } from '@ionic/utils-fs';

import { assertParentDirs } from '../util/fs';
import { join } from 'path';
import sharp from 'sharp';

import type { AdaptiveIconLayer } from './adaptive-icon';
import { AdaptiveIconDescriptor, openXml, resRoot } from './adaptive-icon';
import type { MobileProject } from '../project';

export type { AdaptiveIconLayer };

/**
 * - `as-is`     an authored 108dp layer, already carrying its own padding.
 * - `viewport`  full-bleed artwork that *is* the whole icon, scaled into the visible 72dp.
 *
 * Not Google's 66dp safe zone: that is the rule for a bare mark surviving a circular mask, and
 * on full-bleed artwork it leaves a ring of background showing.
 * https://developer.android.com/develop/ui/views/launch/icon_design_adaptive
 */
export type LayerFit = 'as-is' | 'viewport';

const LEGACY_ICON_SIZES = {
  ldpi: 36,
  mdpi: 48,
  hdpi: 72,
  xhdpi: 96,
  xxhdpi: 144,
  xxxhdpi: 192,
} as const;

// The 108dp layer canvas per density. No ldpi: the template ships no such folder and Android
// has not meaningfully targeted that bucket in a decade.
const ADAPTIVE_LAYER_SIZES = {
  mdpi: 108,
  hdpi: 162,
  xhdpi: 216,
  xxhdpi: 324,
  xxxhdpi: 432,
} as const;

/**
 * The mask draws the central 72dp but can expose 74.25dp of it as black, so artwork bleeds to
 * 76dp.
 */
const VIEWPORT_SCALE = 76 / 108;

// sharp defaults to `cover`, which center-crops anything not already square - silently losing
// the ends of a wordmark. Fit inside instead.
const CONTAIN = {
  fit: 'contain',
  background: { r: 0, g: 0, b: 0, alpha: 0 },
} as const;

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 } as const;

const LAYER_DRAWABLE: Record<AdaptiveIconLayer, string> = {
  foreground: 'ic_launcher_foreground',
  background: 'ic_launcher_background',
  monochrome: 'ic_launcher_monochrome',
};

const BACKGROUND_COLOR_RESOURCE = 'ic_launcher_background';
const BACKGROUND_COLOR_FILE = join('values', 'ic_launcher_background.xml');

const mipmap = (project: MobileProject, density: string, file: string) =>
  join(resRoot(project), `mipmap-${density}`, file);

/**
 * Generate mipmap-<density>/ic_launcher.png and ic_launcher_round.png.
 *
 * The pre-adaptive tier only, never read on API 26+. Neither tier substitutes for the other, so
 * a caller setting adaptive layers by hand needs these too.
 */
export async function generateLegacyIcons(
  source: string,
  project: MobileProject,
): Promise<string[]> {
  const written = await Promise.all(
    Object.entries(LEGACY_ICON_SIZES).flatMap(([density, size]) => [
      writeLegacyIcon(source, project, density, size),
      writeLegacyRoundIcon(source, project, density, size),
    ]),
  );

  await commit(project);

  return written;
}

/** Point the adaptive icon's foreground at an image. */
export async function setAdaptiveIconForeground(
  source: string,
  project: MobileProject,
  fit: LayerFit = 'as-is',
): Promise<string[]> {
  return setImageLayer('foreground', source, project, fit);
}

/** Point the adaptive icon's background at an image, replacing any background color. */
export async function setAdaptiveIconBackground(
  source: string,
  project: MobileProject,
  fit: LayerFit = 'as-is',
): Promise<string[]> {
  return setImageLayer('background', source, project, fit);
}

/**
 * Point the adaptive icon's monochrome layer at an image.
 *
 * Read only when the user enables themed icons (API 33+), and tinted by the system - so only the
 * alpha silhouette survives, not the image's colors.
 */
export async function setAdaptiveIconMonochrome(
  source: string,
  project: MobileProject,
  fit: LayerFit = 'as-is',
): Promise<string[]> {
  return setImageLayer('monochrome', source, project, fit);
}

/**
 * Make the adaptive icon's background a solid color, replacing any background image.
 *
 * @param color a hex color, e.g. `#FF5733`. Written verbatim; Android decides if it is valid.
 */
export async function setAdaptiveIconBackgroundColor(
  color: string,
  project: MobileProject,
): Promise<void> {
  await writeBackgroundColor(project, color);

  const descriptor = await AdaptiveIconDescriptor.open(project);
  descriptor.setLayer('background', `@color/${BACKGROUND_COLOR_RESOURCE}`);

  await commit(project);
}

/**
 * Remove both descriptors and the layer images at every density written here. Layers left in
 * other buckets by older versions are not swept, and the color resource is left to the template.
 *
 * Deleted rather than emptied: a childless `<adaptive-icon>` is valid and renders nothing, where
 * a missing one falls back to the legacy PNGs.
 */
export async function clearAdaptiveIcon(project: MobileProject): Promise<void> {
  await AdaptiveIconDescriptor.remove(project);

  await Promise.all(
    Object.keys(ADAPTIVE_LAYER_SIZES).flatMap(density =>
      Object.values(LAYER_DRAWABLE).map(async drawable => {
        const path = mipmap(project, density, `${drawable}.png`);

        if (await pathExists(path)) {
          await unlink(path);
        }
      }),
    ),
  );
}

async function setImageLayer(
  layer: AdaptiveIconLayer,
  source: string,
  project: MobileProject,
  fit: LayerFit,
): Promise<string[]> {
  const drawable = LAYER_DRAWABLE[layer];

  const written = await Promise.all(
    Object.entries(ADAPTIVE_LAYER_SIZES).map(async ([density, size]) => {
      const dest = mipmap(project, density, `${drawable}.png`);
      await assertParentDirs(dest);
      await writeLayerImage(source, size, fit, dest);

      return dest;
    }),
  );

  const descriptor = await AdaptiveIconDescriptor.open(project);
  descriptor.setLayer(layer, `@mipmap/${drawable}`);

  await commit(project);

  return written;
}

async function writeLayerImage(
  source: string,
  size: number,
  fit: LayerFit,
  dest: string,
): Promise<void> {
  if (fit === 'as-is') {
    await sharp(source).resize(size, size, CONTAIN).png().toFile(dest);
    return;
  }

  const inner = Math.round(size * VIEWPORT_SCALE);
  const before = Math.floor((size - inner) / 2);
  const after = size - inner - before;

  // Two separate pipelines, per https://github.com/lovell/sharp/issues/2378#issuecomment-864132578
  const resized = await sharp(source)
    .resize(inner, inner, CONTAIN)
    .png()
    .toBuffer();

  await sharp(resized)
    .extend({
      top: before,
      bottom: after,
      left: before,
      right: after,
      background: TRANSPARENT,
    })
    .png()
    .toFile(dest);
}

async function writeLegacyIcon(
  source: string,
  project: MobileProject,
  density: string,
  size: number,
): Promise<string> {
  const dest = mipmap(project, density, 'ic_launcher.png');
  await assertParentDirs(dest);

  const padding = 8;

  // Two separate pipelines, per https://github.com/lovell/sharp/issues/2378#issuecomment-864132578
  const resized = await sharp(source).resize(size, size, CONTAIN).toBuffer();
  const padded = await sharp(resized)
    .resize(
      Math.max(0, size - padding * 2),
      Math.max(0, size - padding * 2),
      CONTAIN,
    )
    .extend({
      top: padding,
      bottom: padding,
      left: padding,
      right: padding,
      background: TRANSPARENT,
    })
    .toBuffer();

  await sharp(padded).png().toFile(dest);

  return dest;
}

async function writeLegacyRoundIcon(
  source: string,
  project: MobileProject,
  density: string,
  size: number,
): Promise<string> {
  const dest = mipmap(project, density, 'ic_launcher_round.png');
  await assertParentDirs(dest);

  const circle = `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${
    size / 2
  }" fill="#ffffff"/></svg>`;

  const resized = await sharp(source).resize(size, size, CONTAIN).toBuffer();
  const masked = await sharp(resized)
    .composite([{ input: Buffer.from(circle), blend: 'dest-in' }])
    .toBuffer();

  await sharp(masked).png().toFile(dest);

  return dest;
}

/**
 * Point @color/ic_launcher_background at a color, creating the file if needed.
 *
 * The only path that writes an @color reference into the descriptor, and it always writes the
 * node too - so the descriptor can never reference a color that is missing, which aapt2 fails
 * the build over.
 */
async function writeBackgroundColor(
  project: MobileProject,
  color: string,
): Promise<void> {
  const dest = join(resRoot(project), BACKGROUND_COLOR_FILE);
  const fragment = `<color name="${BACKGROUND_COLOR_RESOURCE}">${color}</color>`;

  if (!(await pathExists(dest))) {
    await assertParentDirs(dest);
    await writeFile(
      dest,
      `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    ${fragment}\n</resources>\n`,
    );
    return;
  }

  // The template ships this file and it may hold unrelated colors, so replace the single node
  // rather than overwriting the document.
  const file = await openXml(project, BACKGROUND_COLOR_FILE, 'resources');
  const target = `resources/color[@name='${BACKGROUND_COLOR_RESOURCE}']`;

  if (file.find(target)?.length) {
    file.replaceFragment(target, fragment);
  } else {
    file.injectFragment('resources', fragment);
  }
}

/**
 * Point the manifest at the launcher icons and flush the project. Every public function ends
 * here, so each is self-contained and a caller never has to remember to commit.
 */
async function commit(project: MobileProject): Promise<void> {
  project.android?.getAndroidManifest()?.setAttrs('manifest/application', {
    'android:icon': '@mipmap/ic_launcher',
    'android:roundIcon': '@mipmap/ic_launcher_round',
  });

  await project.commit();
}
