import { useTranslation } from 'react-i18next';
import { nameKey } from '@pantry-pal/shared';
import type { Suggestion } from '@pantry-pal/shared';

interface Props {
  id: string;
  suggestions: readonly Suggestion[];
  /** Index of the option the input's `aria-activedescendant` points at, or -1. */
  activeIndex: number;
  optionId: (index: number) => string;
  onChoose: (name: string) => void;
}

/** The listbox of a combobox; the input keeps focus and drives it. */
export function ItemSuggestions({
  id,
  suggestions,
  activeIndex,
  optionId,
  onChoose,
}: Props) {
  const { t } = useTranslation();
  return (
    <ul
      id={id}
      role="listbox"
      aria-label={t('items.suggestions.label')}
      className="suggestions"
    >
      {suggestions.map((suggestion, index) => (
        <li
          key={nameKey(suggestion.name)}
          id={optionId(index)}
          role="option"
          aria-selected={index === activeIndex}
          className="suggestions__option"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onChoose(suggestion.name)}
        >
          {suggestion.name}
        </li>
      ))}
    </ul>
  );
}
