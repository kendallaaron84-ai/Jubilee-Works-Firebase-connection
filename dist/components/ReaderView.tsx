import React, { useState, useRef, useEffect, useMemo } from 'react';
import { BookData, ReaderSettings, Highlight, Bookmark as BookmarkType, ThemeMode } from '../types';
import { sendTelemetry } from '../wordpressApi';
import { 
  ChevronLeft as ChevronLeftIcon, 
  ChevronRight as ChevronRightIcon, 
  Settings as SettingsIcon, 
  ArrowLeft as ArrowLeftIcon, 
  X as XIcon, 
  Bookmark as BookmarkIcon, 
  List as ListIcon, 
  Trash2 as Trash2Icon, 
  ShieldCheck,
  Highlighter,
  Check as CheckIcon
} from 'lucide-react';

const generateUUID = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

const MAX_PARAGRAPHS_PER_PAGE = 4;

const paginateContent = (htmlContent: string): string[] => {
  const div = document.createElement('div');
  div.innerHTML = htmlContent;
  const pages: string[] = [];
  let current = "";
  let pCount = 0;

  Array.from(div.children).forEach(node => {
    const isHeading = node.tagName === 'H2' || node.tagName === 'H3';
    if ((isHeading && current !== "") || (pCount >= MAX_PARAGRAPHS_PER_PAGE)) {
      pages.push(current);
      current = "";
      pCount = 0;
    }
    current += node.outerHTML;
    if (node.tagName === 'P') pCount++;
  });
  
  if (current) pages.push(current);
  return pages.length ? pages : ["<p class='italic opacity-30 text-center py-20'>This chapter is currently empty.</p>"];
};

interface ReaderViewProps {
  book: BookData;
  onBack: () => void;
  highlights: Highlight[];
  setHighlights: (highlights: Highlight[]) => void;
  bookmarks: BookmarkType[];
  setBookmarks: (bookmarks: BookmarkType[]) => void;
}

