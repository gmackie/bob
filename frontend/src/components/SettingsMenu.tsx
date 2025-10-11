import { useState, useEffect, useRef } from 'react';
import '../styles/SettingsMenu.css';

export function SettingsMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const [keepTerminalsWarm, setKeepTerminalsWarm] = useState(true);
  const menuRef = useRef<HTMLDivElement>(null);

  // Load setting from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('keepAgentTerminalsWarm');
    if (saved !== null) {
      setKeepTerminalsWarm(saved === 'true');
    }
  }, []);

  // Save setting to localStorage
  const handleToggle = () => {
    const newValue = !keepTerminalsWarm;
    setKeepTerminalsWarm(newValue);
    localStorage.setItem('keepAgentTerminalsWarm', String(newValue));
  };

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  return (
    <div className="settings-menu" ref={menuRef}>
      <button
        className="settings-button"
        onClick={() => setIsOpen(!isOpen)}
        title="Settings"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M12 1v6m0 6v6m-6-6h6m6 0h6M4.22 4.22l4.24 4.24m7.08 0l4.24-4.24M4.22 19.78l4.24-4.24m7.08 0l4.24 4.24"></path>
        </svg>
      </button>

      {isOpen && (
        <div className="settings-dropdown">
          <div className="settings-section">
            <div className="settings-item">
              <label className="settings-label">
                <span>Keep agent terminals warm</span>
                <input
                  type="checkbox"
                  checked={keepTerminalsWarm}
                  onChange={handleToggle}
                  className="settings-checkbox"
                />
              </label>
              <p className="settings-description">
                Maintain terminal connections when switching between agents
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
