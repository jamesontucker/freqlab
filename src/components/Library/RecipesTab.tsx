import { useState, useMemo, useCallback } from 'react';
import type { LibraryAlgorithm } from '../../types';

interface RecipesTabProps {
  recipes: LibraryAlgorithm[];  // Backend still uses "algorithms" type
  searchQuery: string;
  // Note: content is not included - we use reference-based attachments
  onAttach?: (item: { type: 'skill' | 'algorithm'; id: string; name: string }) => void;
}

export function RecipesTab({ recipes, searchQuery, onAttach }: RecipesTabProps) {
  const [selectedCategory, setSelectedCategory] = useState<string | 'all'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Get unique categories from recipes
  const categories = useMemo(() => {
    const cats = new Set(recipes.map((r) => r.category));
    return Array.from(cats).sort();
  }, [recipes]);

  // Filter recipes (includes tag search)
  const filteredRecipes = useMemo(() => {
    return recipes.filter((recipe) => {
      const matchesCategory = selectedCategory === 'all' || recipe.category === selectedCategory;
      const query = searchQuery.toLowerCase();
      const matchesName = recipe.name.toLowerCase().includes(query);
      const matchesDescription = recipe.description.toLowerCase().includes(query);
      const matchesTags = recipe.tags?.some((tag) => tag.toLowerCase().includes(query)) ?? false;
      const matchesContent = recipe.content.toLowerCase().includes(query);
      const matchesCategoryName = recipe.category.toLowerCase().includes(query);
      const matchesSearch = matchesName || matchesDescription || matchesTags || matchesContent || matchesCategoryName;
      return matchesCategory && matchesSearch;
    });
  }, [recipes, selectedCategory, searchQuery]);

  // Group by category when showing all
  const groupedRecipes = useMemo(() => {
    if (selectedCategory !== 'all') {
      return { [selectedCategory]: filteredRecipes };
    }
    return filteredRecipes.reduce((acc, recipe) => {
      const cat = recipe.category;
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(recipe);
      return acc;
    }, {} as Record<string, LibraryAlgorithm[]>);
  }, [filteredRecipes, selectedCategory]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  const copyToClipboard = useCallback(async (recipe: LibraryAlgorithm) => {
    try {
      await navigator.clipboard.writeText(recipe.content);
      setCopiedId(recipe.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, []);

  const handleAttach = useCallback((recipe: LibraryAlgorithm) => {
    onAttach?.({
      type: 'algorithm',  // Backend type unchanged
      id: recipe.id,
      name: recipe.name,
    });
  }, [onAttach]);

  if (recipes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-text-secondary">
        <svg className="w-12 h-12 mb-4 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
        </svg>
        <p>No recipes available yet</p>
        <p className="text-sm mt-1">Recipes will be added in a future update</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Category filter */}
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSelectedCategory('all')}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
              selectedCategory === 'all'
                ? 'bg-accent text-white'
                : 'bg-bg-tertiary text-text-secondary hover:text-text-primary'
            }`}
          >
            All ({recipes.length})
          </button>
          {categories.map((cat) => {
            const count = recipes.filter((r) => r.category === cat).length;
            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors capitalize ${
                  selectedCategory === cat
                    ? 'bg-accent text-white'
                    : 'bg-bg-tertiary text-text-secondary hover:text-text-primary'
                }`}
              >
                {cat} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* Recipes list */}
      {filteredRecipes.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-text-secondary">
          <p>No recipes match your search</p>
          {searchQuery && <p className="text-sm mt-1">Try a different search term</p>}
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(groupedRecipes).map(([category, categoryRecipes]) => (
            <div key={category}>
              {selectedCategory === 'all' && (
                <h3 className="text-sm font-medium text-text-secondary mb-2 capitalize">
                  {category}
                </h3>
              )}
              <div className="space-y-2">
                {categoryRecipes.map((recipe) => (
                  <RecipeCard
                    key={`recipe-${recipe.id}`}
                    recipe={recipe}
                    isExpanded={expandedId === `recipe-${recipe.id}`}
                    isCopied={copiedId === recipe.id}
                    onToggle={() => toggleExpand(`recipe-${recipe.id}`)}
                    onCopy={() => copyToClipboard(recipe)}
                    onAttach={onAttach ? () => handleAttach(recipe) : undefined}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Extracted card component to prevent unnecessary re-renders
interface RecipeCardProps {
  recipe: LibraryAlgorithm;
  isExpanded: boolean;
  isCopied: boolean;
  onToggle: () => void;
  onCopy: () => void;
  onAttach?: () => void;
}

function RecipeCard({ recipe, isExpanded, isCopied, onToggle, onCopy, onAttach }: RecipeCardProps) {
  return (
    <div className="border border-border rounded-lg overflow-hidden bg-bg-tertiary/50">
      {/* Header */}
      <div className="flex items-center justify-between p-3">
        <button onClick={onToggle} className="flex-1 flex items-center gap-3 text-left min-w-0">
          <div className="min-w-0">
            <h4 className="font-medium text-text-primary">{recipe.name}</h4>
            <p className="text-sm text-text-tertiary line-clamp-1">{recipe.description}</p>
            {/* Tags */}
            {recipe.tags && recipe.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {recipe.tags.slice(0, 4).map((tag) => (
                  <span key={tag} className="text-xs px-1.5 py-0.5 rounded bg-bg-primary text-text-muted">
                    {tag}
                  </span>
                ))}
                {recipe.tags.length > 4 && (
                  <span className="text-xs text-text-muted">+{recipe.tags.length - 4}</span>
                )}
              </div>
            )}
          </div>
        </button>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs px-2 py-1 rounded-full bg-purple-500/10 text-purple-400 capitalize">
            {recipe.category}
          </span>
          {recipe.source && (
            <span
              className={`text-xs px-2 py-1 rounded-full ${
                recipe.source === 'core'
                  ? 'bg-blue-500/10 text-blue-400'
                  : 'bg-green-500/10 text-green-400'
              }`}
            >
              {recipe.source}
            </span>
          )}
          <button onClick={onToggle} className="p-1 text-text-tertiary hover:text-text-primary">
            <svg
              className={`w-5 h-5 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-border">
          {/* Content preview */}
          <div className="p-3 bg-bg-primary/50 max-h-64 overflow-y-auto">
            <pre className="text-sm text-text-secondary whitespace-pre-wrap font-mono">
              {recipe.content.slice(0, 1500)}
              {recipe.content.length > 1500 && '...'}
            </pre>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 p-3 border-t border-border">
            <button
              onClick={onCopy}
              className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-bg-tertiary text-text-secondary hover:text-text-primary transition-colors"
            >
              {isCopied ? (
                <>
                  <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  Copied!
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Copy
                </>
              )}
            </button>
            {onAttach && (
              <button
                onClick={onAttach}
                className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-accent text-white hover:bg-accent/90 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </svg>
                Attach to Chat
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
