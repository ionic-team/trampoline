import { readFile } from '@ionic/utils-fs';
import { mergeWith, union, isEmpty } from 'lodash';
import { PlistFile } from '../plist';

// Declared locally rather than re-exported from plist, which would put an
// import attribute in the emitted .d.ts that TypeScript <5.3 cannot parse.
export type PlistValue = string | number | boolean | Date | Uint8Array | PlistObject | PlistValue[];
export type PlistObject = { [key: string]: PlistValue };

export async function parsePlist(filename: string): Promise<PlistObject> {
  const contents = await readFile(filename, { encoding: 'utf-8' });

  return parsePlistString(contents);
}

/** Serializes in the format Xcode writes: tab indented, no offset, LF. */
export async function buildPlist(doc: PlistObject): Promise<string> {
  const { build } = await import('plist');

  return build(doc, {
    indent: '	', // Tab character
    offset: -1,
    newline: '\n'
  });
}

export async function parsePlistString(contents: string): Promise<PlistObject> {
  const { parse } = await import('plist');
  const parsed = parse(contents);
  // If the plist is empty an empty array will come back
  // which is not what we want
  if (isEmpty(parsed)) {
    return {};
  }

  return parsed as PlistObject;
}
