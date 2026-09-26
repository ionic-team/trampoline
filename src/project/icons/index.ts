import * as androidIcons from './android';
import * as iosIcons from './ios';

export type { LayerFit, AdaptiveIconLayer } from './android';

/**
 * Android launcher icons: the legacy bitmaps for pre-API-26, and the layered adaptive icon.
 * Every function writes its files, points the manifest at them, and commits.
 */
export { androidIcons };

/**
 * iOS app icons: the flat app icon set, and the layered Icon Composer `.icon` bundle.
 * Every function writes its files, registers them with the Xcode project, and commits.
 */
export { iosIcons };
