import React, { useState, useRef, useEffect } from 'react';
import { Globe, ChevronDown, Check, Loader2 } from 'lucide-react';
import { useLanguage } from '../../contexts/LanguageContext';

export const LanguageSelector = ({ compact = false }) => {
  const {
    language,
    currentLanguageMeta,
    supportedLanguages,
    changeLanguage,
    isTranslating,
    isLoadingLanguages
  } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="relative inline-block text-left" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="true"
        disabled={isTranslating}
        className={`flex items-center gap-1.5 ${
          compact ? 'px-2 py-1 text-xs' : 'px-2.5 sm:px-3 py-1.5 text-xs sm:text-sm'
        } rounded-xs border-2 border-dark-neutral bg-warm-ivory font-black text-dark-neutral shadow-[2px_2px_0px_#22252A] hover:-translate-x-[1px] hover:-translate-y-[1px] hover:shadow-brutal-sm active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all duration-micro ease-tactile focus-visible:ring-2 focus-visible:ring-dark-neutral focus-visible:outline-none disabled:opacity-75 cursor-pointer`}
        title="Select Language / भाषा चुनें (Digital India Bhashini)"
      >
        {isTranslating ? (
          <Loader2 className="w-3.5 h-3.5 text-forest-green shrink-0 animate-spin" />
        ) : (
          <Globe className="w-3.5 h-3.5 text-forest-green shrink-0" />
        )}
        <span className="font-extrabold">{currentLanguageMeta?.nativeName || 'English'}</span>
        <ChevronDown className={`w-3 h-3 text-dark-neutral-muted transition-transform duration-micro ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-1.5 w-52 rounded-xs border-2 border-dark-neutral bg-white shadow-brutal z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-100">
          <div className="bg-forest-green px-3 py-2 border-b border-dark-neutral flex items-center justify-between">
            <span className="text-[10px] font-black tracking-wider uppercase text-white block">
              Bhashini Languages
            </span>
            <span className="text-[9px] font-mono bg-white/20 text-white px-1.5 py-0.5 rounded-xs">
              {supportedLanguages.length} Active
            </span>
          </div>
          <div className="max-h-64 overflow-y-auto py-1 divide-y divide-gray-100">
            {isLoadingLanguages ? (
              <div className="p-3 text-center text-xs text-dark-neutral-muted flex items-center justify-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-forest-green" />
                <span>Loading languages...</span>
              </div>
            ) : (
              supportedLanguages.map((lang) => {
                const isSelected = lang.code === language;
                return (
                  <button
                    key={lang.code}
                    data-lang={lang.code}
                    type="button"
                    onClick={() => {
                      changeLanguage(lang.code);
                      setIsOpen(false);
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 text-left text-xs transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-forest-green/10 font-black text-forest-green'
                        : 'font-bold text-dark-neutral hover:bg-warm-ivory'
                    }`}
                  >
                    <div className="flex flex-col">
                      <span className="text-xs font-black">{lang.nativeName}</span>
                      <span className="text-[10px] text-dark-neutral-muted">{lang.name}</span>
                    </div>
                    {isSelected && <Check className="w-3.5 h-3.5 text-forest-green shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default LanguageSelector;
