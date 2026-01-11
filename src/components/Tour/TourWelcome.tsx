import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface TourWelcomeProps {
  onStart: () => void;
  onSkip: () => void;
}

/**
 * Welcome popup shown at the start of the guided tour.
 */
export function TourWelcome({ onStart, onSkip }: TourWelcomeProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 50);
    return () => clearTimeout(timer);
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        style={{
          opacity: isVisible ? 1 : 0,
          transition: 'opacity 300ms ease-out',
        }}
      />

      {/* Card */}
      <div
        className="relative bg-bg-secondary rounded-2xl shadow-2xl border border-border max-w-md mx-4 overflow-hidden"
        style={{
          opacity: isVisible ? 1 : 0,
          transform: isVisible ? 'scale(1) translateY(0)' : 'scale(0.95) translateY(10px)',
          transition: 'opacity 300ms ease-out, transform 300ms ease-out',
        }}
      >
        {/* Decorative gradient header */}
        <div className="h-2 bg-gradient-to-r from-accent via-accent/80 to-accent" />

        <div className="p-6">
          {/* Logo */}
          <div className="w-14 h-14 mx-auto mb-4 rounded-xl bg-accent/10 flex items-center justify-center">
            <svg width="40" height="40" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M20 40V35M26 40V30M32 40V25M38 40V20M44 40V25M50 40V30M56 40V35M62 40V32"
                    stroke="url(#welcomeGrad)" strokeWidth="4" strokeLinecap="round"/>
              <path d="M20 40V45M26 40V50M32 40V55M38 40V60M44 40V55M50 40V50M56 40V45M62 40V48"
                    stroke="url(#welcomeGrad)" strokeWidth="4" strokeLinecap="round"/>
              <defs>
                <linearGradient id="welcomeGrad" x1="0" y1="0" x2="80" y2="80" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#2DA86E"/>
                  <stop offset="1" stopColor="#36C07E"/>
                </linearGradient>
              </defs>
            </svg>
          </div>

          {/* Content */}
          <div className="text-center">
            <h2 className="text-xl font-semibold text-text-primary mb-2">
              Welcome to freqlab!
            </h2>
            <p className="text-sm text-text-secondary leading-relaxed">
              Ready to create your first audio plugin? This quick tour will walk you through the basics in about 2 minutes.
            </p>
          </div>

          {/* What you'll learn */}
          <div className="mt-5 space-y-2">
            {[
              'Create a new plugin project',
              'Describe your plugin in chat',
              'Build and test your plugin',
              'Preview with real audio',
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-2.5 text-sm text-text-secondary">
                <div className="w-5 h-5 rounded-full bg-accent/10 flex items-center justify-center flex-shrink-0">
                  <svg className="w-3 h-3 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <span>{item}</span>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="mt-6 flex flex-col gap-2">
            <button
              onClick={onStart}
              className="w-full py-2.5 px-4 text-sm font-medium bg-accent hover:bg-accent-hover text-white rounded-lg transition-colors"
            >
              Start Tour
            </button>
            <button
              onClick={onSkip}
              className="w-full py-2 px-4 text-sm text-text-muted hover:text-text-secondary transition-colors"
            >
              Skip, I'll explore on my own
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
