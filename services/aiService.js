import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebaseConfig";

// Helper to safely parse JSON text from AI response (stripping markdown code blocks if present)
const cleanJsonResponse = (text) => {
  let cleaned = text.trim();
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.substring(7).trim();
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.substring(3).trim();
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.substring(0, cleaned.length - 3).trim();
  }
  return JSON.parse(cleaned);
};

// Global cache for API Keys
let cachedAnthropicKey = null;
let cachedGeminiKey = null;

// Fetch the Anthropic API Key dynamically from Firestore
const getAnthropicApiKey = async () => {
  if (cachedAnthropicKey) return cachedAnthropicKey;
  try {
    if (!db) return null;
    const docRef = doc(db, "config", "anthropic");
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const data = docSnap.data();
      if (data && data.apiKey) {
        cachedAnthropicKey = data.apiKey.trim();
        return cachedAnthropicKey;
      }
    }
  } catch (error) {
    console.warn("Could not fetch Anthropic API key from Firestore.", error);
  }
  return null;
};

// Fetch the Gemini API Key dynamically from Firestore (Free Tier option!)
const getGeminiApiKey = async () => {
  if (cachedGeminiKey) return cachedGeminiKey;
  try {
    if (!db) return null;
    const docRef = doc(db, "config", "gemini");
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const data = docSnap.data();
      if (data && data.apiKey) {
        cachedGeminiKey = data.apiKey.trim();
        return cachedGeminiKey;
      }
    }
  } catch (error) {
    console.warn("Could not fetch Gemini API key from Firestore.", error);
  }
  return null;
};

/**
 * Organizes raw lyrics into structured sections using Gemini, Claude or Mock Fallback.
 * @param {string} rawText 
 * @param {string} language - 'English' | 'Tamil' | 'Mixed'
 */
export const organizeLyricsWithAI = async (rawText, language) => {
  const geminiKey = await getGeminiApiKey();
  const anthropicKey = await getAnthropicApiKey();

  const systemPrompt = `You are a worship music expert. Your job is to organize raw song lyrics into proper labeled sections. Respond ONLY in JSON. No explanation, no markdown, no extra text.`;
  
  const userPrompt = `Organize these raw lyrics into proper song sections.

Raw lyrics:
"${rawText}"

Language: ${language}

Rules:
1. Detect and label these sections: Intro, Verse 1, Verse 2, Verse 3, Pre-Chorus, Chorus, Bridge, Interlude, Tag, Outro
2. If a verse repeats, label it correctly (Verse 1, Verse 2 — not just Verse, Verse)
3. If the chorus repeats, label it as Chorus each time — do not duplicate the lyrics, just note it as (Repeat Chorus)
4. If a section appears with slight lyric variation, label it Verse 2 or Chorus 2
5. For Tamil lyrics: keep the Tamil script exactly as-is, only add English section labels above each section
6. For Mixed lyrics: organize English and Tamil versions into matching sections with the same structure
7. If you cannot confidently identify sections, or if the lyrics are too disorganized, short, or unstructured to segment, do NOT guess or make up random sections. Instead, return a single section with sectionLabel set to "Song" and prepend "[kindly organize Manually]\n\n" to the lyrics.

Respond in this exact JSON format:
{
  "sections": [
    {
      "sectionLabel": "Verse 1",
      "lyrics": "full lyrics of this section here\\nsecond line here\\nthird line here"
    },
    {
      "sectionLabel": "Chorus",
      "lyrics": "full lyrics of this section here\\nsecond line here"
    }
  ],
  "structurePattern": "V1 C V2 C B C",
  "totalSections": 6
}`;

  // 1. Google Gemini Free Tier Option
  if (geminiKey) {
    console.log("🤖 Running Lyrics Organization via Google Gemini 1.5 Flash (Free Tier)...");
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${systemPrompt}\n\nUser Action:\n${userPrompt}` }] }],
          generation_config: {
            response_mime_type: "application/json"
          }
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Gemini API HTTP Error ${response.status}: ${errText}`);
      }

      const data = await response.json();
      let responseText = data.candidates[0].content.parts[0].text.trim();
      return cleanJsonResponse(responseText);
    } catch (e) {
      console.warn("Gemini API call failed, falling back to Anthropic/Mock...", e);
    }
  }

  // 2. Anthropic Claude Option
  if (anthropicKey) {
    console.log("🤖 Running Lyrics Organization via Anthropic Claude 3.5 Sonnet...");
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerously-allow-public-api-key-in-browser": "true"
        },
        body: JSON.stringify({
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 3000,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }]
        })
      });

      if (response.ok) {
        const result = await response.json();
        let responseText = result.content[0].text.trim();
        return cleanJsonResponse(responseText);
      }
    } catch (e) {
      console.warn("Claude API call failed, using mock fallback...", e);
    }
  }

  // 3. Simulation Fallback
  console.log("ℹ️ No active AI keys found in Firestore. Running in Mock Fallback Mode.");
  return generateMockLyricsStructure(rawText, language);
};

