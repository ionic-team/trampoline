import { pathExists, unlink, writeFile } from '@ionic/utils-fs';

import { assertParentDirs } from '../util/fs';
import { join } from 'path';
import sharp from 'sharp';

import type { AdaptiveIconLayer } from './adaptive-icon';
import { AdaptiveIconDescriptor, openXml, resRoot } from './adaptive-icon';
import type { MobileProject } from '../project';

export type { AdaptiveIconLayer };

/**
 * How a source image is fitted onto the 108dp layer canvas.
 *
 * - `as-is`: an authored 108dp layer that already carries its own padding.
 * - `viewport`: full-bleed artwork, scaled down to the area the mask can show.
 *
 * `viewport` doesn't use Google's 66dp safe zone. That zone sizes a bare mark to survive a
 * circular mask, and on full-bleed artwork it leaves a ring of background showing.
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

// The 108dp layer canvas at each density. No ldpi, since the template ships no such folder.
const ADAPTIVE_LAYER_SIZES = {
  mdpi: 108,
  hdpi: 162,
  xhdpi: 216,
  xxhdpi: 324,
  xxxhdpi: 432,
} as const;

/**
 * The mask draws the central 72dp of the 108dp canvas but can expose up to 74.25dp, so artwork
 * is scaled to bleed a little past that, to 76dp.
 */
const VIEWPORT_SCALE = 76 / 108;

// sharp defaults to `cover`, which center-crops anything that isn't already square and cuts the
// ends off a wordmark. Fit inside instead.
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
 * Generate `mipmap-<density>/ic_launcher.png` and `ic_launcher_round.png`.
 *
 * These are only read below API 26, and they aren't interchangeable with the adaptive icon, so
 * a caller setting adaptive layers needs them as well.
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
 * Only read when the user enables themed icons (API 33+). The system tints it, so only the
 * image's alpha channel has any effect, not its colors.
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
 * @param color a hex color, e.g. `#FF5733`. Written verbatim and not validated here.
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
 * Remove both descriptors and the layer images at each density this module writes. Layer images
 * left in other density buckets by older versions, and the background color resource, are left
 * alone.
 *
 * The descriptors are deleted rather than emptied, since an `<adaptive-icon>` with no children is
 * valid and renders nothing, while a missing one falls back to the legacy PNGs.
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

  // resize and extend need separate pipelines, per
  // https://github.com/lovell/sharp/issues/2378#issuecomment-864132578
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

  // Pre-adaptive launchers drew these bitmaps unmasked, so the margin has to be baked into the
  // image. size / 12 keeps it at the template's ~83% artwork at every density.
  const padding = Math.round(size / 12);

  // resize and extend need separate pipelines, per
  // https://github.com/lovell/sharp/issues/2378#issuecomment-864132578
  // Every intermediate is encoded as PNG. Without that the buffer keeps the source's format, and
  // a JPEG has no alpha channel for the letterbox padding, which then comes out black.
  const resized = await sharp(source)
    .resize(size, size, CONTAIN)
    .png()
    .toBuffer();
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
    .png()
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

  // Encoded as PNG for the same reason as the legacy icon above, and it matters more here.
  // `dest-in` composites the circle into the alpha channel, so without one the mask does nothing
  // and the icon stays square.
  const resized = await sharp(source)
    .resize(size, size, CONTAIN)
    .png()
    .toBuffer();
  const masked = await sharp(resized)
    .composite([{ input: Buffer.from(circle), blend: 'dest-in' }])
    .png()
    .toBuffer();

  await sharp(masked).png().toFile(dest);

  return dest;
}

/**
 * Point `@color/ic_launcher_background` at a color, creating the file if needed.
 *
 * This is the only path that writes an `@color` reference into the descriptor, and it always
 * writes the color node too, so the descriptor can't end up referencing a color that doesn't
 * exist. aapt2 fails the build on that.
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

  // The template ships this file and it may hold other colors, so replace just the one node.
  const file = await openXml(project, BACKGROUND_COLOR_FILE, 'resources');
  const target = `resources/color[@name='${BACKGROUND_COLOR_RESOURCE}']`;

  if (file.find(target)?.length) {
    file.replaceFragment(target, fragment);
  } else {
    file.injectFragment('resources', fragment);
  }
}

/**
 * Point the manifest at the launcher icons and flush the project. Every exported function ends
 * here, so callers never have to commit themselves.
 */
async function commit(project: MobileProject): Promise<void> {
  project.android?.getAndroidManifest()?.setAttrs('manifest/application', {
    'android:icon': '@mipmap/ic_launcher',
    'android:roundIcon': '@mipmap/ic_launcher_round',
  });

  await project.commit();
}
