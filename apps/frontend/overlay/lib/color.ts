export function isHexColor(v: string): boolean {
  return /^#([0-9a-fA-F]{6})$/.test(v);
}


