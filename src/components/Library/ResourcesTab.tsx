import { useState, useMemo, useCallback } from 'react';
import type { LibraryResource } from '../../types';

interface ResourcesTabProps {
  resources: LibraryResource[];
  searchQuery: string;
}

export function ResourcesTab({ resources, searchQuery }: ResourcesTabProps) {
  const [selectedCategory, setSelectedCategory] = useState<string | 'all'>('all');
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

  // Get unique categories from resources
  const categories = useMemo(() => {
    const cats = new Set(resources.map((r) => r.category));
    return Array.from(cats).sort();
  }, [resources]);

  // Filter resources (includes tag search)
  const filteredResources = useMemo(() => {
    return resources.filter((resource) => {
      const matchesCategory = selectedCategory === 'all' || resource.category === selectedCategory;
      const query = searchQuery.toLowerCase();
      const matchesName = resource.name.toLowerCase().includes(query);
      const matchesDescription = resource.description.toLowerCase().includes(query);
      const matchesTags = resource.tags?.some((tag) => tag.toLowerCase().includes(query)) ?? false;
      const matchesCategoryName = resource.category.toLowerCase().includes(query);
      const matchesSearch = matchesName || matchesDescription || matchesTags || matchesCategoryName;
      return matchesCategory && matchesSearch;
    });
  }, [resources, selectedCategory, searchQuery]);

  // Group by category when showing all, sorted alphabetically
  const groupedResources = useMemo(() => {
    if (selectedCategory !== 'all') {
      // Sort items alphabetically by name
      const sorted = [...filteredResources].sort((a, b) => a.name.localeCompare(b.name));
      return { [selectedCategory]: sorted };
    }
    const grouped = filteredResources.reduce((acc, resource) => {
      const cat = resource.category;
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(resource);
      return acc;
    }, {} as Record<string, LibraryResource[]>);

    // Sort items within each category alphabetically
    for (const cat of Object.keys(grouped)) {
      grouped[cat].sort((a, b) => a.name.localeCompare(b.name));
    }

    return grouped;
  }, [filteredResources, selectedCategory]);

  // Get sorted category names for rendering
  const sortedCategoryNames = useMemo(() => {
    return Object.keys(groupedResources).sort((a, b) => a.localeCompare(b));
  }, [groupedResources]);

  const toggleCategoryCollapse = useCallback((category: string) => {
    setCollapsedCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }, []);

  const openUrl = useCallback((url: string) => {
    // Validate URL scheme to prevent XSS or malicious protocols
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        console.error('Blocked attempt to open non-http(s) URL:', url);
        return;
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      console.error('Invalid URL:', url);
    }
  }, []);

  if (resources.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-text-secondary">
        <svg className="w-12 h-12 mb-4 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
        </svg>
        <p>No resources available yet</p>
        <p className="text-sm mt-1">External resources will be added soon</p>
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
            All ({resources.length})
          </button>
          {categories.map((cat) => {
            const count = resources.filter((r) => r.category === cat).length;
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

      {/* Resources list */}
      {filteredResources.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-text-secondary">
          <p>No resources match your search</p>
          {searchQuery && <p className="text-sm mt-1">Try a different search term</p>}
        </div>
      ) : (
        <div className="space-y-4">
          {sortedCategoryNames.map((category) => {
            const categoryResources = groupedResources[category];
            const isCollapsed = collapsedCategories.has(category);

            return (
              <div key={category}>
                {selectedCategory === 'all' && (
                  <button
                    onClick={() => toggleCategoryCollapse(category)}
                    className="flex items-center gap-2 w-full text-left text-sm font-medium text-text-secondary mb-2 hover:text-text-primary transition-colors group"
                  >
                    <svg
                      className={`w-4 h-4 transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                    <span className="capitalize">{category}</span>
                    <span className="text-text-muted text-xs">({categoryResources.length})</span>
                  </button>
                )}
                {!isCollapsed && (
                  <div className="space-y-2">
                    {categoryResources.map((resource) => (
                      <ResourceCard
                        key={resource.id}
                        resource={resource}
                        onOpen={() => openUrl(resource.url)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Resource card component
interface ResourceCardProps {
  resource: LibraryResource;
  onOpen: () => void;
}

function ResourceCard({ resource, onOpen }: ResourceCardProps) {
  // Extract domain from URL for display
  const domain = useMemo(() => {
    try {
      const url = new URL(resource.url);
      return url.hostname.replace('www.', '');
    } catch {
      return resource.url;
    }
  }, [resource.url]);

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-bg-tertiary/50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-text-primary">{resource.name}</h4>
          <p className="text-sm text-text-tertiary line-clamp-2 mt-0.5">{resource.description}</p>

          {/* Tags */}
          {resource.tags && resource.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {resource.tags.slice(0, 4).map((tag) => (
                <span key={tag} className="text-xs px-1.5 py-0.5 rounded bg-bg-primary text-text-muted">
                  {tag}
                </span>
              ))}
              {resource.tags.length > 4 && (
                <span className="text-xs text-text-muted">+{resource.tags.length - 4}</span>
              )}
            </div>
          )}

          {/* URL hint */}
          <div className="flex items-center gap-1 mt-2 text-xs text-text-muted">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
            </svg>
            <span className="truncate">{domain}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs px-2 py-1 rounded-full bg-cyan-500/10 text-cyan-400 capitalize">
            {resource.category}
          </span>
          <button
            onClick={onOpen}
            aria-label={`Open ${resource.name} in browser`}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-accent text-white hover:bg-accent/90 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
            Open
          </button>
        </div>
      </div>
    </div>
  );
}
