import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Library } from '../../types';

interface AttachedItem {
  libraryType?: 'skill' | 'algorithm';
  libraryItemId?: string;
}

interface LibraryPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (item: { type: 'skill' | 'algorithm'; id: string; name: string }) => void;
  onRemove?: (item: { type: 'skill' | 'algorithm'; id: string }) => void; // Remove already-attached item
  onOpenResource?: (url: string) => void;
  anchorRef?: React.RefObject<HTMLElement>;
  attachedItems?: AttachedItem[]; // Items already attached to prevent duplicates
}

// Unified library item combining guides (skills), recipes (algorithms), and resources
type LibraryItemType = 'guide' | 'recipe' | 'resource';

interface LibraryItem {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  itemType: LibraryItemType;
  backendType?: 'skill' | 'algorithm'; // Original backend type for attachable items
  url?: string; // For resources
  source: 'core' | 'custom';
  content?: string; // For search matching
}

// Category SVG icons
const CategoryIcons = {
  filters: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
    </svg>
  ),
  dynamics: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
    </svg>
  ),
  effects: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
    </svg>
  ),
  envelopes: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
    </svg>
  ),
  oscillators: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12c0-1.5 1.5-3 3-1.5s1.5 3 3 1.5 1.5-3 3-1.5 1.5 3 3 1.5 1.5-3 3-1.5 1.5 3 3 1.5" />
    </svg>
  ),
  utility: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z" />
    </svg>
  ),
  analysis: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z" />
    </svg>
  ),
  framework: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.429 9.75L2.25 12l4.179 2.25m0-4.5l5.571 3 5.571-3m-11.142 0L2.25 7.5 12 2.25l9.75 5.25-4.179 2.25m0 0L21.75 12l-4.179 2.25m0 0l4.179 2.25L12 21.75 2.25 16.5l4.179-2.25m11.142 0l-5.571 3-5.571-3" />
    </svg>
  ),
  effect: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.098 19.902a3.75 3.75 0 005.304 0l6.401-6.402M6.75 21A3.75 3.75 0 013 17.25V4.125C3 3.504 3.504 3 4.125 3h5.25c.621 0 1.125.504 1.125 1.125v4.072M6.75 21a3.75 3.75 0 003.75-3.75V8.197M6.75 21h13.125c.621 0 1.125-.504 1.125-1.125v-5.25c0-.621-.504-1.125-1.125-1.125h-4.072M10.5 8.197l2.88-2.88c.438-.439 1.15-.439 1.59 0l3.712 3.713c.44.44.44 1.152 0 1.59l-2.879 2.88M6.75 17.25h.008v.008H6.75v-.008z" />
    </svg>
  ),
  instrument: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" />
    </svg>
  ),
  component: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.25 6.087c0-.355.186-.676.401-.959.221-.29.349-.634.349-1.003 0-1.036-1.007-1.875-2.25-1.875s-2.25.84-2.25 1.875c0 .369.128.713.349 1.003.215.283.401.604.401.959v0a.64.64 0 01-.657.643 48.39 48.39 0 01-4.163-.3c.186 1.613.293 3.25.315 4.907a.656.656 0 01-.658.663v0c-.355 0-.676-.186-.959-.401a1.647 1.647 0 00-1.003-.349c-1.036 0-1.875 1.007-1.875 2.25s.84 2.25 1.875 2.25c.369 0 .713-.128 1.003-.349.283-.215.604-.401.959-.401v0c.31 0 .555.26.532.57a48.039 48.039 0 01-.642 5.056c1.518.19 3.058.309 4.616.354a.64.64 0 00.657-.643v0c0-.355-.186-.676-.401-.959a1.647 1.647 0 01-.349-1.003c0-1.035 1.008-1.875 2.25-1.875 1.243 0 2.25.84 2.25 1.875 0 .369-.128.713-.349 1.003-.215.283-.4.604-.4.959v0c0 .333.277.599.61.58a48.1 48.1 0 005.427-.63 48.05 48.05 0 00.582-4.717.532.532 0 00-.533-.57v0c-.355 0-.676.186-.959.401-.29.221-.634.349-1.003.349-1.035 0-1.875-1.007-1.875-2.25s.84-2.25 1.875-2.25c.37 0 .713.128 1.003.349.283.215.604.401.96.401v0a.656.656 0 00.658-.663 48.422 48.422 0 00-.37-5.36c-1.886.342-3.81.574-5.766.689a.578.578 0 01-.61-.58v0z" />
    </svg>
  ),
  shared: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
    </svg>
  ),
  reference: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
    </svg>
  ),
  documentation: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  ),
  tutorial: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5" />
    </svg>
  ),
  tool: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75a4.5 4.5 0 01-4.884 4.484c-1.076-.091-2.264.071-2.95.904l-7.152 8.684a2.548 2.548 0 11-3.586-3.586l8.684-7.152c.833-.686.995-1.874.904-2.95a4.5 4.5 0 016.336-4.486l-3.276 3.276a3.004 3.004 0 002.25 2.25l3.276-3.276c.256.565.398 1.192.398 1.852z" />
    </svg>
  ),
  community: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
    </svg>
  ),
  default: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
    </svg>
  ),
};

