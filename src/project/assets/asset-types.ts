export enum AssetKind {
  Logo = 'logo',
  LogoDark = 'logo-dark',
  AdaptiveIcon = 'adaptive-icon',
  Icon = 'icon',
  IconForeground = 'icon-foreground',
  IconBackground = 'icon-background',
}

export enum Platform {
  Any = 'any',
  Ios = 'ios',
  Android = 'android'
}

export enum Format {
  Png = 'png',
  Jpeg = 'jpeg',
  Svg = 'svg',
  WebP = 'webp',
  Unknown = 'unknown',
}

export enum AndroidDensity {
  Default = '',
  Ldpi = 'ldpi',
  Mdpi = 'mdpi',
  Hdpi = 'hdpi',
  Xhdpi = 'xhdpi',
  Xxhdpi = 'xxhdpi',
  Xxxhdpi = 'xxxhdpi',
  LandLdpi = 'land-ldpi',
  LandMdpi = 'land-mdpi',
  LandHdpi = 'land-hdpi',
  LandXhdpi = 'land-xhdpi',
  LandXxhdpi = 'land-xxhdpi',
  LandXxxhdpi = 'land-xxxhdpi',
  PortLdpi = 'port-ldpi',
  PortMdpi = 'port-mdpi',
  PortHdpi = 'port-hdpi',
  PortXhdpi = 'port-xhdpi',
  PortXxhdpi = 'port-xxhdpi',
  PortXxxhdpi = 'port-xxxhdpi',
  DefaultNight = 'night',
  LdpiNight = 'night-ldpi',
  MdpiNight = 'night-mdpi',
  HdpiNight = 'night-hdpi',
  XhdpiNight = 'night-xhdpi',
  XxhdpiNight = 'night-xxhdpi',
  XxxhdpiNight = 'night-xxxhdpi',
  LandLdpiNight = 'land-night-ldpi',
  LandMdpiNight = 'land-night-mdpi',
  LandHdpiNight = 'land-night-hdpi',
  LandXhdpiNight = 'land-night-xhdpi',
  LandXxhdpiNight = 'land-night-xxhdpi',
  LandXxxhdpiNight = 'land-night-xxxhdpi',
  PortLdpiNight = 'port-night-ldpi',
  PortMdpiNight = 'port-night-mdpi',
  PortHdpiNight = 'port-night-hdpi',
  PortXhdpiNight = 'port-night-xhdpi',
  PortXxhdpiNight = 'port-night-xxhdpi',
  PortXxxhdpiNight = 'port-night-xxxhdpi',
}

export interface OutputAssetTemplate {
  platform: Platform;
  kind: AssetKind;
  format: Format;
  width: number;
  height: number;
  scale?: number;
}

export interface IosOutputAssetTemplate extends OutputAssetTemplate {
  name: string;
  idiom: IosIdiom;
}

// https://developer.apple.com/library/archive/documentation/Xcode/Reference/xcode_ref-Asset_Catalog_Format/ImageSetType.html#//apple_ref/doc/uid/TP40015170-CH25-SW2
export enum IosIdiom {
  Universal = 'universal',
  iPhone = 'iphone',
  iPad = 'ipad',
  Watch = 'watch',
  TV = 'tv',
}

export interface AndroidOutputAssetTemplate extends OutputAssetTemplate {
  density: AndroidDensity;
}
export interface AndroidOutputAssetTemplateAdaptiveIcon extends OutputAssetTemplate {
  density: AndroidDensity;
}
