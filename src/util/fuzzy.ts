export type PathMatch = { path: string; hits: number[]; gaps: number; inName: boolean; namePrefix: boolean };

// a contiguous hit wins; otherwise match from the end so hits cluster in the file name, not the first directory
export function matchPath(query: string, path: string): PathMatch | null {
  const q = query.toLowerCase();
  const p = path.toLowerCase();
  const nameStart = p.lastIndexOf("/") + 1;
  let hits: number[] = [];
  const at = p.lastIndexOf(q);
  if (at >= 0) {
    hits = Array.from(q, (_, k) => at + k);
  } else {
    let i = p.length - 1;
    for (let j = q.length - 1; j >= 0; j--) {
      while (i >= 0 && p[i] !== q[j]) i--;
      if (i < 0) return null;
      hits.unshift(i--);
    }
  }
  let gaps = 0;
  for (let k = 1; k < hits.length; k++) if (hits[k] !== hits[k - 1]! + 1) gaps++;
  return { path, hits, gaps, inName: hits.length > 0 && hits[0]! >= nameStart, namePrefix: hits[0] === nameStart };
}

export function rankPaths(query: string, paths: string[], limit: number): PathMatch[] {
  if (!query) return paths.slice(0, limit).map((path) => ({ path, hits: [], gaps: 0, inName: false, namePrefix: false }));
  const found: PathMatch[] = [];
  for (const path of paths) {
    const m = matchPath(query, path);
    if (m) found.push(m);
  }
  found.sort((a, b) =>
    Number(b.inName) - Number(a.inName) ||
    a.gaps - b.gaps ||
    Number(b.namePrefix) - Number(a.namePrefix) ||
    a.path.length - b.path.length);
  return found.slice(0, limit);
}
