import { useState, ReactNode } from 'react';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { OutputPanel } from './OutputPanel';

interface MainLayoutProps {
  children: ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const [activeSection, setActiveSection] = useState('projects');

  return (
    <div className="h-screen flex flex-col bg-bg-primary">
      <Header />
      <div className="flex-1 flex overflow-hidden">
        <Sidebar activeSection={activeSection} onSectionChange={setActiveSection} />
        <main className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-auto p-6">{children}</div>
          <OutputPanel />
        </main>
      </div>
    </div>
  );
}
