let counter = 0;

export function uniqueId(prefix = 'id'): string {
  counter += 1;
  return `${prefix}_${Date.now()}_${counter}`;
}
