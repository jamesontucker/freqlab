import { useState, useMemo, useCallback } from 'react';
import type { LibrarySkill, SkillCategory } from '../../types';

interface GuidesTabProps {
  guides: LibrarySkill[];  // Backend still uses "skills" type
  searchQuery: string;
  // Note: content is not included - we use reference-based attachments
  onAttach?: (item: { type: 'skill' | 'algorithm'; id: string; name: string }) => void;
}

const CATEGORY_INFO: Record<SkillCategory, { label: string; color: string }> = {
  framework: { label: 'Framework', color: 'bg-blue-500/10 text-blue-400' },
  effect: { label: 'Effect', color: 'bg-purple-500/10 text-purple-400' },
  instrument: { label: 'Instrument', color: 'bg-green-500/10 text-green-400' },
  component: { label: 'Component', color: 'bg-orange-500/10 text-orange-400' },
  shared: { label: 'Shared', color: 'bg-gray-500/10 text-gray-400' },
  reference: { label: 'Reference', color: 'bg-yellow-500/10 text-yellow-400' },
};

export function GuidesTab({ guides, searchQuery, onAttach }: GuidesTabProps) {
  const [selectedCategory, setSelectedCategory] = useState<SkillCategory | 'all'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Filter out internal guides from user UI
  const visibleGuides = useMemo(() => {
    return guides.filter((g) => !g.internal);
  }, [guides]);

  // Get unique categories from visible guides
  const categories = useMemo(() => {
    const cats = new Set(visibleGuides.map((g) => g.category));
    return Array.from(cats) as SkillCategory[];
  }, [visibleGuides]);

  // Filter guides (includes tag search)
  const filteredGuides = useMemo(() => {
    return visibleGuides.filter((guide) => {
      const matchesCategory = selectedCategory === 'all' || guide.category === selectedCategory;
      const query = searchQuery.toLowerCase();
      const matchesName = guide.name.toLowerCase().includes(query);
      const matchesDescription = guide.description.toLowerCase().includes(query);
      const matchesTags = guide.tags?.some((tag) => tag.toLowerCase().includes(query)) ?? false;
      const matchesContent = guide.content.toLowerCase().includes(query);
      const matchesSearch = matchesName || matchesDescription || matchesTags || matchesContent;
      return matchesCategory && matchesSearch;
    });
  }, [visibleGuides, selectedCategory, searchQuery]);

  // Group guides by category
  const groupedGuides = useMemo(() => {
    if (selectedCategory !== 'all') {
      return { [selectedCategory]: filteredGuides };
    }
    return filteredGuides.reduce((acc, guide) => {
      const cat = guide.category;
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(guide);
      return acc;
    }, {} as Record<string, LibrarySkill[]>);
  }, [filteredGuides, selectedCategory]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  const copyToClipboard = useCallback(async (guide: LibrarySkill) => {
    try {
      await navigator.clipboard.writeText(guide.content);
      setCopiedId(guide.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, []);

  const handleAttach = useCallback((guide: LibrarySkill) => {
    onAttach?.({
      type: 'skill',  // Backend type unchanged
      id: guide.id,
      name: guide.name,
    });
  }, [onAttach]);

  if (visibleGuides.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-text-secondary">
        <svg className="w-12 h-12 mb-4 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
        </svg>
        <p>No guides available</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Category filter */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setSelectedCategory('all')}
          className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
            selectedCategory === 'all'
              ? 'bg-accent text-white'
              : 'bg-bg-tertiary text-text-secondary hover:text-text-primary'
          }`}
        >
          All ({visibleGuides.length})
        </button>
        {categories.map((cat) => {
          const count = visibleGuides.filter((g) => g.category === cat).length;
          const info = CATEGORY_INFO[cat];
          const label = info?.label || cat.charAt(0).toUpperCase() + cat.slice(1);
          return (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                selectedCategory === cat
                  ? 'bg-accent text-white'
                  : 'bg-bg-tertiary text-text-secondary hover:text-text-primary'
              }`}
            >
              {label} ({count})
            </button>
          );
        })}
      </div>

      {/* Guides list */}
      {filteredGuides.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-text-secondary">
          <p>No guides match your search</p>
          {searchQuery && <p className="text-sm mt-1">Try a different search term</p>}
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(groupedGuides).map(([category, categoryGuides]) => (
            <div key={category}>
              {selectedCategory === 'all' && (
                <h3 className="text-sm font-medium text-text-secondary mb-2 capitalize">
                  {CATEGORY_INFO[category as SkillCategory]?.label || category}
                </h3>
              )}
              <div className="space-y-2">
                {categoryGuides.map((guide) => (
                  <GuideCard
                    key={`guide-${guide.id}`}
                    guide={guide}
                    isExpanded={expandedId === `guide-${guide.id}`}
                    isCopied={copiedId === guide.id}
                    onToggle={() => toggleExpand(`guide-${guide.id}`)}
                    onCopy={() => copyToClipboard(guide)}
                    onAttach={onAttach ? () => handleAttach(guide) : undefined}
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
interface GuideCardProps {
  guide: LibrarySkill;
  isExpanded: boolean;
  isCopied: boolean;
  onToggle: () => void;
  onCopy: () => void;
  onAttach?: () => void;
}

function GuideCard({ guide, isExpanded, isCopied, onToggle, onCopy, onAttach }: GuideCardProps) {
  const categoryInfo = CATEGORY_INFO[guide.category];

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-bg-tertiary/50">
      {/* Header */}
      <div className="flex items-center justify-between p-3">
        <button onClick={onToggle} className="flex-1 flex items-center gap-3 text-left min-w-0">
          <div className="min-w-0">
            <h4 className="font-medium text-text-primary">{guide.name}</h4>
            <p className="text-sm text-text-tertiary line-clamp-1">{guide.description}</p>
            {/* Tags */}
            {guide.tags && guide.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {guide.tags.slice(0, 4).map((tag) => (
                  <span key={tag} className="text-xs px-1.5 py-0.5 rounded bg-bg-primary text-text-muted">
                    {tag}
                  </span>
                ))}
                {guide.tags.length > 4 && (
                  <span className="text-xs text-text-muted">+{guide.tags.length - 4}</span>
                )}
              </div>
            )}
          </div>
        </button>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-1 rounded-full ${categoryInfo?.color || 'bg-gray-500/10 text-gray-400'}`}>
            {categoryInfo?.label || guide.category}
          </span>
          {guide.source && (
            <span
              className={`text-xs px-2 py-1 rounded-full ${
                guide.source === 'core' ? 'bg-blue-500/10 text-blue-400' : 'bg-green-500/10 text-green-400'
              }`}
            >
              {guide.source}
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
              {guide.content.slice(0, 1500)}
              {guide.content.length > 1500 && '...'}
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
