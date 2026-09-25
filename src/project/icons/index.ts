import * as androidIcons from './android';
import * as iosIcons from './ios';

export type { LayerFit, AdaptiveIconLayer } from './android';

/**
 * Android launcher icons: the legacy bitmaps for pre-API-26, and the layered adaptive icon above
 * it. Every function writes its files, points the manifest at them, and commits.
 */
export { androidIcons };

/** iOS app icon set. */
export { iosIcons };
