/// <reference lib="dom" />

import { readFile, writeFile } from '@ionic/utils-fs';
import xmldom, { XMLSerializer } from '@xmldom/xmldom';
import { format } from 'prettier';

export async function parseXml(filename: string) {
  let contents = await readFile(filename, { encoding: 'utf-8' });
  if (!contents) {
    contents = '<?xml version="1.0" encoding="utf-8" ?>\n<root />';
  }
  return new xmldom.DOMParser().parseFromString(contents);
}

export function parseXmlString(contents: string) {
  return new xmldom.DOMParser().parseFromString(contents);
}

export function serializeXml(doc: any) {
  return new XMLSerializer().serializeToString(doc);
}

export async function formatXml(doc: any) {
  const xml = new XMLSerializer().serializeToString(doc);

  const { default: prettierXml } = await import('@prettier/plugin-xml');

  const formatted = await format(xml, {
    parser: 'xml',
    printWidth: 120,
    bracketSameLine: true,
    xmlWhitespaceSensitivity: 'preserve',
    tabWidth: 4,
    plugins: [prettierXml],
  });

  return formatted;
}

export async function writeXml(doc: any, filename: string) {
  const formatted = await formatXml(doc);
  return writeFile(filename, formatted);
}
