type ClassValue =
  | string
  | number
  | null
  | undefined
  | boolean
  | Record<string, boolean | null | undefined>
  | ClassValue[];

function toClassName(out: string[], value: ClassValue): void {
  if (!value) return;

  if (typeof value === 'string' || typeof value === 'number') {
    out.push(String(value));
    return;
  }

  if (Array.isArray(value)) {
    for (const v of value) toClassName(out, v);
    return;
  }

  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (v) out.push(k);
    }
  }
}

/**
 * Tailwind/CSS-module friendly className composer.
 * Similar to `clsx`, but tiny and dependency-free.
 */
export function cn(...values: ClassValue[]): string {
  const out: string[] = [];
  for (const v of values) toClassName(out, v);
  return out.join(' ');
}


