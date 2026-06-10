import React, { useState, useEffect, useRef } from "react";
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  Dimensions,
  Linking,
  Animated,
  Platform,
  TextInput,
  Alert,
  Modal,
  SafeAreaView,
  FlatList,
  StatusBar as RNStatusBar,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { USE_DEMO_MODE, db } from "../firebaseConfig";
import { doc, updateDoc, collection, query, where, onSnapshot, deleteDoc } from "firebase/firestore";
import MetronomeScreen from "./MetronomeScreen";

const { width } = Dimensions.get("window");

// =========================================================================
// 🎵 MONOSPACE CHORD TRANSPOSER UTILITY HELPERS
// =========================================================================
const KEYS_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const KEYS_FLAT  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const SECTION_PRESETS = ["Verse 1", "Verse 2", "Verse 3", "Verse 4", "Verse 5", "Pre-Chorus", "Chorus", "Chorus 2", "Bridge", "Outro"];

const extractRoot = (keyStr) => {
  if (!keyStr) return 'C';
  const match = keyStr.match(/^([A-G][#b]?)/);
  return match ? match[1] : 'C';
};

const getKeyIndex = (root) => {
  let idx = KEYS_SHARP.indexOf(root);
  if (idx !== -1) return idx;
  idx = KEYS_FLAT.indexOf(root);
  return idx !== -1 ? idx : 0;
};

const preferFlatsForKey = (keyStr) => {
  if (!keyStr) return false;
  const root = extractRoot(keyStr);
  const flats = ['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb'];
  return flats.includes(root) || keyStr.includes('b');
};

const transposeChord = (chord, semitones, preferSharps = true, forceSpelling = false) => {
  if (semitones === 0 && !forceSpelling) return chord;
  
  const transposeNote = (note) => {
    let idx = KEYS_SHARP.indexOf(note);
    if (idx === -1) idx = KEYS_FLAT.indexOf(note);
    if (idx === -1) return note;
    
    let newIdx = (idx + semitones) % 12;
    if (newIdx < 0) newIdx += 12;
    
    return preferSharps ? KEYS_SHARP[newIdx] : KEYS_FLAT[newIdx];
  };

  if (chord.includes('/')) {
    const parts = chord.split('/');
    return parts.map(p => transposeChord(p, semitones, preferSharps)).join('/');
  }

  const match = chord.match(/^([A-G][#b]?)(.*)/);
  if (!match) return chord;
  
  const root = match[1];
  const rest = match[2];
  return transposeNote(root) + rest;
};

const transposeLine = (line, semitones, preferSharps = true) => {
  if (!line || semitones === 0) return line;
  
  const regex = /(\S+)/g;
  let match;
  const tokens = [];
  
  while ((match = regex.exec(line)) !== null) {
    tokens.push({
      chord: match[1],
      index: match.index
    });
  }
  
  if (tokens.length === 0) return line;
  
  const transposedTokens = tokens.map(t => ({
    chord: transposeChord(t.chord, semitones, preferSharps),
    index: t.index
  }));
  
  let result = "";
  for (const t of transposedTokens) {
    if (t.index > result.length) {
      result += " ".repeat(t.index - result.length);
    } else if (t.index < result.length) {
      result += " ";
    }
    result += t.chord;
  }
  return result;
};

// Nashville Number System converter
const formatAsNumberSystem = (transposedChord, currentKey) => {
  if (!transposedChord) return "";
  
  // Helper to extract root note index from KEYS arrays
  const getNoteIndex = (note) => {
    let idx = KEYS_SHARP.indexOf(note);
    if (idx !== -1) return idx;
    idx = KEYS_FLAT.indexOf(note);
    return idx !== -1 ? idx : 0;
  };

  // Helper to convert a single chord root to NNS
  const convertSingle = (chord) => {
    if (chord.includes('/')) {
      const parts = chord.split('/');
      return parts.map(convertSingle).join('/');
    }

    const match = chord.match(/^([A-G][#b]?)(.*)/);
    if (!match) return chord;

    const chordRoot = match[1];
    const rest = match[2];

    const keyRoot = extractRoot(currentKey);
    const keyIdx = getNoteIndex(keyRoot);
    const chordIdx = getNoteIndex(chordRoot);
    const diff = (chordIdx - keyIdx + 12) % 12;

    const intervalToNum = ['1', 'b2', '2', 'b3', '3', '4', 'b5', '5', 'b6', '6', 'b7', '7'];
    const numberRoot = intervalToNum[diff];

    // Standardize minor suffix to '-' or keep it
    let cleanRest = rest;
    if (rest.startsWith('m') && !rest.startsWith('maj') && !rest.startsWith('min')) {
      cleanRest = '-' + rest.substring(1);
    } else if (rest.startsWith('min')) {
      cleanRest = '-' + rest.substring(3);
    }

    return numberRoot + cleanRest;
  };

  return convertSingle(transposedChord);
};
  
// =========================================================================
// 🎼 BRACKET CHORD / CHORDPRO PARSER & EXPORTER
// =========================================================================
const convertToBracketFormat = (sections) => {
  if (!sections || sections.length === 0) return "";
  let result = [];
  for (const sec of sections) {
    result.push(`[${sec.sectionLabel}]`);
    if (sec.lines) {
      for (const line of sec.lines) {
        const chords = line.chords || "";
        const lyrics = line.lyrics || "";
        
        if (!chords.trim()) {
          result.push(lyrics);
          continue;
        }
        
        const regex = /(\S+)/g;
        let match;
        const tokens = [];
        while ((match = regex.exec(chords)) !== null) {
          tokens.push({
            chord: match[1],
            index: match.index
          });
        }
        
        let mergedLine = "";
        let lastLyricIdx = 0;
        for (const token of tokens) {
          if (token.index > lyrics.length) {
            mergedLine += lyrics.substring(lastLyricIdx, lyrics.length);
            mergedLine += " ".repeat(token.index - lyrics.length);
            lastLyricIdx = lyrics.length;
          } else {
            mergedLine += lyrics.substring(lastLyricIdx, token.index);
            lastLyricIdx = token.index;
          }
          mergedLine += `[${token.chord}]`;
        }
        if (lastLyricIdx < lyrics.length) {
          mergedLine += lyrics.substring(lastLyricIdx);
        }
        result.push(mergedLine);
      }
    }
    result.push("");
  }
  return result.join("\n").trim();
};

const parseBracketFormat = (text) => {
  if (!text || !text.trim()) return [];
  
  const lines = text.split("\n");
  const parsedSections = [];
  let currentSection = null;
  
  for (let rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    
    const sectionMatch = rawLine.match(/^\s*\[(Verse\s*\d*|Chorus\s*\d*|Bridge\s*\d*|Pre-Chorus\s*\d*|Outro\s*\d*|Intro\s*\d*|Tag\s*\d*|Ending\s*\d*)\]\s*$/i);
    
    if (sectionMatch) {
      currentSection = {
        sectionLabel: sectionMatch[1].trim(),
        lines: []
      };
      parsedSections.push(currentSection);
      continue;
    }
    
    if (!currentSection) {
      currentSection = {
        sectionLabel: "Verse 1",
        lines: []
      };
      parsedSections.push(currentSection);
    }
    
    let lyricsLine = "";
    const chordsList = [];
    
    const bracketRegex = /\[([^\]]+)\]/g;
    let match;
    let lastIdx = 0;
    
    while ((match = bracketRegex.exec(rawLine)) !== null) {
      const chordName = match[1];
      const matchIdx = match.index;
      
      lyricsLine += rawLine.substring(lastIdx, matchIdx);
      chordsList.push({
        chord: chordName,
        index: lyricsLine.length
      });
      lastIdx = bracketRegex.lastIndex;
    }
    
    lyricsLine += rawLine.substring(lastIdx);
    
    let chordsLine = "";
    for (const c of chordsList) {
      if (c.index > chordsLine.length) {
        chordsLine += " ".repeat(c.index - chordsLine.length);
      } else if (c.index < chordsLine.length) {
        chordsLine += " ";
      }
      chordsLine += c.chord;
    }
    
    currentSection.lines.push({
      chords: chordsLine,
      lyrics: lyricsLine
    });
  }
  
  return parsedSections.filter(s => s.lines.length > 0 || s.sectionLabel.trim() !== "");
};

const tokenizeLyricsLine = (lyricsText) => {
  if (!lyricsText) return [];
  const tokens = [];
  const regex = /(\s+)|(\S+)/g;
  let match;
  while ((match = regex.exec(lyricsText)) !== null) {
    const text = match[0];
    const isWord = !match[1];
    tokens.push({
      text,
      index: match.index,
      isWord
    });
  }
  return tokens;
};

const parseMonospaceChordsToMap = (chordsStr) => {
  const map = {};
  if (!chordsStr) return map;
  const regex = /(\S+)/g;
  let match;
  while ((match = regex.exec(chordsStr)) !== null) {
    map[match.index] = match[1];
  }
  return map;
};

const compileChordsMapToMonospace = (chordsMap) => {
  if (!chordsMap) return "";
  let chordsLine = "";
  const sortedIdxs = Object.keys(chordsMap)
    .map(idx => parseInt(idx, 10))
    .sort((a, b) => a - b);
    
  for (const index of sortedIdxs) {
    const chord = chordsMap[index];
    if (index > chordsLine.length) {
      chordsLine += " ".repeat(index - chordsLine.length);
    } else if (index < chordsLine.length) {
      chordsLine += " ";
    }
    chordsLine += chord;
  }
  return chordsLine;
};

const initializeSectionsFromLyrics = (lyricsText) => {
  if (!lyricsText || !lyricsText.trim()) {
    return [{ sectionLabel: "Verse 1", lines: [{ chords: "", lyrics: "", chordsMap: {} }] }];
  }
  
  const lines = lyricsText.split("\n");
  const sections = [];
  let currentSection = null;
  
  for (let rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    
    const sectionMatch = rawLine.match(/^\s*\[?(Verse\s*\d*|Chorus\s*\d*|Bridge\s*\d*|Pre-Chorus\s*\d*|Outro\s*\d*|Intro\s*\d*|Tag\s*\d*|Ending\s*\d*)\]?\s*:?\s*$/i);
    
    if (sectionMatch) {
      currentSection = {
        sectionLabel: sectionMatch[1].trim(),
        lines: []
      };
      sections.push(currentSection);
      continue;
    }
    
    if (!currentSection) {
      currentSection = {
        sectionLabel: "Verse 1",
        lines: []
      };
      sections.push(currentSection);
    }
    
    currentSection.lines.push({
      chords: "",
      lyrics: rawLine,
      chordsMap: {}
    });
  }
  
  return sections.filter(s => s.lines.length > 0 || s.sectionLabel.trim() !== "");
};

export default function SongDetailScreen({ song, onBack, onEditSong, user, onUpdateSong, onDeleteSong, setlist, initialSongIndex }) {
  const [activeLyricsTab, setActiveLyricsTab] = useState("english"); // "english" | "tamil"

  // Paging Setlist States
  const targetSongs = setlist && setlist.length > 0 ? setlist : [song];
  const initialIndex = initialSongIndex !== undefined ? initialSongIndex : 0;
  const [currentSongIndex, setCurrentSongIndex] = useState(initialIndex);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [fullScreenFontSize, setFullScreenFontSize] = useState(16);
  const [fullScreenTab, setFullScreenTab] = useState("lyrics"); // "lyrics" | "chords"

  const activeSongObj = isFullScreen && targetSongs[currentSongIndex] ? targetSongs[currentSongIndex] : song;

  const handleDeleteSong = () => {
    Alert.alert(
      "Delete Song",
      `Are you sure you want to permanently delete "${song.title}"? This action cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              if (USE_DEMO_MODE) {
                const storedSongs = await AsyncStorage.getItem("@worship_team_songs");
                if (storedSongs) {
                  const parsed = JSON.parse(storedSongs);
                  const filtered = parsed.filter((s) => s.songId !== song.songId);
                  await AsyncStorage.setItem("@worship_team_songs", JSON.stringify(filtered));
                }
              } else {
                await deleteDoc(doc(db, "songs", song.songId));
              }
              if (onDeleteSong) {
                onDeleteSong(song.songId);
              }
              Alert.alert("Success", "Song deleted successfully!");
            } catch (err) {
              console.error("Failed to delete song:", err);
              Alert.alert("Error", "Failed to delete song: " + err.message);
            }
          }
        }
      ]
    );
  };
  const [activeMainTab, setActiveMainTab] = useState("lyrics"); // "lyrics" | "chords"
  const [isEditingChords, setIsEditingChords] = useState(false);
  const [displayKey, setDisplayKey] = useState(song.originalKey || "C");
  const [notationMode, setNotationMode] = useState("normal"); // "normal" | "sharp" | "flat" | "number"
  const [capo, setCapo] = useState(0);
  const [editSections, setEditSections] = useState([]);
  
  // New States for Bracket Text Editor, Floating Keyboard, Personal Notes & Global Key
  const [editorMode, setEditorMode] = useState("grid"); // "grid" | "text"
  const [bracketText, setBracketText] = useState("");
  const [chartBaseKey, setChartBaseKey] = useState(song.originalKey || "C");
  const [activeInputRef, setActiveInputRef] = useState({ secIdx: null, lineIdx: null, field: null }); // tracks active grid input
  const [isTextFocused, setIsTextFocused] = useState(false); // tracks if bracket textbox is focused
  const [cursorSelection, setCursorSelection] = useState({ start: 0, end: 0 });
  const [musicianNotes, setMusicianNotes] = useState("");
  const [isNotesEditing, setIsNotesEditing] = useState(false);
  const [tempNotes, setTempNotes] = useState("");
  const [activeTapCell, setActiveTapCell] = useState({ secIdx: null, lineIdx: null, charIndex: null, word: "" });
  const [pendingChord, setPendingChord] = useState(null);
  const [sectionCreator, setSectionCreator] = useState({ visible: false, type: "Verse 1", linesCount: 4 });
  const [slicerVisible, setSlicerVisible] = useState(false);
  const [slicerLines, setSlicerLines] = useState([]);
  const [introCreatorVisible, setIntroCreatorVisible] = useState(false);
  const [introChords, setIntroChords] = useState([]);
  const [metronomeVisible, setMetronomeVisible] = useState(false);

  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Inline Metronome Quick Play States
  const [isInlinePlaying, setIsInlinePlaying] = useState(false);
  const [inlineCurrentBeat, setInlineCurrentBeat] = useState(1);
  const [hasLyricTask, setHasLyricTask] = useState(false);

  // 🎙️ Audio Recording Feature States
  const [recordingsList, setRecordingsList] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingObj, setRecordingObj] = useState(null);
  const [recordDuration, setRecordDuration] = useState(0);
  const [recordingName, setRecordingName] = useState("");
  const [recordingTarget, setRecordingTarget] = useState("choir"); // "choir" | "musicians"
  const [activePlayingId, setActivePlayingId] = useState(null);
  const [playbackSound, setPlaybackSound] = useState(null);
  const [playbackPosition, setPlaybackPosition] = useState(0);
  const [playbackDuration, setPlaybackDuration] = useState(0);
  const [recordModalVisible, setRecordModalVisible] = useState(false);
  const [recordPreviewUri, setRecordPreviewUri] = useState(null);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [previewSound, setPreviewSound] = useState(null);
  const [previewPosition, setPreviewPosition] = useState(0);
  const [previewDuration, setPreviewDuration] = useState(0);
  const recordIntervalRef = useRef(null);

  // Audio refs
  const inlineHighSoundRef = useRef(null);
  const inlineLowSoundRef = useRef(null);
  const inlineSoundsLoaded = useRef(false);
  const inlineTimerRef = useRef(null);

  const TICK_SOUND_URL = "https://raw.githubusercontent.com/zarocknz/javascript-winwheel/master/examples/wheel_of_fortune/tick.mp3";

  // Default Song tab override on remote jumps (e.g., from Dashboard Roster or Updates)
  useEffect(() => {
    async function loadDefaultTab() {
      try {
        const stored = await AsyncStorage.getItem("@default_song_detail_tab");
        if (stored) {
          setActiveMainTab(stored);
          await AsyncStorage.removeItem("@default_song_detail_tab"); // Clear token after reading
        }
      } catch (err) {
        console.warn("Failed to load default song detail tab override:", err);
      }
    }
    loadDefaultTab();
  }, [song.songId]);

  const getSongDisplaySections = (targetSong) => {
    const lyricsText = activeLyricsTab === "tamil" ? (targetSong.lyricsTamil || "") : (targetSong.lyricsEnglish || "");
    const baseSections = initializeSectionsFromLyrics(lyricsText);

    // If there are no base sections generated from lyrics, check if we have chord chart sections
    if ((!baseSections || baseSections.length === 0 || (baseSections.length === 1 && baseSections[0].lines.length === 0)) && targetSong.chordChart && targetSong.chordChart.sections && targetSong.chordChart.sections.length > 0) {
      return targetSong.chordChart.sections;
    }

    // If we have saved chord chart sections, overlay their chords onto our base lyrics sections!
    if (targetSong.chordChart && targetSong.chordChart.sections && targetSong.chordChart.sections.length > 0) {
      const savedSections = targetSong.chordChart.sections;
      
      // Auto-prepend saved Intro section if not parsed from raw lyrics
      const savedIntro = savedSections.find(s => s && s.sectionLabel && s.sectionLabel.toLowerCase() === "intro");
      const hasBaseIntro = baseSections.some(s => s && s.sectionLabel && s.sectionLabel.toLowerCase() === "intro");
      if (savedIntro && !hasBaseIntro) {
        baseSections.unshift(JSON.parse(JSON.stringify(savedIntro)));
      }

      // Auto-append saved Outro section if not parsed from raw lyrics
      const savedOutro = savedSections.find(s => s && s.sectionLabel && s.sectionLabel.toLowerCase() === "outro");
      const hasBaseOutro = baseSections.some(s => s && s.sectionLabel && s.sectionLabel.toLowerCase() === "outro");
      if (savedOutro && !hasBaseOutro) {
        baseSections.push(JSON.parse(JSON.stringify(savedOutro)));
      }

      for (let sIdx = 0; sIdx < baseSections.length; sIdx++) {
        const baseSec = baseSections[sIdx];
        // Try to find matching saved section by label, or fallback to index
        let savedSec = savedSections.find(s => s && s.sectionLabel && s.sectionLabel.toLowerCase() === baseSec.sectionLabel.toLowerCase());
        if (!savedSec) {
          savedSec = savedSections[sIdx];
        }
        
        if (savedSec && savedSec.lines) {
          for (let lIdx = 0; lIdx < baseSec.lines.length; lIdx++) {
            const baseLine = baseSec.lines[lIdx];
            const savedLine = savedSec.lines[lIdx];
            if (savedLine) {
              baseLine.chords = savedLine.chords || "";
            }
          }
        }
      }
    }
    
    return baseSections;
  };

  const getDisplaySections = () => {
    return getSongDisplaySections(song);
  };

  // Load per-user personalized display key, capo, and musician notes settings
  useEffect(() => {
    const loadUserPreferences = async () => {
      try {
        const savedKey = await AsyncStorage.getItem(`@displayKey_${user?.uid}_${activeSongObj.songId}`);
        const savedCapo = await AsyncStorage.getItem(`@capo_${user?.uid}_${activeSongObj.songId}`);
        const savedNotes = await AsyncStorage.getItem(`@musicianNotes_${user?.uid}_${activeSongObj.songId}`);
        const savedNotation = await AsyncStorage.getItem(`@notationMode_${user?.uid}`);
        
        if (savedNotation) {
          setNotationMode(savedNotation);
        }
        
        if (savedKey) {
          setDisplayKey(savedKey);
        } else if (activeSongObj.userDisplayKeys && activeSongObj.userDisplayKeys[user?.uid]) {
          setDisplayKey(activeSongObj.userDisplayKeys[user.uid]);
        } else {
          setDisplayKey(activeSongObj.originalKey || "C");
        }

        if (savedCapo) {
          setCapo(parseInt(savedCapo, 10));
        } else if (activeSongObj.userCapos && activeSongObj.userCapos[user?.uid] !== undefined) {
          setCapo(activeSongObj.userCapos[user.uid]);
        } else {
          setCapo(0);
        }

        if (savedNotes !== null) {
          setMusicianNotes(savedNotes);
        } else if (activeSongObj.userMusicianNotes && activeSongObj.userMusicianNotes[user?.uid]) {
          setMusicianNotes(activeSongObj.userMusicianNotes[user.uid]);
        } else {
          setMusicianNotes("");
        }
      } catch (err) {
        console.warn("Failed to load user chord settings from storage:", err);
      }
    };

    if (user?.uid && activeSongObj.songId) {
      loadUserPreferences();
    }
  }, [activeSongObj.songId, user?.uid, activeSongObj.userDisplayKeys, activeSongObj.userCapos, activeSongObj.userMusicianNotes]);

  // Load and sync recordings whenever activeSongObj changes
  useEffect(() => {
    if (activeSongObj && activeSongObj.recordings) {
      setRecordingsList(activeSongObj.recordings || []);
    } else {
      setRecordingsList([]);
    }
  }, [activeSongObj?.songId, activeSongObj?.recordings]);

  // Cleanup audio objects on unmount
  useEffect(() => {
    return () => {
      if (playbackSound) {
        playbackSound.unloadAsync().catch(() => {});
      }
      if (previewSound) {
        previewSound.unloadAsync().catch(() => {});
      }
      if (recordIntervalRef.current) {
        clearInterval(recordIntervalRef.current);
      }
    };
  }, [playbackSound, previewSound]);

  // Save recording to Firestore/AsyncStorage
  const handleSaveRecording = async (base64Audio, durationSec) => {
    if (!recordingName.trim()) {
      Alert.alert("Required", "Please provide a name for this recording.");
      return;
    }

    const newRecording = {
      id: "rec_" + Date.now(),
      title: recordingName.trim(),
      target: recordingTarget,
      audioBase64: base64Audio,
      duration: durationSec,
      recordedBy: user?.name || user?.displayName || "Worship Leader",
      recordedByUid: user?.uid || "admin",
      recordedAt: new Date().toISOString(),
    };

    const updatedRecordings = [...recordingsList, newRecording];

    try {
      if (USE_DEMO_MODE) {
        setRecordingsList(updatedRecordings);
        const stored = await AsyncStorage.getItem("@worship_team_songs");
        if (stored) {
          const parsed = JSON.parse(stored);
          const idx = parsed.findIndex(s => s.songId === activeSongObj.songId);
          if (idx !== -1) {
            parsed[idx].recordings = updatedRecordings;
            await AsyncStorage.setItem("@worship_team_songs", JSON.stringify(parsed));
          }
        }
        if (onUpdateSong) {
          onUpdateSong({ ...activeSongObj, recordings: updatedRecordings });
        }
      } else {
        const songRef = doc(db, "songs", activeSongObj.songId);
        await updateDoc(songRef, {
          recordings: updatedRecordings,
        });
        if (onUpdateSong) {
          onUpdateSong({ ...activeSongObj, recordings: updatedRecordings });
        }
      }
      
      setRecordingName("");
      setRecordingTarget("choir");
      setRecordPreviewUri(null);
      setRecordModalVisible(false);
      Alert.alert("Success", "Recording saved successfully!");
    } catch (err) {
      console.error("Failed to save recording:", err);
      Alert.alert("Error", "Failed to save recording: " + err.message);
    }
  };

  const handleSaveRecordingWrapper = async () => {
    if (!recordingName.trim()) {
      Alert.alert("Required", "Please enter a name for the recording.");
      return;
    }
    if (!recordPreviewUri) {
      Alert.alert("No Recording", "Please record something first.");
      return;
    }

    try {
      const response = await fetch(recordPreviewUri);
      const blob = await response.blob();
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64data = reader.result;
        const durationSec = Math.round(recordDuration);
        await handleSaveRecording(base64data, durationSec);
      };
      reader.onerror = (e) => {
        throw new Error("Failed to read audio blob: " + e.message);
      };
      reader.readAsDataURL(blob);
    } catch (err) {
      console.error("Conversion to base64 failed:", err);
      Alert.alert("Save Failed", "Failed to process audio recording: " + err.message);
    }
  };

  const handleDeleteRecording = async (recordingId) => {
    Alert.alert(
      "Delete Recording",
      "Are you sure you want to delete this recording?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            const updatedRecordings = recordingsList.filter(r => r.id !== recordingId);
            try {
              if (USE_DEMO_MODE) {
                setRecordingsList(updatedRecordings);
                const stored = await AsyncStorage.getItem("@worship_team_songs");
                if (stored) {
                  const parsed = JSON.parse(stored);
                  const idx = parsed.findIndex(s => s.songId === activeSongObj.songId);
                  if (idx !== -1) {
                    parsed[idx].recordings = updatedRecordings;
                    await AsyncStorage.setItem("@worship_team_songs", JSON.stringify(parsed));
                  }
                }
                if (onUpdateSong) {
                  onUpdateSong({ ...activeSongObj, recordings: updatedRecordings });
                }
              } else {
                const songRef = doc(db, "songs", activeSongObj.songId);
                await updateDoc(songRef, {
                  recordings: updatedRecordings,
                });
                if (onUpdateSong) {
                  onUpdateSong({ ...activeSongObj, recordings: updatedRecordings });
                }
              }
              Alert.alert("Success", "Recording deleted!");
            } catch (err) {
              console.error("Failed to delete recording:", err);
              Alert.alert("Error", "Failed to delete recording: " + err.message);
            }
          }
        }
      ]
    );
  };

  const startRecording = async () => {
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (permission.status !== "granted") {
        Alert.alert("Permission Denied", "Microphone access is required to record audio.");
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      if (playbackSound) {
        await playbackSound.stopAsync();
        await playbackSound.unloadAsync();
        setPlaybackSound(null);
        setActivePlayingId(null);
      }

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.LOW_QUALITY
      );
      setRecordingObj(recording);
      setIsRecording(true);
      setRecordDuration(0);

      recordIntervalRef.current = setInterval(() => {
        setRecordDuration(prev => prev + 1);
      }, 1000);

    } catch (err) {
      console.error("Failed to start recording:", err);
      Alert.alert("Error", "Could not start recording: " + err.message);
    }
  };

  const stopRecording = async () => {
    if (!recordingObj) return;

    try {
      setIsRecording(false);
      clearInterval(recordIntervalRef.current);
      
      await recordingObj.stopAndUnloadAsync();
      const uri = recordingObj.getURI();
      setRecordPreviewUri(uri);
      setRecordingObj(null);

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });
    } catch (err) {
      console.error("Failed to stop recording:", err);
      Alert.alert("Error", "Could not stop recording: " + err.message);
    }
  };

  const startPreview = async () => {
    if (!recordPreviewUri) return;
    try {
      if (previewSound) {
        await previewSound.unloadAsync();
      }

      const { sound } = await Audio.Sound.createAsync(
        { uri: recordPreviewUri },
        { shouldPlay: true },
        onPreviewStatusUpdate
      );
      setPreviewSound(sound);
      setIsPreviewPlaying(true);
    } catch (err) {
      console.error("Failed to play preview:", err);
    }
  };

  const stopPreview = async () => {
    if (previewSound) {
      await previewSound.stopAsync();
      setIsPreviewPlaying(false);
    }
  };

  const onPreviewStatusUpdate = (status) => {
    if (status.isLoaded) {
      setPreviewPosition(status.positionMillis);
      setPreviewDuration(status.durationMillis);
      if (status.didJustFinish) {
        setIsPreviewPlaying(false);
        setPreviewPosition(0);
      }
    }
  };

  const handlePlayRecording = async (rec) => {
    try {
      if (activePlayingId === rec.id) {
        if (playbackSound) {
          await playbackSound.stopAsync();
          await playbackSound.unloadAsync();
        }
        setPlaybackSound(null);
        setActivePlayingId(null);
        return;
      }

      if (playbackSound) {
        await playbackSound.stopAsync();
        await playbackSound.unloadAsync();
        setPlaybackSound(null);
        setActivePlayingId(null);
      }

      const base64Part = rec.audioBase64.split("base64,")[1] || rec.audioBase64;
      const fileUri = `${FileSystem.cacheDirectory}${rec.id}.m4a`;

      await FileSystem.writeAsStringAsync(fileUri, base64Part, {
        encoding: FileSystem.EncodingType.Base64,
      });

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });

      const { sound } = await Audio.Sound.createAsync(
        { uri: fileUri },
        { shouldPlay: true },
        (status) => {
          if (status.isLoaded) {
            setPlaybackPosition(status.positionMillis);
            setPlaybackDuration(status.durationMillis);
            if (status.didJustFinish) {
              setActivePlayingId(null);
              setPlaybackSound(null);
              setPlaybackPosition(0);
            }
          }
        }
      );

      setPlaybackSound(sound);
      setActivePlayingId(rec.id);
    } catch (err) {
      console.error("Failed to play recording:", err);
      Alert.alert("Playback Error", "Failed to play audio snippet: " + err.message);
    }
  };

  // Sync preferences in full-screen mode when swiping to a new song
  useEffect(() => {
    if (isFullScreen && targetSongs[currentSongIndex]) {
      const activeSong = targetSongs[currentSongIndex];
      const loadFullScreenPrefs = async () => {
        try {
          const savedKey = await AsyncStorage.getItem(`@displayKey_${user?.uid}_${activeSong.songId}`);
          const savedCapo = await AsyncStorage.getItem(`@capo_${user?.uid}_${activeSong.songId}`);
          
          let resolvedKey = activeSong.originalKey || "C";
          if (savedKey) {
            resolvedKey = savedKey;
          } else if (activeSong.userDisplayKeys && user?.uid && activeSong.userDisplayKeys[user.uid]) {
            resolvedKey = activeSong.userDisplayKeys[user.uid];
          } else if (activeSong.currentKey) {
            resolvedKey = activeSong.currentKey;
          }
          
          let resolvedCapo = 0;
          if (savedCapo) {
            resolvedCapo = parseInt(savedCapo, 10);
          } else if (activeSong.userCapos && user?.uid && activeSong.userCapos[user.uid]) {
            resolvedCapo = parseInt(activeSong.userCapos[user.uid], 10);
          }
          
          setDisplayKey(resolvedKey);
          setCapo(resolvedCapo);
        } catch (e) {
          console.warn("Failed to load full screen prefs:", e);
        }
      };
      loadFullScreenPrefs();
    }
  }, [currentSongIndex, isFullScreen]);

  // Transposition & Capo settings handlers
  const handleKeyChange = async (newKey) => {
    setDisplayKey(newKey);
    try {
      await AsyncStorage.setItem(`@displayKey_${user?.uid}_${activeSongObj.songId}`, newKey);
      
      if (!USE_DEMO_MODE && user?.uid) {
        const songDocRef = doc(db, "songs", activeSongObj.songId);
        await updateDoc(songDocRef, {
          [`userDisplayKeys.${user.uid}`]: newKey,
        });
      }

      if (onUpdateSong) {
        onUpdateSong({
          ...activeSongObj,
          userDisplayKeys: {
            ...(activeSongObj.userDisplayKeys || {}),
            [user?.uid]: newKey,
          }
        });
      }
    } catch (err) {
      console.warn("Failed to save transpose key change:", err);
    }
  };

  const handleNotationModeChange = async (mode) => {
    setNotationMode(mode);
    if (user?.uid) {
      try {
        await AsyncStorage.setItem(`@notationMode_${user?.uid}`, mode);
      } catch (err) {
        console.warn("Failed to save notation mode:", err);
      }
    }
  };

  const handleCapoChange = async (newCapo) => {
    setCapo(newCapo);
    try {
      await AsyncStorage.setItem(`@capo_${user?.uid}_${activeSongObj.songId}`, newCapo.toString());

      if (!USE_DEMO_MODE && user?.uid) {
        const songDocRef = doc(db, "songs", activeSongObj.songId);
        await updateDoc(songDocRef, {
          [`userCapos.${user.uid}`]: newCapo,
        });
      }

      if (onUpdateSong) {
        onUpdateSong({
          ...activeSongObj,
          userCapos: {
            ...(activeSongObj.userCapos || {}),
            [user?.uid]: newCapo,
          }
        });
      }
    } catch (err) {
      console.warn("Failed to save capo change:", err);
    }
  };

  const [selectedRoot, setSelectedRoot] = useState(null);

  const startEditingChords = () => {
    let initialSections = JSON.parse(JSON.stringify(getDisplaySections()));
    
    for (const sec of initialSections) {
      if (sec.lines) {
        for (const line of sec.lines) {
          line.chordsMap = parseMonospaceChordsToMap(line.chords || "");
        }
      }
    }
    
    setEditSections(initialSections);
    setBracketText(convertToBracketFormat(initialSections));
    setChartBaseKey(song.originalKey || "C");
    setEditorMode("grid");
    setSelectedRoot(null);
    setActiveTapCell({ secIdx: null, lineIdx: null, charIndex: null, word: "" });
    setIsEditingChords(true);
  };

  const handleToggleEditorMode = (newMode) => {
    if (newMode === editorMode) return;
    if (newMode === "text") {
      const updated = [...editSections];
      for (const sec of updated) {
        if (sec.lines) {
          for (const line of sec.lines) {
            line.chords = compileChordsMapToMonospace(line.chordsMap || {});
          }
        }
      }
      setEditSections(updated);
      const text = convertToBracketFormat(updated);
      setBracketText(text);
    } else {
      const parsed = parseBracketFormat(bracketText);
      for (const sec of parsed) {
        if (sec.lines) {
          for (const line of sec.lines) {
            line.chordsMap = parseMonospaceChordsToMap(line.chords || "");
          }
        }
      }
      setEditSections(parsed);
    }
    setEditorMode(newMode);
    setActiveTapCell({ secIdx: null, lineIdx: null, charIndex: null, word: "" });
  };

  const handleSaveChords = async () => {
    try {
      let finalSections = JSON.parse(JSON.stringify(editSections));
      if (editorMode === "text") {
        finalSections = parseBracketFormat(bracketText);
      } else {
        for (const sec of finalSections) {
          if (sec.lines) {
            for (const line of sec.lines) {
              line.chords = compileChordsMapToMonospace(line.chordsMap || {});
              delete line.chordsMap;
            }
          }
        }
      }
      
      const updatedChart = {
        sections: finalSections
      };
      
      const lastEditedChordKeys = [];
      try {
        const oldSections = getDisplaySections();
        for (let sIdx = 0; sIdx < finalSections.length; sIdx++) {
          const oldSec = oldSections[sIdx];
          const newSec = finalSections[sIdx];
          if (oldSec && newSec && oldSec.lines && newSec.lines) {
            for (let lIdx = 0; lIdx < newSec.lines.length; lIdx++) {
              const oldLine = oldSec.lines[lIdx];
              const newLine = newSec.lines[lIdx];
              const oldMap = oldLine ? parseMonospaceChordsToMap(oldLine.chords || "") : {};
              const newMap = newLine ? parseMonospaceChordsToMap(newLine.chords || "") : {};
              
              Object.keys(newMap).forEach((charIdx) => {
                if (oldMap[charIdx] !== newMap[charIdx]) {
                  lastEditedChordKeys.push(`${sIdx}_${lIdx}_${charIdx}`);
                }
              });
              Object.keys(oldMap).forEach((charIdx) => {
                if (newMap[charIdx] === undefined) {
                  lastEditedChordKeys.push(`${sIdx}_${lIdx}_${charIdx}`);
                }
              });
            }
          }
        }
      } catch (err) {
        console.warn("Failed to detect modified chord coordinates:", err);
      }

      const updatedData = {
        ...song,
        chordChart: updatedChart,
        originalKey: chartBaseKey,
        currentKey: chartBaseKey,
        lastChordEditBy: user?.displayName || user?.email || "Worship Leader",
        lastChordEditAt: new Date().toISOString(),
        lastEditedBy: user?.uid || "unknown-uid",
        lastEditedByName: user?.displayName || user?.email || "Worship Leader",
        lastEditedAt: new Date().toISOString(),
        lastEditedFields: "Chords Updated",
        lastEditedChordKeys: lastEditedChordKeys
      };
      
      setDisplayKey(chartBaseKey);
      setCapo(0);
      
      await AsyncStorage.setItem(`@displayKey_${user?.uid}_${song.songId}`, chartBaseKey);
      await AsyncStorage.setItem(`@capo_${user?.uid}_${song.songId}`, "0");
      
      if (!USE_DEMO_MODE) {
        const songDocRef = doc(db, "songs", song.songId);
        await updateDoc(songDocRef, {
          chordChart: updatedChart,
          originalKey: chartBaseKey,
          currentKey: chartBaseKey,
          lastChordEditBy: user?.displayName || user?.email || "Worship Leader",
          lastChordEditAt: new Date(),
          lastEditedBy: user?.uid || "unknown-uid",
          lastEditedByName: user?.displayName || user?.email || "Worship Leader",
          lastEditedAt: new Date(),
          lastEditedFields: "Chords Updated",
          lastEditedChordKeys: lastEditedChordKeys
        });
      }
      
      if (onUpdateSong) {
        onUpdateSong(updatedData);
      }
      
      setIsEditingChords(false);
      Alert.alert("Success", "Chord chart saved successfully!");
    } catch (err) {
      console.error("Failed to save chord chart:", err);
      Alert.alert("Error", "Failed to save chord chart. Please try again.");
    }
  };

  const handleSaveMusicianNotes = async () => {
    try {
      setMusicianNotes(tempNotes);
      setIsNotesEditing(false);
      
      await AsyncStorage.setItem(`@musicianNotes_${user?.uid}_${song.songId}`, tempNotes);
      
      if (!USE_DEMO_MODE && user?.uid) {
        const songDocRef = doc(db, "songs", song.songId);
        await updateDoc(songDocRef, {
          [`userMusicianNotes.${user.uid}`]: tempNotes
        });
      }
      
      if (onUpdateSong) {
        onUpdateSong({
          ...song,
          userMusicianNotes: {
            ...(song.userMusicianNotes || {}),
            [user?.uid]: tempNotes
          }
        });
      }
      
      Alert.alert("Success", "Musician notes updated!");
    } catch (err) {
      console.error("Failed to save musician notes:", err);
      Alert.alert("Error", "Failed to save notes.");
    }
  };

  const handleUpdateSectionLabel = (secIdx, val) => {
    const updated = [...editSections];
    updated[secIdx].sectionLabel = val;
    setEditSections(updated);
  };

  const handleRemoveSection = (secIdx) => {
    const updated = editSections.filter((_, idx) => idx !== secIdx);
    setEditSections(updated);
  };

  const handleAddSection = () => {
    setSectionCreator({
      visible: true,
      type: "Verse " + (editSections.length + 1),
      linesCount: 4
    });
  };

  const handleOpenSlicer = () => {
    const lyricsText = activeLyricsTab === "tamil" ? (song.lyricsTamil || "") : (song.lyricsEnglish || "");
    const lines = lyricsText.split("\n").map(l => l.trim()).filter(l => l.length > 0);
    
    if (lines.length === 0) {
      Alert.alert("No Lyrics Available", "Please add lyrics to this song first from the Edit Song screen.");
      return;
    }
    
    const currentSections = getDisplaySections();
    const mappedLines = [];
    
    for (const sec of currentSections) {
      if (sec.lines && sec.sectionLabel.toLowerCase() !== "intro" && sec.sectionLabel.toLowerCase() !== "outro") {
        for (const line of sec.lines) {
          if (line.lyrics && line.lyrics.trim().length > 0) {
            mappedLines.push({
              text: line.lyrics.trim(),
              chords: line.chords || "",
              sectionLabel: sec.sectionLabel || "Verse 1"
            });
          }
        }
      }
    }
    
    if (mappedLines.length === 0) {
      for (const lineText of lines) {
        if (lineText.startsWith("[") && lineText.endsWith("]")) continue;
        mappedLines.push({
          text: lineText,
          chords: "",
          sectionLabel: "Verse 1"
        });
      }
    }
    
    setSlicerLines(mappedLines);
    setSlicerVisible(true);
  };

  const handleSaveSlicer = async () => {
    try {
      const groupedSections = [];
      let currentSec = null;
      
      const currentSections = getDisplaySections();
      const existingIntro = currentSections.find(s => s.sectionLabel.toLowerCase() === "intro");
      if (existingIntro) {
        groupedSections.push(existingIntro);
      }
      
      for (const lineObj of slicerLines) {
        if (!currentSec || currentSec.sectionLabel.toLowerCase() !== lineObj.sectionLabel.toLowerCase()) {
          currentSec = {
            sectionLabel: lineObj.sectionLabel,
            lines: []
          };
          groupedSections.push(currentSec);
        }
        currentSec.lines.push({
          lyrics: lineObj.text,
          chords: lineObj.chords
        });
      }
      
      const existingOutro = currentSections.find(s => s.sectionLabel.toLowerCase() === "outro");
      if (existingOutro && !groupedSections.some(s => s.sectionLabel.toLowerCase() === "outro")) {
        groupedSections.push(existingOutro);
      }
      
      for (const sec of groupedSections) {
        for (const l of sec.lines) {
          delete l.chordsMap;
        }
      }
      
      const updatedChart = {
        sections: groupedSections
      };
      
      // Also construct the new formatted lyrics text with [Section] headers!
      const lyricsLines = [];
      let lastSectionLabel = "";
      for (const lineObj of slicerLines) {
        if (lineObj.sectionLabel !== lastSectionLabel) {
          lyricsLines.push(`[${lineObj.sectionLabel}]`);
          lastSectionLabel = lineObj.sectionLabel;
        }
        lyricsLines.push(lineObj.text);
      }
      const newLyricsText = lyricsLines.join("\n");
      const lyricsField = activeLyricsTab === "tamil" ? "lyricsTamil" : "lyricsEnglish";
      
      const updatedData = {
        ...song,
        chordChart: updatedChart,
        [lyricsField]: newLyricsText,
        lastChordEditBy: user?.displayName || user?.email || "Musician",
        lastChordEditAt: new Date().toISOString(),
        lastEditedBy: user?.uid || "unknown-uid",
        lastEditedByName: user?.displayName || user?.email || "Musician",
        lastEditedAt: new Date().toISOString(),
        lastEditedFields: "Lyrics Sections Organized"
      };
      
      if (!USE_DEMO_MODE) {
        const songDocRef = doc(db, "songs", song.songId);
        await updateDoc(songDocRef, {
          chordChart: updatedChart,
          [lyricsField]: newLyricsText,
          lastChordEditBy: user?.displayName || user?.email || "Musician",
          lastChordEditAt: new Date(),
          lastEditedBy: user?.uid || "unknown-uid",
          lastEditedByName: user?.displayName || user?.email || "Musician",
          lastEditedAt: new Date(),
          lastEditedFields: "Lyrics Sections Organized"
        });
      }
      
      if (onUpdateSong) {
        onUpdateSong(updatedData);
      }
      
      setSlicerVisible(false);
      Alert.alert("Success", "Lyrics sections organized perfectly!");
    } catch (err) {
      console.error("Failed to save slicer structure:", err);
      Alert.alert("Error", "Failed to save song structure.");
    }
  };

  const handleSaveIntroProgression = async () => {
    if (introChords.length === 0) {
      Alert.alert("No Chords", "Please add at least one chord to build your Intro!");
      return;
    }
    
    try {
      const chordsMap = {};
      introChords.forEach((c, idx) => {
        chordsMap[idx * 12] = `${c.chord} (${c.bars})`;
      });
      
      const compiledIntroLine = {
        chords: compileChordsMapToMonospace(chordsMap),
        lyrics: ""
      };
      
      const currentSections = JSON.parse(JSON.stringify(getDisplaySections()));
      const existingIntroIdx = currentSections.findIndex(s => s.sectionLabel.toLowerCase() === "intro");
      
      if (existingIntroIdx !== -1) {
        currentSections[existingIntroIdx].lines = [compiledIntroLine];
      } else {
        const newIntroSection = {
          sectionLabel: "Intro",
          lines: [compiledIntroLine]
        };
        currentSections.unshift(newIntroSection);
      }
      
      for (const sec of currentSections) {
        for (const l of sec.lines) {
          delete l.chordsMap;
        }
      }
      
      const updatedChart = {
        sections: currentSections
      };
      
      const lastEditedChordKeys = [];
      introChords.forEach((_, idx) => {
        lastEditedChordKeys.push(`0_0_${idx * 12}`);
      });

      const updatedData = {
        ...song,
        chordChart: updatedChart,
        lastChordEditBy: user?.displayName || user?.email || "Musician",
        lastChordEditAt: new Date().toISOString(),
        lastEditedBy: user?.uid || "unknown-uid",
        lastEditedByName: user?.displayName || user?.email || "Musician",
        lastEditedAt: new Date().toISOString(),
        lastEditedFields: "Intro Chords Added",
        lastEditedChordKeys: lastEditedChordKeys
      };
      
      if (!USE_DEMO_MODE) {
        const songDocRef = doc(db, "songs", song.songId);
        await updateDoc(songDocRef, {
          chordChart: updatedChart,
          lastChordEditBy: user?.displayName || user?.email || "Musician",
          lastChordEditAt: new Date(),
          lastEditedBy: user?.uid || "unknown-uid",
          lastEditedByName: user?.displayName || user?.email || "Musician",
          lastEditedAt: new Date(),
          lastEditedFields: "Intro Chords Added",
          lastEditedChordKeys: lastEditedChordKeys
        });
      }
      
      if (onUpdateSong) {
        onUpdateSong(updatedData);
      }
      
      setIntroCreatorVisible(false);
      setIntroChords([]);
      Alert.alert("Success", "Intro chords added at the starting of the song!");
    } catch (err) {
      console.error("Failed to save Intro progression:", err);
      Alert.alert("Error", "Failed to save Intro chords.");
    }
  };

  const handleUpdateLineField = (secIdx, lineIdx, field, val) => {
    const updated = [...editSections];
    updated[secIdx].lines[lineIdx][field] = val;
    if (field === "lyrics") {
      // Re-initialize chordsMap on lyric text changes to keep it fresh
      updated[secIdx].lines[lineIdx].chordsMap = parseMonospaceChordsToMap(updated[secIdx].lines[lineIdx].chords || "");
    }
    setEditSections(updated);
  };

  const handleAddLine = (secIdx, lineIdx) => {
    const updated = [...editSections];
    updated[secIdx].lines.splice(lineIdx + 1, 0, { chords: "", lyrics: "", chordsMap: {} });
    setEditSections(updated);
  };

  const handleRemoveLine = (secIdx, lineIdx) => {
    const updated = [...editSections];
    updated[secIdx].lines.splice(lineIdx, 1);
    setEditSections(updated);
  };

  const handleInsertBracketChord = (chord) => {
    const insertText = `[${chord}]`;
    const { start, end } = cursorSelection;
    const newText = bracketText.substring(0, start) + insertText + bracketText.substring(end);
    setBracketText(newText);
    
    const newCursorPos = start + insertText.length;
    setCursorSelection({ start: newCursorPos, end: newCursorPos });
  };

  const handleAssignChordToTapCell = async (chord) => {
    const { secIdx, lineIdx, charIndex } = activeTapCell;
    if (secIdx === null || lineIdx === null || charIndex === null) return;
    
    // Check if we need to prompt for bar count!
    // We only prompt for bars in the "Intro" or "Outro" sections, or on lines with no lyrics.
    // Also, if the chord already has a Bar count (e.g. it has the word "Bar"), we don't prompt!
    const activeSection = isEditingChords ? editSections[secIdx] : getDisplaySections()[secIdx];
    const isIntroOrOutro = activeSection && activeSection.sectionLabel && 
      (activeSection.sectionLabel.toLowerCase().includes("intro") || 
       activeSection.sectionLabel.toLowerCase().includes("outro"));
    
    const line = activeSection && activeSection.lines && activeSection.lines[lineIdx];
    const isProgressionLine = line && (!line.lyrics || line.lyrics.trim() === "");
    
    const hasBarDuration = chord.includes("Bar");
    
    if ((isIntroOrOutro || isProgressionLine) && !hasBarDuration && pendingChord === null) {
      setPendingChord(chord);
      return;
    }
    
    if (isEditingChords) {
      const updated = [...editSections];
      const line = updated[secIdx].lines[lineIdx];
      if (!line.chordsMap) line.chordsMap = {};
      
      line.chordsMap[charIndex] = chord;
      line.chords = compileChordsMapToMonospace(line.chordsMap);
      
      setEditSections(updated);
      setActiveTapCell({ secIdx: null, lineIdx: null, charIndex: null, word: "" });
    } else {
      // Dynamic Direct auto-saving in display mode!
      try {
        const currentSections = JSON.parse(JSON.stringify(getDisplaySections()));
        const section = currentSections[secIdx];
        if (!section) return;
        const line = section.lines[lineIdx];
        if (!line) return;
        
        const lineChordsMap = parseMonospaceChordsToMap(line.chords || "");
        
        // Convert selected chord back to originalKey before saving!
        const semitones = getSemitoneShift();
        const preferSharps = !preferFlatsForKey(song.originalKey);
        const originalKeyChord = transposeChord(chord, -semitones, preferSharps);
        
        lineChordsMap[charIndex] = originalKeyChord;
        line.chords = compileChordsMapToMonospace(lineChordsMap);
        
        for (const sec of currentSections) {
          for (const l of sec.lines) {
            delete l.chordsMap;
          }
        }
        
        const updatedChart = {
          sections: currentSections
        };
        
        const updatedData = {
          ...song,
          chordChart: updatedChart,
          lastChordEditBy: user?.displayName || user?.email || "Musician",
          lastChordEditAt: new Date().toISOString(),
          lastEditedBy: user?.uid || "unknown-uid",
          lastEditedByName: user?.displayName || user?.email || "Musician",
          lastEditedAt: new Date().toISOString(),
          lastEditedFields: `Chord assigned: ${chord}`,
          lastEditedChordKeys: [`${secIdx}_${lineIdx}_${charIndex}`]
        };
        
        if (!USE_DEMO_MODE) {
          const songDocRef = doc(db, "songs", song.songId);
          await updateDoc(songDocRef, {
            chordChart: updatedChart,
            lastChordEditBy: user?.displayName || user?.email || "Musician",
            lastChordEditAt: new Date(),
            lastEditedBy: user?.uid || "unknown-uid",
            lastEditedByName: user?.displayName || user?.email || "Musician",
            lastEditedAt: new Date(),
            lastEditedFields: `Chord assigned: ${chord}`,
            lastEditedChordKeys: [`${secIdx}_${lineIdx}_${charIndex}`]
          });
        }
        
        if (onUpdateSong) {
          onUpdateSong(updatedData);
        }
        
        setActiveTapCell({ secIdx: null, lineIdx: null, charIndex: null, word: "" });
      } catch (err) {
        console.error("Failed to save chord dynamically:", err);
        Alert.alert("Error", "Failed to save chord. Please try again.");
      }
    }
  };

  const handleRemoveChordFromTapCell = async (secIdx, lineIdx, charIndex) => {
    if (isEditingChords) {
      const updated = [...editSections];
      const line = updated[secIdx].lines[lineIdx];
      if (line.chordsMap && line.chordsMap[charIndex]) {
        delete line.chordsMap[charIndex];
        line.chords = compileChordsMapToMonospace(line.chordsMap);
        setEditSections(updated);
      }
      
      if (activeTapCell.secIdx === secIdx && activeTapCell.lineIdx === lineIdx && activeTapCell.charIndex === charIndex) {
        setActiveTapCell({ secIdx: null, lineIdx: null, charIndex: null, word: "" });
      }
    } else {
      // Dynamic Direct auto-saving in display mode!
      try {
        const currentSections = JSON.parse(JSON.stringify(getDisplaySections()));
        const section = currentSections[secIdx];
        if (!section) return;
        const line = section.lines[lineIdx];
        if (!line) return;
        
        const lineChordsMap = parseMonospaceChordsToMap(line.chords || "");
        delete lineChordsMap[charIndex];
        line.chords = compileChordsMapToMonospace(lineChordsMap);
        
        for (const sec of currentSections) {
          for (const l of sec.lines) {
            delete l.chordsMap;
          }
        }
        
        const updatedChart = {
          sections: currentSections
        };
        
        const updatedData = {
          ...song,
          chordChart: updatedChart,
          lastChordEditBy: user?.displayName || user?.email || "Musician",
          lastChordEditAt: new Date().toISOString(),
          lastEditedBy: user?.uid || "unknown-uid",
          lastEditedByName: user?.displayName || user?.email || "Musician",
          lastEditedAt: new Date().toISOString(),
          lastEditedFields: "Chord cleared"
        };
        
        if (!USE_DEMO_MODE) {
          const songDocRef = doc(db, "songs", song.songId);
          await updateDoc(songDocRef, {
            chordChart: updatedChart,
            lastChordEditBy: user?.displayName || user?.email || "Musician",
            lastChordEditAt: new Date(),
            lastEditedBy: user?.uid || "unknown-uid",
            lastEditedByName: user?.displayName || user?.email || "Musician",
            lastEditedAt: new Date(),
            lastEditedFields: "Chord cleared"
          });
        }
        
        if (onUpdateSong) {
          onUpdateSong(updatedData);
        }
        
        setActiveTapCell({ secIdx: null, lineIdx: null, charIndex: null, word: "" });
      } catch (err) {
        console.error("Failed to clear chord dynamically:", err);
        Alert.alert("Error", "Failed to clear chord.");
      }
    }
  };

  const handleInsertChord = (chord) => {
    if (editorMode === "text") {
      handleInsertBracketChord(chord);
    } else {
      handleAssignChordToTapCell(chord);
    }
  };

  const handleTapRoot = (root) => {
    setSelectedRoot(root);
  };

  const handleModifierPress = (mod) => {
    const chord = (selectedRoot || "") + mod;
    handleInsertChord(chord);
    setSelectedRoot(null);
  };

  const handleInsertRootDirectly = () => {
    if (selectedRoot) {
      handleInsertChord(selectedRoot);
      setSelectedRoot(null);
    }
  };



  // Semitone calculation for live transposition
  const getSemitoneShift = (customOriginalKey, customDisplayKey) => {
    const origKey = customOriginalKey || song.originalKey;
    const dispKey = customDisplayKey || displayKey;
    if (!dispKey || !origKey) return 0;
    const originalRoot = extractRoot(origKey);
    const displayRoot = extractRoot(dispKey);
    return getKeyIndex(displayRoot) - getKeyIndex(originalRoot);
  };

  // Real-time listener to check if the current user has any active pending/in-progress tasks assigned for this song
  useEffect(() => {
    if (!song.songId || !user?.uid) {
      setHasLyricTask(false);
      return;
    }

    let unsubscribe = null;

    if (USE_DEMO_MODE) {
      const checkDemoTasks = async () => {
        try {
          const stored = await AsyncStorage.getItem("@worship_team_tasks");
          const allTasks = stored ? JSON.parse(stored) : [];
          const matching = allTasks.some((t) => {
            const isAssigned = Array.isArray(t.assignedTo) ? t.assignedTo.includes(user.uid) : t.assignedTo === user.uid;
            return isAssigned &&
              t.relatedSongId === song.songId &&
              (t.status === "pending" || t.status === "in_progress");
          });
          setHasLyricTask(matching);
        } catch (err) {
          console.error("Failed to load demo tasks in SongDetailScreen:", err);
        }
      };

      checkDemoTasks();
      const interval = setInterval(checkDemoTasks, 2000);
      return () => clearInterval(interval);
    } else {
      try {
        const tasksColl = collection(db, "tasks");
        const q = query(
          tasksColl,
          where("assignedTo", "array-contains", user.uid),
          where("relatedSongId", "==", song.songId)
        );

        unsubscribe = onSnapshot(q, (snapshot) => {
          let matching = false;
          snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            if (data.status === "pending" || data.status === "in_progress") {
              matching = true;
            }
          });
          setHasLyricTask(matching);
        }, (err) => {
          console.error("Failed to listen to song tasks inside SongDetailScreen:", err);
        });
      } catch (err) {
        console.error("Failed to initiate task listener inside SongDetailScreen:", err);
      }

      return () => {
        if (unsubscribe) unsubscribe();
      };
    }
  }, [song.songId, user?.uid]);

  // Check editing privileges:
  // - canEdit: Allows accessing editing interface (lyrics). Leaders, admins, musicians, choir members, or general members with active task clearance can edit lyrics.
  const canEdit = ["worship_leader", "super_admin", "musician", "choir_member"].includes(user?.role) || (user?.role === "member" && hasLyricTask);
  
  // - canEditChords: Strictly reserved for leaders, admins, and musicians.
  const canEditChords = ["worship_leader", "super_admin", "musician"].includes(user?.role);

  // Determine active theme color based on role
  const getRoleColor = (role) => {
    switch (role) {
      case "super_admin":
        return "#EF4444";
      case "worship_leader":
        return "#F59E0B";
      case "musician":
        return "#A855F7";
      case "choir_member":
        return "#0D9488";
      default:
        return "#3B82F6";
    }
  };

  const themeColor = getRoleColor(user?.role);

  // Set up BPM pulsating beat metronome effect!
  useEffect(() => {
    if (!song.bpm || song.bpm <= 0) return;

    // Calculate duration per beat in milliseconds
    const beatDurationMs = (60 / song.bpm) * 1000;

    const pulseAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.3,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1.0,
          duration: beatDurationMs - 100,
          useNativeDriver: true,
        }),
      ])
    );

    pulseAnimation.start();

    return () => pulseAnimation.stop();
  }, [song.bpm]);

  // Preload Inline Metronome Audio
  useEffect(() => {
    async function loadInlineAudio() {
      try {
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          staysActiveInBackground: false,
          shouldRouteThroughEarpieceAndroid: false,
        });

        // Load high downbeat sound
        const { sound: highSound } = await Audio.Sound.createAsync(
          { uri: TICK_SOUND_URL },
          {
            shouldPlay: false,
            volume: 1.0,
            rate: 1.45,
            shouldCorrectPitch: false,
          }
        );
        inlineHighSoundRef.current = highSound;

        // Load low regular beat sound
        const { sound: lowSound } = await Audio.Sound.createAsync(
          { uri: TICK_SOUND_URL },
          {
            shouldPlay: false,
            volume: 0.55,
            rate: 0.95,
            shouldCorrectPitch: false,
          }
        );
        inlineLowSoundRef.current = lowSound;
        inlineSoundsLoaded.current = true;
      } catch (err) {
        console.warn("Failed to load inline metronome click audio assets:", err);
      }
    }

    loadInlineAudio();

    return () => {
      // Cleanup sounds when screen unmounts
      if (inlineHighSoundRef.current) {
        inlineHighSoundRef.current.unloadAsync().catch(() => {});
        inlineHighSoundRef.current = null;
      }
      if (inlineLowSoundRef.current) {
        inlineLowSoundRef.current.unloadAsync().catch(() => {});
        inlineLowSoundRef.current = null;
      }
      inlineSoundsLoaded.current = false;
      if (inlineTimerRef.current) {
        clearInterval(inlineTimerRef.current);
        inlineTimerRef.current = null;
      }
    };
  }, []);

  const getBeatsPerMeasure = (sig) => {
    if (sig === "2/4") return 2;
    if (sig === "3/4") return 3;
    if (sig === "4/4") return 4;
    if (sig === "6/8") return 6;
    if (sig === "12/8") return 12;
    return 4;
  };

  // Play sound for inline metronome
  const playInlineClickSound = async (isDownbeat) => {
    try {
      if (!inlineSoundsLoaded.current) return;
      const soundObj = isDownbeat ? inlineHighSoundRef.current : inlineLowSoundRef.current;
      if (soundObj) {
        await soundObj.replayAsync();
      }
    } catch (err) {
      console.log("Inline audio beat execution error:", err);
    }
  };

  // Inline Metronome Scheduler Loop
  useEffect(() => {
    if (!isInlinePlaying) {
      if (inlineTimerRef.current) {
        clearInterval(inlineTimerRef.current);
        inlineTimerRef.current = null;
      }
      setInlineCurrentBeat(1);
      return;
    }

    const currentBpm = song.bpm || 100;
    const intervalMs = (60 / currentBpm) * 1000;
    let nextBeat = 1;

    // Trigger beat 1 instantly
    setInlineCurrentBeat(nextBeat);
    playInlineClickSound(true);

    inlineTimerRef.current = setInterval(() => {
      const beatsCount = getBeatsPerMeasure(song.timeSignature || "4/4");
      nextBeat = (nextBeat % beatsCount) + 1;
      setInlineCurrentBeat(nextBeat);
      const isDownbeat = nextBeat === 1;
      playInlineClickSound(isDownbeat);
    }, intervalMs);

    return () => {
      if (inlineTimerRef.current) {
        clearInterval(inlineTimerRef.current);
        inlineTimerRef.current = null;
      }
    };
  }, [isInlinePlaying, song.bpm, song.timeSignature]);

  // Turn off inline metronome if full screen metronome is opened
  useEffect(() => {
    if (metronomeVisible) {
      setIsInlinePlaying(false);
    }
  }, [metronomeVisible]);

  const handleOpenLink = (url) => {
    if (!url) return;
    Linking.openURL(url).catch((err) => {
      console.error("Failed to open link:", err);
    });
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return "N/A";
    // Check if firestore timestamp object
    if (timestamp.seconds) {
      return new Date(timestamp.seconds * 1000).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    }
    // Check if regular date or ISO string
    try {
      return new Date(timestamp).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return timestamp.toString();
    }
  };

  const renderFullScreenItemContent = (item) => {
    if (fullScreenTab === "lyrics") {
      const lyricsText = activeLyricsTab === "tamil" ? (item.lyricsTamil || "") : (item.lyricsEnglish || "");
      return (
        <ScrollView style={styles.fullScreenScroll} contentContainerStyle={styles.fullScreenScrollContent}>
          {lyricsText ? (
            <Text style={[
              styles.fullScreenLyricsText, 
              { fontSize: fullScreenFontSize }, 
              activeLyricsTab === "tamil" && styles.tamilFont
            ]}>
              {lyricsText}
            </Text>
          ) : (
            <Text style={styles.noLyricsText}>
              No {activeLyricsTab === "english" ? "English" : "Tamil"} lyrics available for this song.
            </Text>
          )}
        </ScrollView>
      );
    } else {
      // Render Chords
      const displaySections = getSongDisplaySections(item);
      const hasDisplaySections = displaySections && displaySections.length > 0;
      
      // Resolve the display key for this specific song!
      const isCurrent = item.songId === activeSongObj.songId;
      const itemDisplayKey = isCurrent 
        ? displayKey 
        : ((item.userDisplayKeys && user?.uid && item.userDisplayKeys[user.uid]) || item.currentKey || item.originalKey || "C");

      // Calculate semitone shift for this specific item
      const semitones = getSemitoneShift(item.originalKey, itemDisplayKey);
      
      const preferSharps = notationMode === "sharp" 
        ? true 
        : (notationMode === "flat" ? false : !preferFlatsForKey(itemDisplayKey));

      return (
        <ScrollView style={styles.fullScreenScroll} contentContainerStyle={styles.fullScreenScrollContent}>
          {hasDisplaySections ? (
            <View style={[styles.chordSheetPaper, { backgroundColor: "transparent", borderWidth: 0, padding: 0 }]}>
              {displaySections.map((section, sIdx) => {
                return (
                  <View key={sIdx} style={styles.chordSectionContainer}>
                    <Text style={[styles.chordSectionTitle, { color: themeColor, fontSize: fullScreenFontSize + 1 }]}>{section.sectionLabel}</Text>
                    <View style={styles.chordSectionLines}>
                      {section.lines && section.lines.map((line, lIdx) => {
                        const chordsMap = parseMonospaceChordsToMap(line.chords || "");
                        const hasChords = !!(line.chords && line.chords.trim() !== "");
                        const hasLyrics = !!(line.lyrics && line.lyrics.trim() !== "");

                        if (!hasLyrics && hasChords) {
                          const chordsArray = Object.keys(chordsMap)
                            .map(idx => parseInt(idx, 10))
                            .sort((a, b) => a - b);

                          return (
                            <View key={lIdx} style={styles.chordProgressionRow}>
                              {chordsArray.map((charIdx) => {
                                const rawCh = chordsMap[charIdx];
                                const forceSpelling = notationMode === "sharp" || notationMode === "flat";
                                const displayCh = transposeChord(rawCh, semitones, preferSharps, forceSpelling);
                                const finalCh = notationMode === "number" ? formatAsNumberSystem(displayCh, itemDisplayKey) : displayCh;
                                return (
                                  <View key={charIdx} style={[styles.progressionChordBadge, { backgroundColor: "rgba(255,255,255,0.05)" }]}>
                                    <Text style={[styles.progressionChordText, { color: themeColor, fontSize: fullScreenFontSize }]}>
                                      {finalCh}
                                    </Text>
                                  </View>
                                );
                              })}
                            </View>
                          );
                        }

                        if (hasLyrics) {
                          const tokens = tokenizeLyricsLine(line.lyrics || "");
                          return (
                            <View key={lIdx} style={styles.interactiveLyricsRow}>
                              {tokens.map((token, tokIdx) => {
                                if (!token.isWord) {
                                  return <Text key={tokIdx} style={[styles.lyricsSpace, { fontSize: fullScreenFontSize }]}> </Text>;
                                }

                                const rawChord = chordsMap[token.index];
                                const forceSpelling = notationMode === "sharp" || notationMode === "flat";
                                const displayChord = rawChord ? transposeChord(rawChord, semitones, preferSharps, forceSpelling) : null;
                                const finalChord = displayChord ? (notationMode === "number" ? formatAsNumberSystem(displayChord, itemDisplayKey) : displayChord) : null;

                                return (
                                  <View key={tokIdx} style={styles.interactiveWordBlock}>
                                    <View style={styles.interactiveChordSlot}>
                                      {finalChord && (
                                        <Text style={[
                                          styles.interactiveChordText,
                                          { color: themeColor, fontSize: Math.max(10, fullScreenFontSize - 4) }
                                        ]}>
                                          {finalChord}
                                        </Text>
                                      )}
                                    </View>
                                    <Text style={[styles.lyricsText, { fontSize: fullScreenFontSize }]}>
                                      {token.text}
                                    </Text>
                                  </View>
                                );
                              })}
                            </View>
                          );
                        }

                        return null;
                      })}
                    </View>
                  </View>
                );
              })}
            </View>
          ) : (
            <Text style={styles.noLyricsText}>No chords available for this song.</Text>
          )}
        </ScrollView>
      );
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onBack} activeOpacity={0.7}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>Song Details</Text>
        {canEdit ? (
          <TouchableOpacity
            style={[styles.editButton, { borderColor: themeColor }]}
            activeOpacity={0.8}
            onPress={() => onEditSong(song, hasLyricTask)}
          >
            <Text style={[styles.editButtonText, { color: themeColor }]}>Edit</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 60 }} /> // Spacer to balance header
        )}
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Main Info Card */}
        <View style={styles.metaCard}>
          <View style={styles.titleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.songTitle}>{song.title}</Text>
              <Text style={styles.songArtist}>{song.artist}</Text>
            </View>
            <View style={styles.keyBadgeContainer}>
              <View style={[styles.keyBadge, { backgroundColor: themeColor + "15", borderColor: themeColor + "40" }]}>
                <Text 
                  style={[
                    styles.keyText, 
                    { 
                      color: themeColor,
                      fontSize: (song.currentKey || song.originalKey) && (song.currentKey || song.originalKey).length > 6 
                        ? 11 
                        : ((song.currentKey || song.originalKey) && (song.currentKey || song.originalKey).length > 3 ? 13 : 18)
                    }
                  ]}
                  numberOfLines={1}
                >
                  {song.currentKey || song.originalKey}
                </Text>
                <Text style={styles.keyLabel}>Key</Text>
              </View>
              {!!song.currentKey && !!song.originalKey && song.currentKey !== song.originalKey && (
                <View style={styles.keyLogTooltip}>
                  <Text style={styles.keyLogText} numberOfLines={1}>
                    Orig: <Text style={styles.keyLogHighlight}>{song.originalKey}</Text>
                  </Text>
                  {!!song.keyLastChangedByName && (
                    <Text style={styles.keyLogByText} numberOfLines={1}>
                      By {song.keyLastChangedByName}
                    </Text>
                  )}
                </View>
              )}
            </View>
          </View>

          <View style={styles.divider} />

          {/* Quick Info Grid */}
          <View style={styles.infoGrid}>
            <TouchableOpacity
              style={styles.gridItem}
              onPress={() => setMetronomeVisible(true)}
              activeOpacity={0.7}
            >
              <View style={styles.gridItemHeaderRow}>
                <Text style={styles.gridLabel}>BPM / TEMPO ⏱️</Text>
                <TouchableOpacity
                  style={[
                    styles.inlinePlayBtn,
                    isInlinePlaying && { backgroundColor: themeColor }
                  ]}
                  activeOpacity={0.8}
                  onPress={(e) => {
                    e.stopPropagation();
                    setIsInlinePlaying(!isInlinePlaying);
                  }}
                >
                  <Text style={styles.inlinePlayBtnText}>
                    {isInlinePlaying ? "⏹️ Stop" : "▶️ Play"}
                  </Text>
                </TouchableOpacity>
              </View>
              <View style={styles.bpmContainer}>
                {song.bpm ? (
                  <>
                    <Animated.View
                      style={[
                        styles.pulseIndicator,
                        {
                          backgroundColor: isInlinePlaying ? "#EF4444" : themeColor,
                          transform: [{ scale: pulseAnim }],
                        },
                      ]}
                    />
                    <Text style={styles.gridValue}>{song.bpm}</Text>
                    {isInlinePlaying && (
                      <Text style={[styles.inlineBeatText, { color: themeColor }]}>
                        Beat {inlineCurrentBeat}
                      </Text>
                    )}
                  </>
                ) : (
                  <Text style={styles.gridValue}>100</Text>
                )}
              </View>
            </TouchableOpacity>

            <View style={styles.gridItem}>
              <Text style={styles.gridLabel}>TIME SIG</Text>
              <Text style={styles.gridValue}>{song.timeSignature || "4/4"}</Text>
            </View>


          </View>

          {/* Links Section */}
          {!!(song.youtubeLink || song.spotifyLink) && (
            <View style={styles.linksContainer}>
              {song.youtubeLink ? (
                <TouchableOpacity
                  style={[styles.linkButton, styles.youtubeButton]}
                  onPress={() => handleOpenLink(song.youtubeLink)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.linkButtonText}>📺 YouTube Video</Text>
                </TouchableOpacity>
              ) : null}

              {song.spotifyLink ? (
                <TouchableOpacity
                  style={[styles.linkButton, styles.spotifyButton]}
                  onPress={() => handleOpenLink(song.spotifyLink)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.linkButtonText}>🎵 Spotify Audio</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          )}
        </View>

        {/* Full Screen Mode Toggle Button */}
        {true && (
          <TouchableOpacity
            style={[styles.editChordsToggleBtn, { borderColor: themeColor + "60", backgroundColor: themeColor + "10", marginTop: 10, marginBottom: 20 }]}
            onPress={() => {
              setFullScreenTab(activeMainTab);
              setIsFullScreen(true);
            }}
            activeOpacity={0.8}
          >
            <Text style={[styles.editChordsToggleBtnText, { color: themeColor, fontSize: 13, fontWeight: "800" }]}>
              📱 Open Full Screen Setlist Viewer
            </Text>
          </TouchableOpacity>
        )}

        {/* Lyrics / Chords / Recordings Tab Selection */}
        <View style={styles.mainTabWrapper}>
          <TouchableOpacity
            style={[
              styles.mainTabButton,
              activeMainTab === "lyrics" && [styles.mainTabButtonActive, { borderBottomColor: themeColor }]
            ]}
            onPress={() => {
              setIsEditingChords(false);
              setActiveMainTab("lyrics");
            }}
            activeOpacity={0.7}
          >
            <Text style={[styles.mainTabButtonText, activeMainTab === "lyrics" && { color: themeColor, fontWeight: "800" }]}>
              Lyrics
            </Text>
          </TouchableOpacity>
          {canEditChords && (
            <TouchableOpacity
              style={[
                styles.mainTabButton,
                activeMainTab === "chords" && [styles.mainTabButtonActive, { borderBottomColor: themeColor }]
              ]}
              onPress={() => {
                setIsEditingChords(false);
                setActiveMainTab("chords");
              }}
              activeOpacity={0.7}
            >
              <Text style={[styles.mainTabButtonText, activeMainTab === "chords" && { color: themeColor, fontWeight: "800" }]}>
                Chords
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[
              styles.mainTabButton,
              activeMainTab === "recordings" && [styles.mainTabButtonActive, { borderBottomColor: themeColor }]
            ]}
            onPress={() => {
              setIsEditingChords(false);
              setActiveMainTab("recordings");
            }}
            activeOpacity={0.7}
          >
            <Text style={[styles.mainTabButtonText, activeMainTab === "recordings" && { color: themeColor, fontWeight: "800" }]}>
              Recordings
            </Text>
          </TouchableOpacity>
        </View>

        {/* Lyrics Segment View */}
        {activeMainTab === "lyrics" && (
          <View style={{ marginBottom: 20 }}>
            {canEdit && (
              <TouchableOpacity
                style={[styles.editChordsToggleBtn, { borderColor: themeColor + "50", marginBottom: 20 }]}
                onPress={handleOpenSlicer}
                activeOpacity={0.8}
              >
                <Text style={[styles.editChordsToggleBtnText, { color: themeColor, fontSize: 13 }]}>
                  📝 Organize Lyrics Sections
                </Text>
              </TouchableOpacity>
            )}

            <View style={[styles.lyricsContainer, { marginBottom: 0 }]}>
              <View style={styles.lyricsHeader}>
                <TouchableOpacity
                  style={[
                    styles.lyricsTab,
                    activeLyricsTab === "english" && [styles.activeLyricsTab, { borderBottomColor: themeColor }],
                  ]}
                  onPress={() => setActiveLyricsTab("english")}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.lyricsTabText,
                      activeLyricsTab === "english" ? { color: themeColor, fontWeight: "800" } : null,
                    ]}
                  >
                    English Lyrics
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.lyricsTab,
                    activeLyricsTab === "tamil" && [styles.activeLyricsTab, { borderBottomColor: themeColor }],
                  ]}
                  onPress={() => setActiveLyricsTab("tamil")}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.lyricsTabText,
                      activeLyricsTab === "tamil" ? { color: themeColor, fontWeight: "800" } : null,
                    ]}
                  >
                    Tamil Lyrics
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={styles.lyricsBody}>
                {activeLyricsTab === "english" ? (
                  song.lyricsEnglish ? (
                    <Text style={styles.lyricsText}>{song.lyricsEnglish}</Text>
                  ) : (
                    <Text style={styles.noLyricsText}>No English lyrics available for this song.</Text>
                  )
                ) : song.lyricsTamil ? (
                  <Text style={[styles.lyricsText, styles.tamilFont]}>{song.lyricsTamil}</Text>
                ) : (
                  <Text style={styles.noLyricsText}>No Tamil lyrics available for this song.</Text>
                )}
              </View>
            </View>
          </View>
        )}

        {/* Chords View Container */}
        {canEditChords && activeMainTab === "chords" && (
          <View style={styles.chordsContainer}>
            {isEditingChords ? (
              /* =========================================================
                 CHORD CHART EDITOR PANEL
                 ========================================================= */
              <View style={styles.editorPanel}>
                <View style={styles.editorHeaderRow}>
                  <Text style={styles.editorTitle}>Chord Chart Editor</Text>
                  <View style={styles.editorActions}>
                    <TouchableOpacity 
                      style={styles.btnOutlineRed} 
                      onPress={() => {
                        Alert.alert("Discard Changes", "Are you sure you want to discard your chord changes?", [
                          { text: "No", style: "cancel" },
                          { text: "Yes, Discard", onPress: () => setIsEditingChords(false), style: "destructive" }
                        ]);
                      }}
                    >
                      <Text style={{ color: "#EF4444", fontWeight: "700", fontSize: 13 }}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.btnSolid, { backgroundColor: themeColor, marginLeft: 10 }]} onPress={handleSaveChords}>
                      <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 13 }}>Save</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Editor Mode Selector */}
                <View style={styles.editorModeToggleContainer}>
                  <TouchableOpacity
                    style={[styles.editorModeTab, editorMode === "grid" && styles.editorModeTabActive]}
                    onPress={() => handleToggleEditorMode("grid")}
                  >
                    <Text style={[styles.editorModeTabText, editorMode === "grid" && styles.editorModeTabTextActive]}>Interactive Word-Tap Editor</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.editorModeTab, editorMode === "text" && styles.editorModeTabActive]}
                    onPress={() => handleToggleEditorMode("text")}
                  >
                    <Text style={[styles.editorModeTabText, editorMode === "text" && styles.editorModeTabTextActive]}>Bracket Text Editor (Easy)</Text>
                  </TouchableOpacity>
                </View>

                {/* Global Base Key Picker */}
                <View style={styles.baseKeyPickerContainer}>
                  <Text style={styles.baseKeyPickerLabel}>Chart Base Key:</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.baseKeyScroll}>
                    {['C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'].map((k) => {
                      const isSelected = chartBaseKey === k;
                      return (
                        <TouchableOpacity
                          key={k}
                          style={[
                            styles.baseKeySelectButton,
                            isSelected && [styles.baseKeySelectButtonActive, { backgroundColor: themeColor }]
                          ]}
                          onPress={() => setChartBaseKey(k)}
                        >
                          <Text style={[styles.baseKeySelectText, isSelected && styles.baseKeySelectTextActive]}>
                            {k}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>

                {editorMode === "text" ? (
                  /* BRACKET TEXT EDITOR VIEW */
                  <View style={styles.bracketTextInputContainer}>
                    <Text style={styles.bracketEditorInstructions}>
                      Type or paste lyrics. Wrap chords in brackets e.g. [G]Amazing [Em]grace.
                    </Text>
                    <TextInput
                      style={styles.bracketTextInput}
                      value={bracketText}
                      onChangeText={setBracketText}
                      multiline
                      placeholder={`[Verse 1]\n[G]Amazing [Em]grace, how [C]sweet the [G]sound\n\n[Chorus]\n[C]My chains are [G]gone`}
                      placeholderTextColor="#475569"
                      autoCapitalize="none"
                      autoCorrect={false}
                      onFocus={() => {
                        setIsTextFocused(true);
                        setActiveInputRef({ secIdx: null, lineIdx: null, field: null });
                      }}
                      onBlur={() => setIsTextFocused(false)}
                      onSelectionChange={(e) => {
                        setCursorSelection(e.nativeEvent.selection);
                      }}
                    />
                  </View>
                ) : (
                  /* INTERACTIVE WORD-TAP EDITOR VIEW */
                  <View>
                    {editSections.map((section, secIdx) => (
                      <View key={secIdx} style={styles.sectionEditCard}>
                        <View style={{ marginBottom: 12, borderBottomWidth: 1, borderColor: "#334155", paddingBottom: 8 }}>
                          <Text style={[styles.chordSectionTitle, { color: themeColor }]}>
                            {section.sectionLabel}
                          </Text>
                        </View>

                        {/* Interactive Word-Tap Lines list */}
                        <View style={styles.linesListContainer}>
                          {section.lines.map((line, lineIdx) => {
                            const isLyricsEmpty = !line.lyrics || line.lyrics.trim() === "";
                            const tokens = tokenizeLyricsLine(line.lyrics || "");
                            
                            return (
                              <View key={lineIdx} style={styles.lineEditCard}>
                                <View style={styles.lineEditIndexRow}>
                                  <Text style={styles.lineIndexText}>Line {lineIdx + 1}</Text>
                                  <View style={styles.lineActionButtons}>
                                    <TouchableOpacity
                                      style={styles.lineBtnSmall}
                                      onPress={() => handleAddLine(secIdx, lineIdx)}
                                    >
                                      <Text style={styles.lineBtnTextSmall}>+ Insert Line</Text>
                                    </TouchableOpacity>
                                    {section.lines.length > 1 && (
                                      <TouchableOpacity
                                        style={[styles.lineBtnSmall, styles.removeLineBtn]}
                                        onPress={() => handleRemoveLine(secIdx, lineIdx)}
                                      >
                                        <Text style={styles.lineBtnTextSmall}>✕ Remove</Text>
                                      </TouchableOpacity>
                                    )}
                                  </View>
                                </View>

                                {/* 🎤 Interactive Clickable Lyrics Words Row */}
                                <Text style={styles.interactiveTapLabel}>Tap a word to assign chords:</Text>
                                <View style={styles.interactiveWordsRow}>
                                  {isLyricsEmpty ? (
                                    /* Empty lyrics layout (e.g. for Intro/Outro progression slots) */
                                    [0, 1, 2, 3, 4, 5, 6, 7].map((slotIdx) => {
                                      const charIndex = slotIdx * 6;
                                      const assignedChord = line.chordsMap ? line.chordsMap[charIndex] : null;
                                      const isActive = activeTapCell.secIdx === secIdx && 
                                                      activeTapCell.lineIdx === lineIdx && 
                                                      activeTapCell.charIndex === charIndex;
                                                      
                                      return (
                                        <View key={slotIdx} style={styles.slotBlock}>
                                          {assignedChord && (
                                            <TouchableOpacity 
                                              style={[styles.miniChordBadge, { backgroundColor: themeColor }]}
                                              onPress={() => handleRemoveChordFromTapCell(secIdx, lineIdx, charIndex)}
                                            >
                                              <Text style={styles.miniChordBadgeText}>{assignedChord} ✕</Text>
                                            </TouchableOpacity>
                                          )}
                                          <TouchableOpacity
                                            style={[
                                              styles.emptySlotBtn,
                                              isActive && { borderColor: themeColor, backgroundColor: themeColor + "15" }
                                            ]}
                                            onPress={() => setActiveTapCell({ secIdx, lineIdx, charIndex, word: `Beat ${slotIdx + 1}` })}
                                          >
                                            <Text style={[styles.emptySlotText, isActive && { color: themeColor }]}>
                                              {isActive ? "Pick Ch" : `Slot ${slotIdx + 1}`}
                                            </Text>
                                          </TouchableOpacity>
                                        </View>
                                      );
                                    })
                                  ) : (
                                    /* Words tap layout */
                                    tokens.map((token, tokIdx) => {
                                      if (!token.isWord) {
                                        return <View key={tokIdx} style={{ width: 8 }} />;
                                      }
                                      
                                      const assignedChord = line.chordsMap ? line.chordsMap[token.index] : null;
                                      const isActive = activeTapCell.secIdx === secIdx && 
                                                      activeTapCell.lineIdx === lineIdx && 
                                                      activeTapCell.charIndex === token.index;
                                                      
                                      return (
                                        <View key={tokIdx} style={styles.wordBlock}>
                                          {assignedChord && (
                                            <TouchableOpacity 
                                              style={[styles.miniChordBadge, { backgroundColor: themeColor }]}
                                              onPress={() => handleRemoveChordFromTapCell(secIdx, lineIdx, token.index)}
                                            >
                                              <Text style={styles.miniChordBadgeText}>{assignedChord} ✕</Text>
                                            </TouchableOpacity>
                                          )}
                                          <TouchableOpacity
                                            style={[
                                              styles.wordBtn,
                                              isActive && { borderColor: themeColor, backgroundColor: themeColor + "15" }
                                            ]}
                                            onPress={() => setActiveTapCell({ secIdx, lineIdx, charIndex: token.index, word: token.text })}
                                          >
                                            <Text style={[styles.wordBtnText, isActive && { color: themeColor, fontWeight: "800" }]}>
                                              {token.text}
                                            </Text>
                                          </TouchableOpacity>
                                        </View>
                                      );
                                    })
                                  )}
                                </View>

                                {/* Standard lyrics input text area to update the line lyrics */}
                                <TextInput
                                  style={[styles.lyricInput, { marginTop: 12 }]}
                                  value={line.lyrics}
                                  onChangeText={(val) => handleUpdateLineField(secIdx, lineIdx, "lyrics", val)}
                                  placeholder="Type or edit lyric line here..."
                                  placeholderTextColor="#475569"
                                />
                              </View>
                            );
                          })}
                        </View>

                        {/* Add Line bottom button */}
                        <TouchableOpacity
                          style={[styles.addBtnOutline, { borderColor: themeColor + "40" }]}
                          onPress={() => handleAddLine(secIdx, section.lines.length - 1)}
                        >
                          <Text style={[styles.addBtnOutlineText, { color: themeColor }]}>+ Add Line</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}

                <View style={styles.divider} />

                {/* Floating Chord Helper Keyboard Accessory */}
                <View style={styles.helperKeyboardContainer}>
                  <View style={styles.helperHeaderRow}>
                    <Text style={styles.helperTitle}>Quick Chord Keyboard</Text>
                    {selectedRoot && (
                      <View style={styles.builderPreviewContainer}>
                        <Text style={styles.builderPreviewLabel}>Pending: </Text>
                        <View style={styles.builderPreviewBadge}>
                          <Text style={styles.builderPreviewText}>{selectedRoot}</Text>
                        </View>
                        <TouchableOpacity style={[styles.builderInsertBtn, { backgroundColor: themeColor }]} onPress={handleInsertRootDirectly}>
                          <Text style={styles.builderInsertBtnText}>Use {selectedRoot}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.builderCancelBtn} onPress={() => setSelectedRoot(null)}>
                          <Text style={styles.builderCancelBtnText}>✕</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                  
                  {/* Presets Row */}
                  <View style={styles.helperRowWrapper}>
                    <Text style={styles.scrollSectionLabel}>Presets:</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.helperScrollContent}>
                      {['C', 'G', 'Am', 'F', 'D', 'Em', 'A', 'E', 'Dm', 'Bm', 'C#m', 'F#m'].map((ch) => (
                        <TouchableOpacity key={ch} style={styles.presetChordBtn} onPress={() => handleInsertChord(ch)}>
                          <Text style={styles.presetChordText}>{ch}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                  
                  {/* Builder Roots Row */}
                  <View style={styles.helperRowWrapper}>
                    <Text style={styles.scrollSectionLabel}>Roots:</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.helperScrollContent}>
                      {['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'].map((r) => (
                        <TouchableOpacity
                          key={r}
                          style={[styles.rootChordBtn, selectedRoot === r && { backgroundColor: themeColor + "30", borderColor: themeColor }]}
                          onPress={() => handleTapRoot(r)}
                        >
                          <Text style={[styles.rootChordText, selectedRoot === r && { color: themeColor }]}>{r}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>

                  {/* Builder Modifiers Row */}
                  <View style={styles.helperRowWrapper}>
                    <Text style={styles.scrollSectionLabel}>Modifiers:</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.helperScrollContent}>
                      {['maj', 'm', '7', 'sus4', 'add9', '/'].map((mod) => (
                        <TouchableOpacity key={mod} style={styles.modifierChordBtn} onPress={() => handleModifierPress(mod)}>
                          <Text style={styles.modifierChordText}>{mod}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                </View>

                <View style={styles.divider} />

                <View style={styles.editorFooterActions}>
                  <TouchableOpacity 
                    style={[styles.btnOutlineRed, { flex: 1, marginRight: 8 }]} 
                    onPress={() => {
                      Alert.alert("Discard Changes", "Are you sure you want to discard your chord changes?", [
                        { text: "No", style: "cancel" },
                        { text: "Yes, Discard", onPress: () => setIsEditingChords(false), style: "destructive" }
                      ]);
                    }}
                  >
                    <Text style={{ color: "#EF4444", fontWeight: "700", textAlign: "center" }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.btnSolid, { backgroundColor: themeColor, flex: 1, marginLeft: 8 }]} onPress={handleSaveChords}>
                    <Text style={{ color: "#FFFFFF", fontWeight: "700", textAlign: "center" }}>Save Chord Chart</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              /* =========================================================
                 CHORD CHART DISPLAY VIEW (READ-ONLY)
                 ========================================================= */
              <View style={styles.displayPanel}>
                
                {/* Transposition & Capo controls box */}
                <View style={styles.transpositionBox}>
                  <View style={styles.transposeControlRow}>
                    <Text style={styles.transposeControlLabel}>Transpose Key:</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.keySelectorScroll}>
                      {['C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'].map((k) => {
                        const isSelected = displayKey === k;
                        return (
                          <TouchableOpacity
                            key={k}
                            style={[
                              styles.keySelectButton,
                              isSelected && [styles.keySelectButtonActive, { backgroundColor: themeColor }]
                            ]}
                            onPress={() => handleKeyChange(k)}
                          >
                            <Text style={[styles.keySelectText, isSelected && styles.keySelectTextActive]}>
                              {k}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                    {displayKey !== (song.originalKey || "C") && (
                      <TouchableOpacity
                        style={[styles.resetKeyButton, { borderColor: themeColor }]}
                        onPress={() => handleKeyChange(song.originalKey || "C")}
                      >
                        <Text style={[styles.resetKeyButtonText, { color: themeColor }]}>Reset</Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  <View style={styles.dividerSmall} />

                  <View style={styles.capoStepperRow}>
                    <View>
                      <Text style={styles.capoTitle}>Capo Position</Text>
                      <Text style={styles.capoSub}>
                        {capo === 0 ? "No capo" : `Capo on fret ${capo}`}
                      </Text>
                    </View>
                    <View style={styles.stepperContainer}>
                      <TouchableOpacity
                        style={styles.stepperBtn}
                        onPress={() => handleCapoChange(Math.max(0, capo - 1))}
                      >
                        <Text style={styles.stepperBtnText}>−</Text>
                      </TouchableOpacity>
                      <View style={styles.stepperValueContainer}>
                        <Text style={styles.stepperValue}>{capo}</Text>
                      </View>
                      <TouchableOpacity
                        style={styles.stepperBtn}
                        onPress={() => handleCapoChange(Math.min(11, capo + 1))}
                      >
                        <Text style={styles.stepperBtnText}>+</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View style={styles.dividerSmall} />

                  <View style={styles.notationSelectorRow}>
                    <Text style={styles.notationControlLabel}>Notation:</Text>
                    <View style={styles.notationButtonsContainer}>
                      {[
                        { mode: "normal", label: "Normal" },
                        { mode: "sharp", label: "♯ Sharp" },
                        { mode: "flat", label: "♭ Flat" },
                        { mode: "number", label: "Numbers" }
                      ].map((item) => {
                        const isActive = notationMode === item.mode;
                        return (
                          <TouchableOpacity
                            key={item.mode}
                            style={[
                              styles.notationButton,
                              isActive && [styles.notationButtonActive, { backgroundColor: themeColor }]
                            ]}
                            onPress={() => handleNotationModeChange(item.mode)}
                            activeOpacity={0.7}
                          >
                            <Text style={[styles.notationButtonText, isActive && styles.notationButtonTextActive]}>
                              {item.label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                </View>

                {/* 🎸 Personal Musician Performance Notes card */}
                {["worship_leader", "super_admin", "musician"].includes(user?.role) && (
                  <View style={styles.musicianNotesCard}>
                    <View style={styles.musicianNotesHeader}>
                      <Text style={styles.musicianNotesTitle}>🎸 My Musician Notes (Private Cues)</Text>
                      {!isNotesEditing ? (
                        <TouchableOpacity
                          style={[styles.notesEditBtn, { borderColor: themeColor }]}
                          onPress={() => {
                            setTempNotes(musicianNotes);
                            setIsNotesEditing(true);
                          }}
                        >
                          <Text style={[styles.notesEditBtnText, { color: themeColor }]}>Edit</Text>
                        </TouchableOpacity>
                      ) : (
                        <View style={styles.notesEditingActions}>
                          <TouchableOpacity
                            style={styles.notesCancelBtn}
                            onPress={() => setIsNotesEditing(false)}
                          >
                            <Text style={styles.notesCancelBtnText}>Cancel</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.notesSaveBtn, { backgroundColor: themeColor }]}
                            onPress={handleSaveMusicianNotes}
                          >
                            <Text style={styles.notesSaveBtnText}>Save</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>

                    {isNotesEditing ? (
                      <TextInput
                        style={styles.musicianNotesInput}
                        value={tempNotes}
                        onChangeText={setTempNotes}
                        multiline
                        placeholder="Write private cues, intro chords (e.g. G - Em - C - D), guitar patch name, gear details..."
                        placeholderTextColor="#475569"
                        autoCapitalize="none"
                      />
                    ) : (
                      <Text style={musicianNotes.trim() ? styles.musicianNotesText : styles.musicianNotesPlaceholder}>
                        {musicianNotes.trim() ? musicianNotes : "No private cues recorded yet. Tap Edit to write intro notes, cues, or reminders."}
                      </Text>
                    )}
                  </View>
                )}

                {/* 🛠️ Leader Perform-Action Control Row */}
                {canEditChords && (
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 16 }}>
                    <TouchableOpacity
                      style={[styles.editChordsToggleBtn, { flex: 1, marginRight: 6, marginBottom: 0, borderColor: themeColor + "50" }]}
                      onPress={startEditingChords}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.editChordsToggleBtnText, { color: themeColor, fontSize: 12 }]}>
                        ✏️ Edit Chart
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.editChordsToggleBtn, { flex: 1.2, marginRight: 6, marginBottom: 0, borderColor: themeColor + "50" }]}
                      onPress={() => {
                        setIntroChords([]);
                        setIntroCreatorVisible(true);
                      }}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.editChordsToggleBtnText, { color: themeColor, fontSize: 12 }]}>
                        🎹 Add Intro Chords
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.editChordsToggleBtn, { flex: 1.2, marginBottom: 0, borderColor: themeColor + "50" }]}
                      onPress={handleOpenSlicer}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.editChordsToggleBtnText, { color: themeColor, fontSize: 12 }]}>
                        📝 Organize Sections
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}

                {/* Chord sheet display content */}
                {(() => {
                  const displaySections = getDisplaySections();
                  const hasDisplaySections = displaySections && displaySections.length > 0;
                  
                  return hasDisplaySections ? (
                    <View style={styles.chordSheetPaper}>
                      {displaySections.map((section, sIdx) => {
                        const semitones = getSemitoneShift();
                        const preferSharps = notationMode === "sharp" 
                          ? true 
                          : (notationMode === "flat" ? false : !preferFlatsForKey(displayKey));

                        return (
                          <View key={sIdx} style={styles.chordSectionContainer}>
                            <Text style={[styles.chordSectionTitle, { color: themeColor }]}>{section.sectionLabel}</Text>
                            <View style={styles.chordSectionLines}>
                              {section.lines && section.lines.map((line, lIdx) => {
                                const chordsMap = parseMonospaceChordsToMap(line.chords || "");
                                const hasChords = !!(line.chords && line.chords.trim() !== "");
                                const hasLyrics = !!(line.lyrics && line.lyrics.trim() !== "");

                                if (!hasLyrics && hasChords) {
                                  // Render as progression badges row for Intro/Outro progression slots
                                  const chordsArray = Object.keys(chordsMap)
                                    .map(idx => parseInt(idx, 10))
                                    .sort((a, b) => a - b);

                                  return (
                                    <View key={lIdx} style={styles.chordProgressionRow}>
                                      {chordsArray.map((charIdx) => {
                                        const rawCh = chordsMap[charIdx];
                                        const forceSpelling = notationMode === "sharp" || notationMode === "flat";
                                        const displayCh = transposeChord(rawCh, semitones, preferSharps, forceSpelling);
                                        const finalCh = notationMode === "number" ? formatAsNumberSystem(displayCh, displayKey) : displayCh;
                                        const isHighlighted = song.lastEditedChordKeys && 
                                                              song.lastEditedChordKeys.includes(`${sIdx}_${lIdx}_${charIdx}`);
                                        return (
                                          <TouchableOpacity
                                            key={charIdx}
                                            style={[
                                              styles.progressionChordBadge,
                                              isHighlighted && {
                                                borderColor: "#FBBF24",
                                                borderWidth: 1.5,
                                                backgroundColor: "rgba(245, 158, 11, 0.15)"
                                              }
                                            ]}
                                            disabled={!canEditChords}
                                            onPress={() => {
                                              setActiveTapCell({
                                                secIdx: sIdx,
                                                lineIdx: lIdx,
                                                charIndex: charIdx,
                                                word: `Beat Chord`
                                              });
                                            }}
                                          >
                                            <Text style={[
                                              styles.progressionChordText,
                                              { color: isHighlighted ? "#FBBF24" : themeColor },
                                              isHighlighted && {
                                                fontWeight: "900",
                                                textShadowColor: "#FBBF24",
                                                textShadowOffset: { width: 0, height: 0 },
                                                textShadowRadius: 6
                                              }
                                            ]}>
                                              {finalCh}
                                            </Text>
                                          </TouchableOpacity>
                                        );
                                      })}
                                      {canEditChords && (
                                        <TouchableOpacity
                                          style={styles.addProgressionChordBtn}
                                          onPress={() => {
                                            setActiveTapCell({
                                              secIdx: sIdx,
                                              lineIdx: lIdx,
                                              charIndex: chordsArray.length * 6,
                                              word: `New Beat Slot`
                                            });
                                          }}
                                        >
                                          <Text style={{ color: themeColor, fontSize: 11, fontWeight: "700" }}>+ Add Chord</Text>
                                        </TouchableOpacity>
                                      )}
                                    </View>
                                  );
                                }

                                if (hasLyrics) {
                                  // Interactive wrapping word-blocks layout
                                  const tokens = tokenizeLyricsLine(line.lyrics || "");
                                  return (
                                    <View key={lIdx} style={styles.interactiveLyricsRow}>
                                      {tokens.map((token, tokIdx) => {
                                        if (!token.isWord) {
                                          return <Text key={tokIdx} style={styles.lyricsSpace}> </Text>;
                                        }

                                        const rawChord = chordsMap[token.index];
                                        const forceSpelling = notationMode === "sharp" || notationMode === "flat";
                                        const displayChord = rawChord ? transposeChord(rawChord, semitones, preferSharps, forceSpelling) : null;
                                        const finalChord = displayChord ? (notationMode === "number" ? formatAsNumberSystem(displayChord, displayKey) : displayChord) : null;
                                        const isHighlighted = displayChord && song.lastEditedChordKeys && 
                                                              song.lastEditedChordKeys.includes(`${sIdx}_${lIdx}_${token.index}`);
                                        const isActive = activeTapCell.secIdx === sIdx && 
                                                        activeTapCell.lineIdx === lIdx && 
                                                        activeTapCell.charIndex === token.index;

                                        return (
                                          <View key={tokIdx} style={styles.interactiveWordBlock}>
                                            {/* Chord Above Word */}
                                            <View style={styles.interactiveChordSlot}>
                                              {finalChord ? (
                                                <Text style={[
                                                  styles.interactiveChordText,
                                                  { color: isHighlighted ? "#FBBF24" : themeColor },
                                                  isHighlighted && {
                                                    fontWeight: "900",
                                                    textShadowColor: "#FBBF24",
                                                    textShadowOffset: { width: 0, height: 0 },
                                                    textShadowRadius: 6
                                                  }
                                                ]}>
                                                  {finalChord}
                                                </Text>
                                              ) : null}
                                            </View>

                                            {/* Word Button */}
                                            {canEditChords ? (
                                              <TouchableOpacity
                                                style={[
                                                  styles.interactiveWordTextBtn,
                                                  isActive && { backgroundColor: themeColor + "15", borderRadius: 4 }
                                                ]}
                                                onPress={() => {
                                                  setActiveTapCell({
                                                    secIdx: sIdx,
                                                    lineIdx: lIdx,
                                                    charIndex: token.index,
                                                    word: token.text
                                                  });
                                                }}
                                                activeOpacity={0.7}
                                              >
                                                <Text style={styles.interactiveWordTextClickable}>{token.text}</Text>
                                              </TouchableOpacity>
                                            ) : (
                                              <Text style={styles.interactiveWordText}>{token.text}</Text>
                                            )}
                                          </View>
                                        );
                                      })}
                                    </View>
                                  );
                                }
 
                                return <View key={lIdx} style={{ height: 10 }} />;
                              })}
                            </View>
                          </View>
                        );
                      })}
 
                      {/* Audit badge footer */}
                      {!!song.lastChordEditBy && (
                        <View style={styles.chordAuditFooter}>
                          <Text style={styles.chordAuditText}>
                            Last edited by <Text style={styles.chordAuditHighlight}>{song.lastChordEditBy}</Text> on {formatDate(song.lastChordEditAt)}
                          </Text>
                        </View>
                      )}
                    </View>
                  ) : (
                    <View style={styles.noChordsCard}>
                      <Text style={styles.noChordsText}>No lyrics or chord chart available for this song yet.</Text>
                      {canEditChords && (
                        <TouchableOpacity
                          style={[styles.btnSolid, { backgroundColor: themeColor, marginTop: 14 }]}
                          onPress={startEditingChords}
                        >
                          <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 13 }}>Create Chord Chart</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })()}
              </View>
            )}
          </View>
        )}

        {/* 🎙️ Recordings View Container */}
        {activeMainTab === "recordings" && (
          <View style={styles.recordingsContainer}>
            <View style={styles.recordingsHeaderRow}>
              <Text style={styles.recordingsTitle}>🎙️ Song Audio Snippets</Text>
              {["worship_leader", "super_admin"].includes(user?.role) && (
                <TouchableOpacity
                  style={[styles.recordNewBtn, { backgroundColor: themeColor }]}
                  onPress={() => {
                    setRecordingName("");
                    setRecordingTarget("choir");
                    setRecordPreviewUri(null);
                    setRecordModalVisible(true);
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={styles.recordNewBtnText}>+ Record Snippet</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* List of Recordings */}
            {(() => {
              const isMusicianOrLeader = ["worship_leader", "super_admin", "musician"].includes(user?.role);
              const visibleRecordings = recordingsList.filter(r => isMusicianOrLeader || r.target === "choir");

              if (visibleRecordings.length === 0) {
                return (
                  <View style={styles.noRecordingsCard}>
                    <Text style={styles.noRecordingsText}>No audio snippets recorded for this song yet.</Text>
                    {["worship_leader", "super_admin"].includes(user?.role) && (
                      <Text style={styles.noRecordingsSub}>Tap "+ Record Snippet" above to record an intro guide or vocal harmony.</Text>
                    )}
                  </View>
                );
              }

              return visibleRecordings.map((rec) => {
                const isPlaying = activePlayingId === rec.id;
                const progressPercent = isPlaying && playbackDuration > 0
                  ? (playbackPosition / playbackDuration) * 100
                  : 0;

                const formatTime = (ms) => {
                  if (!ms) return "0:00";
                  const secs = Math.floor(ms / 1000);
                  const m = Math.floor(secs / 60);
                  const s = secs % 60;
                  return `${m}:${s < 10 ? "0" : ""}${s}`;
                };

                return (
                  <View key={rec.id} style={styles.recordingCard}>
                    <View style={styles.recordingCardInfo}>
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                        <Text style={styles.recordingCardTitle}>{rec.title}</Text>
                        <View style={[
                          styles.targetTag,
                          { backgroundColor: rec.target === "choir" ? "rgba(16, 185, 129, 0.15)" : "rgba(245, 158, 11, 0.15)" }
                        ]}>
                          <Text style={[
                            styles.targetTagText,
                            { color: rec.target === "choir" ? "#10B981" : "#F59E0B" }
                          ]}>
                            {rec.target === "choir" ? "Choir + Musicians" : "Musicians Only"}
                          </Text>
                        </View>
                      </View>
                      
                      <Text style={styles.recordingCardMeta}>
                        Recorded by {rec.recordedBy} • {formatDate(rec.recordedAt)}
                      </Text>

                      {/* Playback Progress Bar */}
                      {isPlaying && (
                        <View style={styles.progressContainer}>
                          <View style={styles.progressBarBg}>
                            <View style={[styles.progressBarFill, { width: `${progressPercent}%`, backgroundColor: themeColor }]} />
                          </View>
                          <View style={styles.progressTimeRow}>
                            <Text style={styles.progressTime}>{formatTime(playbackPosition)}</Text>
                            <Text style={styles.progressTime}>{formatTime(playbackDuration)}</Text>
                          </View>
                        </View>
                      )}
                    </View>

                    <View style={styles.recordingCardActions}>
                      <TouchableOpacity
                        style={[styles.recordingPlayBtn, { borderColor: themeColor }]}
                        onPress={() => handlePlayRecording(rec)}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.recordingPlayBtnText, { color: themeColor }]}>
                          {isPlaying ? "⏹ Stop" : "▶ Play"} ({rec.duration ? `${Math.floor(rec.duration / 60)}:${rec.duration % 60 < 10 ? "0" : ""}${rec.duration % 60}` : "0:00"})
                        </Text>
                      </TouchableOpacity>

                      {(["worship_leader", "super_admin"].includes(user?.role) || rec.recordedByUid === user?.uid) && (
                        <TouchableOpacity
                          style={styles.recordingDeleteBtn}
                          onPress={() => handleDeleteRecording(rec.id)}
                          activeOpacity={0.7}
                        >
                          <Text style={styles.recordingDeleteBtnText}>🗑 Delete</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                );
              });
            })()}

            {/* 🎙️ Recording Control Panel Modal */}
            <Modal
              visible={recordModalVisible}
              animationType="slide"
              transparent={true}
              onRequestClose={() => {
                if (isRecording) {
                  stopRecording().catch(() => {});
                }
                setRecordModalVisible(false);
              }}
            >
              <View style={styles.recordingModalOverlay}>
                <View style={styles.recordingModalContainer}>
                  <Text style={styles.recordingModalTitle}>🎙️ Record Audio Snippet</Text>
                  
                  {/* Name input */}
                  <Text style={styles.recordingInputLabel}>Snippet Name / Description <Text style={{ color: "#EF4444" }}>*</Text></Text>
                  <TextInput
                    style={styles.recordingNameInput}
                    value={recordingName}
                    onChangeText={setRecordingName}
                    placeholder="e.g., Intro Guide, Verse Vocal, Harmony"
                    placeholderTextColor="#475569"
                    autoCapitalize="words"
                  />

                  {/* Target Audience */}
                  <Text style={styles.recordingInputLabel}>Target Audience</Text>
                  <View style={styles.targetAudienceSelector}>
                    <TouchableOpacity
                      style={[
                        styles.targetAudienceBtn,
                        recordingTarget === "choir" && { backgroundColor: themeColor + "20", borderColor: themeColor }
                      ]}
                      onPress={() => setRecordingTarget("choir")}
                      activeOpacity={0.7}
                    >
                      <Text style={[
                        styles.targetAudienceBtnText,
                        recordingTarget === "choir" && { color: themeColor, fontWeight: "800" }
                      ]}>
                        👥 Choir & Musicians
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.targetAudienceBtn,
                        recordingTarget === "musicians" && { backgroundColor: themeColor + "20", borderColor: themeColor }
                      ]}
                      onPress={() => setRecordingTarget("musicians")}
                      activeOpacity={0.7}
                    >
                      <Text style={[
                        styles.targetAudienceBtnText,
                        recordingTarget === "musicians" && { color: themeColor, fontWeight: "800" }
                      ]}>
                        🎸 Musicians Only
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.recordingStatusBox}>
                    {isRecording ? (
                      <View style={{ alignItems: "center" }}>
                        <View style={styles.recordingIndicatorPulse} />
                        <Text style={styles.recordingStatusText}>Recording in progress...</Text>
                        <Text style={styles.recordingTimerText}>
                          {Math.floor(recordDuration / 60)}:{(recordDuration % 60) < 10 ? "0" : ""}{recordDuration % 60}
                        </Text>
                      </View>
                    ) : recordPreviewUri ? (
                      <View style={{ alignItems: "center", width: "100%" }}>
                        <Text style={styles.recordingStatusTextSuccess}>✓ Snippet recorded successfully!</Text>
                        <Text style={styles.recordingDurationLabel}>
                          Duration: {Math.floor(recordDuration / 60)}:{(recordDuration % 60) < 10 ? "0" : ""}{recordDuration % 60}
                        </Text>
                        
                        {/* Preview Audio Controls */}
                        <TouchableOpacity
                          style={[styles.previewPlayBtn, { borderColor: themeColor }]}
                          onPress={isPreviewPlaying ? stopPreview : startPreview}
                          activeOpacity={0.7}
                        >
                          <Text style={[styles.previewPlayBtnText, { color: themeColor }]}>
                            {isPreviewPlaying ? "⏹ Stop Preview" : "▶ Listen to Preview"}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <Text style={styles.recordingStatusPlaceholder}>Ready to record microphone audio snippet.</Text>
                    )}
                  </View>

                  {/* Actions Row */}
                  <View style={styles.modalActionsRow}>
                    {/* Discard / Close */}
                    <TouchableOpacity
                      style={styles.modalCancelBtn}
                      onPress={async () => {
                        if (isRecording) {
                          await stopRecording();
                        }
                        if (previewSound) {
                          await previewSound.unloadAsync();
                        }
                        setRecordModalVisible(false);
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.modalCancelBtnText}>Cancel</Text>
                    </TouchableOpacity>

                    {/* Middle control: Record/Stop/Re-record */}
                    {isRecording ? (
                      <TouchableOpacity
                        style={styles.modalStopBtn}
                        onPress={stopRecording}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.modalStopBtnText}>⏹ Stop</Text>
                      </TouchableOpacity>
                    ) : recordPreviewUri ? (
                      <TouchableOpacity
                        style={styles.modalReRecordBtn}
                        onPress={() => {
                          setRecordPreviewUri(null);
                          startRecording();
                        }}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.modalReRecordBtnText}>🔄 Re-record</Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity
                        style={[styles.modalRecordBtn, { backgroundColor: "#EF4444" }]}
                        onPress={startRecording}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.modalRecordBtnText}>🎙️ Start</Text>
                      </TouchableOpacity>
                    )}

                    {/* Save Button */}
                    <TouchableOpacity
                      style={[
                        styles.modalSaveBtn,
                        { backgroundColor: recordingName.trim() && recordPreviewUri ? "#10B981" : "#1E293B" }
                      ]}
                      disabled={!recordingName.trim() || !recordPreviewUri}
                      onPress={handleSaveRecordingWrapper}
                      activeOpacity={0.7}
                    >
                      <Text style={[
                        styles.modalSaveBtnText,
                        { color: recordingName.trim() && recordPreviewUri ? "#FFFFFF" : "#64748B" }
                      ]}>
                        Save
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </Modal>
          </View>
        )}

        {/* Ministry Song Notes */}
        {song.notes ? (
          <View style={styles.notesCard}>
            <Text style={styles.notesTitle}>Ministry Notes</Text>
            <Text style={styles.notesText}>{song.notes}</Text>
          </View>
        ) : null}

        {/* Song Audit Metadata Footer */}
        <View style={styles.footerAudit}>
          {!!song.addedByName && (
            <Text style={styles.auditText}>
              Added by: <Text style={styles.auditHighlight}>{song.addedByName}</Text>
            </Text>
          )}
          {song.lastEditedByName ? (
            <>
              <Text style={styles.auditText}>
                Last edited by: <Text style={styles.auditHighlight}>{song.lastEditedByName}</Text> on {formatDate(song.lastEditedAt)}
              </Text>
              {song.lastEditedFields ? (
                <Text style={styles.auditFieldsText}>
                  Modified fields: <Text style={styles.auditFieldsHighlight}>{song.lastEditedFields}</Text>
                </Text>
              ) : null}
            </>
          ) : (
            !!song.createdAt && (
              <Text style={styles.auditText}>
                Created on: <Text style={styles.auditHighlight}>{formatDate(song.createdAt)}</Text>
              </Text>
            )
          )}
        </View>

        {/* Super Admin Delete Button */}
        {user?.role === "super_admin" && (
          <TouchableOpacity
            style={styles.deleteSongFullBtn}
            onPress={handleDeleteSong}
            activeOpacity={0.8}
          >
            <Text style={styles.deleteSongFullBtnText}>🗑️ Delete Song Profile</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* 🔮 Premium Tap-to-Assign Word Chord Popover Dropdown Modal */}
      <Modal
        visible={activeTapCell.charIndex !== null}
        transparent={true}
        animationType="fade"
        onRequestClose={() => {
          setActiveTapCell({ secIdx: null, lineIdx: null, charIndex: null, word: "" });
          setPendingChord(null);
        }}
      >
        <View style={styles.popoverOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFillObject}
            activeOpacity={1}
            onPress={() => {
              setActiveTapCell({ secIdx: null, lineIdx: null, charIndex: null, word: "" });
              setPendingChord(null);
            }}
          />
          <View style={styles.popoverContent}>
            {/* Header */}
            <View style={styles.popoverHeader}>
              <Text style={styles.popoverTitle}>Select Chord for "{activeTapCell.word}"</Text>
              <TouchableOpacity
                style={styles.popoverCloseBtn}
                onPress={() => {
                  setActiveTapCell({ secIdx: null, lineIdx: null, charIndex: null, word: "" });
                  setPendingChord(null);
                }}
              >
                <Text style={styles.popoverCloseBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            {pendingChord !== null ? (
              /* Sub-View: Select Bar Count Duration */
              <View style={{ paddingVertical: 10 }}>
                <Text style={styles.popoverSectionLabel}>
                  How many bars for "{pendingChord}"?
                </Text>
                
                <View style={styles.popoverPresetsGrid}>
                  {['1', '2', '3', '4', '8'].map((barOpt) => (
                    <TouchableOpacity
                      key={barOpt}
                      style={[styles.popoverPresetBtn, { backgroundColor: themeColor, minWidth: 65, height: 38 }]}
                      onPress={() => {
                        const finalChord = `${pendingChord} (${barOpt})`;
                        handleAssignChordToTapCell(finalChord);
                        setPendingChord(null);
                      }}
                    >
                      <Text style={styles.popoverPresetText}>{barOpt} {barOpt === '1' ? 'Bar' : 'Bars'}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                
                <TouchableOpacity
                  style={[styles.popoverUseRootBtn, { backgroundColor: "rgba(255,255,255,0.06)", height: 40, justifyContent: "center", marginTop: 10 }]}
                  onPress={() => {
                    handleAssignChordToTapCell(pendingChord);
                    setPendingChord(null);
                  }}
                >
                  <Text style={[styles.popoverUseRootBtnText, { color: "#E2E8F0" }]}>Skip (Use plain chord "{pendingChord}")</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                {/* Quick Major Presets Grid */}
                <Text style={styles.popoverSectionLabel}>Major Chords Presets:</Text>
                <View style={styles.popoverPresetsGrid}>
                  {['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'].map((ch) => (
                    <TouchableOpacity
                      key={ch}
                      style={[styles.popoverPresetBtn, { backgroundColor: themeColor }]}
                      onPress={() => handleAssignChordToTapCell(ch)}
                    >
                      <Text style={styles.popoverPresetText}>{ch}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Quick Minor Presets Grid */}
                <Text style={styles.popoverSectionLabel}>Minor Chords Presets:</Text>
                <View style={styles.popoverPresetsGrid}>
                  {['Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'Abm', 'Am', 'Bbm', 'Bm'].map((ch) => (
                    <TouchableOpacity
                      key={ch}
                      style={[styles.popoverPresetBtn, { backgroundColor: themeColor }]}
                      onPress={() => handleAssignChordToTapCell(ch)}
                    >
                      <Text style={styles.popoverPresetText}>{ch}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Custom Chord Builder */}
                <Text style={styles.popoverSectionLabel}>Custom Chord Builder:</Text>
                
                {/* Roots scroll */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
                  {['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'].map((r) => (
                    <TouchableOpacity
                      key={r}
                      style={[
                        styles.popoverBuilderRootBtn,
                        selectedRoot === r && { backgroundColor: themeColor + "30", borderColor: themeColor }
                      ]}
                      onPress={() => setSelectedRoot(r)}
                    >
                      <Text style={[styles.popoverBuilderRootText, selectedRoot === r && { color: themeColor }]}>{r}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                {/* Modifiers scroll */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
                  {['maj', 'm', '7', 'sus4', 'add9', '/'].map((mod) => (
                    <TouchableOpacity
                      key={mod}
                      style={styles.popoverBuilderModBtn}
                      onPress={() => {
                        const chord = (selectedRoot || "") + mod;
                        handleAssignChordToTapCell(chord);
                        setSelectedRoot(null);
                      }}
                    >
                      <Text style={styles.popoverBuilderModText}>{mod}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                {/* Action Row */}
                <View style={styles.popoverActionsRow}>
                  {/* If cell already has chord, show remove chord option! */}
                  {activeTapCell.secIdx !== null && 
                   activeTapCell.lineIdx !== null && 
                   activeTapCell.charIndex !== null && 
                   (isEditingChords 
                     ? editSections[activeTapCell.secIdx]?.lines[activeTapCell.lineIdx]?.chordsMap?.[activeTapCell.charIndex] 
                     : parseMonospaceChordsToMap(getDisplaySections()[activeTapCell.secIdx]?.lines[activeTapCell.lineIdx]?.chords || "")?.[activeTapCell.charIndex]
                   ) && (
                    <TouchableOpacity
                      style={styles.popoverRemoveBtn}
                      onPress={() => handleRemoveChordFromTapCell(activeTapCell.secIdx, activeTapCell.lineIdx, activeTapCell.charIndex)}
                    >
                      <Text style={styles.popoverRemoveBtnText}>✕ Clear Chord</Text>
                    </TouchableOpacity>
                  )}

                  {selectedRoot && (
                    <TouchableOpacity
                      style={[styles.popoverUseRootBtn, { backgroundColor: themeColor }]}
                      onPress={() => {
                        handleAssignChordToTapCell(selectedRoot);
                        setSelectedRoot(null);
                      }}
                    >
                      <Text style={styles.popoverUseRootBtnText}>Use "{selectedRoot}"</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* 🔮 Ultra-Premium Section & Lines Creator Popover Modal */}
      <Modal
        visible={sectionCreator.visible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setSectionCreator({ visible: false, type: "Verse 1", linesCount: 4 })}
      >
        <View style={styles.popoverOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFillObject}
            activeOpacity={1}
            onPress={() => setSectionCreator({ visible: false, type: "Verse 1", linesCount: 4 })}
          />
          <View style={styles.popoverContent}>
            {/* Header */}
            <View style={styles.popoverHeader}>
              <Text style={styles.popoverTitle}>Add New Song Section</Text>
              <TouchableOpacity
                style={styles.popoverCloseBtn}
                onPress={() => setSectionCreator({ visible: false, type: "Verse 1", linesCount: 4 })}
              >
                <Text style={styles.popoverCloseBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Section Type Selector */}
            <Text style={styles.popoverSectionLabel}>1. Select Section Type:</Text>
            <View style={styles.popoverPresetsGrid}>
              {["Intro", "Verse 1", "Verse 2", "Verse 3", "Verse 4", "Verse 5", "Pre-Chorus", "Chorus", "Chorus 2", "Bridge", "Outro"].map((preset) => {
                const isSel = sectionCreator.type === preset;
                return (
                  <TouchableOpacity
                    key={preset}
                    style={[
                      styles.popoverPresetBtn,
                      { backgroundColor: isSel ? themeColor : "#111827", borderWidth: 1, borderColor: "#334155" }
                    ]}
                    onPress={() => setSectionCreator(prev => ({ ...prev, type: preset }))}
                  >
                    <Text style={[styles.popoverPresetText, { color: isSel ? "#FFFFFF" : "#94A3B8" }]}>{preset}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Lines Count Selector */}
            <Text style={styles.popoverSectionLabel}>2. How many lines?</Text>
            <View style={styles.popoverPresetsGrid}>
              {[1, 2, 4, 6, 8].map((num) => {
                const isSel = sectionCreator.linesCount === num;
                return (
                  <TouchableOpacity
                    key={num}
                    style={[
                      styles.popoverPresetBtn,
                      { backgroundColor: isSel ? themeColor : "#111827", borderWidth: 1, borderColor: "#334155" }
                    ]}
                    onPress={() => setSectionCreator(prev => ({ ...prev, linesCount: num }))}
                  >
                    <Text style={[styles.popoverPresetText, { color: isSel ? "#FFFFFF" : "#94A3B8" }]}>
                      {num} {num === 1 ? "Line" : "Lines"}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Create Button */}
            <TouchableOpacity
              style={[styles.popoverUseRootBtn, { backgroundColor: themeColor, marginTop: 14, height: 44, justifyContent: "center" }]}
              onPress={() => {
                const lines = [];
                for (let i = 0; i < (sectionCreator.linesCount || 4); i++) {
                  lines.push({ chords: "", lyrics: "", chordsMap: {} });
                }
                const newSection = {
                  sectionLabel: sectionCreator.type || "Verse 1",
                  lines: lines
                };
                
                setEditSections([...editSections, newSection]);
                setSectionCreator({ visible: false, type: "Verse 1", linesCount: 4 });
              }}
            >
              <Text style={[styles.popoverUseRootBtnText, { fontSize: 13, fontWeight: "800" }]}>
                Add "{sectionCreator.type || "Verse 1"}" with {sectionCreator.linesCount || 4} Lines
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 🔮 Ultra-Premium Lyrics Section Organizer (Slicer) Popover Modal */}
      <Modal
        visible={slicerVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setSlicerVisible(false)}
      >
        <View style={styles.popoverOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFillObject}
            activeOpacity={1}
            onPress={() => setSlicerVisible(false)}
          />
          <View style={[styles.popoverContent, { width: width * 0.95, maxHeight: "85%", maxWidth: 500 }]}>
            {/* Header */}
            <View style={styles.popoverHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.popoverTitle} numberOfLines={1}>Organize Lyrics Sections</Text>
                <Text style={{ color: "#64748B", fontSize: 11, marginTop: 2 }}>Tap section badges to assign lines</Text>
              </View>
              <TouchableOpacity
                style={styles.popoverCloseBtn}
                onPress={() => setSlicerVisible(false)}
              >
                <Text style={styles.popoverCloseBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView 
              showsVerticalScrollIndicator={true} 
              style={{ marginVertical: 10, maxHeight: 420 }}
              nestedScrollEnabled={true}
            >
              {slicerLines.map((line, idx) => (
                <View key={idx} style={styles.slicerLineCard}>
                  <Text style={styles.slicerLineIndex}>Line {idx + 1}</Text>
                  <Text style={styles.slicerLineText}>"{line.text}"</Text>
                  
                  {/* Presets Horizontal Badges */}
                  <View style={styles.slicerBadgesRow}>
                    {["Verse 1", "Verse 2", "Verse 3", "Verse 4", "Verse 5", "Pre-Chorus", "Chorus", "Chorus 2", "Bridge", "Outro"].map((preset) => {
                      const isSel = line.sectionLabel === preset;
                      return (
                        <TouchableOpacity
                          key={preset}
                          style={[
                            styles.slicerBadge,
                            { backgroundColor: isSel ? themeColor : "#111827", borderColor: isSel ? themeColor : "#334155" }
                          ]}
                          onPress={() => {
                            const updated = [...slicerLines];
                            updated[idx].sectionLabel = preset;
                            setSlicerLines(updated);
                          }}
                        >
                          <Text style={[styles.slicerBadgeText, { color: isSel ? "#FFFFFF" : "#64748B" }]}>
                            {preset}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ))}
            </ScrollView>

            {/* Slicer Save Actions */}
            <View style={styles.popoverActionsRow}>
              <TouchableOpacity
                style={[styles.popoverRemoveBtn, { flex: 1, marginRight: 8, justifyContent: "center", alignItems: "center" }]}
                onPress={() => setSlicerVisible(false)}
              >
                <Text style={styles.popoverRemoveBtnText}>Cancel</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.popoverUseRootBtn, { flex: 1.5, backgroundColor: themeColor, height: 40, justifyContent: "center", alignItems: "center" }]}
                onPress={handleSaveSlicer}
              >
                <Text style={styles.popoverUseRootBtnText}>Save Song Structure</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 🔮 Premium Intro Chord Progression Creator Modal */}
      <Modal
        visible={introCreatorVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => {
          setIntroCreatorVisible(false);
          setIntroChords([]);
        }}
      >
        <View style={styles.popoverOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFillObject}
            activeOpacity={1}
            onPress={() => {
              setIntroCreatorVisible(false);
              setIntroChords([]);
            }}
          />
          <View style={[styles.popoverContent, { width: width * 0.95, maxHeight: "85%", maxWidth: 440 }]}>
            {/* Header */}
            <View style={styles.popoverHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.popoverTitle} numberOfLines={1}>Add Intro Chords</Text>
                <Text style={{ color: "#64748B", fontSize: 11, marginTop: 2 }}>Tap chords to build intro progression</Text>
              </View>
              <TouchableOpacity
                style={styles.popoverCloseBtn}
                onPress={() => {
                  setIntroCreatorVisible(false);
                  setIntroChords([]);
                }}
              >
                <Text style={styles.popoverCloseBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Selected Progression Line display */}
            <Text style={styles.popoverSectionLabel}>Intro Progression Preview:</Text>
            <View style={styles.introProgressionPreviewBox}>
              {introChords.length === 0 ? (
                <Text style={{ color: "#475569", fontSize: 12, fontStyle: "italic" }}>
                  No chords added yet. Tap preset chords below.
                </Text>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: "center" }}>
                  {introChords.map((c, idx) => (
                    <View key={idx} style={styles.introChordBadge}>
                      <Text style={[styles.introChordBadgeText, { color: themeColor }]}>{c.chord}</Text>
                      
                      {/* Sub-duration Selector */}
                      <View style={{ flexDirection: "row", marginHorizontal: 4 }}>
                        {['1B', '2B', '4B', '8B'].map(b => (
                          <TouchableOpacity
                            key={b}
                            style={[
                              styles.introChordBarBtn,
                              c.bars === b[0] && { backgroundColor: themeColor + "30", borderColor: themeColor }
                            ]}
                            onPress={() => {
                              const updated = [...introChords];
                              updated[idx].bars = b[0];
                              setIntroChords(updated);
                            }}
                          >
                            <Text style={[styles.introChordBarBtnText, c.bars === b[0] && { color: themeColor, fontWeight: "800" }]}>
                              {b}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      
                      <TouchableOpacity
                        style={styles.introChordRemoveBtn}
                        onPress={() => {
                          const updated = introChords.filter((_, cIdx) => cIdx !== idx);
                          setIntroChords(updated);
                        }}
                      >
                        <Text style={{ color: "#EF4444", fontSize: 11, fontWeight: "800", marginLeft: 4 }}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </ScrollView>
              )}
            </View>

            {/* Chord Selection Presets */}
            <ScrollView style={{ marginVertical: 10, maxHeight: 320 }} nestedScrollEnabled={true}>
              {/* Quick Major Presets */}
              <Text style={styles.popoverSectionLabel}>Major Chords Presets:</Text>
              <View style={styles.popoverPresetsGrid}>
                {['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'].map((ch) => (
                  <TouchableOpacity
                    key={ch}
                    style={[styles.popoverPresetBtn, { backgroundColor: themeColor }]}
                    onPress={() => {
                      setIntroChords([...introChords, { chord: ch, bars: "2" }]);
                    }}
                  >
                    <Text style={styles.popoverPresetText}>{ch}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Quick Minor Presets */}
              <Text style={styles.popoverSectionLabel}>Minor Chords Presets:</Text>
              <View style={styles.popoverPresetsGrid}>
                {['Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'Abm', 'Am', 'Bbm', 'Bm'].map((ch) => (
                  <TouchableOpacity
                    key={ch}
                    style={[styles.popoverPresetBtn, { backgroundColor: themeColor }]}
                    onPress={() => {
                      setIntroChords([...introChords, { chord: ch, bars: "2" }]);
                    }}
                  >
                    <Text style={styles.popoverPresetText}>{ch}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            {/* Intro Creation Actions */}
            <View style={styles.popoverActionsRow}>
              <TouchableOpacity
                style={[styles.popoverRemoveBtn, { flex: 1, marginRight: 8, justifyContent: "center", alignItems: "center" }]}
                onPress={() => {
                  setIntroCreatorVisible(false);
                  setIntroChords([]);
                }}
              >
                <Text style={styles.popoverRemoveBtnText}>Cancel</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.popoverUseRootBtn, { flex: 1.5, backgroundColor: themeColor, height: 40, justifyContent: "center", alignItems: "center" }]}
                onPress={handleSaveIntroProgression}
              >
                <Text style={styles.popoverUseRootBtnText}>Done (Insert Intro)</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ⏱️ Premium Interactive Metronome Overlay */}
      <MetronomeScreen
        visible={metronomeVisible}
        onClose={() => setMetronomeVisible(false)}
        initialBpm={song.bpm || 100}
        song={song}
        user={user}
        onUpdateSong={onUpdateSong}
      />

      {/* 📱 Full-Screen Paging Lyrics & Chords Viewer Modal */}
      <Modal
        visible={isFullScreen}
        animationType="fade"
        transparent={false}
        onRequestClose={() => setIsFullScreen(false)}
      >
        <SafeAreaView style={styles.fullScreenContainer}>
          {/* Header of Full Screen Mode */}
          <View style={styles.fullScreenHeader}>
            <TouchableOpacity 
              style={styles.fullScreenExitBtn} 
              activeOpacity={0.7} 
              onPress={() => setIsFullScreen(false)}
            >
              <Text style={styles.fullScreenExitBtnText}>✕ Exit</Text>
            </TouchableOpacity>

            <View style={styles.fullScreenHeaderTitleContainer}>
              <Text style={styles.fullScreenHeaderTitle} numberOfLines={1}>
                {activeSongObj.title || "No Title"}
              </Text>
              <Text style={styles.fullScreenHeaderSub} numberOfLines={1}>
                {currentSongIndex + 1} of {targetSongs.length} • {activeSongObj.artist} (Key: {displayKey || "N/A"})
              </Text>
            </View>

            {/* Chords / Lyrics Toggle Tab */}
            <View style={styles.fullScreenTabWrapper}>
              <TouchableOpacity
                style={[
                  styles.fullScreenTabBtn,
                  fullScreenTab === "lyrics" && styles.fullScreenTabBtnActive
                ]}
                onPress={() => setFullScreenTab("lyrics")}
                activeOpacity={0.7}
              >
                <Text style={[styles.fullScreenTabText, fullScreenTab === "lyrics" && styles.fullScreenTabTextActive]}>
                  Lyrics
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.fullScreenTabBtn,
                  fullScreenTab === "chords" && styles.fullScreenTabBtnActive
                ]}
                onPress={() => setFullScreenTab("chords")}
                activeOpacity={0.7}
              >
                <Text style={[styles.fullScreenTabText, fullScreenTab === "chords" && styles.fullScreenTabTextActive]}>
                  Chords
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Sub Controls Panel (Transposition, Tamil Toggle & Font Scaling) */}
          <View style={styles.fullScreenControlsPanel}>
            {/* Left side: Transpose Key */}
            {fullScreenTab === "chords" ? (
              <View style={styles.fullScreenTransposers}>
                <TouchableOpacity 
                  style={styles.fullScreenCtrlBtn} 
                  onPress={() => {
                    const keys = preferFlatsForKey(activeSongObj.originalKey) ? KEYS_FLAT : KEYS_SHARP;
                    const currentRoot = extractRoot(displayKey);
                    let idx = keys.indexOf(currentRoot);
                    if (idx === -1) idx = KEYS_SHARP.indexOf(currentRoot);
                    if (idx === -1) idx = KEYS_FLAT.indexOf(currentRoot);
                    if (idx !== -1) {
                      let newIdx = (idx - 1) % 12;
                      if (newIdx < 0) newIdx += 12;
                      handleKeyChange(keys[newIdx]);
                    }
                  }}
                >
                  <Text style={styles.fullScreenCtrlBtnText}>Key -</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={styles.fullScreenCtrlBtn} 
                  onPress={() => {
                    const keys = preferFlatsForKey(activeSongObj.originalKey) ? KEYS_FLAT : KEYS_SHARP;
                    const currentRoot = extractRoot(displayKey);
                    let idx = keys.indexOf(currentRoot);
                    if (idx === -1) idx = KEYS_SHARP.indexOf(currentRoot);
                    if (idx === -1) idx = KEYS_FLAT.indexOf(currentRoot);
                    if (idx !== -1) {
                      let newIdx = (idx + 1) % 12;
                      if (newIdx < 0) newIdx += 12;
                      handleKeyChange(keys[newIdx]);
                    }
                  }}
                >
                  <Text style={styles.fullScreenCtrlBtnText}>Key +</Text>
                </TouchableOpacity>
                {displayKey !== (activeSongObj.originalKey || "C") && (
                  <TouchableOpacity 
                    style={[styles.fullScreenCtrlBtn, { borderColor: "#F59E0B" }]} 
                    onPress={() => handleKeyChange(activeSongObj.originalKey || "C")}
                  >
                    <Text style={[styles.fullScreenCtrlBtnText, { color: "#F59E0B" }]}>Reset</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              /* If lyrics, show Tamil/English sub-toggle */
              <View style={styles.fullScreenTransposers}>
                <TouchableOpacity
                  style={[
                    styles.fullScreenCtrlBtn,
                    activeLyricsTab === "english" && { backgroundColor: themeColor + "20", borderColor: themeColor }
                  ]}
                  onPress={() => setActiveLyricsTab("english")}
                >
                  <Text style={[styles.fullScreenCtrlBtnText, activeLyricsTab === "english" && { color: themeColor }]}>English</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.fullScreenCtrlBtn,
                    activeLyricsTab === "tamil" && { backgroundColor: themeColor + "20", borderColor: themeColor }
                  ]}
                  onPress={() => setActiveLyricsTab("tamil")}
                >
                  <Text style={[styles.fullScreenCtrlBtnText, activeLyricsTab === "tamil" && { color: themeColor }]}>Tamil</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Right side: Font Sizing */}
            <View style={styles.fullScreenFontSizeRow}>
              <TouchableOpacity 
                style={styles.fullScreenCtrlBtn} 
                onPress={() => setFullScreenFontSize(prev => Math.max(12, prev - 2))}
              >
                <Text style={styles.fullScreenCtrlBtnText}>A -</Text>
              </TouchableOpacity>
              <Text style={styles.fullScreenFontSizeLabel}>{fullScreenFontSize}pt</Text>
              <TouchableOpacity 
                style={styles.fullScreenCtrlBtn} 
                onPress={() => setFullScreenFontSize(prev => Math.min(30, prev + 2))}
              >
                <Text style={styles.fullScreenCtrlBtnText}>A +</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Horizontal Paging FlatList */}
          <FlatList
            data={targetSongs}
            keyExtractor={(item) => item.songId}
            horizontal={true}
            pagingEnabled={true}
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={initialIndex}
            getItemLayout={(data, index) => ({ length: width, offset: width * index, index })}
            onMomentumScrollEnd={(e) => {
              const offsetX = e.nativeEvent.contentOffset.x;
              const index = Math.round(offsetX / width);
              if (index >= 0 && index < targetSongs.length && index !== currentSongIndex) {
                setCurrentSongIndex(index);
              }
            }}
            onScrollToIndexFailed={() => {}}
            renderItem={({ item }) => (
              <View style={{ width: width, flex: 1, backgroundColor: "#0B0F19" }}>
                {renderFullScreenItemContent(item)}
              </View>
            )}
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  // =========================================================================
  // 🎵 CHORD CHART SYSTEM STYLES
  // =========================================================================
  mainTabWrapper: {
    flexDirection: "row",
    backgroundColor: "#111827",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1E293B",
    padding: 4,
    marginBottom: 18,
  },
  mainTabButton: {
    flex: 1,
    paddingVertical: 12,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 8,
  },
  mainTabButtonActive: {
    backgroundColor: "#1E293B",
  },
  mainTabButtonText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#64748B",
  },
  chordsContainer: {
    marginBottom: 20,
  },
  
  // Editor Styles
  editorPanel: {
    backgroundColor: "#1E293B",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#334155",
    padding: 20,
  },
  editorHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
    borderBottomWidth: 1,
    borderColor: "#334155",
    paddingBottom: 12,
  },
  editorTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  editorActions: {
    flexDirection: "row",
  },
  btnSolid: {
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  btnOutline: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  btnOutlineRed: {
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.4)",
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(239, 68, 68, 0.1)",
  },
  sectionEditCard: {
    backgroundColor: "#111827",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#334155",
    padding: 16,
    marginBottom: 16,
  },
  sectionHeaderInputRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  sectionInputLabel: {
    color: "#94A3B8",
    fontSize: 13,
    fontWeight: "700",
    marginRight: 8,
  },
  sectionLabelInput: {
    flex: 1,
    backgroundColor: "#1E293B",
    borderColor: "#334155",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 38,
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  removeSectionBtn: {
    marginLeft: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  removeSectionBtnText: {
    color: "#EF4444",
    fontSize: 12,
    fontWeight: "700",
  },
  presetRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 16,
    borderBottomWidth: 1,
    borderColor: "#1E293B",
    paddingBottom: 10,
  },
  presetBadge: {
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: 6,
    marginBottom: 6,
    backgroundColor: "#1E293B",
  },
  presetBadgeText: {
    color: "#64748B",
    fontSize: 11,
    fontWeight: "700",
  },
  linesListContainer: {
    marginBottom: 12,
  },
  lineEditCard: {
    backgroundColor: "#1E293B",
    borderColor: "#334155",
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  lineEditIndexRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  lineIndexText: {
    color: "#64748B",
    fontSize: 11,
    fontWeight: "800",
  },
  lineActionButtons: {
    flexDirection: "row",
  },
  lineBtnSmall: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginLeft: 8,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "#334155",
  },
  removeLineBtn: {
    backgroundColor: "rgba(239, 68, 68, 0.05)",
    borderColor: "rgba(239, 68, 68, 0.2)",
  },
  lineBtnTextSmall: {
    color: "#94A3B8",
    fontSize: 10,
    fontWeight: "700",
  },
  chordInputMonospace: {
    backgroundColor: "#111827",
    borderColor: "#334155",
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    height: 36,
    color: "#A855F7",
    fontSize: 14,
    fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
    fontWeight: "700",
    marginBottom: 6,
  },
  lyricInput: {
    backgroundColor: "#111827",
    borderColor: "#334155",
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    height: 36,
    color: "#FFFFFF",
    fontSize: 13,
  },
  addBtnOutline: {
    borderWidth: 1,
    borderRadius: 8,
    borderStyle: "dashed",
    paddingVertical: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  addBtnOutlineText: {
    fontSize: 12,
    fontWeight: "700",
  },
  addSectionBtn: {
    borderWidth: 1.5,
    borderRadius: 12,
    borderStyle: "dashed",
    paddingVertical: 12,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.02)",
    marginTop: 10,
  },
  addSectionBtnText: {
    fontSize: 13,
    fontWeight: "800",
  },
  editorFooterActions: {
    flexDirection: "row",
    marginTop: 16,
  },

  // Display Panel Styles
  displayPanel: {
    backgroundColor: "#1E293B",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#334155",
    padding: 20,
    overflow: "hidden",
  },
  transpositionBox: {
    backgroundColor: "#111827",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#334155",
    padding: 14,
    marginBottom: 16,
  },
  transposeControlRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  transposeControlLabel: {
    color: "#94A3B8",
    fontSize: 12,
    fontWeight: "700",
    marginRight: 10,
  },
  keySelectorScroll: {
    alignItems: "center",
    paddingRight: 10,
  },
  keySelectButton: {
    width: 32,
    height: 32,
    borderRadius: 6,
    backgroundColor: "#1E293B",
    borderWidth: 1,
    borderColor: "#334155",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 6,
  },
  keySelectButtonActive: {
    borderWidth: 0,
  },
  keySelectText: {
    color: "#64748B",
    fontSize: 12,
    fontWeight: "800",
  },
  keySelectTextActive: {
    color: "#FFFFFF",
  },
  resetKeyButton: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginLeft: 6,
  },
  resetKeyButtonText: {
    fontSize: 11,
    fontWeight: "800",
  },
  dividerSmall: {
    height: 1,
    backgroundColor: "#1E293B",
    marginVertical: 12,
  },
  notationSelectorRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 12,
  },
  notationControlLabel: {
    color: "#94A3B8",
    fontSize: 12,
    fontWeight: "700",
    marginRight: 10,
  },
  notationButtonsContainer: {
    flexDirection: "row",
    flex: 1,
    justifyContent: "space-between",
  },
  notationButton: {
    flex: 1,
    height: 32,
    borderRadius: 6,
    backgroundColor: "#1E293B",
    borderWidth: 1,
    borderColor: "#334155",
    justifyContent: "center",
    alignItems: "center",
    marginHorizontal: 3,
  },
  notationButtonActive: {
    borderWidth: 0,
  },
  notationButtonText: {
    color: "#64748B",
    fontSize: 10,
    fontWeight: "800",
  },
  notationButtonTextActive: {
    color: "#FFFFFF",
  },
  capoStepperRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  capoTitle: {
    color: "#E2E8F0",
    fontSize: 13,
    fontWeight: "800",
  },
  capoSub: {
    color: "#64748B",
    fontSize: 11,
    fontWeight: "500",
    marginTop: 2,
  },
  stepperContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1E293B",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#334155",
    padding: 3,
  },
  stepperBtn: {
    width: 28,
    height: 28,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#111827",
    borderRadius: 6,
  },
  stepperBtnText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
  },
  stepperValueContainer: {
    paddingHorizontal: 12,
    minWidth: 36,
    alignItems: "center",
  },
  stepperValue: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },
  editChordsToggleBtn: {
    borderWidth: 1,
    borderRadius: 10,
    height: 46,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.02)",
    marginBottom: 16,
  },
  editChordsToggleBtnText: {
    fontSize: 13,
    fontWeight: "700",
  },
  chordSheetPaper: {
    backgroundColor: "#111827",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#334155",
    padding: 16,
  },
  chordSectionContainer: {
    marginBottom: 20,
  },
  chordSectionTitle: {
    fontSize: 14,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  chordSectionLines: {
    paddingLeft: 4,
  },
  chordLineContainer: {
    marginBottom: 12,
  },
  monospaceChords: {
    fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 0.2,
    lineHeight: 18,
    marginBottom: 2,
  },
  monospaceLyrics: {
    fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
    fontSize: 15,
    color: "#E2E8F0",
    letterSpacing: 0.2,
    lineHeight: 18,
  },
  chordAuditFooter: {
    borderTopWidth: 1,
    borderColor: "#1E293B",
    paddingTop: 12,
    marginTop: 8,
    alignItems: "center",
  },
  chordAuditText: {
    color: "#475569",
    fontSize: 10,
    fontWeight: "600",
  },
  chordAuditHighlight: {
    color: "#64748B",
    fontWeight: "700",
  },
  noChordsCard: {
    backgroundColor: "#111827",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#334155",
    padding: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  noChordsText: {
    color: "#64748B",
    fontSize: 13,
    fontStyle: "italic",
    textAlign: "center",
  },

  container: {
    flex: 1,
    backgroundColor: "#0B0F19",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 60,
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderColor: "#1E293B",
  },
  backButton: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  backButtonText: {
    color: "#64748B",
    fontSize: 15,
    fontWeight: "700",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#FFFFFF",
    flex: 1,
    textAlign: "center",
    marginHorizontal: 10,
  },
  editButton: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 5,
  },
  editButtonText: {
    fontSize: 13,
    fontWeight: "700",
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 60,
  },
  metaCard: {
    backgroundColor: "#1E293B",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#334155",
    padding: 20,
    marginBottom: 20,
  },
  titleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  songTitle: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "800",
    marginBottom: 6,
  },
  songArtist: {
    color: "#94A3B8",
    fontSize: 15,
    fontWeight: "500",
  },
  keyBadgeContainer: {
    alignItems: "center",
  },
  keyBadge: {
    borderWidth: 1.5,
    borderRadius: 12,
    minWidth: 54,
    paddingHorizontal: 8,
    height: 52,
    justifyContent: "center",
    alignItems: "center",
  },
  keyLogTooltip: {
    backgroundColor: "#1E293B",
    borderColor: "#334155",
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 4,
    marginTop: 6,
    alignItems: "center",
    minWidth: 70,
  },
  keyLogText: {
    color: "#64748B",
    fontSize: 9,
    fontWeight: "700",
  },
  keyLogHighlight: {
    color: "#94A3B8",
    fontWeight: "800",
  },
  keyLogByText: {
    color: "#475569",
    fontSize: 8,
    fontWeight: "600",
    marginTop: 2,
  },
  keyText: {
    fontWeight: "900",
  },
  keyLabel: {
    color: "#64748B",
    fontSize: 9,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  divider: {
    height: 1,
    backgroundColor: "#334155",
    marginVertical: 16,
  },
  infoGrid: {
    flexDirection: "row",
    justifyContent: "flex-start",
  },
  gridItem: {
    marginRight: 32,
  },
  gridLabel: {
    color: "#64748B",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  gridValue: {
    color: "#E2E8F0",
    fontSize: 16,
    fontWeight: "800",
  },
  bpmContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  pulseIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  ccliText: {
    color: "#94A3B8",
  },
  linksContainer: {
    flexDirection: "row",
    marginTop: 18,
    justifyContent: "space-between",
  },
  linkButton: {
    flex: 1,
    borderRadius: 10,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
    marginHorizontal: 4,
  },
  youtubeButton: {
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.25)",
  },
  spotifyButton: {
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.25)",
  },
  linkButtonText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  lyricsContainer: {
    backgroundColor: "#1E293B",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#334155",
    overflow: "hidden",
    marginBottom: 20,
  },
  lyricsHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#111827",
  },
  lyricsTab: {
    flex: 1,
    height: 48,
    justifyContent: "center",
    alignItems: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  activeLyricsTab: {
    backgroundColor: "rgba(255,255,255,0.01)",
  },
  lyricsTabText: {
    color: "#64748B",
    fontSize: 13,
    fontWeight: "600",
  },
  lyricsBody: {
    padding: 20,
    backgroundColor: "#1E293B",
  },
  lyricsText: {
    color: "#E2E8F0",
    fontSize: 16,
    lineHeight: 26,
    fontWeight: "500",
    textAlign: "center",
  },
  tamilFont: {
    fontSize: 17,
    lineHeight: 28,
  },
  noLyricsText: {
    color: "#64748B",
    fontSize: 14,
    textAlign: "center",
    fontStyle: "italic",
    paddingVertical: 20,
  },
  notesCard: {
    backgroundColor: "#111827",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1E293B",
    padding: 16,
    marginBottom: 20,
  },
  notesTitle: {
    color: "#94A3B8",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    marginBottom: 8,
  },
  notesText: {
    color: "#E2E8F0",
    fontSize: 14,
    lineHeight: 20,
  },
  footerAudit: {
    alignItems: "center",
    paddingTop: 8,
    paddingBottom: 24,
  },
  auditText: {
    color: "#475569",
    fontSize: 11,
    fontWeight: "600",
    marginBottom: 4,
  },
  auditHighlight: {
    color: "#64748B",
    fontWeight: "700",
  },
  auditFieldsText: {
    color: "#475569",
    fontSize: 10,
    fontWeight: "600",
    marginTop: 2,
  },
  auditFieldsHighlight: {
    color: "#94A3B8",
    fontStyle: "italic",
    fontWeight: "500",
  },
  
  // upgraded chord chart system additions:
  editorModeToggleContainer: {
    flexDirection: "row",
    backgroundColor: "#111827",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#334155",
    padding: 3,
    marginBottom: 16,
  },
  editorModeTab: {
    flex: 1,
    paddingVertical: 10,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 6,
  },
  editorModeTabActive: {
    backgroundColor: "#1E293B",
  },
  editorModeTabText: {
    color: "#64748B",
    fontSize: 12,
    fontWeight: "700",
  },
  editorModeTabTextActive: {
    color: "#FFFFFF",
  },
  baseKeyPickerContainer: {
    backgroundColor: "#111827",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#334155",
    padding: 10,
    marginBottom: 16,
    flexDirection: "row",
    alignItems: "center",
  },
  baseKeyPickerLabel: {
    color: "#94A3B8",
    fontSize: 11,
    fontWeight: "700",
    marginRight: 10,
    width: 90,
  },
  baseKeyScroll: {
    alignItems: "center",
  },
  baseKeySelectButton: {
    width: 28,
    height: 28,
    borderRadius: 5,
    backgroundColor: "#1E293B",
    borderWidth: 1,
    borderColor: "#334155",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 4,
  },
  baseKeySelectButtonActive: {
    borderWidth: 0,
  },
  baseKeySelectText: {
    color: "#64748B",
    fontSize: 11,
    fontWeight: "800",
  },
  baseKeySelectTextActive: {
    color: "#FFFFFF",
  },
  bracketTextInputContainer: {
    backgroundColor: "#111827",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#334155",
    padding: 12,
    marginBottom: 16,
  },
  bracketEditorInstructions: {
    color: "#64748B",
    fontSize: 11,
    fontStyle: "italic",
    marginBottom: 10,
    lineHeight: 15,
  },
  bracketTextInput: {
    backgroundColor: "#0B0F19",
    borderColor: "#334155",
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    minHeight: 250,
    color: "#FFFFFF",
    fontSize: 14,
    fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
    lineHeight: 20,
    textAlignVertical: "top",
  },
  helperKeyboardContainer: {
    backgroundColor: "#111827",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#334155",
    padding: 12,
    marginBottom: 16,
  },
  helperHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 1,
    borderColor: "#1E293B",
    paddingBottom: 8,
    marginBottom: 8,
  },
  helperTitle: {
    color: "#E2E8F0",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  builderPreviewContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1E293B",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: "#334155",
  },
  builderPreviewLabel: {
    color: "#64748B",
    fontSize: 10,
    fontWeight: "700",
  },
  builderPreviewBadge: {
    backgroundColor: "#111827",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginRight: 6,
  },
  builderPreviewText: {
    color: "#A855F7",
    fontSize: 11,
    fontWeight: "900",
  },
  builderInsertBtn: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    marginRight: 6,
  },
  builderInsertBtnText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "800",
  },
  builderCancelBtn: {
    padding: 2,
  },
  builderCancelBtnText: {
    color: "#EF4444",
    fontSize: 10,
    fontWeight: "800",
  },
  helperRowWrapper: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  scrollSectionLabel: {
    color: "#64748B",
    fontSize: 10,
    fontWeight: "800",
    width: 60,
  },
  helperScrollContent: {
    alignItems: "center",
  },
  presetChordBtn: {
    backgroundColor: "#1E293B",
    borderColor: "#334155",
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginRight: 5,
  },
  presetChordText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "800",
  },
  rootChordBtn: {
    backgroundColor: "#1E293B",
    borderColor: "#334155",
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginRight: 5,
  },
  rootChordText: {
    color: "#94A3B8",
    fontSize: 11,
    fontWeight: "800",
  },
  modifierChordBtn: {
    backgroundColor: "#1E293B",
    borderColor: "#334155",
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginRight: 5,
  },
  modifierChordText: {
    color: "#A855F7",
    fontSize: 11,
    fontWeight: "800",
  },
  musicianNotesCard: {
    backgroundColor: "#111827",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#334155",
    padding: 14,
    marginBottom: 16,
  },
  musicianNotesHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 1,
    borderColor: "#1E293B",
    paddingBottom: 8,
    marginBottom: 8,
  },
  musicianNotesTitle: {
    color: "#E2E8F0",
    fontSize: 12,
    fontWeight: "800",
  },
  notesEditBtn: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 3,
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  notesEditBtnText: {
    fontSize: 10,
    fontWeight: "700",
  },
  notesEditingActions: {
    flexDirection: "row",
  },
  notesCancelBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: 6,
  },
  notesCancelBtnText: {
    color: "#64748B",
    fontSize: 10,
    fontWeight: "700",
  },
  notesSaveBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
  },
  notesSaveBtnText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "700",
  },
  musicianNotesInput: {
    backgroundColor: "#1E293B",
    borderColor: "#334155",
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    color: "#FFFFFF",
    fontSize: 13,
    minHeight: 80,
    textAlignVertical: "top",
  },
  musicianNotesText: {
    color: "#E2E8F0",
    fontSize: 13,
    lineHeight: 18,
    fontStyle: "italic",
    paddingLeft: 4,
  },
  musicianNotesPlaceholder: {
    color: "#475569",
    fontSize: 12,
    fontStyle: "italic",
    paddingLeft: 4,
  },
  interactiveTapLabel: {
    color: "#94A3B8",
    fontSize: 11,
    fontWeight: "700",
    marginBottom: 8,
    textTransform: "uppercase",
  },
  interactiveWordsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    backgroundColor: "#0B0F19",
    borderColor: "#334155",
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    minHeight: 64,
    alignItems: "flex-end",
  },
  wordBlock: {
    alignItems: "center",
    marginVertical: 6,
  },
  wordBtn: {
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    backgroundColor: "rgba(255, 255, 255, 0.02)",
  },
  wordBtnText: {
    color: "#FFFFFF",
    fontSize: 13,
  },
  miniChordBadge: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginBottom: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  miniChordBadgeText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "900",
  },
  slotBlock: {
    alignItems: "center",
    marginHorizontal: 3,
    marginVertical: 6,
  },
  emptySlotBtn: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#475569",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 5,
    backgroundColor: "rgba(255, 255, 255, 0.01)",
    minWidth: 46,
    alignItems: "center",
  },
  emptySlotText: {
    color: "#64748B",
    fontSize: 10,
    fontWeight: "700",
  },
  chordProgressionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    marginVertical: 6,
  },
  progressionChordBadge: {
    backgroundColor: "#1E293B",
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 8,
    marginVertical: 4,
  },
  progressionChordText: {
    fontSize: 13,
    fontWeight: "900",
    fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
  },
  addProgressionChordBtn: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#334155",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginVertical: 4,
    backgroundColor: "rgba(255,255,255,0.01)",
  },
  interactiveLyricsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-end",
    marginVertical: 6,
  },
  interactiveWordBlock: {
    alignItems: "center",
    marginVertical: 4,
    marginRight: 1,
  },
  interactiveChordSlot: {
    height: 18,
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
  },
  interactiveChordText: {
    fontSize: 12,
    fontWeight: "900",
    fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
  },
  interactiveWordText: {
    fontSize: 14,
    color: "#E2E8F0",
    fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
  },
  interactiveWordTextBtn: {
    paddingVertical: 1,
    paddingHorizontal: 2,
  },
  interactiveWordTextClickable: {
    fontSize: 14,
    color: "#E2E8F0",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.2)",
    borderStyle: "dotted",
    fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
  },
  lyricsSpace: {
    fontSize: 14,
    width: 5,
  },
  popoverOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.65)",
    justifyContent: "center",
    alignItems: "center",
  },
  popoverContent: {
    backgroundColor: "#1E293B",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#334155",
    padding: 20,
    width: width * 0.9,
    maxWidth: 380,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  popoverHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
    borderBottomWidth: 1,
    borderColor: "#334155",
    paddingBottom: 8,
  },
  popoverTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  popoverCloseBtn: {
    padding: 4,
  },
  popoverCloseBtnText: {
    color: "#94A3B8",
    fontSize: 16,
    fontWeight: "700",
  },
  popoverSectionLabel: {
    color: "#94A3B8",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    marginBottom: 8,
    marginTop: 6,
  },
  popoverPresetsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-start",
    marginBottom: 12,
  },
  popoverPresetBtn: {
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginRight: 6,
    marginBottom: 6,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  popoverPresetText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "800",
  },
  popoverBuilderRootBtn: {
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginRight: 6,
    minWidth: 40,
    alignItems: "center",
  },
  popoverBuilderRootText: {
    color: "#94A3B8",
    fontSize: 12,
    fontWeight: "800",
  },
  popoverBuilderModBtn: {
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginRight: 6,
    minWidth: 44,
    alignItems: "center",
  },
  popoverBuilderModText: {
    color: "#A855F7",
    fontSize: 12,
    fontWeight: "800",
  },
  popoverActionsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 12,
    borderTopWidth: 1,
    borderColor: "#334155",
    paddingTop: 12,
  },
  popoverRemoveBtn: {
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.25)",
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  popoverRemoveBtnText: {
    color: "#EF4444",
    fontSize: 12,
    fontWeight: "700",
  },
  popoverUseRootBtn: {
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: "center",
  },
  popoverUseRootBtnText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  slicerLineCard: {
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  slicerLineIndex: {
    color: "#64748B",
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  slicerLineText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 8,
  },
  slicerBadgesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 4,
  },
  slicerBadge: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: 5,
    marginBottom: 5,
  },
  slicerBadgeText: {
    fontSize: 10,
    fontWeight: "700",
  },
  introProgressionPreviewBox: {
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 10,
    padding: 10,
    minHeight: 60,
    marginBottom: 12,
    justifyContent: "center",
  },
  introChordBadge: {
    backgroundColor: "#1E293B",
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 8,
    padding: 6,
    marginRight: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  introChordBadgeText: {
    fontSize: 13,
    fontWeight: "900",
    marginRight: 4,
  },
  introChordBarBtn: {
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 2,
    marginRight: 3,
  },
  introChordBarBtnText: {
    color: "#64748B",
    fontSize: 8,
    fontWeight: "700",
  },
  introChordRemoveBtn: {
    padding: 2,
  },
  gridItemHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
  },
  inlinePlayBtn: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginLeft: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  inlinePlayBtnText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "800",
  },
  inlineBeatText: {
    fontSize: 12,
    fontWeight: "800",
    marginLeft: 10,
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  deleteSongFullBtn: {
    margin: 24,
    marginTop: 8,
    backgroundColor: "#EF4444",
    borderRadius: 12,
    height: 50,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#EF4444",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
    elevation: 4,
  },
  deleteSongFullBtnText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
  },
  fullScreenContainer: {
    flex: 1,
    backgroundColor: "#0B0F19",
    paddingTop: Platform.OS === "android" ? 12 : 0,
  },
  fullScreenHeader: {
    height: 60,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#1E293B",
    backgroundColor: "#0F172A",
  },
  fullScreenExitBtn: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "#334155",
  },
  fullScreenExitBtnText: {
    color: "#EF4444",
    fontSize: 13,
    fontWeight: "800",
  },
  fullScreenHeaderTitleContainer: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 12,
  },
  fullScreenHeaderTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
  },
  fullScreenHeaderSub: {
    color: "#94A3B8",
    fontSize: 11,
    fontWeight: "600",
    marginTop: 2,
  },
  fullScreenTabWrapper: {
    flexDirection: "row",
    backgroundColor: "#1E293B",
    borderRadius: 8,
    padding: 2,
  },
  fullScreenTabBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  fullScreenTabBtnActive: {
    backgroundColor: "#0F172A",
  },
  fullScreenTabText: {
    color: "#64748B",
    fontSize: 12,
    fontWeight: "700",
  },
  fullScreenTabTextActive: {
    color: "#FFFFFF",
  },
  fullScreenControlsPanel: {
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    backgroundColor: "#0F172A",
    borderBottomWidth: 1,
    borderBottomColor: "#1E293B",
  },
  fullScreenTransposers: {
    flexDirection: "row",
    alignItems: "center",
  },
  fullScreenCtrlBtn: {
    backgroundColor: "#1E293B",
    borderColor: "#334155",
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 6,
  },
  fullScreenCtrlBtnText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
  },
  fullScreenFontSizeRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  fullScreenFontSizeLabel: {
    color: "#E2E8F0",
    fontSize: 12,
    fontWeight: "700",
    marginHorizontal: 6,
  },
  fullScreenScroll: {
    flex: 1,
  },
  fullScreenScrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  fullScreenLyricsText: {
    color: "#E2E8F0",
    lineHeight: 34,
    fontWeight: "600",
  },
  
  // 🎙️ Audio Recordings Tab Styles
  recordingsContainer: {
    paddingHorizontal: 4,
    marginBottom: 30,
  },
  recordingsHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  recordingsTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  recordNewBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  recordNewBtnText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
  noRecordingsCard: {
    backgroundColor: "#111827",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1E293B",
    padding: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  noRecordingsText: {
    color: "#94A3B8",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },
  noRecordingsSub: {
    color: "#64748B",
    fontSize: 12,
    marginTop: 6,
    textAlign: "center",
  },
  recordingCard: {
    backgroundColor: "#111827",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1E293B",
    padding: 16,
    marginBottom: 12,
  },
  recordingCardInfo: {
    flex: 1,
    marginBottom: 12,
  },
  recordingCardTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: "#FFFFFF",
    flex: 1,
  },
  targetTag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: "flex-start",
  },
  targetTagText: {
    fontSize: 10,
    fontWeight: "700",
  },
  recordingCardMeta: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 2,
  },
  progressContainer: {
    marginTop: 10,
    backgroundColor: "rgba(0,0,0,0.2)",
    borderRadius: 8,
    padding: 8,
  },
  progressBarBg: {
    height: 4,
    backgroundColor: "#1E293B",
    borderRadius: 2,
    overflow: "hidden",
  },
  progressBarFill: {
    height: "100%",
    borderRadius: 2,
  },
  progressTimeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 6,
  },
  progressTime: {
    fontSize: 10,
    color: "#94A3B8",
    fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
  },
  recordingCardActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.05)",
    paddingTop: 12,
  },
  recordingPlayBtn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  recordingPlayBtnText: {
    fontSize: 12,
    fontWeight: "700",
  },
  recordingDeleteBtn: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  recordingDeleteBtnText: {
    color: "#EF4444",
    fontSize: 12,
    fontWeight: "700",
  },
  
  // Modal Recording Controls
  recordingModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(11, 15, 25, 0.85)",
    justifyContent: "center",
    padding: 20,
  },
  recordingModalContainer: {
    backgroundColor: "#0F172A",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#1E293B",
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 10,
  },
  recordingModalTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#FFFFFF",
    marginBottom: 16,
  },
  recordingInputLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#94A3B8",
    marginBottom: 6,
    marginTop: 12,
  },
  recordingNameInput: {
    backgroundColor: "#0B0F19",
    borderWidth: 1,
    borderColor: "#1E293B",
    borderRadius: 8,
    padding: 10,
    color: "#FFFFFF",
    fontSize: 14,
  },
  targetAudienceSelector: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  targetAudienceBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#1E293B",
    backgroundColor: "#0B0F19",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
    marginHorizontal: 4,
  },
  targetAudienceBtnText: {
    fontSize: 11,
    color: "#64748B",
    fontWeight: "600",
  },
  recordingStatusBox: {
    backgroundColor: "#0B0F19",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1E293B",
    padding: 20,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 120,
    marginBottom: 20,
  },
  recordingIndicatorPulse: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#EF4444",
    marginBottom: 10,
  },
  recordingStatusText: {
    color: "#EF4444",
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 4,
  },
  recordingTimerText: {
    fontSize: 24,
    fontWeight: "800",
    color: "#FFFFFF",
    fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
  },
  recordingStatusTextSuccess: {
    color: "#10B981",
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 4,
  },
  recordingDurationLabel: {
    color: "#94A3B8",
    fontSize: 12,
    marginBottom: 12,
  },
  previewPlayBtn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  previewPlayBtnText: {
    fontSize: 12,
    fontWeight: "700",
  },
  recordingStatusPlaceholder: {
    color: "#475569",
    fontSize: 12,
    textAlign: "center",
  },
  modalActionsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  modalCancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  modalCancelBtnText: {
    color: "#64748B",
    fontSize: 13,
    fontWeight: "700",
  },
  modalStopBtn: {
    backgroundColor: "#EF4444",
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  modalStopBtnText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
  modalReRecordBtn: {
    borderWidth: 1,
    borderColor: "#475569",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  modalReRecordBtnText: {
    color: "#94A3B8",
    fontSize: 12,
    fontWeight: "700",
  },
  modalRecordBtn: {
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  modalRecordBtnText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
  modalSaveBtn: {
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    minWidth: 70,
    alignItems: "center",
  },
  modalSaveBtnText: {
    fontSize: 13,
    fontWeight: "700",
  },
});
