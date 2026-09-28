import * as androidIcons from './android';
import * as iosIcons from './ios';

export type { LayerFit, AdaptiveIconLayer } from './android';

/**
 * Android launcher icons: the legacy bitmaps used below API 26, and the adaptive icon layers.
 * Each function writes its files, updates the manifest, and commits.
 */
export { androidIcons };

/**
 * iOS app icons: the flat app icon set, and the layered Icon Composer `.icon` bundle.
 * Each function writes its files, registers them with the Xcode project, and commits.
 */
export { iosIcons };
