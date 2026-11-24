export type PathMatch = { path: string; hits: number[]; gaps: number; inName: boolean; namePrefix: boolean };
export type PreparedPath = { path: string; lower: string };

export function preparePaths(paths: string[]): PreparedPath[] {
  return paths.map((path) => ({ path, lower: path.toLowerCase() }));
}

function matchLower(q: string, path: string, p: string): PathMatch | null {
  const nameStart = p.lastIndexOf("/") + 1;
  const hits: number[] = [];
  const at = p.lastIndexOf(q);
  if (at >= 0) {
    for (let k = 0; k < q.length; k++) hits.push(at + k);
  } else {
    let i = p.length - 1;
    for (let j = q.length - 1; j >= 0; j--) {
      const target = q[j]!;
      while (i >= 0 && p[i] !== target) i--;
      if (i < 0) return null;
      hits.push(i--);
    }
    hits.reverse();
  }
  let gaps = 0;
  for (let k = 1; k < hits.length; k++) if (hits[k] !== hits[k - 1]! + 1) gaps++;
  return { path, hits, gaps, inName: hits.length > 0 && hits[0]! >= nameStart, namePrefix: hits[0] === nameStart };
}

// a contiguous hit wins; otherwise match from the end so hits cluster in the file name, not the first directory
export function matchPath(query: string, path: string): PathMatch | null {
  return matchLower(query.toLowerCase(), path, path.toLowerCase());
}

export function rankPreparedPaths(query: string, entries: PreparedPath[], limit: number): PathMatch[] {
  if (!query) return entries.slice(0, limit).map(({ path }) => ({ path, hits: [], gaps: 0, inName: false, namePrefix: false }));
  const q = query.toLowerCase();
  const found: PathMatch[] = [];
  for (const entry of entries) {
    const m = matchLower(q, entry.path, entry.lower);
    if (m) found.push(m);
  }
  found.sort((a, b) =>
    Number(b.inName) - Number(a.inName) ||
    a.gaps - b.gaps ||
    Number(b.namePrefix) - Number(a.namePrefix) ||
    a.path.length - b.path.length);
  return found.slice(0, limit);
}

export function rankPaths(query: string, paths: string[], limit: number): PathMatch[] {
  if (!query) return paths.slice(0, limit).map((path) => ({ path, hits: [], gaps: 0, inName: false, namePrefix: false }));
  const q = query.toLowerCase();
  const found: PathMatch[] = [];
  for (const path of paths) {
    const m = matchLower(q, path, path.toLowerCase());
    if (m) found.push(m);
  }
  found.sort((a, b) =>
    Number(b.inName) - Number(a.inName) ||
    a.gaps - b.gaps ||
    Number(b.namePrefix) - Number(a.namePrefix) ||
    a.path.length - b.path.length);
  return found.slice(0, limit);
}
