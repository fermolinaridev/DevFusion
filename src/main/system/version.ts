export interface Version { major: number; minor: number; patch: number }

/** Extrai a primeira versão "X.Y[.Z]" de um texto (ex.: "git version 2.54.0 (Apple Git-157)"). */
export function parseVersion(text: string): Version | null {
  const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(text);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3] ?? 0) };
}

export function compareVersions(a: Version, b: Version): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}
