import { useEffect, useState } from 'react';
import type { Suggestion } from '@pantry-pal/shared';
import { apiRequest } from '../services/apiClient';
import { db } from '../services/db';

interface Props {
  value: string;
  onSelect: (suggestion: string) => void;
}

export function ItemSuggestions({ value, onSelect }: Props) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!value.trim()) {
      setSuggestions([]);
      return;
    }

    const fetchSuggestions = async () => {
      setLoading(true);
      
      try {
        // First try to get suggestions from the local database
        const localSuggestions = await db.suggestions
          .where('nameKey')
          .startsWithIgnoreCase(value.toLowerCase())
          .limit(5)
          .toArray();
        
        if (localSuggestions.length > 0) {
          setSuggestions(localSuggestions);
        } else {
          // If no local suggestions, fetch from API
          const response = await apiRequest<{ suggestions: Suggestion[] }>('/api/suggestions');
          setSuggestions(response.suggestions.slice(0, 5));
        }
      } catch (error) {
        // If API call fails, try to get local suggestions anyway
        try {
          const localSuggestions = await db.suggestions
            .where('nameKey')
            .startsWithIgnoreCase(value.toLowerCase())
            .limit(5)
            .toArray();
          setSuggestions(localSuggestions);
        } catch {
          // If all else fails, show empty suggestions
          setSuggestions([]);
        }
      } finally {
        setLoading(false);
      }
    };

    const debounceTimer = setTimeout(fetchSuggestions, 200); // Debounce for better performance
    
    return () => clearTimeout(debounceTimer);
  }, [value]);

  if (!value.trim() || suggestions.length === 0) {
    return null;
  }

  return (
    <ul className="suggestions-dropdown" role="listbox">
      {suggestions.map((suggestion) => (
        <li
          key={suggestion.name}
          role="option"
          onClick={() => onSelect(suggestion.name)}
          className="suggestion-item"
        >
          {suggestion.name}
        </li>
      ))}
    </ul>
  );
}