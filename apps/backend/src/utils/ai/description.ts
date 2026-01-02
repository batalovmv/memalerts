export function makeAutoDescription(args: { transcript?: string | null; labels?: string[] }): string | null {
  const t = String(args.transcript || '').trim();
  const lines = t
    .split(/[.!?]\s+/g)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3);

  const first = lines[0] ? lines[0].slice(0, 180) : '';
  const second = lines[1] ? lines[1].slice(0, 180) : '';

  const labelHint =
    Array.isArray(args.labels) && args.labels.length > 0
      ? args.labels
          .slice(0, 3)
          .map((l) => String(l).replace(/^text:/, ''))
          .filter(Boolean)
          .join(', ')
      : '';

  const parts = [first, second].filter(Boolean);
  if (parts.length === 0 && !labelHint) return null;
  const base = parts.length > 0 ? parts.join('. ') : 'Видео без распознанной речи.';
  return labelHint ? `${base}. Метки: ${labelHint}.` : base;
}


