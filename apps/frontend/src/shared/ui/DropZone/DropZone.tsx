import { useCallback, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';

import { cn } from '@/shared/lib/cn';

type DropZoneProps = {
  onFilesDropped: (files: File[]) => void;
  accept?: string;
  maxFiles?: number;
  maxSize?: number;
  disabled?: boolean;
  children?: ReactNode;
  className?: string;
  ariaLabel?: string;
};

export function DropZone({
  onFilesDropped,
  accept = 'video/*',
  maxFiles = 20,
  maxSize = 50 * 1024 * 1024,
  disabled = false,
  children,
  className,
  ariaLabel,
}: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleFiles = useCallback(
    (list: FileList | null) => {
      if (disabled || !list) return;
      const files = Array.from(list);
      if (files.length === 0) return;
      onFilesDropped(files);
    },
    [disabled, onFilesDropped],
  );

  const handleDragOver = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      if (!disabled) setIsDragging(true);
    },
    [disabled],
  );

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      handleFiles(e.dataTransfer?.files ?? null);
    },
    [handleFiles],
  );

  const handleClick = useCallback(() => {
    if (disabled) return;
    inputRef.current?.click();
  }, [disabled]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleClick();
      }
    },
    [disabled, handleClick],
  );

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || undefined}
      aria-label={ariaLabel}
      data-max-files={maxFiles}
      data-max-size={maxSize}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        'border-2 border-dashed rounded-2xl p-8 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        isDragging ? 'border-primary bg-primary/10' : 'border-gray-300 dark:border-gray-600',
        disabled && 'opacity-50 cursor-not-allowed',
        className,
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={maxFiles > 1}
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          handleFiles(e.currentTarget.files);
          e.currentTarget.value = '';
        }}
      />
      {children ?? null}
    </div>
  );
}
