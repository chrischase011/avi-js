import { describeApp, type AppDescription, type ModuleRef } from '@avi/core';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Serializes a description the same way every time, so manifests diff cleanly. */
export function serializeManifest(description: AppDescription): string {
  return `${JSON.stringify(description, null, 2)}\n`;
}

/**
 * Imports the compiled entry module, describes the exported root module and writes the
 * manifest. Importing runs the module's top-level code, but no provider is created.
 */
export async function writeManifest(options: {
  entry: string;
  exportName?: string;
  out: string;
}): Promise<AppDescription> {
  const exportName = options.exportName ?? 'AppModule';
  const loaded = (await import(pathToFileURL(path.resolve(options.entry)).href)) as Record<
    string,
    unknown
  >;
  const root = loaded[exportName];
  if (root === undefined) {
    throw new Error(`${options.entry} has no export named ${exportName}`);
  }
  const description = describeApp(root as ModuleRef);
  await writeFile(options.out, serializeManifest(description));
  return description;
}