// Category display config
const CATEGORY_CONFIG: Record<string, { label: string; iconKey: keyof typeof CategoryIcons }> = {
  // Recipe (algorithm) categories
  filters: { label: 'Filters', iconKey: 'filters' },
  dynamics: { label: 'Dynamics', iconKey: 'dynamics' },
  effects: { label: 'Effects', iconKey: 'effects' },
  envelopes: { label: 'Envelopes', iconKey: 'envelopes' },
  oscillators: { label: 'Oscillators', iconKey: 'oscillators' },
  utility: { label: 'Utility', iconKey: 'utility' },
  analysis: { label: 'Analysis', iconKey: 'analysis' },
  // Guide (skill) categories
  framework: { label: 'Framework', iconKey: 'framework' },
  effect: { label: 'Effect Patterns', iconKey: 'effect' },
  instrument: { label: 'Instrument Patterns', iconKey: 'instrument' },
  component: { label: 'Components', iconKey: 'component' },
  shared: { label: 'Shared', iconKey: 'shared' },
  reference: { label: 'Reference', iconKey: 'reference' },
  // Resource categories
  documentation: { label: 'Documentation', iconKey: 'documentation' },
  tutorial: { label: 'Tutorials', iconKey: 'tutorial' },
  tool: { label: 'Tools', iconKey: 'tool' },
  community: { label: 'Community', iconKey: 'community' },
};

function getCategoryConfig(category: string) {
  const config = CATEGORY_CONFIG[category.toLowerCase()];
  if (config) {
    return {
      label: config.label,
      icon: CategoryIcons[config.iconKey],
    };
  }
  return {
    label: category.charAt(0).toUpperCase() + category.slice(1),
    icon: CategoryIcons.default,
  };
}

