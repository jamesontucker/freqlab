import { useEffect, useState, useCallback } from 'react';
import { useTourStore } from '../../stores/tourStore';
import { useProjectStore } from '../../stores/projectStore';
import { usePreviewStore } from '../../stores/previewStore';
import { useProjectBusyStore } from '../../stores/projectBusyStore';
import { getTourElement, subscribeToRefChanges } from '../../utils/tourRefs';
import { TourSpotlight } from './TourSpotlight';
import { TourStep } from './TourStep';
import { TourWelcome } from './TourWelcome';
import { TourComplete } from './TourComplete';
import { TourWaiting } from './TourWaiting';

/**
 * GuidedTour orchestrates the entire tour experience.
 * It renders the appropriate components based on current step
 * and watches for state changes to auto-advance.
 */
export function GuidedTour() {
  // Tour state - use selectors to prevent unnecessary re-renders
  const isActive = useTourStore((s) => s.isActive);
  const currentStep = useTourStore((s) => s.currentStep);

  // Tour actions - get from store without subscribing
  const advanceToNextStep = useTourStore.getState().advanceToNextStep;
  const advanceToStep = useTourStore.getState().advanceToStep;
  const exitTour = useTourStore.getState().exitTour;
  const completeTour = useTourStore.getState().completeTour;
  const getCurrentStepConfig = useTourStore.getState().getCurrentStepConfig;

  // Project state
  const activeProject = useProjectStore((s) => s.activeProject);

  // Preview state - use individual selectors
  const isPlaying = usePreviewStore((s) => s.isPlaying);
  const previewOpen = usePreviewStore((s) => s.isOpen);
  const demoSamples = usePreviewStore((s) => s.demoSamples);
  const loadedPlugin = usePreviewStore((s) => s.loadedPlugin);

  // Build state
  const claudeBusyPaths = useProjectBusyStore((s) => s.claudeBusyPaths);
  const buildingPath = useProjectBusyStore((s) => s.buildingPath);

  // Track the target element for current step
  const [targetElement, setTargetElement] = useState<HTMLElement | null>(null);

  // Force re-render when refs change
  const [, setRefVersion] = useState(0);

  // Track initial project path when entering new-plugin-create step
  const [initialProjectPath, setInitialProjectPath] = useState<string | undefined>(undefined);

  // Get current step config
  const stepConfig = getCurrentStepConfig();

  // Subscribe to ref changes
  useEffect(() => {
    const unsubscribe = subscribeToRefChanges(() => {
      setRefVersion((v) => v + 1);
    });
    return unsubscribe;
  }, []);

  // Update target element when step changes
  useEffect(() => {
    if (!stepConfig?.target) {
      setTargetElement(null);
      return;
    }

    // Try to get element immediately
    const element = getTourElement(stepConfig.target);
    if (element) {
      setTargetElement(element);
      return;
    }

    // Poll for element if not immediately available (modal opening, etc.)
    const pollInterval = setInterval(() => {
      const el = getTourElement(stepConfig.target!);
      if (el) {
        setTargetElement(el);
        clearInterval(pollInterval);
      }
    }, 100);

    // Stop polling after 5 seconds
    const timeout = setTimeout(() => {
      clearInterval(pollInterval);
    }, 5000);

    return () => {
      clearInterval(pollInterval);
      clearTimeout(timeout);
    };
  }, [stepConfig?.target, currentStep]);

  // Auto-advance: Modal opened (new plugin button clicked)
  // Detect by checking if the modal element becomes available
  useEffect(() => {
    if (!isActive || currentStep !== 'click-new-plugin') return;

    // Poll for the modal to appear
    const pollInterval = setInterval(() => {
      const modal = getTourElement('new-plugin-modal');
      if (modal) {
        clearInterval(pollInterval);
        advanceToNextStep(); // Goes to introduce-new-plugin-modal
      }
    }, 100);

    return () => clearInterval(pollInterval);
  }, [isActive, currentStep, advanceToNextStep]);

  // Note: new-plugin-name, new-plugin-type, and new-plugin-description steps use manual advance ("Got it" button)

  // Auto-advance: Next button clicked on basic step (modal transitions to UI step)
  useEffect(() => {
    if (!isActive || currentStep !== 'new-plugin-next-basic') return;

    // Poll for the framework option to appear (user clicked Next)
    // Tour uses egui (Simple UI) as the pre-selected framework
    const pollInterval = setInterval(() => {
      const frameworkOption = getTourElement('new-plugin-framework-egui');
      if (frameworkOption) {
        clearInterval(pollInterval);
        // Small delay to let modal transition complete
        setTimeout(() => advanceToNextStep(), 300);
      }
    }, 100);

    return () => clearInterval(pollInterval);
  }, [isActive, currentStep, advanceToNextStep]);

  // Note: new-plugin-framework uses manual advance ("Got it" button)

  // Auto-advance: Next button clicked on UI step (modal transitions to components step)
  useEffect(() => {
    if (!isActive || currentStep !== 'new-plugin-next-ui') return;

    // Poll for the create button to appear (user clicked Next)
    const pollInterval = setInterval(() => {
      const createButton = getTourElement('new-plugin-create-button');
      if (createButton) {
        clearInterval(pollInterval);
        // Small delay to let modal transition complete
        setTimeout(() => advanceToNextStep(), 300);
      }
    }, 100);

    return () => clearInterval(pollInterval);
  }, [isActive, currentStep, advanceToNextStep]);

  // Auto-advance: Project created (only when a NEW project is created)
  useEffect(() => {
    if (!isActive || currentStep !== 'new-plugin-create') return;

    // Only advance if a NEW project was created (path changed from initial)
    const projectChanged = activeProject?.path && activeProject.path !== initialProjectPath;

    if (projectChanged) {
      // Small delay to let modal close animation complete
      const timer = setTimeout(() => {
        advanceToNextStep();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [isActive, currentStep, activeProject?.path, initialProjectPath, advanceToNextStep]);

  // Note: send-chat-message uses manual advance ("Got it" button) after user types exact message

  // Auto-advance: Message sent (chat becomes busy) - after clicking send button
  useEffect(() => {
    if (!isActive || currentStep !== 'highlight-send-button') return;
    if (!activeProject?.path) return;

    const isChatBusy = claudeBusyPaths.has(activeProject.path);
    if (isChatBusy) {
      // Message was sent - advance to waiting
      advanceToNextStep();
    }
  }, [isActive, currentStep, activeProject?.path, claudeBusyPaths, advanceToNextStep]);

  // Auto-advance: Chat finished responding
  useEffect(() => {
    if (!isActive || currentStep !== 'wait-for-response') return;
    if (!activeProject?.path) return;

    const isChatBusy = claudeBusyPaths.has(activeProject.path);
    if (!isChatBusy) {
      // Chat finished - advance after longer delay to let chat scroll and settle
      // The version badge position changes as chat messages are added
      const timer = setTimeout(() => {
        advanceToNextStep();
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [isActive, currentStep, activeProject?.path, claudeBusyPaths, advanceToNextStep]);

  // Auto-advance: Build started
  useEffect(() => {
    if (!isActive || currentStep !== 'click-build') return;

    if (buildingPath) {
      // Build started - advance to waiting
      advanceToNextStep();
    }
  }, [isActive, currentStep, buildingPath, advanceToNextStep]);

  // Auto-advance: Build completed
  // We track build completion via buildingPath (from projectBusyStore)
  useEffect(() => {
    if (!isActive || currentStep !== 'wait-for-build') return;

    // Build completed when buildingPath becomes null
    // We enter this step when build starts, so !buildingPath means it finished
    if (!buildingPath) {
      const timer = setTimeout(() => {
        // Check if build failed by looking for the fix-error button
        const fixErrorButton = getTourElement('fix-error-button');
        if (fixErrorButton) {
          // Build failed - go to show-fix-error step
          advanceToStep('show-fix-error');
        } else {
          // Build succeeded - skip show-fix-error and go to launch-plugin
          advanceToStep('launch-plugin');
        }
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [isActive, currentStep, buildingPath, advanceToStep]);

  // Auto-advance: Fix error button clicked (chat becomes busy)
  // Go back to wait-for-response to wait for Claude to fix the code
  useEffect(() => {
    if (!isActive || currentStep !== 'show-fix-error') return;
    if (!activeProject?.path) return;

    const isChatBusy = claudeBusyPaths.has(activeProject.path);
    if (isChatBusy) {
      // Fix was clicked and chat is working - go back to waiting
      advanceToStep('wait-for-response');
    }
  }, [isActive, currentStep, activeProject?.path, claudeBusyPaths, advanceToStep]);

  // Auto-advance: Plugin launched
  useEffect(() => {
    if (!isActive || currentStep !== 'launch-plugin') return;

    if (loadedPlugin.status === 'active') {
      const timer = setTimeout(() => {
        advanceToNextStep();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [isActive, currentStep, loadedPlugin.status, advanceToNextStep]);

  // Auto-advance: Preview panel opened (controls button clicked)
  useEffect(() => {
    if (!isActive || currentStep !== 'open-controls') return;

    if (previewOpen) {
      const timer = setTimeout(() => {
        advanceToNextStep();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isActive, currentStep, previewOpen, advanceToNextStep]);

  // Auto-advance: Audio playing
  useEffect(() => {
    if (!isActive || currentStep !== 'click-play') return;

    if (isPlaying) {
      const timer = setTimeout(() => {
        advanceToNextStep();
      }, 2000); // Give them time to hear it
      return () => clearTimeout(timer);
    }
  }, [isActive, currentStep, isPlaying, advanceToNextStep]);

  // Capture initial project state when entering new-plugin-create step
  useEffect(() => {
    if (isActive && currentStep === 'new-plugin-create') {
      setInitialProjectPath(activeProject?.path);
    }
  }, [isActive, currentStep]);

  // Auto-advance: Skip sample selection step if no demo samples exist
  useEffect(() => {
    if (!isActive || currentStep !== 'select-sample') return;

    // If no demo samples are available, skip to the play button step
    if (demoSamples.length === 0) {
      const timer = setTimeout(() => {
        advanceToNextStep();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [isActive, currentStep, demoSamples.length, advanceToNextStep]);

  // Auto-advance: Drums sample button clicked (detect click directly, not state change)
  useEffect(() => {
    if (!isActive || currentStep !== 'select-sample') return;

    const drumsButton = getTourElement('sample-select');
    if (!drumsButton) return;

    const handleClick = () => {
      // Small delay to let the click complete
      setTimeout(() => {
        advanceToNextStep();
      }, 300);
    };

    drumsButton.addEventListener('click', handleClick);
    return () => drumsButton.removeEventListener('click', handleClick);
  }, [isActive, currentStep, advanceToNextStep]);

  // Handle skip tour
  const handleSkip = useCallback(() => {
    exitTour();
  }, [exitTour]);

  // Handle start tour (from welcome popup)
  const handleStart = useCallback(() => {
    advanceToNextStep();
  }, [advanceToNextStep]);

  // Handle manual next (for "Got it" buttons)
  const handleNext = useCallback(() => {
    // Special validation for send-chat-message step
    if (currentStep === 'send-chat-message' && stepConfig?.suggestedMessage) {
      // Get the chat input value from the DOM
      const chatInput = document.querySelector('textarea[placeholder*="Describe"]') as HTMLTextAreaElement;
      const inputValue = chatInput?.value?.trim() || '';
      const expectedMessage = stepConfig.suggestedMessage;

      if (inputValue !== expectedMessage) {
        // Don't advance - message doesn't match
        // Could show a toast or hint here
        return;
      }
    }
    advanceToNextStep();
  }, [advanceToNextStep, currentStep, stepConfig?.suggestedMessage]);

  // Handle complete tour
  const handleComplete = useCallback(() => {
    completeTour();
  }, [completeTour]);

  // Don't render if tour not active
  if (!isActive || !currentStep) {
    return null;
  }

  // Welcome popup
  if (currentStep === 'welcome') {
    return <TourWelcome onStart={handleStart} onSkip={handleSkip} />;
  }

  // Complete popup
  if (currentStep === 'complete') {
    return <TourComplete onClose={handleComplete} />;
  }

  // Waiting state
  if (stepConfig?.type === 'waiting') {
    return <TourWaiting message={stepConfig.message} onSkip={handleSkip} />;
  }

  // Spotlight step
  if (stepConfig?.type === 'spotlight') {
    return (
      <>
        <TourSpotlight targetElement={targetElement} />
        <TourStep
          step={stepConfig}
          targetElement={targetElement}
          onSkip={handleSkip}
          onNext={stepConfig.advanceOn === 'manual' ? handleNext : undefined}
        />
      </>
    );
  }

  return null;
}

// Export index file for convenient imports
export { TourSpotlight } from './TourSpotlight';
export { TourStep } from './TourStep';
export { TourWelcome } from './TourWelcome';
export { TourComplete } from './TourComplete';
export { TourWaiting } from './TourWaiting';
