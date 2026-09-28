const norm = (code: string) => code.toUpperCase().replace(/-/g, '_');

// Position codes are free text; compare ignoring '-' vs '_' (CO-CSO / CO_CSO).
export function positionMatches(code: string | null | undefined, wanted: string): boolean {
  return !!code && norm(code) === norm(wanted);
}
