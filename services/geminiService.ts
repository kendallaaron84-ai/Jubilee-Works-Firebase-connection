import { generateWithGemini } from '../wordpressApi';
import { BookData, BookReview, Chapter } from '../types';
// Add this import to the top of your file
import { generateWithGemini, getHeaders } from '../wordpressApi';

/**
 * Utility to violently strip markdown formatting from AI responses
 * so React can parse it as raw JSON data.
 */
const parseCleanJson = (text: string) => {
    try {
        const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
        return JSON.parse(cleaned);
    } catch (error) {
        console.error("Failed to parse Command Center JSON:", text);
        throw new Error("The Command Center returned unreadable data. Please try again.");
    }
};

// --- THE AI CAPABILITIES ---

// wordpressApi.ts
export const generateWithGemini = async (payload: any): Promise<string> => {
    const config = window.kobaConfig;
    const response = await fetch(`${config.restUrl}jubilee/v1/generate`, {
        method: 'POST',
        headers: getHeaders(),
        // Send the payload object directly here
        body: JSON.stringify(payload) 
    });

    if (!response.ok) throw new Error('Command Center Error');
    const data = await response.json();
    
    return data.text || (typeof data === 'string' ? data : JSON.stringify(data));
};

export const generateBookIdeas = async (book: BookData): Promise<string[]> => {
    const title = book.metadata.title || "Untitled Draft";
    const description = book.metadata.description || "No description provided.";
    const mood = book.metadata.mood || "Author's natural tone";
    const setting = book.metadata.setting || "Unspecified setting";
    const emotion = book.metadata.emotion || "Unspecified emotional arc";
    const styleReference = book.metadata.styleReference || "None provided";

    const systemInstruction = `You are an elite publishing strategist. 
    CRITICAL AUTHOR GUARDRAILS:
    - Target Mood: ${mood}
    - Primary Setting: ${setting}
    - Emotional Arc: ${emotion}
    - Style Reference: ${styleReference}
    CRITICAL INSTRUCTION: You must respond ONLY with a raw JSON array of strings. Example format: ["Idea 1", "Idea 2", "Idea 3", "Idea 4"]`;

    const payload = {
        prompt: `Based ONLY on the guardrails and this book context, generate exactly 4 highly creative, distinct, and compelling plot hooks or chapter ideas.\n\nTitle: "${title}"\nContext: "${description}"`,
        temperature: 0.8, // Higher variance for brainstorming
        maxOutputTokens: 600,
        systemInstruction: systemInstruction
    };

    const rawResponse = await generateWithGemini(payload);
    return parseCleanJson(rawResponse);
};

export const generateStoryWizardStructure = async (topic: string, desc: string, length: string) => {
    const systemInstruction = `You are a master story architect. Build a highly structured book outline.
    CRITICAL INSTRUCTION: Respond ONLY with a raw JSON object using this exact structure:
    {
      "title": "A captivating title",
      "description": "A powerful 2-sentence blurb about the book.",
      "chapters": [
        { "title": "Chapter 1 Title", "summary": "What happens in chapter 1" },
        { "title": "Chapter 2 Title", "summary": "What happens in chapter 2" }
      ]
    }`;

    const payload = {
        prompt: `Topic: "${topic}"\nDescription: "${desc}"\nTarget length: ${length}.`,
        temperature: 0.4, // Lower temperature for structural consistency
        maxOutputTokens: 1500,
        systemInstruction: systemInstruction
    };

    const rawResponse = await generateWithGemini(payload);
    return parseCleanJson(rawResponse);
};

export const generateNextChapterParagraph = async (currentChapter: Chapter, metadata: any, prevChapters: Chapter[]): Promise<string> => {
    const mood = metadata.mood || "Balanced narrative flow";
    const setting = metadata.setting || "Unspecified environment";
    const emotion = metadata.emotion || "Steady narrative arc";

    const systemInstruction = `You are a master storyteller. Continue the chapter text precisely following these author constraints:
    - Current Mood: ${mood}
    - Location Setting: ${setting}
    - Emotional Resonance: ${emotion}
    CRITICAL CONSTRAINT: Write exactly ONE cohesive paragraph closing out current thoughts. Do not add introductory chit-chat.`;

    const payload = {
        prompt: `Book Title: ${metadata.title}\nDescription: ${metadata.description}\n\nPrevious Chapter Text: ${currentChapter.content}\n\nWrite the next compelling paragraph.`,
        temperature: 0.7,
        maxOutputTokens: 250, // Prevents runaway generation
        systemInstruction: systemInstruction
    };
    
    return await generateWithGemini(payload);
};

export const autoFormatContent = async (text: string): Promise<string> => {
    const payload = {
        prompt: `Format the following raw text into clean, readable HTML paragraphs (using <p> tags). Fix typos but DO NOT change the voice, style, or meaning.\n\nText to format:\n${text}`,
        temperature: 0.0, // Absolute zero creativity; strictly acts as a parser
        maxOutputTokens: 2000,
        systemInstruction: "You are a strict code formatter and copyeditor. Output ONLY semantic HTML text blocks. Never alter the author's meaning."
    };
    
    return await generateWithGemini(payload);
};

export const reviewFullBook = async (book: BookData): Promise<BookReview> => {
    const systemInstruction = `Act as an expert developmental editor. 
    CRITICAL INSTRUCTION: Respond ONLY with a raw JSON object using this exact structure:
    {
        "readabilityScore": 85,
        "flowAnalysis": "A 2 sentence summary of the pacing and narrative flow.",
        "grammar": ["A specific grammar fix", "Another grammar fix"],
        "alignment": "A 1 sentence note on how well it aligns with its genre.",
        "suggestions": ["Actionable suggestion 1", "Actionable suggestion 2", "Actionable suggestion 3"]
    }`;

    const payload = {
        prompt: `Review the following manuscript excerpt.\nTitle: ${book.metadata.title}\nContent: ${book.chapters.map(c => c.content).join('\n\n')}`,
        temperature: 0.2, // Highly analytical
        maxOutputTokens: 1000,
        systemInstruction: systemInstruction
    };
    
    const rawResponse = await generateWithGemini(payload);
    return parseCleanJson(rawResponse);
};

export const applyReviewSuggestions = async (book: BookData, review: BookReview): Promise<Chapter[]> => {
    const targetChapter = book.chapters[0];
    
    const payload = {
        prompt: `Rewrite the following chapter text by incorporating these specific editorial suggestions: ${review.suggestions.join(", ")}. Maintain the original narrative voice. Return ONLY the polished text wrapped in proper HTML <p> tags.\n\nOriginal Text:\n${targetChapter.content}`,
        temperature: 0.2,
        maxOutputTokens: 2000,
        systemInstruction: "Act as an expert copyeditor. Apply the requested changes while fiercely protecting the author's unique voice."
    };

    const polishedText = await generateWithGemini(payload);

    return book.chapters.map((c, i) => {
        if (i === 0) return { ...c, content: polishedText, lastModified: Date.now() };
        return c;
    });
};