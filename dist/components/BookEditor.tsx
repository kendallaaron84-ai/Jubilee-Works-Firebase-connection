import React, { useState, useEffect, useRef } from 'react';
import { BookData, Chapter, StoryLength, BookReview, Guardrail, VoiceDefinition } from '../types';
import { saveManuscript } from '../wordpressApi';
import { 
  generateStoryWizardStructure, 
  generateNextChapterParagraph, 
  autoFormatContent, 
  reviewFullBook, 
  applyReviewSuggestions,
  generateBookIdeas
} from '../services/geminiService';
import { 
  Plus, ArrowLeft, 
  Wand2, CircleDashed, X, Lightbulb, Check, Eye, EyeOff,
  BookOpen, Sparkles, PenTool, AlignLeft, ClipboardCheck, AlertCircle, Sparkle,
  Image as ImageIcon, Upload, Trash2, ShieldCheck, Volume2, Mic,
  Map as MapIcon, Ghost, Heart, BarChart3, TrendingUp, Hash, Copyright, Edit3, Settings
} from 'lucide-react';

// 1. ONLY ONE generateUUID function, safely outside the component
const generateUUID = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID(); 
  }
  // Bulletproof fallback for non-HTTPS environments
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

interface BookEditorProps {
  book: BookData;
  setBook: (book: BookData) => void;
  onBack: () => void;
}

type EditorTab = 'content' | 'settings' | 'guardrails';

const SYSTEM_VOICES = ['Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir'];

