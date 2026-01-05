interface SidebarProps {
  activeSection?: string;
  onSectionChange?: (section: string) => void;
}

export function Sidebar({ activeSection = 'projects', onSectionChange }: SidebarProps) {
  const sections = [
    {
      id: 'projects',
      label: 'Projects',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
        </svg>
      ),
    },
    {
      id: 'setup',
      label: 'Setup',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z" />
        </svg>
      ),
    },
    {
      id: 'help',
      label: 'Help',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
        </svg>
      ),
    },
  ];

  return (
    <aside className="w-64 bg-bg-secondary border-r border-border flex flex-col">
      {/* New Plugin Button */}
      <div className="p-4">
        <button className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-accent hover:bg-accent-hover text-white font-medium rounded-xl transition-all duration-200 hover:shadow-lg hover:shadow-accent/25">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          <span>New Plugin</span>
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3">
        <div className="space-y-1">
          {sections.map((section) => (
            <button
              key={section.id}
              onClick={() => onSectionChange?.(section.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all duration-200 ${
                activeSection === section.id
                  ? 'bg-accent-subtle text-accent'
                  : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'
              }`}
            >
              {section.icon}
              <span className="font-medium">{section.label}</span>
            </button>
          ))}
        </div>
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-border">
        <div className="flex items-center justify-between text-xs">
          <span className="text-text-muted">freqlab</span>
          <span className="text-text-muted px-2 py-0.5 bg-bg-tertiary rounded">v0.1.0</span>
        </div>
      </div>
    </aside>
  );
}
