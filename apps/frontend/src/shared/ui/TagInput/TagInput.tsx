import { useId, useState, KeyboardEvent, ClipboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { HelpTooltip } from '@/shared/ui';

function XSmallIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}

export default function TagInput({ tags, onChange, placeholder }: TagInputProps) {
  const { t } = useTranslation();
  const hintId = useId();
  const [inputValue, setInputValue] = useState('');
  const defaultPlaceholder = placeholder || t('submit.addTags');

  const normalizeTag = (raw: string): string => raw.trim().toLowerCase();

  const addTags = (raw: string) => {
    // Tag is always one "word": split by comma/whitespace/newlines
    const parts = raw
      .split(/[,\s]+/g)
      .map(normalizeTag)
      .filter(Boolean);

    if (parts.length === 0) return;

    const next = [...tags];
    for (const p of parts) {
      if (p.length > 50) continue;
      if (!next.includes(p)) next.push(p);
    }
    if (next.length !== tags.length) onChange(next);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      e.preventDefault();
      // Don't add empty tag on space spam
      if (inputValue.trim()) {
        addTags(inputValue);
        setInputValue('');
      }
    } else if (e.key === 'Backspace' && inputValue === '' && tags.length > 0) {
      // Remove last tag if backspace is pressed on empty input
      removeTag(tags.length - 1);
    }
  };

  const removeTag = (index: number) => {
    onChange(tags.filter((_, i) => i !== index));
  };

  const handleBlur = () => {
    if (inputValue.trim()) {
      addTags(inputValue);
      setInputValue('');
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    // If user pastes multiple words, treat them as multiple tags.
    if (/[,\s]/.test(text)) {
      e.preventDefault();
      addTags(text);
      setInputValue('');
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 p-2 min-h-[44px] rounded-xl bg-white/60 dark:bg-white/10 shadow-sm ring-1 ring-black/5 dark:ring-white/10 focus-within:ring-2 focus-within:ring-primary/30 transition-[box-shadow,ring-color]">
        {tags.map((tag, index) => (
          <span
            key={index}
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-sm font-medium bg-primary/10 dark:bg-primary/20 text-primary ring-1 ring-primary/20"
          >
            {tag}
            {(() => {
              const btn = (
                <button
                  type="button"
                  onClick={() => removeTag(index)}
                  className="inline-flex items-center justify-center rounded-md p-0.5 text-primary/80 hover:text-primary hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                  aria-label={t('tagInput.removeTag', { defaultValue: 'Remove tag' })}
                >
                  <XSmallIcon />
                </button>
              );
              return <HelpTooltip content={t('tagInput.removeTag', { defaultValue: 'Remove tag' })}>{btn}</HelpTooltip>;
            })()}
          </span>
        ))}
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          onPaste={handlePaste}
          placeholder={tags.length === 0 ? defaultPlaceholder : ''}
          aria-label={t('tagInput.label', { defaultValue: 'Tags' })}
          aria-describedby={hintId}
          className="flex-1 min-w-[120px] bg-transparent border-none outline-none text-sm text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400"
          maxLength={50}
        />
      </div>
      <p id={hintId} className="text-xs text-gray-500">
        {t('tagInput.pressEnterToAdd')}
      </p>
    </div>
  );
}

