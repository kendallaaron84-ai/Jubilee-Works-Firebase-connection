declare global {
    interface Window {
        kobaConfig: {
            restUrl: string;
            nonce: string;
            user: string;
            licenseKey: string;
        }
    }
}

// Use this version as it includes the nonce required by WordPress
export const getHeaders = () => {
    const config = window.kobaConfig;
    if (!config) throw new Error("Jubilee Studio Workspace not detected.");
    return {
        'Content-Type': 'application/json',
        'X-WP-Nonce': config.nonce,
        'X-KOBAI-License-Key': config.licenseKey 
    };
};

export const fetchManuscripts = async () => {
    const config = window.kobaConfig;
    // Fetch from WordPress secure post type instead of local storage
    const response = await fetch(`${config.restUrl}wp/v2/manuscripts?_fields=id,title,content,meta`, { headers: getHeaders() });
    if (!response.ok) return [];
    return await response.json();
};

export const saveManuscript = async (bookData: any) => {
    const config = window.kobaConfig;
    const response = await fetch(`${config.restUrl}wp/v2/manuscripts`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
            title: bookData.metadata.title,
            content: JSON.stringify(bookData),
            status: 'publish' // Maps to internal DB status, custom logic handles draft/publish via metadata
        })
    });
    return await response.json();
};

export const sendTelemetry = async (type: 'highlight' | 'bookmark', payload: any) => {
    // COMMENTED OUT TO STOP THE 500 ERRORS
    /*
    const config = window.kobaConfig;
    await fetch(`${config.restUrl}jubilee/v1/telemetry`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ type, user: config.user, timestamp: Date.now(), data: payload })
    });
    */
    console.log("Telemetry captured locally:", type, payload);
    return Promise.resolve();
};

// Update this function in wordpressApi.ts
export const generateWithGemini = async (payload: any): Promise<string> => {
    const config = window.kobaConfig;
    
    // Ensure we send the full payload object that the PHP backend expects
    const response = await fetch(`${config.restUrl}jubilee/v1/generate`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        // This will now show you the actual server error in the console
        const errorData = await response.text();
        console.error("Gemini API Error:", errorData);
        throw new Error('Command Center Error');
    }
    
    const data = await response.json();
    
    // PHP returns { "text": "..." }
    return data.text || (typeof data === 'string' ? data : JSON.stringify(data));
};