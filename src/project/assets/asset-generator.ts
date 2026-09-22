import type { InputAsset } from './input-asset';
import type { OutputAsset } from './output-asset';
import type { MobileProject } from '../project';

export abstract class AssetGenerator {
  constructor(public options: AssetGeneratorOptions) {}

  abstract generate(asset: InputAsset, project: MobileProject): Promise<OutputAsset[]>;
}

export interface AssetGeneratorOptions {
  // Background color for icon generation
  iconBackgroundColor?: string;
  // Background color for icon generation for use in dark mode scenarios
  iconBackgroundColorDark?: string;
  // Android product flavor name where generated assets will be created. Default: main
  androidFlavor?: string;
}