export const ReaderView: React.FC<ReaderViewProps> = ({ 
  book, 
  onBack, 
  highlights, 
  setHighlights, 
  bookmarks, 
  setBookmarks 
}) => {
  const [chapterIndex, setChapterIndex] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);
  const [showControls] = useState(true);
  const [settings, setSettings] = useState<ReaderSettings>({ 
    theme: 'dark', 
    fontSize: 110, 
    fontFamily: 'serif' 
  });
  
  const [showSettings, setShowSettings] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [selectionMenu, setSelectionMenu] = useState<{ x: number, y: number, text: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  
  const contentAreaRef = useRef<HTMLDivElement>(null);
  const toastTimeoutRef = useRef<number | null>(null);

  const chapter = book.chapters[chapterIndex];

  const showToast = (message: string) => {
    if (toastTimeoutRef.current) window.clearTimeout(toastTimeoutRef.current);
    setToast(message);
    toastTimeoutRef.current = window.setTimeout(() => setToast(null), 2500);
  };
  
  const pages = useMemo(() => {
    const rawPages = paginateContent(chapter?.content || "");
    const isFirstChapter = chapterIndex === 0;
    const hasCopyrightData = book.metadata.isbn || (book.metadata.copyrightYear && book.metadata.copyrightOwner);
    
    if (isFirstChapter && hasCopyrightData) {
      const copyrightHtml = `
        <div class="flex flex-col items-center justify-center text-center py-12 mb-12 min-h-[400px] select-none">
          <div class="opacity-10 mb-8"><svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M14.83 14.83a4 4 0 1 1 0-5.66"/></svg></div>
          <h2 class="text-2xl font-bold mb-4">${book.metadata.title}</h2>
          <p class="text-sm opacity-60 mb-8 uppercase tracking-[0.2em]">by ${book.metadata.author}</p>
          <div class="space-y-4 text-[11px] opacity-40 tracking-widest leading-relaxed">
            <p>© ${book.metadata.copyrightYear || new Date().getFullYear()} ${book.metadata.copyrightOwner || book.metadata.author}</p>
            <p>All rights reserved. No part of this publication may be reproduced or transmitted in any form.</p>
            ${book.metadata.isbn ? `<p class="mt-4 font-mono font-bold text-[10px]">ISBN: ${book.metadata.isbn}</p>` : ''}
          </div>
          <div class="mt-20 text-[8px] uppercase tracking-[0.4em] opacity-20">Secure Digital Edition • Published by Jubilee Works</div>
        </div>
      `;
      return [copyrightHtml, ...rawPages];
    }
    return rawPages;
  }, [chapter, chapterIndex, book.metadata]);

  useEffect(() => {
    const handleCopy = (e: ClipboardEvent) => {
      if (window.getSelection()?.toString().length === 0) return;
      e.preventDefault();
      if (e.clipboardData) e.clipboardData.setData('text/plain', 'Unauthorized reproduction prohibited. Protected by Jubilee Works.');
      alert("🔒 Content Protection Active: Text extraction is restricted.");
    };

    window.addEventListener('copy', handleCopy);
    return () => {
      window.removeEventListener('copy', handleCopy);
      if (toastTimeoutRef.current) window.clearTimeout(toastTimeoutRef.current);
    };
  }, []);

  const handleSelection = () => {
    const selection = window.getSelection();
    const selectedText = selection?.toString().trim();

    if (selectedText && selectedText.length > 0) {
      const range = selection?.getRangeAt(0);
      const rect = range?.getBoundingClientRect();
      if (rect) {
        setSelectionMenu({
          x: rect.left + rect.width / 2,
          y: rect.top + window.scrollY,
          text: selectedText
        });
      }
    } else {
      setSelectionMenu(null);
    }
  };

  const addHighlight = async () => {
    if (!selectionMenu) return;
    const newHighlight: Highlight = {
      id: generateUUID(),
      chapterId: chapter.id,
      text: selectionMenu.text,
      color: 'amber',
      date: Date.now()
    };
    setHighlights([...highlights, newHighlight]);
    setSelectionMenu(null);
    window.getSelection()?.removeAllRanges();
    showToast('Highlight Saved');

    try {
      await sendTelemetry('highlight', newHighlight);
    } catch (e) {
      console.warn("Telemetry connection offline:", e);
    }
  };

  const highlightedPageContent = useMemo(() => {
    let content = pages[pageIndex] || "";
    if (!content) return "";
    highlights.forEach(h => {
      if (h.chapterId === chapter.id) {
        const escaped = h.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escaped, 'gi');
        content = content.replace(regex, `<span class="bg-brand-amber/40 text-brand-amber border-b border-brand-amber/50 px-0.5 rounded shadow-sm inline-block transform transition-all hover:scale-[1.01]">${h.text}</span>`);
      }
    });
    return content;
  }, [pages, pageIndex, highlights, chapter?.id]);

  const addBookmark = async () => {
    const newBookmark: BookmarkType = {
      id: generateUUID(),
      chapterId: chapter.id,
      pageIndex: pageIndex,
      createdAt: Date.now(),
      previewText: `${chapter.title} - p.${pageIndex + 1}`
    };
    setBookmarks([newBookmark, ...bookmarks]);
    showToast('Bookmark Added');

    try {
      await sendTelemetry('bookmark', newBookmark);
    } catch (e) {
      console.warn("Telemetry connection offline:", e);
    }
  };

  const themeClasses: Record<ThemeMode, string> = {
    light: 'bg-paper text-ink',
    paper: 'bg-paper text-ink',
    sepia: 'bg-[#f4ecd8] text-[#433422]',
    cream: 'bg-[#fffdd0] text-gray-900',
    dark: 'bg-brand-blue text-brand-amber'
  };

  const scrollToTop = () => { if (contentAreaRef.current) contentAreaRef.current.scrollTo({ top: 0, behavior: 'smooth' }); };

  const handlePrevPage = () => {
    if (pageIndex > 0) { setPageIndex(pageIndex - 1); scrollToTop(); }
    else if (chapterIndex > 0) {
      const prevIdx = chapterIndex - 1;
      const prevPages = paginateContent(book.chapters[prevIdx].content);
      setChapterIndex(prevIdx);
      setPageIndex(prevPages.length - 1);
      scrollToTop();
    }
  };

  const handleNextPage = () => {
    if (pageIndex < pages.length - 1) { setPageIndex(pageIndex + 1); scrollToTop(); }
    else if (chapterIndex < book.chapters.length - 1) { setChapterIndex(chapterIndex + 1); setPageIndex(0); scrollToTop(); }
  };

  const isDark = settings.theme === 'dark';

  return (
    <div className={`h-full flex flex-col transition-all duration-500 overflow-hidden ${themeClasses[settings.theme]}`}>
      {toast && (
        <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-[60] animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="bg-brand-amber text-brand-blue px-6 py-2.5 rounded-full font-black text-[10px] uppercase tracking-[0.2em] shadow-2xl flex items-center gap-3 border border-white/20 backdrop-blur-md">
            <CheckIcon className="w-4 h-4" />
            {toast}
          </div>
        </div>
      )}

      {/* Top Navigation Bar */}
      <div className={`sticky top-0 w-full h-16 bg-black/90 backdrop-blur-xl border-b border-white/10 z-[100] transition-transform duration-300 ${showControls ? 'translate-y-0' : '-translate-y-full'}`}>
        <div className="max-w-4xl mx-auto h-full px-4 flex items-center justify-between">
          <div className="flex gap-4 items-center">
            <button onClick={onBack} className="p-2 text-white hover:bg-white/10 rounded-xl transition-colors">
              <ArrowLeftIcon className="w-5 h-5"/>
            </button>
            <div className="text-xs font-black uppercase tracking-widest text-white opacity-50">
              {Math.round(((chapterIndex * MAX_PARAGRAPHS_PER_PAGE + pageIndex) / (book.chapters.length * MAX_PARAGRAPHS_PER_PAGE)) * 100)}% READ
            </div>
          </div>
          
          <div className="flex gap-2 items-center">
            <button onClick={addBookmark} className="p-2 text-white hover:bg-white/10 rounded-xl opacity-70 hover:opacity-100" title="Bookmark Page">
              <BookmarkIcon className="w-4 h-4"/>
            </button>
            <button onClick={() => setShowMenu(true)} className="p-2 text-white hover:bg-white/10 rounded-xl opacity-70 hover:opacity-100" title="Table of Contents">
              <ListIcon className="w-4 h-4"/>
            </button>
            <button onClick={() => setShowSettings(true)} className="p-2 text-white hover:bg-white/10 rounded-xl opacity-70 hover:opacity-100" title="Display Preferences">
              <SettingsIcon className="w-4 h-4"/>
            </button>
          </div>
        </div>
      </div>

      {/* Reader Content Area */}
      <div className="flex-1 relative flex flex-col items-center overflow-hidden cursor-default" onMouseUp={handleSelection}>
        <div ref={contentAreaRef} className="max-w-xl w-full h-full px-8 py-10 md:py-16 overflow-y-auto no-scrollbar scroll-smooth">
           <div 
            className={`reader-content-inner prose prose-lg ${settings.theme === 'dark' ? 'prose-invert text-brand-amber' : 'text-ink'} max-w-none leading-[1.9] select-text`}
            style={{ fontSize: `${settings.fontSize}%`, fontFamily: settings.fontFamily === 'serif' ? 'Merriweather, serif' : 'Inter, sans-serif' }}
            dangerouslySetInnerHTML={{ __html: highlightedPageContent }} 
           />
        </div>

        {/* Floating Highlight Menu */}
        {selectionMenu && (
          <div className="fixed z-50 animate-in fade-in zoom-in-95 duration-200" style={{ left: selectionMenu.x, top: selectionMenu.y - 60, transform: 'translateX(-50%)' }}>
            <button onClick={addHighlight} className="flex items-center gap-2 px-4 py-2 bg-brand-amber text-brand-blue rounded-full font-black text-[10px] uppercase tracking-widest shadow-2xl hover:scale-105 active:scale-95 transition-all border border-white/20">
              <Highlighter className="w-3.5 h-3.5" /> Highlight
            </button>
            <div className="w-3 h-3 bg-brand-amber absolute -bottom-1.5 left-1/2 -translate-x-1/2 rotate-45 shadow-2xl"></div>
          </div>
        )}

        {/* Intellectual Property Watermark Shield */}
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center opacity-[0.03] overflow-hidden select-none">
          <div className="rotate-[-30deg] text-[10rem] font-black uppercase whitespace-nowrap">KOBA-I SECURE</div>
        </div>
      </div>

      {/* Bottom Layout Navigation */}
      <div className="px-6 py-4 flex flex-col items-center gap-4 bg-black/20 border-t border-white/5 z-30 select-none">
        <div className="flex w-full max-w-xs gap-3">
          <button onClick={handlePrevPage} className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[9px] font-black tracking-widest uppercase transition-all shadow-md bg-brand-red text-brand-amber hover:brightness-110 active:scale-95 border border-white/5"><ChevronLeftIcon className="w-4 h-4"/> Prev</button>
          <button onClick={handleNextPage} className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[9px] font-black tracking-widest uppercase transition-all shadow-md bg-brand-red text-brand-amber hover:brightness-110 active:scale-95 border border-white/5">Next <ChevronRightIcon className="w-4 h-4"/></button>
        </div>
        <div className={`flex items-center gap-2 text-[8px] font-black ${isDark ? 'text-brand-amber/20' : 'text-ink/20'} uppercase tracking-[0.5em] pb-1`}><ShieldCheck className="w-3 h-3" /> PROTECTED BY KOBA INNOVATION © 2026</div>
      </div>

      {/* Preferences Tuning Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-brand-blue/70 z-50 flex items-center justify-center p-4 backdrop-blur-md" onClick={() => setShowSettings(false)}>
           <div className="bg-brand-blue-light p-8 rounded-3xl shadow-2xl w-full max-w-xs space-y-8 border border-white/10" onClick={e => e.stopPropagation()}>
              <h3 className="font-black text-center uppercase tracking-[0.2em] text-[10px] text-brand-amber">Preferences</h3>
              <div className="space-y-4">
                <label className="text-[9px] font-black text-white/40 uppercase tracking-widest">Theme Palette</label>
                <div className="grid grid-cols-5 gap-2">
                  {(['light','paper','sepia','cream','dark'] as ThemeMode[]).map(t => (
                    <button key={t} onClick={() => setSettings({...settings, theme: t})} className={`h-8 w-8 rounded-full border-2 transition-all ${settings.theme === t ? 'border-brand-amber scale-110 shadow-lg' : 'border-transparent opacity-40 hover:opacity-100'}`} style={{ backgroundColor: t === 'light' ? '#fff' : t === 'paper' ? '#fdfbf7' : t === 'sepia' ? '#f4ecd8' : t === 'cream' ? '#fffdd0' : '#1A2B56' }} />
                  ))}
                </div>
              </div>
              <div className="space-y-4">
                <div className="flex justify-between items-center text-[9px] font-black text-white/40 uppercase">
                  <label>Font Scaling</label><span className="text-brand-amber">{settings.fontSize}%</span>
                </div>
                <input type="range" min="80" max="180" step="5" value={settings.fontSize} onChange={e => setSettings({...settings, fontSize: Number(e.target.value)})} className="w-full accent-brand-amber h-1 bg-brand-blue rounded-lg appearance-none cursor-pointer" />
              </div>
              <div className="space-y-4">
                <label className="text-[9px] font-black text-white/40 uppercase tracking-widest">Typography</label>
                <div className="flex gap-2">
                  <button onClick={() => setSettings({...settings, fontFamily: 'serif'})} className={`flex-1 py-3 border rounded-xl text-[9px] font-serif font-black transition-all ${settings.fontFamily === 'serif' ? 'bg-brand-amber text-brand-blue border-brand-amber' : 'bg-transparent border-white/10 text-white/50 hover:text-white'}`}>Serif</button>
                  <button onClick={() => setSettings({...settings, fontFamily: 'sans'})} className={`flex-1 py-3 border rounded-xl text-[9px] font-sans font-black transition-all ${settings.fontFamily === 'sans' ? 'bg-brand-amber text-brand-blue border-brand-amber' : 'bg-transparent border-white/10 text-white/50 hover:text-white'}`}>Sans</button>
                </div>
              </div>
              <button onClick={() => setShowSettings(false)} className="w-full py-4 bg-brand-red text-brand-amber rounded-2xl font-black text-[10px] tracking-widest uppercase shadow-xl hover:brightness-110 transition-all border border-white/5">Apply</button>
           </div>
        </div>
      )}

      {/* Navigation Index Slide-Out */}
      {showMenu && (
        <div className="fixed inset-0 bg-brand-blue/70 backdrop-blur-md z-50 flex justify-end" onClick={() => setShowMenu(false)}>
          <div className="w-full max-w-xs bg-brand-blue-light h-full shadow-2xl flex flex-col border-l border-white/10" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-white/10 flex justify-between items-center"><h3 className="font-bold font-serif text-brand-amber text-lg">Table of Contents</h3><button onClick={() => setShowMenu(false)} className="p-2 text-white/40 hover:text-white transition-all"><XIcon className="w-5 h-5"/></button></div>
            <div className="flex-1 overflow-y-auto p-4 space-y-8 no-scrollbar">
              <section>
                <div className="flex items-center gap-2 mb-4 text-[10px] font-black text-brand-amber uppercase tracking-widest"><BookmarkIcon className="w-3 h-3"/> Session Bookmarks</div>
                {bookmarks.length === 0 ? <p className="text-[10px] italic opacity-30 px-2">No bookmarks saved.</p> : (
                  <div className="space-y-2">
                    {bookmarks.map(b => (
                      <div key={b.id} className="group relative p-4 bg-brand-blue rounded-xl text-[11px] hover:bg-white/5 cursor-pointer border border-white/5 transition-all" onClick={() => {
                        const cIdx = book.chapters.findIndex(c => c.id === b.chapterId);
                        if (cIdx !== -1) { setChapterIndex(cIdx); setPageIndex(b.pageIndex); setShowMenu(false); scrollToTop(); }
                      }}>
                        <div className="font-black text-brand-amber mb-1">{b.previewText}</div>
                        <button onClick={(e) => { e.stopPropagation(); setBookmarks(bookmarks.filter(mark => mark.id !== b.id)); }} className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 p-1.5 text-brand-red hover:bg-white/10 rounded-lg"><Trash2Icon className="w-3 h-3"/></button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
              <section>
                <div className="flex items-center gap-2 mb-4 text-[10px] font-black text-brand-amber uppercase tracking-widest">Chapters</div>
                <div className="space-y-1">
                  {book.chapters.map((c, idx) => (
                    <button key={c.id} onClick={() => { setChapterIndex(idx); setPageIndex(0); setShowMenu(false); scrollToTop(); }} className={`w-full text-left p-3 rounded-xl text-xs transition-all ${chapterIndex === idx ? 'bg-brand-red text-brand-amber font-bold' : 'hover:bg-white/5 text-white/60'}`}>{idx + 1}. {c.title}</button>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};