/**
 * Detects the original key, BPM, time signature and chord sheet using Gemini, Claude or Mock Fallback.
 * @param {string} title 
 * @param {string} artist 
 * @param {string} existingLyrics
 */
export const detectKeyAndChordsWithAI = async (title, artist, existingLyrics = "") => {
  const geminiKey = await getGeminiApiKey();
  const anthropicKey = await getAnthropicApiKey();

  const systemPrompt = `You are a music theory and worship music chords expert. Respond ONLY in JSON. No explanation, no markdown, no extra text.`;
  
  const userPrompt = `You must search Google to find the accurate chords, key, and structure of the song "${title}" by "${artist}".
To find the exact chords, prioritize searching these websites by query:
- "${title} ${artist} chords site:tamilchristiansongs.in" (highly recommended for Tamil and mixed Christian songs)
- "${title} ${artist} chords site:churchspot.com"
- "${title} ${artist} chords site:thegodsmusic.com"
- "${title} ${artist} chords site:chordify.net"

Compare the search results and extract the EXACT chord chart (retaining the precise chord names, spacing, and character-by-character positioning above the lyrics) from the best matching source.

${existingLyrics ? `Here are the existing lyrics currently entered for this song. You MUST map the chords to these exact lyrics, matching the lines and section structure:
${existingLyrics}
` : 'If no existing lyrics are provided above, search the web to retrieve both the lyrics and the chord progressions for all parts of the song.'}

CRITICAL RULES:
1. The chords for each line must reflect the actual song melody/harmonic changes. DO NOT simply repeat the exact same chord sequence for every single line of a section (e.g. do not just copy "G Em C D" to every line of Verse 1 unless the song's actual chord progression does not change at all).
2. Align the chords carefully by placing spaces in the "chords" string so they visually line up over the syllables of the "lyrics" string where they should be played.
3. Group the lines into logical song sections with section labels (e.g., "Intro", "Verse 1", "Chorus", "Bridge", "Outro").

Respond in this exact JSON format:
{
  "originalKey": "G",
  "bpm": 72,
  "timeSignature": "4/4",
  "chordProgression": "G - Em - C - D",
  "chordChart": {
    "sections": [
      {
        "sectionLabel": "Verse 1",
        "lines": [
          {
            "chords": "G         Em        C         D",
            "lyrics": "first line of lyrics"
          },
          {
            "chords": "C         D         G",
            "lyrics": "second line of lyrics with different chord changes"
          }
        ]
      }
    ]
  },
  "confidence": "high"
}

If confident in the search results: set confidence to 'high'
If unsure: set confidence to 'low'
If completely unknown: set confidence to 'unknown' and leave chordChart sections empty`;

  // 1. Google Gemini Free Tier Option
  if (geminiKey) {
    console.log("🤖 Running Chord Detection via Google Gemini 2.5 Flash (with Search Grounding)...");
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${systemPrompt}\n\nUser Action:\n${userPrompt}` }] }],
          tools: [
            {
              google_search: {}
            }
          ]
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Gemini API HTTP Error ${response.status}: ${errText}`);
      }

      const data = await response.json();
      let responseText = data.candidates[0].content.parts[0].text.trim();
      return cleanJsonResponse(responseText);
    } catch (e) {
      console.warn("Gemini API call failed, falling back to Anthropic/Mock...", e);
    }
  }

  // 2. Anthropic Claude Option
  if (anthropicKey) {
    console.log("🤖 Running Chord Detection via Anthropic Claude 3.5 Sonnet...");
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerously-allow-public-api-key-in-browser": "true"
        },
        body: JSON.stringify({
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 3500,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }]
        })
      });

      if (response.ok) {
        const result = await response.json();
        let responseText = result.content[0].text.trim();
        return cleanJsonResponse(responseText);
      }
    } catch (e) {
      console.warn("Claude API call failed, using mock fallback...", e);
    }
  }

  // 3. Simulation Fallback
  console.log("ℹ️ No active AI keys found in Firestore. Running in Mock Fallback Mode.");
  return generateMockKeyAndChords(title, artist);
};

