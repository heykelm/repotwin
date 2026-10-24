import fs from 'node:fs';

interface PackageMetadata {
  version?: unknown;
}

function readVersion(): string {
  const metadata = JSON.parse(
    fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')
  ) as PackageMetadata;

  if (typeof metadata.version !== 'string' || metadata.version.trim() === '') {
    throw new Error('RepoTwin package version is missing or invalid');
  }

  return metadata.version;
}

export const REPOTWIN_VERSION = readVersion();