export function GuidePicker({ isOpen, onClose, onSelect, onRemove, onOpenResource, anchorRef, attachedItems = [] }: LibraryPickerProps) {
  const [library, setLibrary] = useState<Library | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | 'all'>('all');
  const [selectedType, setSelectedType] = useState<LibraryItemType | 'all'>('all');
  const [recentlyAttached, setRecentlyAttached] = useState<Set<string>>(new Set());
  const [categoriesExpanded, setCategoriesExpanded] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const pickerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const timeoutRefs = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  // Load library data
  const loadLibrary = useCallback(async () => {
    setLoading(true);
    try {
      const lib = await invoke<Library>('get_library');
      setLibrary(lib);
    } catch (e) {
      console.error('Failed to load library:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadLibrary();
    } else {
      setSearchQuery('');
      setSelectedCategory('all');
      setSelectedType('all');
      setCategoriesExpanded(false);
      setCollapsedSections(new Set());
    }
  }, [isOpen, loadLibrary]);

  // Focus search input when picker opens - using useLayoutEffect for synchronous DOM focus
  useLayoutEffect(() => {
    if (isOpen && searchInputRef.current) {
      // Use requestAnimationFrame to ensure the DOM is ready
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
      });
    }
  }, [isOpen]);

  // Cleanup timeouts on unmount to prevent memory leaks
  useEffect(() => {
    const timeouts = timeoutRefs.current;
    return () => {
      timeouts.forEach((id) => clearTimeout(id));
      timeouts.clear();
    };
  }, []);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        pickerRef.current &&
        !pickerRef.current.contains(e.target as Node) &&
        anchorRef?.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };

    // Close on escape
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose, anchorRef]);

  // Combine guides (skills), recipes (algorithms), and resources into unified list
  const allItems = useMemo((): LibraryItem[] => {
    if (!library) return [];

    // Filter out internal guides from user UI
    const guides: LibraryItem[] = (library.skills || [])
      .filter((s) => !s.internal)
      .map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        category: s.category,
        tags: s.tags || [],
        itemType: 'guide' as const,
        backendType: 'skill' as const,
        source: (s.source || 'core') as 'core' | 'custom',
        content: s.content,
      }));

    const recipes: LibraryItem[] = (library.algorithms || []).map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      category: a.category,
      tags: a.tags || [],
      itemType: 'recipe' as const,
      backendType: 'algorithm' as const,
      source: (a.source || 'core') as 'core' | 'custom',
      content: a.content,
    }));

    const resources: LibraryItem[] = (library.resources || []).map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      category: r.category,
      tags: r.tags || [],
      itemType: 'resource' as const,
      url: r.url,
      source: (r.source || 'core') as 'core' | 'custom',
    }));

    return [...recipes, ...guides, ...resources];
  }, [library]);

  // Get unique categories
  const categories = useMemo(() => {
    const cats = new Set(allItems.map((item) => item.category.toLowerCase()));
    return Array.from(cats).sort();
  }, [allItems]);

  // Count items by type
  const typeCounts = useMemo(() => {
    return {
      guide: allItems.filter((item) => item.itemType === 'guide').length,
      recipe: allItems.filter((item) => item.itemType === 'recipe').length,
      resource: allItems.filter((item) => item.itemType === 'resource').length,
    };
  }, [allItems]);

  // Filter items by search, category, and type (includes tag search!)
  const filteredItems = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();

    return allItems.filter((item) => {
      // Type filter
      if (selectedType !== 'all' && item.itemType !== selectedType) return false;

      // Category filter
      const matchesCategory =
        selectedCategory === 'all' || item.category.toLowerCase() === selectedCategory;

      if (!matchesCategory) return false;

      // Search filter (name, description, tags, content)
      if (!query) return true;

      const matchesName = item.name.toLowerCase().includes(query);
      const matchesDescription = item.description.toLowerCase().includes(query);
      const matchesTags = item.tags.some((tag) => tag.toLowerCase().includes(query));
      const matchesCategory2 = item.category.toLowerCase().includes(query);
      const matchesContent = item.content?.toLowerCase().includes(query) ?? false;

      return matchesName || matchesDescription || matchesTags || matchesCategory2 || matchesContent;
    });
  }, [allItems, searchQuery, selectedCategory, selectedType]);

  // Group by category for display, sorted alphabetically
  const groupedItems = useMemo(() => {
    const groups: Record<string, LibraryItem[]> = {};
    for (const item of filteredItems) {
      const cat = item.category.toLowerCase();
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(item);
    }
    // Sort items within each category alphabetically by name
    for (const cat of Object.keys(groups)) {
      groups[cat].sort((a, b) => a.name.localeCompare(b.name));
    }
    return groups;
  }, [filteredItems]);

  // Get sorted category names for rendering
  const sortedCategoryNames = useMemo(() => {
    return Object.keys(groupedItems).sort((a, b) => a.localeCompare(b));
  }, [groupedItems]);

  const handleSelect = useCallback(
    (item: LibraryItem) => {
      if (item.itemType === 'resource' && item.url) {
        // Open resource in new tab
        window.open(item.url, '_blank', 'noopener,noreferrer');
        onOpenResource?.(item.url);
        onClose(); // Close after opening resource
      } else if (item.backendType) {
        // Attach guide or recipe to chat
        onSelect({
          type: item.backendType,
          id: item.id,
          name: item.name,
        });

        // Show visual feedback - add to recently attached set
        const itemKey = `${item.itemType}-${item.id}`;
        setRecentlyAttached(prev => new Set(prev).add(itemKey));
        const timeoutId = setTimeout(() => {
          timeoutRefs.current.delete(timeoutId);
          setRecentlyAttached(prev => {
            const next = new Set(prev);
            next.delete(itemKey);
            return next;
          });
        }, 1500);
        timeoutRefs.current.add(timeoutId);

        // DON'T close - let user attach multiple items
      }
    },
    [onSelect, onOpenResource, onClose]
  );

  if (!isOpen) return null;

  return (
    <div
      ref={pickerRef}
      role="dialog"
      aria-label="Library picker"
      aria-modal="true"
      className="absolute bottom-full left-0 mb-2 w-[440px] max-h-[480px] bg-bg-secondary border border-border rounded-lg shadow-xl z-50 flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="p-2.5 border-b border-border">
        <div className="flex items-center justify-between mb-1.5">
          <h3 className="text-sm font-medium text-text-primary">Attach from Library</h3>
          <button
            onClick={onClose}
            aria-label="Close library picker"
            className="p-1 text-text-tertiary hover:text-text-primary rounded transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search guides, recipes, resources..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-bg-tertiary border border-border rounded text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent/50 focus:border-accent"
          />
        </div>

        {/* Type filter tabs */}
        <div className="flex gap-0.5 mt-1.5">
          <button
            onClick={() => setSelectedType('all')}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              selectedType === 'all'
                ? 'bg-accent text-white'
                : 'bg-bg-tertiary text-text-secondary hover:text-text-primary'
            }`}
          >
            All ({allItems.length})
          </button>
          <button
            onClick={() => setSelectedType('guide')}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              selectedType === 'guide'
                ? 'bg-accent text-white'
                : 'bg-bg-tertiary text-text-secondary hover:text-text-primary'
            }`}
          >
            Guides ({typeCounts.guide})
          </button>
          <button
            onClick={() => setSelectedType('recipe')}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              selectedType === 'recipe'
                ? 'bg-accent text-white'
                : 'bg-bg-tertiary text-text-secondary hover:text-text-primary'
            }`}
          >
            Recipes ({typeCounts.recipe})
          </button>
          <button
            onClick={() => setSelectedType('resource')}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              selectedType === 'resource'
                ? 'bg-accent text-white'
                : 'bg-bg-tertiary text-text-secondary hover:text-text-primary'
            }`}
          >
            Resources ({typeCounts.resource})
          </button>
        </div>
      </div>

      {/* Category pills - collapsible */}
      <div className="border-b border-border">
        {/* Header with toggle */}
        <button
          onClick={() => setCategoriesExpanded(!categoriesExpanded)}
          className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="font-medium">Categories</span>
            {selectedCategory !== 'all' && (
              <span className="px-1.5 py-0.5 rounded bg-accent/20 text-accent text-[10px]">
                {getCategoryConfig(selectedCategory).label}
              </span>
            )}
          </div>
          <svg
            className={`w-4 h-4 transition-transform ${categoriesExpanded ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Expandable content */}
        {categoriesExpanded && (
          <div className="px-2.5 pb-2 flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
            <button
              onClick={() => setSelectedCategory('all')}
              className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
                selectedCategory === 'all'
                  ? 'bg-accent text-white'
                  : 'bg-bg-tertiary text-text-secondary hover:text-text-primary'
              }`}
            >
              All
            </button>
            {categories.map((cat) => {
              const config = getCategoryConfig(cat);
              const count = allItems.filter((item) => item.category.toLowerCase() === cat).length;
              return (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`flex items-center gap-1 px-2 py-1 text-xs rounded-full transition-colors ${
                    selectedCategory === cat
                      ? 'bg-accent text-white'
                      : 'bg-bg-tertiary text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {config.icon}
                  <span>{config.label} ({count})</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-text-secondary">
            <svg className="w-5 h-5 animate-spin mr-2" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Loading...
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-text-secondary">
            <svg className="w-8 h-8 mb-2 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <p className="text-sm">No items found</p>
            {searchQuery && (
              <p className="text-xs mt-1 text-text-tertiary">Try a different search term</p>
            )}
          </div>
        ) : (
          <div className="p-1.5 space-y-1">
            {sortedCategoryNames.map((category) => {
              const items = groupedItems[category];
              const isCollapsed = collapsedSections.has(category);
              const toggleSection = () => {
                setCollapsedSections(prev => {
                  const next = new Set(prev);
                  if (next.has(category)) {
                    next.delete(category);
                  } else {
                    next.add(category);
                  }
                  return next;
                });
              };
              return (
                <div key={category}>
                  <button
                    onClick={toggleSection}
                    className="w-full flex items-center justify-between px-2 py-1.5 text-[11px] font-medium text-text-tertiary hover:text-text-secondary uppercase tracking-wider transition-colors rounded hover:bg-bg-tertiary/50"
                  >
                    <div className="flex items-center gap-1.5">
                      {getCategoryConfig(category).icon}
                      <span>{getCategoryConfig(category).label}</span>
                      <span className="text-text-muted">({items.length})</span>
                    </div>
                    <svg
                      className={`w-3.5 h-3.5 transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {!isCollapsed && (
                    <div className="space-y-0.5 mt-0.5">
                      {items.map((item) => {
                        // Check if this item is already attached
                        const isAlreadyAttached = item.backendType && attachedItems.some(
                          (a) => a.libraryType === item.backendType && a.libraryItemId === item.id
                        );
                        return (
                          <LibraryItemRow
                            key={`${item.itemType}-${item.id}`}
                            item={item}
                            onSelect={handleSelect}
                            onRemove={onRemove}
                            isRecentlyAttached={recentlyAttached.has(`${item.itemType}-${item.id}`)}
                            isAlreadyAttached={isAlreadyAttached}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer hint */}
      <div className="px-3 py-2 border-t border-border text-xs text-text-tertiary">
        Guides & recipes attach to chat • Resources open in browser
      </div>
    </div>
  );
}

interface LibraryItemRowProps {
  item: LibraryItem;
  onSelect: (item: LibraryItem) => void;
  onRemove?: (item: { type: 'skill' | 'algorithm'; id: string }) => void;
  isRecentlyAttached?: boolean;
  isAlreadyAttached?: boolean;
}

function LibraryItemRow({ item, onSelect, onRemove, isRecentlyAttached, isAlreadyAttached }: LibraryItemRowProps) {
  // Type badge config
  const typeBadge = {
    guide: { label: 'Guide', color: 'bg-blue-500/10 text-blue-400' },
    recipe: { label: 'Recipe', color: 'bg-purple-500/10 text-purple-400' },
    resource: { label: 'Link', color: 'bg-cyan-500/10 text-cyan-400' },
  }[item.itemType];

  // Already attached items can be clicked to remove (resources can always be re-opened)
  const canRemove = isAlreadyAttached && item.itemType !== 'resource' && item.backendType;

  const handleClick = () => {
    if (canRemove && onRemove && item.backendType) {
      onRemove({ type: item.backendType, id: item.id });
    } else {
      onSelect(item);
    }
  };

  return (
    <button
      onClick={handleClick}
      className={`w-full flex items-start gap-2 px-2 py-1.5 rounded-lg transition-colors text-left group ${
        canRemove
          ? 'bg-accent/10 hover:bg-red-500/10'
          : isRecentlyAttached
            ? 'bg-green-500/10'
            : 'hover:bg-bg-tertiary'
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-medium transition-colors truncate ${
            canRemove
              ? 'text-accent group-hover:text-red-400'
              : isRecentlyAttached
                ? 'text-green-400'
                : 'text-text-primary group-hover:text-accent'
          }`}>
            {item.name}
          </span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${typeBadge.color}`}>
            {typeBadge.label}
          </span>
          {canRemove && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/20 text-accent group-hover:bg-red-500/20 group-hover:text-red-400 flex-shrink-0 transition-colors">
              Added
            </span>
          )}
        </div>
        <p className="text-xs text-text-tertiary line-clamp-1">{item.description}</p>
        {item.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {item.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="text-xs px-1.5 py-0.5 rounded bg-bg-primary text-text-muted"
              >
                {tag}
              </span>
            ))}
            {item.tags.length > 3 && (
              <span className="text-xs text-text-muted">+{item.tags.length - 3}</span>
            )}
          </div>
        )}
      </div>
      {item.itemType === 'resource' ? (
        <svg
          className="w-4 h-4 text-text-muted group-hover:text-accent transition-colors flex-shrink-0 mt-0.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
        </svg>
      ) : canRemove ? (
        <svg
          className="w-4 h-4 text-accent group-hover:text-red-400 transition-colors flex-shrink-0 mt-0.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      ) : isRecentlyAttached ? (
        <svg
          className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg
          className="w-4 h-4 text-text-muted group-hover:text-accent transition-colors flex-shrink-0 mt-0.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
      )}
    </button>
  );
}