export const BookEditor: React.FC<BookEditorProps> = ({ book, setBook, onBack }) => {
  const [activeChapterId, setActiveChapterId] = useState<string | null>(book.chapters[0]?.id || null);
  const [activeTab, setActiveTab] = useState<EditorTab>('content');
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'idle'>('saved');
  const [localText, setLocalText] = useState("");
  const [showWizard, setShowWizard] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isAutoWriting, setIsAutoWriting] = useState(false);
  const [isFormatting, setIsFormatting] = useState(false);
  
  const [sparkedIdeas, setSparkedIdeas] = useState<string[]>([]);
  const [isSparking, setIsSparking] = useState(false);
  const [showIdeasModal, setShowIdeasModal] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [isApplyingReview, setIsApplyingReview] = useState(false);
  const [reviewResult, setReviewResult] = useState<BookReview | null>(null);
  const [wizardTopic, setWizardTopic] = useState("");
  const [wizardDesc, setWizardDesc] = useState("");
  const [wizardLength, setWizardLength] = useState<StoryLength>("5-min");
  const [customMinutes, setCustomMinutes] = useState<number>(20);
  
  // Voice Management State
  const [editingVoice, setEditingVoice] = useState<VoiceDefinition | null>(null);
  const [isAddingVoice, setIsAddingVoice] = useState(false);
  
  const saveTimeoutRef = useRef<number | null>(null);
  const activeChapter = book.chapters.find(c => c.id === activeChapterId);

  // 2. The Idea Generator function safely INSIDE the component
  const handleCreateBookFromIdea = (ideaText: string) => {
      if (!window.confirm("Start a new book based on this idea? Your current work will be safely stored.")) {
          return;
      }

      const newBookId = generateUUID(); 

      const newBook: BookData = {
          id: newBookId,
          metadata: {
              title: "Untitled Draft",
              description: ideaText, 
              mood: "",
              setting: "",
              emotion: ""
          },
          chapters: [
              {
                  id: generateUUID(),
                  title: "Chapter 1",
                  content: "",
                  status: 'draft',
                  lastModified: Date.now()
              }
          ],
          lastModified: Date.now()
      };

      setBook(newBook); // Changed to setBook!
      setSparkedIdeas([]);
  };

  useEffect(() => {
    if (activeChapter) {
      const text = activeChapter.content
        .replace(/<p>/g, '')
        .replace(/<\/p>/g, '\n')
        .replace(/<h2>/g, '## ')
        .replace(/<\/h2>/g, '')
        .replace(/<h3>/g, '### ')
        .replace(/<\/h3>/g, '')
        .trim();
      setLocalText(text);
      setSaveStatus('saved');
    }
  }, [activeChapterId]);

  const updateMetadata = (field: keyof typeof book.metadata, value: any) => {
    setBook({ ...book, metadata: { ...book.metadata, [field]: value } });
  };

  const updateChapter = (id: string, updates: Partial<Chapter>) => {
    setBook({
      ...book,
      chapters: book.chapters.map(c => c.id === id ? { ...c, ...updates, lastModified: Date.now() } : c)
    });
  };

  const convertToHtml = (text: string) => {
    return text.split('\n').map(l => {
      if (!l.trim()) return "";
      if (l.startsWith('###')) return `<h3>${l.replace('###','').trim()}</h3>`;
      if (l.startsWith('##')) return `<h2>${l.replace('##','').trim()}</h2>`;
      return `<p>${l}</p>`;
    }).join('');
  };

  const handleTextChange = (newVal: string) => {
    setLocalText(newVal);
    setSaveStatus('saving');
    if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current);
    
    saveTimeoutRef.current = window.setTimeout(async () => {
      if (!activeChapter) return;
      const html = convertToHtml(newVal);
      
      // 1. Build out the freshly updated structural frame
      const updatedChapters = book.chapters.map(c => 
        c.id === activeChapter.id ? { ...c, content: html, lastModified: Date.now() } : c
      );
      const updatedBookState = { ...book, chapters: updatedChapters, lastModified: Date.now() };
      
      // 2. Commit the change locally to React state
      setBook(updatedBookState);
      
      try {
        // 3. Inject payload down into the WordPress REST backend architecture
        await saveManuscript(updatedBookState);
        setSaveStatus('saved');
      } catch (err) {
        console.error("Database sync failed:", err);
        setSaveStatus('idle');
      }
    }, 1200); // 1.2s debounce buffer optimal for server requests
  };

  const addGuardrail = (type: Guardrail['type']) => {
    const newGuard: Guardrail = {
      id: generateUUID(),
      type,
      name: `New ${type.charAt(0).toUpperCase() + type.slice(1)}`,
      content: ''
    };
    updateMetadata('guardrails', [...(book.metadata.guardrails || []), newGuard]);
  };

  const removeGuardrail = (id: string) => {
    updateMetadata('guardrails', (book.metadata.guardrails || []).filter(g => g.id !== id));
  };

  const updateGuardrail = (id: string, updates: Partial<Guardrail>) => {
    updateMetadata('guardrails', (book.metadata.guardrails || []).map(g => g.id === id ? { ...g, ...updates } : g));
  };

  const handleReferenceUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const newGuard: Guardrail = {
        id: generateUUID(),
        type: 'style-reference',
        name: file.name,
        content: content.slice(0, 5000)
      };
      updateMetadata('guardrails', [...(book.metadata.guardrails || []), newGuard]);
    };
    reader.readAsText(file);
  };

  const handleAutoFormat = async () => {
    if (!activeChapter) return;
    setIsFormatting(true);
    try {
      const formattedHtml = await autoFormatContent(localText);
      const cleanText = formattedHtml
        .replace(/<p>/g, '')
        .replace(/<\/p>/g, '\n')
        .replace(/<h2>/g, '## ')
        .replace(/<\/h2>/g, '')
        .replace(/<h3>/g, '### ')
        .replace(/<\/h3>/g, '')
        .trim();
      
      setLocalText(cleanText);
      updateChapter(activeChapter.id, { content: formattedHtml });
      setSaveStatus('saved');
    } catch (err) { console.error(err); } finally { setIsFormatting(false); }
  };

  const handleGetUnstuck = async () => {
    if (!activeChapter) return;
    setIsAutoWriting(true);
    try {
      const currentChapterState = { ...activeChapter, content: convertToHtml(localText) };
      const prevChapters = book.chapters.filter(c => c.id !== activeChapter.id);
      const nextPara = await generateNextChapterParagraph(currentChapterState, book.metadata, prevChapters);
      if (nextPara) {
        const updatedText = localText.trim() + "\n\n" + nextPara;
        handleTextChange(updatedText);
      }
    } catch (err) { console.error(err); } finally { setIsAutoWriting(false); }
  };

  const handleSparkIdea = async () => {
    setIsSparking(true);
    try {
      const ideas = await generateBookIdeas(book);
      setSparkedIdeas(ideas);
      setShowIdeasModal(true);
    } catch (err) { console.error(err); } finally { setIsSparking(false); }
  };

  const handleReviewBook = async () => {
    setIsReviewing(true);
    try {
      const review = await reviewFullBook(book);
      if (review) setReviewResult(review);
    } catch (err) { console.error(err); } finally { setIsReviewing(false); }
  };

  const handleAcceptReview = async () => {
    if (!reviewResult) return;
    setIsApplyingReview(true);
    try {
      const updatedChapters = await applyReviewSuggestions(book, reviewResult);
      setBook({ ...book, chapters: updatedChapters });
      setReviewResult(null);
    } catch (err) { console.error(err); } finally { setIsApplyingReview(false); }
  };

  const addChapter = () => {
    const newId = generateUUID();
    const newChapter: Chapter = { id: newId, title: `Chapter ${book.chapters.length + 1}`, content: '', lastModified: Date.now() };
    setBook({ ...book, chapters: [...book.chapters, newChapter] });
    setActiveChapterId(newId);
  };

  const handleStartWizard = async () => {
    if (!wizardTopic) return;
    setIsGenerating(true);
    try {
      const durationString = wizardLength === 'custom' ? `${customMinutes}-min` : wizardLength;
      const result = await generateStoryWizardStructure(wizardTopic, wizardDesc, durationString);
      if (result) {
        const newChapters = result.chapters.map((ch: any) => ({
          id: generateUUID(),
          title: ch.title,
          content: `<h2>${ch.title}</h2><p>${ch.summary}</p>`,
          lastModified: Date.now()
        }));
        setBook({
          ...book,
          metadata: {
            ...book.metadata,
            title: result.title || book.metadata.title,
            author: result.author || book.metadata.author,
            description: result.description || wizardDesc || book.metadata.description
          },
          chapters: newChapters
        });
        if (newChapters.length > 0) setActiveChapterId(newChapters[0].id);
        setShowWizard(false);
      }
    } catch (err) { console.error(err); } finally { setIsGenerating(false); }
  };

  // Voice Management Handlers
  const handleSaveVoice = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingVoice) return;
    
    const voices = book.metadata.availableVoices || [];
    const exists = voices.find(v => v.localId === editingVoice.localId);
    
    let updatedVoices;
    if (exists) {
      updatedVoices = voices.map(v => v.localId === editingVoice.localId ? editingVoice : v);
    } else {
      updatedVoices = [...voices, editingVoice];
    }
    
    updateMetadata('availableVoices', updatedVoices);
    setEditingVoice(null);
    setIsAddingVoice(false);
  };

  const handleDeleteVoice = (localId: string) => {
    const voices = (book.metadata.availableVoices || []).filter(v => v.localId !== localId);
    updateMetadata('availableVoices', voices);
    if (book.metadata.voiceURI === book.metadata.availableVoices?.find(v => v.localId === localId)?.id) {
       updateMetadata('voiceURI', voices[0]?.id || 'Zephyr');
    }
  };

  const currentVoices = book.metadata.availableVoices || [];

  return (
    <div className="flex h-full bg-brand-blue text-app-text overflow-hidden select-none font-sans">
      {/* Sidebar */}
      <aside className="w-80 border-r border-app-border flex flex-col bg-brand-blue-light/50 backdrop-blur-xl shadow-2xl z-20 overflow-hidden">
        <div className="p-6 flex flex-col gap-4">
          <button 
            onClick={onBack} 
            className="group flex items-center text-[10px] font-black uppercase tracking-widest text-brand-amber/60 hover:text-brand-amber transition-all"
          >
            <ArrowLeft className="w-4 h-4 mr-2 group-hover:-translate-x-1 transition-transform" /> 
            Library
          </button>
          
          <div className="flex bg-black/30 p-1.5 rounded-2xl border border-app-border">
            <button 
              onClick={() => setActiveTab('content')} 
              className={`flex-1 py-2.5 text-[10px] font-black rounded-xl transition-all uppercase tracking-widest flex items-center justify-center gap-2 ${activeTab === 'content' ? 'bg-brand-red text-brand-amber shadow-lg shadow-brand-red/20 border border-white/5' : 'text-app-text/30 hover:text-app-text/50'}`}
            >
              <PenTool className="w-3.5 h-3.5"/> Editor
            </button>
            <button 
              onClick={() => setActiveTab('settings')} 
              className={`flex-1 py-2.5 text-[10px] font-black rounded-xl transition-all uppercase tracking-widest flex items-center justify-center gap-2 ${activeTab === 'settings' ? 'bg-brand-red text-brand-amber shadow-lg shadow-brand-red/20 border border-white/5' : 'text-app-text/30 hover:text-app-text/50'}`}
            >
              <Settings className="w-3.5 h-3.5"/> Book
            </button>
            <button 
              onClick={() => setActiveTab('guardrails')} 
              className={`flex-1 py-2.5 text-[10px] font-black rounded-xl transition-all uppercase tracking-widest flex items-center justify-center gap-2 ${activeTab === 'guardrails' ? 'bg-brand-red text-brand-amber shadow-lg shadow-brand-red/20 border border-white/5' : 'text-app-text/30 hover:text-app-text/50'}`}
            >
              <ShieldCheck className="w-3.5 h-3.5"/> Style
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-6 custom-scroll">
          {activeTab === 'content' ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between px-2">
                <h3 className="text-[10px] font-black text-brand-amber uppercase tracking-[0.3em]">Manuscript Structure</h3>
              </div>
              <div className="space-y-1.5">
                {book.chapters.map((c, i) => (
                  <button 
                    key={c.id} 
                    onClick={() => setActiveChapterId(c.id)} 
                    className={`w-full p-4 rounded-2xl text-left text-xs flex justify-between items-center group transition-all border ${activeChapterId === c.id ? 'bg-brand-red text-brand-amber shadow-xl border-white/10' : 'bg-white/5 border-transparent hover:bg-white/10 text-app-text/60'}`}
                  >
                    <span className="truncate font-bold"><span className="opacity-30 mr-2">{i+1}.</span> {c.title}</span>
                  </button>
                ))}
              </div>
              <button 
                onClick={addChapter} 
                className="w-full flex items-center justify-center gap-2 py-4 bg-brand-amber/5 text-brand-amber rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] hover:bg-brand-amber/10 transition-all border border-brand-amber/20"
              >
                <Plus className="w-4 h-4"/> New Chapter
              </button>
            </div>
          ) : activeTab === 'guardrails' ? (
            <div className="space-y-8">
              <section>
                <div className="flex justify-between items-center mb-4 px-2">
                  <h3 className="text-[10px] font-black text-brand-amber uppercase tracking-[0.3em]">Guardrails</h3>
                  <div className="flex gap-1">
                    <button onClick={() => addGuardrail('setting')} title="Add Setting" className="p-2 bg-brand-amber/10 text-brand-amber rounded-xl hover:bg-brand-amber/20 transition-colors"><MapIcon className="w-4 h-4"/></button>
                    <button onClick={() => addGuardrail('mood')} title="Add Mood" className="p-2 bg-brand-amber/10 text-brand-amber rounded-xl hover:bg-brand-amber/20 transition-colors"><Ghost className="w-4 h-4"/></button>
                    <button onClick={() => addGuardrail('emotion')} title="Add Emotion" className="p-2 bg-brand-amber/10 text-brand-amber rounded-xl hover:bg-brand-amber/20 transition-colors"><Heart className="w-4 h-4"/></button>
                  </div>
                </div>
                
                <div className="space-y-3">
                  {(book.metadata.guardrails || []).map(g => (
                    <div key={g.id} className="bg-white/5 border border-app-border rounded-2xl p-4 relative group hover:border-brand-amber/30 transition-all">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="p-1.5 bg-black/30 rounded-lg">
                          {g.type === 'setting' && <MapIcon className="w-3.5 h-3.5 text-blue-400" />}
                          {g.type === 'mood' && <Ghost className="w-3.5 h-3.5 text-purple-400" />}
                          {g.type === 'emotion' && <Heart className="w-3.5 h-3.5 text-red-400" />}
                        </div>
                        <input 
                          value={g.name} 
                          onChange={e => updateGuardrail(g.id, { name: e.target.value })}
                          className="bg-transparent border-none text-[10px] font-black uppercase tracking-widest text-brand-amber focus:ring-0 p-0 w-full"
                        />
                        <button onClick={() => removeGuardrail(g.id)} className="opacity-0 group-hover:opacity-100 p-1.5 text-brand-red/50 hover:text-brand-red transition-all"><Trash2 className="w-4 h-4"/></button>
                      </div>
                      <textarea 
                        value={g.content}
                        onChange={e => updateGuardrail(g.id, { content: e.target.value })}
                        placeholder={`Define ${g.type}...`}
                        className="w-full bg-transparent border-none focus:ring-0 text-xs p-0 text-app-text/50 resize-none h-20 custom-scroll leading-relaxed"
                      />
                    </div>
                  ))}
                  <div className="pt-4">
                    <label className="flex items-center justify-center gap-2 w-full py-4 bg-brand-amber/5 text-brand-amber rounded-2xl text-[10px] font-black uppercase tracking-widest border border-brand-amber/20 cursor-pointer hover:bg-brand-amber/10 transition-all group">
                      <Upload className="w-4 h-4 group-hover:-translate-y-0.5 transition-transform" /> 
                      Reference Document
                      <input type="file" className="hidden" accept=".txt,.md" onChange={handleReferenceUpload} />
                    </label>
                  </div>
                </div>
              </section>
            </div>
          ) : (
            <div className="space-y-8">
              <section className="bg-black/20 p-5 rounded-2xl border border-app-border">
                <h3 className="text-[10px] font-black text-brand-amber uppercase tracking-[0.3em] mb-4">Availability</h3>
                <div className="flex bg-black/30 p-1.5 rounded-xl border border-app-border">
                  <button 
                    onClick={() => updateMetadata('status', 'draft')} 
                    className={`flex-1 flex items-center justify-center gap-2 py-3 text-[9px] font-black rounded-lg transition-all tracking-widest ${book.metadata.status === 'draft' ? 'bg-brand-red text-brand-amber shadow-lg border border-white/5' : 'text-app-text/20 hover:text-app-text/40'}`}
                  >
                    <EyeOff className="w-3.5 h-3.5"/> DRAFT
                  </button>
                  <button 
                    onClick={() => updateMetadata('status', 'published')} 
                    className={`flex-1 flex items-center justify-center gap-2 py-3 text-[9px] font-black rounded-lg transition-all tracking-widest ${book.metadata.status === 'published' ? 'bg-brand-red text-brand-amber shadow-lg border border-white/5' : 'text-app-text/20 hover:text-app-text/40'}`}
                  >
                    <Eye className="w-3.5 h-3.5"/> PUBLISHED
                  </button>
                </div>
              </section>

              <section className="space-y-4">
                <div className="flex justify-between items-center px-2">
                  <h3 className="text-[10px] font-black text-brand-amber uppercase tracking-[0.3em]">Narration Setup</h3>
                  <button 
                    onClick={() => {
                      setEditingVoice({ localId: generateUUID(), id: 'Zephyr', name: 'New Character Voice' });
                      setIsAddingVoice(true);
                    }}
                    className="p-2 bg-brand-amber/10 text-brand-amber rounded-xl hover:bg-brand-amber/20 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
                
                <div className="relative group">
                  <select 
                    value={book.metadata.voiceURI || 'Zephyr'} 
                    onChange={e => updateMetadata('voiceURI', e.target.value)}
                    className="w-full bg-white/5 border border-app-border rounded-2xl p-4 text-xs text-app-text/70 outline-none focus:ring-1 focus:ring-brand-amber/30 transition-all appearance-none cursor-pointer pr-12 group-hover:border-brand-amber/20"
                  >
                    {currentVoices.map(v => (
                      <option key={v.localId} value={v.id}>{v.name}</option>
                    ))}
                    {currentVoices.length === 0 && <option value="Zephyr">Zephyr (Default)</option>}
                  </select>
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 p-1.5 bg-brand-amber/10 rounded-lg pointer-events-none">
                    <Mic className="w-4 h-4 text-brand-amber opacity-60" />
                  </div>
                </div>

                <div className="space-y-2 mt-4">
                   <h4 className="text-[8px] font-black text-brand-amber/30 uppercase tracking-[0.2em] px-2">Voice Profiles</h4>
                   {currentVoices.map(v => (
                     <div key={v.localId} className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-transparent hover:border-brand-amber/20 group transition-all">
                        <div className="flex flex-col min-w-0">
                          <span className="text-xs font-bold text-app-text/80 truncate">{v.name}</span>
                          <span className="text-[8px] opacity-30 font-black uppercase tracking-widest">{v.id} profile</span>
                        </div>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => setEditingVoice(v)} className="p-2 bg-brand-amber/10 text-brand-amber rounded-lg hover:bg-brand-amber/20 transition-colors"><Edit3 className="w-4 h-4"/></button>
                          <button onClick={() => handleDeleteVoice(v.localId)} className="p-2 bg-brand-red/10 text-brand-red rounded-lg hover:bg-brand-red hover:text-white transition-all"><Trash2 className="w-4 h-4"/></button>
                        </div>
                     </div>
                   ))}
                </div>
              </section>

              <section className="space-y-4">
                <h3 className="text-[10px] font-black text-brand-amber uppercase tracking-[0.3em] px-2">Cover Identity</h3>
                <div className="relative group overflow-hidden rounded-3xl border border-app-border bg-black/20 h-56 flex flex-col items-center justify-center shadow-2xl transition-all hover:border-brand-amber/20">
                  {book.metadata.logo ? (
                    <img src={book.metadata.logo} alt="Book Cover" className="w-full h-full object-cover transition-transform group-hover:scale-105 duration-700" />
                  ) : (
                    <div className="flex flex-col items-center gap-3 opacity-20">
                      <ImageIcon className="w-10 h-10" />
                      <span className="text-[9px] font-black uppercase tracking-widest">No Artwork</span>
                    </div>
                  )}
                  <div className="absolute inset-0 bg-brand-blue/80 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-sm">
                    <label className="cursor-pointer bg-brand-red text-brand-amber px-6 py-3 rounded-2xl hover:scale-105 active:scale-95 transition-all shadow-2xl font-black text-[10px] uppercase tracking-widest border border-white/5">
                      Upload Art
                      <input type="file" className="hidden" accept="image/*" onChange={e => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onloadend = () => updateMetadata('logo', reader.result as string);
                          reader.readAsDataURL(file);
                        }
                      }} />
                    </label>
                  </div>
                </div>

                <div className="space-y-6 pt-6 border-t border-app-border">
                  <div className="space-y-2">
                    <label className="text-[9px] font-black text-brand-amber uppercase tracking-[0.2em] px-2 flex items-center gap-2">
                      <Hash className="w-3.5 h-3.5 opacity-40" /> Publication ISBN
                    </label>
                    <input 
                      value={book.metadata.isbn || ''} 
                      onChange={e => updateMetadata('isbn', e.target.value)}
                      placeholder="978-X-XX-XXXXXX-X"
                      className="w-full bg-black/20 border border-app-border rounded-2xl p-4 text-xs text-app-text/70 outline-none focus:ring-1 focus:ring-brand-amber/30 transition-all placeholder:opacity-20"
                    />
                  </div>
                  
                  <div className="space-y-4">
                    <label className="text-[9px] font-black text-brand-amber uppercase tracking-[0.2em] px-2 flex items-center gap-2">
                      <Copyright className="w-3.5 h-3.5 opacity-40" /> Copyright Ledger
                    </label>
                    <div className="grid grid-cols-2 gap-4">
                      <input 
                        value={book.metadata.copyrightYear || ''} 
                        onChange={e => updateMetadata('copyrightYear', e.target.value)}
                        placeholder="Year"
                        className="w-full bg-black/20 border border-app-border rounded-2xl p-4 text-xs text-app-text/70 outline-none focus:ring-1 focus:ring-brand-amber/30 transition-all"
                      />
                      <input 
                        value={book.metadata.copyrightOwner || ''} 
                        onChange={e => updateMetadata('copyrightOwner', e.target.value)}
                        placeholder="Owner"
                        className="w-full bg-black/20 border border-app-border rounded-2xl p-4 text-xs text-app-text/70 outline-none focus:ring-1 focus:ring-brand-amber/30 transition-all"
                      />
                    </div>
                  </div>
                </div>
              </section>
            </div>
          )}
        </div>
        
        <footer className="mt-auto py-6 flex items-center justify-center gap-3 bg-black/30 border-t border-app-border">
          <ShieldCheck className="w-4 h-4 text-brand-amber opacity-20" />
          <span className="text-[9px] font-black text-brand-amber/20 uppercase tracking-[0.4em]">KOBA I SECURITY</span>
        </footer>
      </aside>

      {/* Main Editor Area */}
      <main className="flex-1 flex flex-col overflow-hidden bg-brand-blue relative">
        {/* Toolbar */}
        <header className="px-8 py-6 border-b border-app-border flex justify-between items-center bg-brand-blue-light/20 backdrop-blur-xl z-10">
          <div className="flex-1 max-w-2xl mr-8">
            <input 
              value={book.metadata.title} 
              onChange={e => updateMetadata('title', e.target.value)} 
              className="text-2xl font-serif font-bold bg-transparent border-none focus:ring-0 p-0 block w-full text-brand-amber placeholder:opacity-10 leading-tight" 
              placeholder="Manuscript Title"
            />
            <div className="flex items-center gap-5 mt-3">
              <input 
                value={book.metadata.author} 
                onChange={e => updateMetadata('author', e.target.value)} 
                className="text-[10px] font-black uppercase tracking-[0.3em] text-app-text/40 bg-transparent border-none focus:ring-0 p-0 block" 
                placeholder="Author Name"
              />
              <div className="w-1 h-1 rounded-full bg-white/10" />
              <span className={`text-[9px] font-black uppercase tracking-widest flex items-center gap-2 ${saveStatus === 'saving' ? 'text-brand-amber animate-pulse' : 'text-green-500/60'}`}>
                 {saveStatus === 'saving' ? <CircleDashed className="w-3.5 h-3.5 animate-spin"/> : <Check className="w-3.5 h-3.5"/>} 
                 {saveStatus}
              </span>
            </div>
          </div>
          
          <div className="flex gap-4 items-center">
             <div className="flex gap-2.5 items-center bg-black/30 p-2 rounded-[1.5rem] border border-app-border">
                <button 
                  onClick={handleReviewBook} 
                  disabled={isReviewing || isApplyingReview} 
                  className="flex items-center gap-2.5 px-5 py-3 rounded-xl bg-slate-900 text-white text-[10px] font-black tracking-widest uppercase hover:bg-black transition-all shadow-xl disabled:opacity-50"
                >
                  {isReviewing ? <CircleDashed className="w-4 h-4 animate-spin"/> : <ClipboardCheck className="w-4 h-4"/>} 
                  Analysis
                </button>
                <button 
                  onClick={handleAutoFormat} 
                  disabled={isFormatting || !activeChapter} 
                  className="flex items-center gap-2.5 px-5 py-3 rounded-xl bg-slate-100 text-slate-900 text-[10px] font-black tracking-widest uppercase hover:bg-white transition-all shadow-xl disabled:opacity-50"
                >
                  {isFormatting ? <CircleDashed className="w-4 h-4 animate-spin"/> : <AlignLeft className="w-4 h-4"/>} 
                  Polish
                </button>
             </div>
             
             <div className="flex gap-2.5 items-center bg-brand-red/10 p-2 rounded-[1.5rem] border border-brand-red/20 shadow-inner">
                <button 
                  onClick={handleSparkIdea} 
                  disabled={isSparking} 
                  className="flex items-center gap-2.5 px-5 py-3 rounded-xl bg-brand-amber/10 text-brand-amber text-[10px] font-black tracking-widest uppercase hover:bg-brand-amber/20 transition-all shadow-xl disabled:opacity-50 border border-brand-amber/10"
                >
                  {isSparking ? <CircleDashed className="w-4 h-4 animate-spin"/> : <Lightbulb className="w-4 h-4"/>} 
                  Idea
                </button>
                <button 
                  onClick={handleGetUnstuck} 
                  disabled={isAutoWriting || !activeChapter} 
                  className="flex items-center gap-2.5 px-5 py-3 rounded-xl bg-brand-amber text-brand-blue text-[10px] font-black tracking-widest uppercase hover:brightness-110 transition-all shadow-xl disabled:opacity-50"
                >
                  {isAutoWriting ? <CircleDashed className="w-4 h-4 animate-spin"/> : <PenTool className="w-4 h-4"/>} 
                  Flow
                </button>
                <button 
                  onClick={() => setShowWizard(true)} 
                  className="flex items-center gap-2.5 px-7 py-3 rounded-xl bg-brand-red text-brand-amber text-[10px] font-black tracking-[0.2em] uppercase hover:brightness-110 shadow-2xl transition-all border border-white/5"
                >
                  <Sparkles className="w-4 h-4 animate-pulse"/> Wizard
                </button>
             </div>
          </div>
        </header>

        {/* Content Viewport */}
        <section className="flex-1 overflow-y-auto custom-scroll flex justify-center py-20 px-10">
          {activeChapter ? (
            <div className="max-w-3xl w-full flex flex-col animate-in fade-in slide-in-from-bottom-8 duration-1000">
              <input 
                value={activeChapter.title} 
                onChange={e => updateChapter(activeChapter.id, { title: e.target.value })} 
                className="text-5xl lg:text-6xl font-serif font-bold w-full bg-transparent border-none focus:ring-0 text-brand-amber placeholder:opacity-5 mb-16 leading-tight" 
                placeholder="Chapter One"
              />
              <textarea 
                className="flex-1 bg-transparent font-serif text-xl lg:text-2xl leading-[2.2] outline-none border-none resize-none placeholder:text-app-text/5 text-app-text/80 min-h-[600px] mb-40 selection:bg-brand-amber/20" 
                placeholder="The story begins here..." 
                value={localText} 
                onChange={e => handleTextChange(e.target.value)}
              />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full opacity-5 pointer-events-none select-none">
              <BookOpen className="w-40 h-40 mb-10 text-brand-amber" />
              <h2 className="text-3xl font-serif tracking-widest uppercase">Select A Chapter</h2>
            </div>
          )}
        </section>
        
        {/* Page Ambient Glow */}
        <div className="absolute top-0 right-0 w-1/3 h-1/2 bg-brand-amber/5 blur-[120px] pointer-events-none rounded-full" />
        <div className="absolute bottom-0 left-0 w-1/4 h-1/3 bg-brand-red/5 blur-[120px] pointer-events-none rounded-full" />
      </main>

      {/* MODALS */}

      {/* Voice Configuration Modal */}
      {editingVoice && (
        <div className="fixed inset-0 bg-brand-blue/90 backdrop-blur-2xl z-[60] flex items-center justify-center p-6 animate-in fade-in duration-300">
          <div className="bg-brand-blue-light rounded-[3rem] w-full max-w-md shadow-2xl border border-app-border overflow-hidden animate-in zoom-in-95 duration-300">
             <div className="p-10 border-b border-app-border flex justify-between items-center bg-black/20">
                <div className="flex items-center gap-5">
                  <div className="bg-brand-amber p-4 rounded-3xl text-brand-blue shadow-2xl"><Volume2 className="w-6 h-6"/></div>
                  <div>
                    <h2 className="text-2xl font-bold font-serif text-brand-amber">{isAddingVoice ? 'New Persona' : 'Edit Persona'}</h2>
                    <p className="text-[9px] font-black uppercase tracking-widest text-brand-amber/30 mt-1">Audio Synthesis Definition</p>
                  </div>
                </div>
                <button onClick={() => setEditingVoice(null)} className="p-3 text-app-text/20 hover:text-app-text transition-all bg-white/5 rounded-full hover:bg-white/10"><X className="w-5 h-5"/></button>
             </div>
             <form onSubmit={handleSaveVoice} className="p-10 space-y-8">
                <div className="space-y-3">
                  <label className="text-[10px] font-black text-brand-amber uppercase tracking-widest ml-1">Character Label</label>
                  <input 
                    required 
                    value={editingVoice.name} 
                    onChange={e => setEditingVoice({...editingVoice, name: e.target.value})}
                    placeholder="e.g. Lead Protagonist"
                    className="w-full p-5 border border-app-border rounded-2xl focus:ring-2 focus:ring-brand-amber/40 outline-none bg-black/30 text-app-text text-sm transition-all shadow-inner"
                  />
                </div>
                <div className="space-y-4">
                  <label className="text-[10px] font-black text-brand-amber uppercase tracking-widest ml-1">System Architecture</label>
                  <div className="grid grid-cols-2 gap-3">
                    {SYSTEM_VOICES.map(sv => (
                      <button 
                        key={sv}
                        type="button"
                        onClick={() => setEditingVoice({...editingVoice, id: sv})}
                        className={`py-4 rounded-2xl text-[10px] font-black tracking-[0.2em] uppercase border transition-all ${editingVoice.id === sv ? 'bg-brand-red text-brand-amber border-brand-red shadow-xl' : 'bg-black/20 border-app-border text-app-text/30 hover:text-app-text/60'}`}
                      >
                        {sv}
                      </button>
                    ))}
                  </div>
                </div>
                <button type="submit" className="w-full py-5 bg-brand-red text-brand-amber rounded-3xl text-[10px] font-black tracking-[0.3em] uppercase shadow-2xl hover:brightness-110 active:scale-95 transition-all border border-white/5 mt-4">
                  Finalize Voice Profile
                </button>
             </form>
          </div>
        </div>
      )}

      {/* Review Result Modal */}
      {reviewResult && (
        <div className="fixed inset-0 bg-brand-blue/90 backdrop-blur-2xl z-50 flex items-center justify-center p-6 animate-in fade-in duration-300">
          <div className="bg-brand-blue-light rounded-[3rem] w-full max-w-3xl max-h-[90vh] shadow-2xl border border-app-border flex flex-col animate-in zoom-in-95 duration-500 overflow-hidden">
             <div className="p-12 border-b border-app-border flex justify-between items-center bg-black/20 shrink-0">
                <div className="flex items-center gap-6">
                  <div className="bg-brand-amber p-5 rounded-3xl text-brand-blue shadow-2xl shadow-brand-amber/20"><ClipboardCheck className="w-8 h-8"/></div>
                  <div>
                    <h2 className="text-3xl font-bold font-serif text-brand-amber">Editorial Feedback</h2>
                    <p className="text-[10px] font-black uppercase tracking-[0.4em] text-brand-amber/30 mt-2">Intelligent Manuscript Synthesis</p>
                  </div>
                </div>
                <button onClick={() => setReviewResult(null)} className="p-3 text-app-text/20 hover:text-app-text transition-all bg-white/5 rounded-full"><X className="w-6 h-6"/></button>
             </div>
             
             <div className="flex-1 overflow-y-auto p-12 custom-scroll space-y-12">
                <div className="flex flex-col md:flex-row gap-12 items-stretch">
                  <div className="w-full md:w-2/5 bg-black/30 p-10 rounded-[2.5rem] border border-app-border flex flex-col items-center text-center justify-center shadow-inner">
                    <BarChart3 className="w-10 h-10 text-brand-amber mb-4 opacity-40" />
                    <span className="text-[10px] font-black uppercase tracking-[0.3em] text-app-text/20">Narrative Score</span>
                    <div className="text-7xl font-serif font-bold text-brand-amber my-6 drop-shadow-2xl">{reviewResult.readabilityScore}</div>
                    <div className="w-full h-2.5 bg-black/40 rounded-full overflow-hidden shadow-inner">
                      <div className="h-full bg-gradient-to-r from-brand-red to-brand-amber transition-all duration-1500 ease-out" style={{ width: `${reviewResult.readabilityScore}%` }} />
                    </div>
                  </div>
                  
                  <div className="flex-1 space-y-8 py-4">
                    <section className="space-y-5">
                      <h3 className="text-[11px] font-black text-brand-amber uppercase tracking-[0.3em] flex items-center gap-3"><TrendingUp className="w-4 h-4 opacity-40"/> Flow Logic</h3>
                      <p className="text-sm opacity-70 bg-black/20 p-6 rounded-3xl border border-app-border leading-relaxed font-serif italic shadow-inner">
                        "{reviewResult.flowAnalysis}"
                      </p>
                    </section>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <section className="space-y-5">
                    <h3 className="text-[11px] font-black text-brand-amber uppercase tracking-[0.3em] flex items-center gap-3"><AlertCircle className="w-4 h-4 opacity-40"/> Mechanics</h3>
                    <ul className="space-y-2.5">
                      {reviewResult.grammar.length > 0 ? reviewResult.grammar.map((g, i) => (
                        <li key={i} className="text-xs opacity-60 bg-black/20 p-4 rounded-2xl border border-app-border shadow-sm flex items-start gap-3">
                          <span className="text-brand-red font-black">•</span> {g}
                        </li>
                      )) : <li className="text-xs opacity-30 italic px-4">Crystal clear mechanics detected.</li>}
                    </ul>
                  </section>
                  <section className="space-y-5">
                    <h3 className="text-[11px] font-black text-brand-amber uppercase tracking-[0.3em] flex items-center gap-3"><Check className="w-4 h-4 opacity-40"/> Core Alignment</h3>
                    <div className="text-xs opacity-60 bg-black/20 p-5 rounded-2xl border border-app-border leading-relaxed shadow-sm">{reviewResult.alignment}</div>
                  </section>
                </div>

                <section className="space-y-6">
                  <h3 className="text-[11px] font-black text-brand-amber uppercase tracking-[0.3em] flex items-center gap-3"><Sparkle className="w-4 h-4 opacity-40"/> Improvement Vector</h3>
                  <div className="grid grid-cols-1 gap-4">
                    {reviewResult.suggestions.map((s, i) => (
                      <div key={i} className="text-xs text-brand-amber/80 bg-brand-amber/5 p-5 rounded-[2rem] border border-brand-amber/10 flex items-start gap-4 transition-all hover:bg-brand-amber/10">
                        <span className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-brand-amber text-brand-blue font-black text-[11px] shadow-lg">{i+1}</span>
                        <p className="pt-1 leading-relaxed">{s}</p>
                      </div>
                    ))}
                  </div>
                </section>
             </div>

             <footer className="p-10 bg-black/30 border-t border-app-border shrink-0 flex gap-6">
                <button onClick={() => setReviewResult(null)} className="flex-1 py-5 bg-white/5 text-app-text/40 rounded-3xl text-[10px] font-black tracking-[0.3em] uppercase hover:bg-white/10 transition-all border border-transparent">Discard Review</button>
                <button 
                  disabled={isApplyingReview} 
                  onClick={handleAcceptReview} 
                  className="flex-[2] py-5 bg-brand-red text-brand-amber rounded-[2rem] text-[10px] font-black tracking-[0.4em] uppercase shadow-2xl hover:brightness-110 active:scale-[0.98] transition-all border border-white/5 flex items-center justify-center gap-4 group"
                >
                  {isApplyingReview ? <CircleDashed className="w-6 h-6 animate-spin" /> : <Sparkles className="w-6 h-6 group-hover:rotate-12 transition-transform" />}
                  {isApplyingReview ? 'Synchronizing Manuscript...' : 'Implement AI Optimizations'}
                </button>
             </footer>
          </div>
        </div>
      )}

      {/* Ideas Spark Modal - Interactive Incubator */}
      {showIdeasModal && (
        <div className="fixed inset-0 bg-brand-blue/90 backdrop-blur-2xl z-50 flex items-center justify-center p-6 animate-in fade-in duration-300">
          <div className="bg-brand-blue-light rounded-[3rem] w-full max-w-md shadow-2xl border border-app-border overflow-hidden animate-in zoom-in-95 duration-500">
             <div className="p-10 border-b border-app-border flex justify-between items-center bg-black/20">
                <div className="flex items-center gap-5">
                  <div className="bg-brand-amber p-4 rounded-3xl text-brand-blue shadow-2xl"><Lightbulb className="w-6 h-6"/></div>
                  <div>
                    <h2 className="text-2xl font-bold font-serif text-brand-amber">Creative Spark</h2>
                    <p className="text-[10px] font-black uppercase tracking-widest text-brand-amber/30 mt-1">Story Incubator</p>
                  </div>
                </div>
                <button onClick={() => setShowIdeasModal(false)} className="p-3 text-app-text/20 hover:text-app-text transition-all bg-white/5 rounded-full"><X className="w-5 h-5"/></button>
             </div>
             
             {/* The Interactive Ideas Grid */}
             <div className="p-10 space-y-4 max-h-[60vh] overflow-y-auto no-scrollbar">
                {sparkedIdeas.map((idea, idx) => (
                  <button 
                    key={idx} 
                    onClick={() => {
                        handleCreateBookFromIdea(idea);
                        setShowIdeasModal(false); // Close modal after clicking
                    }}
                    className="group relative w-full flex flex-col items-start text-left p-5 bg-black/30 border border-app-border rounded-2xl text-sm leading-relaxed text-app-text/70 hover:border-brand-amber/50 hover:bg-black/50 transition-all shadow-inner font-serif"
                  >
                    <div className="flex items-start gap-3">
                        <span className="text-brand-amber font-bold font-sans not-italic">{idx + 1}.</span> 
                        <span className="italic">{idea}</span>
                    </div>
                    
                    {/* The Action Trigger (Fades in on hover) */}
                    <div className="mt-5 flex items-center text-[10px] font-black uppercase tracking-widest text-brand-amber opacity-40 group-hover:opacity-100 transition-opacity">
                        <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Start New Book From Idea
                    </div>
                  </button>
                ))}
                
                <button onClick={() => setShowIdeasModal(false)} className="w-full mt-6 py-5 bg-brand-red text-brand-amber rounded-3xl text-[10px] font-black tracking-[0.3em] uppercase shadow-2xl hover:brightness-110 active:scale-95 transition-all border border-white/5">
                    Cancel & Resume Composition
                </button>
             </div>
          </div>
        </div>
      )}

      {/* Wizard Modal */}
      {showWizard && (
        <div className="fixed inset-0 bg-brand-blue/90 backdrop-blur-3xl z-50 flex items-center justify-center p-6 animate-in fade-in duration-300">
          <div className="bg-brand-blue-light rounded-[3rem] w-full max-w-lg shadow-2xl border border-app-border overflow-hidden animate-in zoom-in-95 duration-500">
             <div className="p-12 border-b border-app-border flex justify-between items-center bg-black/20">
                <div className="flex items-center gap-6">
                  <div className="bg-brand-red p-5 rounded-3xl text-brand-amber shadow-2xl shadow-brand-red/20"><Wand2 className="w-7 h-7"/></div>
                  <div>
                    <h2 className="text-3xl font-bold font-serif text-brand-amber">Narrative Wizard</h2>
                    <p className="text-[10px] font-black uppercase tracking-[0.4em] text-brand-amber/30 mt-2">Architecture Synthesis</p>
                  </div>
                </div>
                <button onClick={() => setShowWizard(false)} className="p-3 text-app-text/20 hover:text-app-text transition-all bg-white/5 rounded-full"><X className="w-6 h-6"/></button>
             </div>
             <div className="p-12 space-y-10">
                <div className="space-y-4">
                  <label className="text-[10px] font-black text-brand-amber uppercase tracking-[0.3em] ml-2">Premise or Concept</label>
                  <input 
                    value={wizardTopic} 
                    onChange={(e) => setWizardTopic(e.target.value)} 
                    placeholder="e.g. A forgotten library in a floating city..." 
                    className="w-full p-6 border border-app-border rounded-3xl focus:ring-2 focus:ring-brand-amber/40 outline-none bg-black/30 text-app-text text-base shadow-inner transition-all placeholder:opacity-10"
                  />
                </div>
                <div className="space-y-4">
                  <label className="text-[10px] font-black text-brand-amber uppercase tracking-[0.3em] ml-2">Manuscript Scale</label>
                  <div className="flex gap-3">
                    {(['5-min', '10-min', 'custom'] as StoryLength[]).map(l => (
                       <button 
                        key={l} 
                        onClick={() => setWizardLength(l)} 
                        className={`flex-1 py-4.5 rounded-2xl text-[10px] font-black tracking-[0.2em] uppercase border transition-all ${wizardLength === l ? 'bg-brand-red text-brand-amber border-brand-red shadow-xl' : 'bg-black/30 border-app-border text-app-text/20 hover:text-app-text/40'}`}
                       >
                         {l === 'custom' ? 'EPIC' : l.replace('-', ' ')}
                       </button>
                    ))}
                  </div>
                </div>
                <button 
                  disabled={isGenerating || !wizardTopic} 
                  onClick={handleStartWizard} 
                  className="w-full py-6 bg-brand-red text-brand-amber rounded-[2.5rem] text-[10px] font-black tracking-[0.5em] uppercase shadow-2xl hover:brightness-125 active:scale-95 transition-all border border-white/5 mt-4 flex items-center justify-center gap-4 group"
                >
                  {isGenerating ? <CircleDashed className="w-6 h-6 animate-spin" /> : <Sparkles className="w-6 h-6 group-hover:rotate-12 transition-transform" />}
                  {isGenerating ? 'GENERATING ARCHITECTURE...' : 'IGNITE SYNTHESIS'}
                </button>
             </div>
          </div>
        </div>
      )}
    </div>
  );
};