export function parseQueryBool(value: unknown): boolean {
  const str = String(value ?? '')
    .trim()
    .toLowerCase();
  return str === '1' || str === 'true' || str === 'yes' || str === 'on';
}
