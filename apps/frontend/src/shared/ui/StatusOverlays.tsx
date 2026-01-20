export function SavingOverlay({ label }: { label: string }) {
  return (
    <div className="absolute inset-0 z-10 rounded-xl bg-white/75 dark:bg-gray-900/75 backdrop-blur-sm">
      <div className="absolute inset-0 rounded-xl ring-1 ring-black/5 dark:ring-white/10" />
      <div className="flex h-full w-full items-center justify-center p-4">
        <div className="flex items-center gap-3 rounded-xl bg-white/90 dark:bg-gray-900/90 px-4 py-3 shadow-xl ring-1 ring-black/5 dark:ring-white/10">
          <div className="h-4 w-4 rounded-full border-2 border-gray-300 dark:border-gray-600 border-t-primary animate-spin" aria-hidden="true" />
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{label}</div>
        </div>
      </div>
    </div>
  );
}

export function SavedOverlay({ label }: { label: string }) {
  return (
    <div className="absolute inset-0 z-10 rounded-xl bg-white/45 dark:bg-gray-900/45 backdrop-blur-sm">
      <div className="absolute inset-0 rounded-xl ring-1 ring-black/5 dark:ring-white/10" />
      <div className="flex h-full w-full items-center justify-center p-4">
        <div className="flex items-center gap-3 rounded-xl bg-white/85 dark:bg-gray-900/85 px-4 py-3 shadow-lg ring-1 ring-black/5 dark:ring-white/10">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-green-500/15 text-green-600 dark:text-green-300">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 6 9 17l-5-5" />
            </svg>
          </div>
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{label}</div>
        </div>
      </div>
    </div>
  );
}