/**
 * Automatically fetches the official or popular YouTube and Spotify links using Gemini search grounding.
 * @param {string} title 
 * @param {string} artist 
 */
export const detectMediaLinksWithAI = async (title, artist) => {
  const geminiKey = await getGeminiApiKey();
  const anthropicKey = await getAnthropicApiKey();

  const systemPrompt = `You are a music media finder. Respond ONLY in JSON. No explanation, no markdown, no extra text.`;
  
  const userPrompt = `You must execute Google Search queries using both the song title and the artist name together (for example, search for: "${title} ${artist} youtube" and "${title} ${artist} spotify") to find the official or most popular YouTube video URL and Spotify track URL.

Perform search queries to find:
1. YouTube video URL (typically starting with https://www.youtube.com/watch?v= or https://youtu.be/)
2. Spotify track URL (typically starting with https://open.spotify.com/track/)

Respond in this exact JSON format:
{
  "youtubeLink": "https://www.youtube.com/watch?v=...",
  "spotifyLink": "https://open.spotify.com/track/..."
}

If you cannot find one or both links, return empty strings for the missing fields.`;

  // 1. Google Gemini Free Tier Option
  if (geminiKey) {
    console.log("🤖 Running Media Link Detection via Google Gemini 2.5 Flash (with Search Grounding)...");
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${systemPrompt}\n\nUser Action:\n${userPrompt}` }] }],
          tools: [
            {
              google_search: {}
            }
          ]
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Gemini API HTTP Error ${response.status}: ${errText}`);
      }

      const data = await response.json();
      let responseText = data.candidates[0].content.parts[0].text.trim();
      return cleanJsonResponse(responseText);
    } catch (e) {
      console.warn("Gemini API call failed for link detection, falling back to Anthropic/Mock...", e);
    }
  }

  // 2. Anthropic Claude Option
  if (anthropicKey) {
    console.log("🤖 Running Media Link Detection via Anthropic Claude 3.5 Sonnet...");
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerously-allow-public-api-key-in-browser": "true"
        },
        body: JSON.stringify({
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 1000,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }]
        })
      });

      if (response.ok) {
        const result = await response.json();
        let responseText = result.content[0].text.trim();
        return cleanJsonResponse(responseText);
      }
    } catch (e) {
      console.warn("Claude API call failed for link detection, using mock fallback...", e);
    }
  }

  // 3. Simulation Fallback
  console.log("ℹ️ No active AI keys found or API failed. Running in Mock Fallback Mode for links.");
  return generateMockMediaLinks(title, artist);
};


// =========================================================================
// 🧪 MOCK FALLBACK DATA GENERATORS
// =========================================================================

function generateMockMediaLinks(title, artist) {
  const normTitle = (title || "").toLowerCase();
  if (normTitle.includes("way maker") || normTitle.includes("waymaker")) {
    return {
      youtubeLink: "https://www.youtube.com/watch?v=iJCV_2S9xD0",
      spotifyLink: "https://open.spotify.com/track/303W6xRzNn8P49fM0S8pE4"
    };
  }
  if (normTitle.includes("amazing grace")) {
    return {
      youtubeLink: "https://www.youtube.com/watch?v=Obp-9BEaJeY",
      spotifyLink: "https://open.spotify.com/track/145g9OshM19J3cI2Dq9Nvx"
    };
  }
  if (normTitle.includes("goodness of god")) {
    return {
      youtubeLink: "https://www.youtube.com/watch?v=-f4MUUMWMWY",
      spotifyLink: "https://open.spotify.com/track/25nZ45U3B2jYwB7t30iW6b"
    };
  }
  if (normTitle.includes("how great is our god")) {
    return {
      youtubeLink: "https://www.youtube.com/watch?v=KBD18rsVJHk",
      spotifyLink: "https://open.spotify.com/track/2t9R2JtGZkQpxzC4gAwtJ1"
    };
  }
  if (normTitle.includes("10,000 reasons") || normTitle.includes("10000 reasons")) {
    return {
      youtubeLink: "https://www.youtube.com/watch?v=DXDGE_lRI0E",
      spotifyLink: "https://open.spotify.com/track/4jVv3k8eG4UjO3z748NqS0"
    };
  }
  
  // Generic fallback if not matched
  const searchSlug = encodeURIComponent(`${title} ${artist}`);
  return {
    youtubeLink: `https://www.youtube.com/results?search_query=${searchSlug}`,
    spotifyLink: `https://open.spotify.com/search/${searchSlug}`
  };
}

