import { useState, KeyboardEvent, ClipboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}

export default function TagInput({ tags, onChange, placeholder }: TagInputProps) {
  const { t } = useTranslation();
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
      <div className="flex flex-wrap gap-2 p-2 border border-gray-300 rounded-lg min-h-[42px]">
        {tags.map((tag, index) => (
          <span
            key={index}
            className="inline-flex items-center gap-1 px-2 py-1 bg-purple-100 text-purple-800 rounded text-sm"
          >
            {tag}
            <button
              type="button"
              onClick={() => removeTag(index)}
              className="text-purple-600 hover:text-purple-800 font-bold"
            >
              ×
            </button>
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
          className="flex-1 min-w-[120px] border-none outline-none text-sm"
          maxLength={50}
        />
      </div>
      <p className="text-xs text-gray-500">
        {t('tagInput.pressEnterToAdd')}
      </p>
    </div>
  );
}