function generateMockLyricsStructure(rawText, language) {
  return {
    sections: [
      {
        sectionLabel: "Song",
        lyrics: `[kindly organize Manually]\n\n${(rawText || "").trim()}`
      }
    ],
    structurePattern: "Song",
    totalSections: 1
  };
}

function generateMockKeyAndChords(title, artist) {
  const normalizedTitle = (title || "").toLowerCase();
  
  if (normalizedTitle.includes("way maker") || normalizedTitle.includes("waymaker")) {
    return {
      originalKey: "G Major",
      bpm: 68,
      timeSignature: "4/4",
      chordProgression: "C - G - D - Em",
      confidence: "high",
      chordChart: {
        sections: [
          {
            sectionLabel: "Verse 1",
            lines: [
              { chords: "C                          G", lyrics: "You are here, moving in our midst" },
              { chords: "D                          Em", lyrics: "I worship You, I worship You" },
              { chords: "C                          G", lyrics: "You are here, working in this place" },
              { chords: "D                          Em", lyrics: "I worship You, I worship You" }
            ]
          },
          {
            sectionLabel: "Chorus",
            lines: [
              { chords: "C", lyrics: "You are Way Maker, Miracle Worker" },
              { chords: "G", lyrics: "Promise Keeper, Light in the darkness" },
              { chords: "D", lyrics: "My God, that is who You are" },
              { chords: "Em", lyrics: "that is who You are" }
            ]
          },
          {
            sectionLabel: "Verse 2",
            lines: [
              { chords: "C                          G", lyrics: "You are here, touching every heart" },
              { chords: "D                          Em", lyrics: "I worship You, I worship You" },
              { chords: "C                          G", lyrics: "You are here, healing every life" },
              { chords: "D                          Em", lyrics: "I worship You, I worship You" }
            ]
          },
          {
            sectionLabel: "Bridge",
            lines: [
              { chords: "C", lyrics: "Even when I don't see it, You're working" },
              { chords: "G", lyrics: "Even when I don't feel it, You're working" },
              { chords: "D", lyrics: "You never stop, You never stop working" },
              { chords: "Em", lyrics: "You never stop, You never stop working" }
            ]
          }
        ]
      }
    };
  }

  if (normalizedTitle.includes("amazing grace")) {
    return {
      originalKey: "G Major",
      bpm: 80,
      timeSignature: "3/4",
      chordProgression: "G - C - G - D - Em",
      confidence: "high",
      chordChart: {
        sections: [
          {
            sectionLabel: "Verse 1",
            lines: [
              { chords: "G              C         G", lyrics: "Amazing grace! How sweet the sound" },
              { chords: "G                       D", lyrics: "That saved a wretch like me!" },
              { chords: "G                C         G", lyrics: "I once was lost, but now am found" },
              { chords: "Em      D       G", lyrics: "Was blind, but now I see." }
            ]
          },
          {
            sectionLabel: "Verse 2",
            lines: [
              { chords: "G                  C       G", lyrics: "'Twas grace that taught my heart to fear" },
              { chords: "G                         D", lyrics: "And grace my fears relieved;" },
              { chords: "G                C         G", lyrics: "How precious did that grace appear" },
              { chords: "Em     D        G", lyrics: "The hour I first believed." }
            ]
          }
        ]
      }
    };
  }

  return {
    originalKey: "C Major",
    bpm: 76,
    timeSignature: "4/4",
    chordProgression: "C - F - G - Am",
    confidence: "low",
    chordChart: {
      sections: [
        {
          sectionLabel: "Verse 1",
          lines: [
            { chords: "C              F", lyrics: "first line of verse lyrics here" },
            { chords: "G              Am", lyrics: "second line of verse lyrics here" }
          ]
        },
        {
          sectionLabel: "Chorus",
          lines: [
            { chords: "F              C", lyrics: "first line of chorus lyrics here" },
            { chords: "G              Am", lyrics: "second line of chorus lyrics here" }
          ]
        }
      ]
    }
  };
}
