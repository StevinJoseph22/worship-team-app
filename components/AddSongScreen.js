import React, { useState, useEffect, useRef } from "react";
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Modal,
  ActivityIndicator,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { WebView } from "react-native-webview";
import * as Clipboard from "expo-clipboard";
import { organizeLyricsWithAI, detectKeyAndChordsWithAI, detectMediaLinksWithAI } from "../services/aiService";
import { db, USE_DEMO_MODE } from "../firebaseConfig";
import { doc, getDoc } from "firebase/firestore";
import AsyncStorage from "@react-native-async-storage/async-storage";

export default function AddSongScreen({ songToEdit, onSave, onCancel, user, songs, defaultTitle = "" }) {
  const isEditMode = !!songToEdit;

  // Role permissions checks
  const hasLyricTaskClearance = songToEdit?.hasLyricTaskClearance;
  const isAllowedToSave = isEditMode
    ? ["worship_leader", "super_admin", "musician", "choir_member"].includes(user?.role) || (user?.role === "member" && hasLyricTaskClearance)
    : ["worship_leader", "super_admin", "musician", "choir_member"].includes(user?.role);

  // Restrict editing capabilities to lyrics only for choir members and general members
  const isLyricsOnly = user?.role === "choir_member" || user?.role === "member";
  
  // Smart Import controls visible only to Worship Leaders, Super Admins, and Musicians
  const showSmartImport = ["worship_leader", "super_admin", "musician"].includes(user?.role);

  // Root theme color
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

  // Basic song fields
  const [title, setTitle] = useState(defaultTitle || "");
  const [artist, setArtist] = useState("");
  const [originalKey, setOriginalKey] = useState("C Major");
  const [currentKey, setCurrentKey] = useState("C Major");
  const [bpm, setBpm] = useState("");
  const [timeSignature, setTimeSignature] = useState("4/4");
  const [youtubeLink, setYoutubeLink] = useState("");
  const [spotifyLink, setSpotifyLink] = useState("");
  const [ccli, setCcli] = useState("");
  const [notes, setNotes] = useState("");
  const [tagsInput, setTagsInput] = useState("");

  // Section-based Lyrics state
  const [sectionsEnglish, setSectionsEnglish] = useState([{ id: "1", sectionLabel: "Verse 1", lyrics: "" }]);
  const [sectionsTamil, setSectionsTamil] = useState([{ id: "1", sectionLabel: "Verse 1", lyrics: "" }]);

  // Auto-filled labels tracking
  const [autoFilledKey, setAutoFilledKey] = useState(false);
  const [autoFilledBpm, setAutoFilledBpm] = useState(false);
  const [autoFilledTimeSignature, setAutoFilledTimeSignature] = useState(false);

  // Heuristic language badges
  const [detectedTamilEnglishBadge, setDetectedTamilEnglishBadge] = useState(""); // "Tamil detected ✓" or "English detected ✓" or "Mixed detected ✓"

  // AI & browser loading indicators
  const [isAiOrganizing, setIsAiOrganizing] = useState(false);
  const [isAiDetecting, setIsAiDetecting] = useState(false);
  const [isAiDetectingLinks, setIsAiDetectingLinks] = useState(false);
  const [confidence, setConfidence] = useState(null); // 'high' | 'low' | 'unknown'
  const [detectedChords, setDetectedChords] = useState(null); // raw JSON chord chart from Claude

  // In-App Browser modal controls
  const [browserVisible, setBrowserVisible] = useState(false);
  const [browserUrl, setBrowserUrl] = useState("");
  const [selectedText, setSelectedText] = useState("");
  const [browserMode, setBrowserMode] = useState("lyrics"); // "lyrics" | "youtube" | "spotify"
  const webViewRef = useRef(null);

  // Key pickers state
  const [keyPickerVisible, setKeyPickerVisible] = useState(false);
  const [scaleType, setScaleType] = useState("Major");

  // Custom cross-platform section rename modal states
  const [renameModalVisible, setRenameModalVisible] = useState(false);
  const [renameTarget, setRenameTarget] = useState({ index: null, sectionsList: null, setSectionsList: null, initialLabel: "" });
  const [newLabelText, setNewLabelText] = useState("");

  // Fetch AI Feature configuration from Firestore on mount
  const [enableAiDetection, setEnableAiDetection] = useState(true);

  useEffect(() => {
    const fetchFeatureConfig = async () => {
      if (USE_DEMO_MODE) {
        try {
          const stored = await AsyncStorage.getItem("@worship_team_enable_ai_detection");
          if (stored !== null) {
            setEnableAiDetection(stored === "true");
          } else {
            setEnableAiDetection(true);
          }
        } catch (err) {
          console.warn("Could not fetch feature config from AsyncStorage", err);
          setEnableAiDetection(true);
        }
        return;
      }
      try {
        if (db) {
          const docRef = doc(db, "config", "features");
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            const data = docSnap.data();
            if (data && data.enableAiDetection !== undefined) {
              setEnableAiDetection(!!data.enableAiDetection);
            }
          }
        }
      } catch (err) {
        console.warn("Could not fetch feature config", err);
      }
    };
    fetchFeatureConfig();
  }, []);

  // Artist & Tags dropdown suggestions
  const [artistDropdownVisible, setArtistDropdownVisible] = useState(false);
  const [tagsDropdownVisible, setTagsDropdownVisible] = useState(false);

  // Parse lyrics from bracketed format into structured sections
  const parseLyricsToSections = (rawText) => {
    if (!rawText || !rawText.trim()) {
      return [{ id: Math.random().toString(), sectionLabel: "Verse 1", lyrics: "" }];
    }
    const sections = [];
    const lines = rawText.split("\n");
    let currentLabel = "Verse 1";
    let currentLyrics = [];
    const hasHeaders = lines.some(line => /^\[.+\]$/.test(line.trim()));

    if (!hasHeaders) {
      return [{ id: Math.random().toString(), sectionLabel: "Verse 1", lyrics: rawText.trim() }];
    }

    lines.forEach((line) => {
      const trimmed = line.trim();
      if (/^\[.+\]$/.test(trimmed)) {
        if (currentLyrics.length > 0 || sections.length > 0) {
          sections.push({
            id: Math.random().toString(),
            sectionLabel: currentLabel,
            lyrics: currentLyrics.join("\n").trim()
          });
        }
        currentLabel = trimmed.slice(1, -1);
        currentLyrics = [];
      } else {
        currentLyrics.push(line);
      }
    });

    if (currentLyrics.length > 0 || sections.length === 0) {
      sections.push({
        id: Math.random().toString(),
        sectionLabel: currentLabel,
        lyrics: currentLyrics.join("\n").trim()
      });
    }
    return sections;
  };

  // Populate data on edit mode
  useEffect(() => {
    if (songToEdit) {
      setTitle(songToEdit.title || "");
      setArtist(songToEdit.artist || "");
      const loadedOriginalKey = songToEdit.originalKey || songToEdit.currentKey || "C Major";
      const loadedCurrentKey = songToEdit.currentKey || songToEdit.originalKey || "C Major";
      setOriginalKey(loadedOriginalKey);
      setCurrentKey(loadedCurrentKey);
      setScaleType(loadedCurrentKey.includes("Minor") ? "Minor" : "Major");
      setBpm(songToEdit.bpm ? songToEdit.bpm.toString() : "");
      setTimeSignature(songToEdit.timeSignature || "4/4");
      setYoutubeLink(songToEdit.youtubeLink || "");
      setSpotifyLink(songToEdit.spotifyLink || "");
      setTagsInput(songToEdit.tags ? songToEdit.tags.join(", ") : "");
      setCcli(songToEdit.ccli || "");
      setNotes(songToEdit.notes || "");

      // Parse structured sections
      setSectionsEnglish(parseLyricsToSections(songToEdit.lyricsEnglish || ""));
      setSectionsTamil(parseLyricsToSections(songToEdit.lyricsTamil || ""));
      if (songToEdit.chordChart) {
        setDetectedChords(songToEdit.chordChart);
      }
    }
  }, [songToEdit]);

  // Extract unique suggestion helpers
  const existingArtists = Array.from(new Set((songs || []).map(s => s.artist?.trim()).filter(Boolean))).sort();
  const filteredArtists = existingArtists.filter(a => {
    const query = artist.toLowerCase().trim();
    return query && a.toLowerCase().trim() !== query && a.toLowerCase().includes(query);
  });

  const existingTags = Array.from(new Set((songs || []).flatMap(s => s.tags || []).map(t => t.trim()).filter(Boolean))).sort();
  const lastTagQuery = (tagsInput.split(",").pop() || "").trim();
  const filteredTags = existingTags.filter(tag => {
    const query = lastTagQuery.toLowerCase().trim();
    if (!query || tag.toLowerCase().trim() === query) return false;
    const enteredTags = tagsInput.split(",").map(t => t.trim().toLowerCase());
    return !enteredTags.includes(tag.toLowerCase()) && tag.toLowerCase().includes(query);
  });

  // Reordering controls
  const moveSection = (list, setList, index, direction) => {
    const newList = [...list];
    if (direction === "up" && index > 0) {
      const temp = newList[index];
      newList[index] = newList[index - 1];
      newList[index - 1] = temp;
    } else if (direction === "down" && index < newList.length - 1) {
      const temp = newList[index];
      newList[index] = newList[index + 1];
      newList[index + 1] = temp;
    }
    setList(newList);
  };

  // Build structure pattern for UI
  const getStructurePattern = (sections) => {
    const parts = sections
      .map(sec => {
        const lbl = sec.sectionLabel.trim().toUpperCase();
        if (lbl.includes("VERSE 1") || lbl === "V1") return "V1";
        if (lbl.includes("VERSE 2") || lbl === "V2") return "V2";
        if (lbl.includes("VERSE 3") || lbl === "V3") return "V3";
        if (lbl.includes("VERSE")) return "V";
        if (lbl.includes("CHORUS")) return "C";
        if (lbl.includes("PRE-CHORUS") || lbl === "PC") return "PC";
        if (lbl.includes("BRIDGE") || lbl === "B") return "B";
        if (lbl.includes("INTRO") || lbl === "I") return "Intro";
        if (lbl.includes("OUTRO") || lbl === "O") return "Outro";
        return lbl.slice(0, 3);
      })
      .filter(Boolean);
    return parts.length > 0 ? parts.join(" → ") : "None";
  };

  // Smart Language Classifier Heuristics
  const autoDetectLanguageAndRoute = (text) => {
    if (!text || !text.trim()) return;

    const hasTamilUnicode = /[\u0B80-\u0BFF]/.test(text);
    const tamilKeywords = ["ஆண்டவர்", "இயேசு", "நேசிக்கிறேன்", "ஆராதனை"];
    const hasTamilKeywords = tamilKeywords.some(keyword => text.includes(keyword));

    if (hasTamilUnicode || hasTamilKeywords) {
      const lines = text.split("\n");
      let hasEnglish = false;
      let hasTamilLine = false;
      
      lines.forEach(line => {
        const trimmed = line.trim();
        if (!trimmed) return;
        const isTamil = /[\u0B80-\u0BFF]/.test(trimmed) || tamilKeywords.some(k => trimmed.includes(k));
        if (isTamil) {
          hasTamilLine = true;
        } else if (/[a-zA-Z]/.test(trimmed)) {
          hasEnglish = true;
        }
      });

      if (hasEnglish && hasTamilLine) {
        // Mixed text: split line by line
        const engLines = [];
        const tamLines = [];
        lines.forEach(line => {
          const trimmed = line.trim();
          if (!trimmed) {
            engLines.push("");
            tamLines.push("");
            return;
          }
          const isTamil = /[\u0B80-\u0BFF]/.test(trimmed) || tamilKeywords.some(k => trimmed.includes(k));
          if (isTamil) {
            tamLines.push(trimmed);
          } else {
            engLines.push(trimmed);
          }
        });
        const finalEng = engLines.join("\n").replace(/^\n+|\n+$/g, '').trim();
        const finalTam = tamLines.join("\n").replace(/^\n+|\n+$/g, '').trim();

        setDetectedTamilEnglishBadge("Mixed detected ✓");
        triggerAiOrganization(finalEng, "English", "mixed");
        triggerAiOrganization(finalTam, "Tamil", "mixed");
      } else {
        // Pure Tamil
        setDetectedTamilEnglishBadge("Tamil detected ✓");
        triggerAiOrganization(text, "Tamil", "tamil");
      }
    } else {
      // Pure English
      setDetectedTamilEnglishBadge("English detected ✓");
      triggerAiOrganization(text, "English", "english");
    }
  };

  // Trigger Claude API to structure lyrics
  const triggerAiOrganization = async (rawText, language, modeType) => {
    setIsAiOrganizing(true);
    try {
      const organized = await organizeLyricsWithAI(rawText, language);
      if (organized && organized.sections) {
        const mappedSecs = organized.sections.map(s => ({
          id: Math.random().toString(),
          sectionLabel: s.sectionLabel,
          lyrics: s.lyrics
        }));

        if (language === "Tamil") {
          setSectionsTamil(mappedSecs);
          if (modeType !== "mixed") setSectionsEnglish([{ id: "1", sectionLabel: "Verse 1", lyrics: "" }]);
        } else {
          setSectionsEnglish(mappedSecs);
          if (modeType !== "mixed") setSectionsTamil([{ id: "1", sectionLabel: "Verse 1", lyrics: "" }]);
        }
      }
    } catch (e) {
      Alert.alert("AI Organizer Error", "Failed to structure lyrics via Claude: " + e.message);
    } finally {
      setIsAiOrganizing(false);
    }
  };

  // Trigger Online Search browser Modal
  const handleOpenBrowser = () => {
    if (!title.trim() || !artist.trim()) {
      Alert.alert("Missing Fields", "Please enter both the Song Title and Artist to search online.");
      return;
    }
    setBrowserMode("lyrics");
    const query = encodeURIComponent(`${title.trim()} ${artist.trim()} lyrics`);
    setBrowserUrl(`https://www.google.com/search?q=${query}`);
    setSelectedText("");
    setBrowserVisible(true);
  };

  const handleSearchMediaManual = (mode) => {
    if (!title.trim() || !artist.trim()) {
      Alert.alert("Missing Fields", "Please enter both the Song Title and Artist first.");
      return;
    }
    setBrowserMode(mode);
    setSelectedText("");
    const query = encodeURIComponent(`${title.trim()} ${artist.trim()}`);
    if (mode === "youtube") {
      setBrowserUrl(`https://m.youtube.com/results?search_query=${query}`);
    } else {
      setBrowserUrl(`https://www.google.com/search?q=${query}+spotify+track`);
    }
    setBrowserVisible(true);
  };

  const handleImportBrowserText = () => {
    if (browserMode === "youtube") {
      setYoutubeLink(browserUrl);
      setBrowserVisible(false);
      Alert.alert("Success", "YouTube link imported successfully!");
      return;
    }
    if (browserMode === "spotify") {
      setSpotifyLink(browserUrl);
      setBrowserVisible(false);
      Alert.alert("Success", "Spotify link imported successfully!");
      return;
    }

    if (!selectedText || !selectedText.trim()) {
      Alert.alert("No Selection", "Please long press and highlight the song lyrics first, then tap Import.");
      return;
    }
    setBrowserVisible(false);
    autoDetectLanguageAndRoute(selectedText);
    Alert.alert("Success", "Lyrics imported and organized successfully!");
  };

  const handleWebViewMessage = (event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data && data.type === 'selection') {
        setSelectedText(data.text || "");
      }
    } catch (err) {
      console.warn("Error parsing WebView message:", err);
    }
  };

  const handleNavigationStateChange = (navState) => {
    setBrowserUrl(navState.url);
  };

  // Trigger Clipboard paste & import
  const handleImportFromClipboard = async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (!text || !text.trim()) {
        Alert.alert("Clipboard Empty", "No text found on your clipboard to paste.");
        return;
      }
      autoDetectLanguageAndRoute(text);
      Alert.alert("Success", "Clipboard lyrics imported and organized successfully!");
    } catch (err) {
      Alert.alert("Clipboard Error", "Could not access system clipboard: " + err.message);
    }
  };

  // Call Claude to detect Key & Chords
  const handleDetectKeyAndChords = async () => {
    if (!title.trim() || !artist.trim()) {
      Alert.alert("Missing Fields", "Please enter both the Song Title and Artist first.");
      return;
    }
    setIsAiDetecting(true);
    try {
      // Compile existing lyrics to help the AI map chords to the correct lines
      const lyricsEngStr = sectionsEnglish
        .map(sec => sec.lyrics.trim() ? `[${sec.sectionLabel.trim()}]\n${sec.lyrics.trim()}` : "")
        .filter(Boolean)
        .join("\n\n")
        .trim();

      const lyricsTamStr = sectionsTamil
        .map(sec => sec.lyrics.trim() ? `[${sec.sectionLabel.trim()}]\n${sec.lyrics.trim()}` : "")
        .filter(Boolean)
        .join("\n\n")
        .trim();

      const existingLyrics = lyricsEngStr || lyricsTamStr || "";
      const result = await detectKeyAndChordsWithAI(title.trim(), artist.trim(), existingLyrics);
      if (result) {
        setOriginalKey(result.originalKey || "C Major");
        setCurrentKey(result.originalKey || "C Major");
        setBpm(result.bpm ? result.bpm.toString() : "");
        setTimeSignature(result.timeSignature || "4/4");
        setConfidence(result.confidence || "low");
        setDetectedChords(result);

        // Mark as auto-filled
        setAutoFilledKey(true);
        setAutoFilledBpm(true);
        setAutoFilledTimeSignature(true);
      }
    } catch (e) {
      Alert.alert("AI Detector Error", "Failed to detect key and chords via Claude: " + e.message);
    } finally {
      setIsAiDetecting(false);
    }
  };

  // Call AI to detect YouTube & Spotify links
  const handleDetectMediaLinks = async () => {
    if (!title.trim() || !artist.trim()) {
      Alert.alert("Missing Fields", "Please enter both the Song Title and Artist first.");
      return;
    }
    setIsAiDetectingLinks(true);
    try {
      const result = await detectMediaLinksWithAI(title.trim(), artist.trim());
      if (result) {
        if (result.youtubeLink) {
          setYoutubeLink(result.youtubeLink);
        }
        if (result.spotifyLink) {
          setSpotifyLink(result.spotifyLink);
        }
        
        if (result.youtubeLink || result.spotifyLink) {
          Alert.alert("Links Detected", `Successfully auto-detected:${result.youtubeLink ? "\n✓ YouTube Link" : ""}${result.spotifyLink ? "\n✓ Spotify Link" : ""}`);
        } else {
          Alert.alert("Not Found", "Could not find any YouTube or Spotify links for this song.");
        }
      }
    } catch (e) {
      Alert.alert("AI Detector Error", "Failed to detect links: " + e.message);
    } finally {
      setIsAiDetectingLinks(false);
    }
  };

  // Smart merge chords to lyrics sections on Save
  const smartMergeChordsAndLyrics = (lyricsSections, chordChartData) => {
    if (!chordChartData) {
      return { sections: [] };
    }

    let detectedSections = null;
    if (chordChartData.sections) {
      detectedSections = chordChartData.sections;
    } else if (chordChartData.chordChart && chordChartData.chordChart.sections) {
      detectedSections = chordChartData.chordChart.sections;
    }

    if (!detectedSections) {
      return { sections: [] };
    }

    const mergedSections = [];
    const matchedLabels = new Set();

    lyricsSections.forEach(section => {
      const label = section.sectionLabel.trim();
      const matchedChordSection = detectedSections.find(
        s => s.sectionLabel.trim().toLowerCase() === label.toLowerCase()
      );

      if (matchedChordSection) {
        matchedLabels.add(matchedChordSection.sectionLabel.toLowerCase());
        const lyricLines = section.lyrics.split("\n");
        const chordLines = matchedChordSection.lines || [];
        const mergedLines = [];

        const maxLines = Math.max(lyricLines.length, chordLines.length);
        for (let i = 0; i < maxLines; i++) {
          const lyricLine = lyricLines[i] !== undefined ? lyricLines[i] : "";
          const chordInfo = chordLines[i];
          mergedLines.push({
            chords: chordInfo ? chordInfo.chords || "" : "",
            lyrics: lyricLine
          });
        }

        mergedSections.push({
          sectionLabel: label,
          lines: mergedLines
        });
      } else {
        const lyricLines = section.lyrics.split("\n");
        const mergedLines = lyricLines.map(line => ({
          chords: "",
          lyrics: line
        }));
        mergedSections.push({
          sectionLabel: label,
          lines: mergedLines
        });
      }
    });

    // Append unmatched chord sections with note
    detectedSections.forEach(chordSection => {
      if (!matchedLabels.has(chordSection.sectionLabel.toLowerCase())) {
        const originalLines = chordSection.lines || [];
        const linesWithNote = originalLines.map(line => ({
          chords: line.chords || "",
          lyrics: line.lyrics || ""
        }));
        if (linesWithNote.length > 0) {
          linesWithNote[0].lyrics = `${linesWithNote[0].lyrics} (Unmatched section — please place manually)`;
        } else {
          linesWithNote.push({
            chords: "",
            lyrics: "(Unmatched section — please place manually)"
          });
        }
        mergedSections.push({
          sectionLabel: chordSection.sectionLabel,
          lines: linesWithNote
        });
      }
    });

    return { sections: mergedSections };
  };

  // Compile fields to save
  const handleSubmit = () => {
    if (!isAllowedToSave) {
      Alert.alert("Permission Denied", "Your account role does not have authorization to save this song.");
      return;
    }
    if (!title.trim()) {
      Alert.alert("Required Field", "Please enter a Song Title.");
      return;
    }
    if (!artist.trim()) {
      Alert.alert("Required Field", "Please enter the Artist name.");
      return;
    }

    const tags = tagsInput
      ? tagsInput
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean)
      : [];

    // Serialize section lists back into single string blocks
    const lyricsEngStr = sectionsEnglish
      .map(sec => `[${sec.sectionLabel.trim()}]\n${sec.lyrics.trim()}`)
      .join("\n\n")
      .trim();

    const lyricsTamStr = sectionsTamil
      .map(sec => `[${sec.sectionLabel.trim()}]\n${sec.lyrics.trim()}`)
      .join("\n\n")
      .trim();

    // Smart Merge Chords
    let finalChordChart = { sections: [] };
    if (detectedChords) {
      const targetLyricsSecs = sectionsEnglish.some(s => s.lyrics.trim().length > 0)
        ? sectionsEnglish
        : sectionsTamil;
      finalChordChart = smartMergeChordsAndLyrics(targetLyricsSecs, detectedChords);
    }

    const songData = {
      title: title.trim(),
      artist: artist.trim(),
      originalKey: isEditMode ? originalKey.trim() : currentKey.trim(),
      currentKey: currentKey.trim(),
      bpm: bpm ? parseInt(bpm, 10) || 0 : 0,
      timeSignature: timeSignature.trim() || "4/4",
      lyricsEnglish: lyricsEngStr,
      lyricsTamil: lyricsTamStr,
      youtubeLink: youtubeLink.trim(),
      spotifyLink: spotifyLink.trim(),
      tags: tags,
      ccli: ccli.trim(),
      notes: notes.trim(),
      chordChart: finalChordChart
    };

    onSave(songData);
  };

  // Render Section lists
  const renderSectionCard = (section, index, lang, sectionsList, setSectionsList) => {
    const handleRename = () => {
      setRenameTarget({
        index: index,
        sectionsList: sectionsList,
        setSectionsList: setSectionsList,
        initialLabel: section.sectionLabel
      });
      setNewLabelText(section.sectionLabel);
      setRenameModalVisible(true);
    };

    const handleTextChange = (text) => {
      const newList = [...sectionsList];
      newList[index].lyrics = text;
      setSectionsList(newList);
    };

    const handleDelete = () => {
      const newList = sectionsList.filter((_, i) => i !== index);
      setSectionsList(newList);
    };

    return (
      <View key={section.id || index} style={styles.sectionCard}>
        {/* Left Drag handles */}
        <View style={styles.dragHandlesContainer}>
          <TouchableOpacity 
            style={styles.arrowBtn} 
            onPress={() => moveSection(sectionsList, setSectionsList, index, "up")}
            disabled={index === 0}
          >
            <Text style={[styles.arrowText, index === 0 && styles.disabledText]}>▲</Text>
          </TouchableOpacity>
          <Text style={styles.dragHandleText}>≡</Text>
          <TouchableOpacity 
            style={styles.arrowBtn} 
            onPress={() => moveSection(sectionsList, setSectionsList, index, "down")}
            disabled={index === sectionsList.length - 1}
          >
            <Text style={[styles.arrowText, index === sectionsList.length - 1 && styles.disabledText]}>▼</Text>
          </TouchableOpacity>
        </View>

        {/* Center input */}
        <View style={styles.sectionCardCenter}>
          <TouchableOpacity onPress={handleRename} style={styles.labelButton}>
            <Text style={styles.sectionCardLabel}>{section.sectionLabel} ✏️</Text>
          </TouchableOpacity>
          <TextInput
            style={styles.sectionLyricsInput}
            multiline={true}
            placeholder={`Enter lyrics for ${section.sectionLabel}...`}
            placeholderTextColor="#64748B"
            value={section.lyrics}
            onChangeText={handleTextChange}
            textAlignVertical="top"
          />
        </View>
        
        {/* Right delete option */}
        <TouchableOpacity onPress={handleDelete} style={styles.cardDeleteIconBtn}>
          <Text style={{ fontSize: 16 }}>🗑️</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const addBlankSection = (sectionsList, setSectionsList) => {
    const nextIdx = sectionsList.length + 1;
    const newList = [...sectionsList, {
      id: Math.random().toString(),
      sectionLabel: `Verse ${nextIdx}`,
      lyrics: ""
    }];
    setSectionsList(newList);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.container}
    >
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.cancelButton} onPress={onCancel} activeOpacity={0.7}>
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {isEditMode ? "Edit Song Details" : "Add New Song"}
        </Text>
        <TouchableOpacity
          style={[
            styles.saveButton,
            { backgroundColor: isAllowedToSave ? themeColor : "#334155" },
          ]}
          onPress={handleSubmit}
          disabled={!isAllowedToSave}
          activeOpacity={0.8}
        >
          <Text style={styles.saveButtonText}>Save</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {!isAllowedToSave && (
          <View style={styles.readOnlyBanner}>
            <Text style={styles.readOnlyText}>
              🛡️ Read-Only Mode: Your role ({user?.role?.replace("_", " ")}) does not have permission to modify song records.
            </Text>
          </View>
        )}

        {/* 1. Song Title & Artist Fields */}
        <View style={styles.formGroup}>
          <Text style={styles.label}>Song Title *</Text>
          <TextInput
            style={[styles.input, (!isAllowedToSave || isLyricsOnly) && styles.disabledInput]}
            placeholder="e.g. Amazing Grace"
            placeholderTextColor="#64748B"
            value={title}
            onChangeText={setTitle}
            editable={isAllowedToSave && !isLyricsOnly}
          />
        </View>

        <View style={[styles.formGroup, { zIndex: 10 }]}>
          <Text style={styles.label}>Artist / Ministry *</Text>
          <TextInput
            style={[styles.input, (!isAllowedToSave || isLyricsOnly) && styles.disabledInput]}
            placeholder="e.g. Chris Tomlin, Hillsong"
            placeholderTextColor="#64748B"
            value={artist}
            onChangeText={(text) => {
              setArtist(text);
              setArtistDropdownVisible(true);
            }}
            onFocus={() => {
              if (!isLyricsOnly) setArtistDropdownVisible(true);
            }}
            onBlur={() => {
              setTimeout(() => setArtistDropdownVisible(false), 250);
            }}
            editable={isAllowedToSave && !isLyricsOnly}
          />
          {artistDropdownVisible && isAllowedToSave && !isLyricsOnly && filteredArtists.length > 0 && (
            <View style={styles.artistSuggestionsContainer}>
              <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled={true}>
                {filteredArtists.map((item, idx) => (
                  <TouchableOpacity
                    key={idx}
                    style={styles.suggestionItem}
                    onPress={() => {
                      setArtist(item);
                      setArtistDropdownVisible(false);
                    }}
                  >
                    <Text style={styles.suggestionText}>{item}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}
        </View>

        {/* 2. Smart Import Actions (Worship Leader & Musician Only) */}
        {showSmartImport && isAllowedToSave && (
          <View style={styles.smartImportBox}>
            <Text style={styles.smartImportTitle}>⚡ Smart Lyrics & Chords Import</Text>
            <View style={styles.smartButtonsRow}>
              <TouchableOpacity style={[styles.smartBtn, { borderColor: themeColor }]} onPress={handleOpenBrowser}>
                <Text style={[styles.smartBtnText, { color: themeColor }]}>🔍 Search Online</Text>
              </TouchableOpacity>
              
              <TouchableOpacity style={[styles.smartBtn, { borderColor: themeColor }]} onPress={handleImportFromClipboard}>
                <Text style={[styles.smartBtnText, { color: themeColor }]}>📋 Paste Clipboard</Text>
              </TouchableOpacity>
            </View>
            
            {enableAiDetection && (
              <View style={{ flexDirection: "row", marginTop: 4 }}>
                <TouchableOpacity style={[styles.smartDetectBtn, { backgroundColor: themeColor, flex: 1, marginHorizontal: 2 }]} onPress={handleDetectKeyAndChords}>
                  <Text style={styles.smartDetectBtnText}>🤖 Auto-detect Chords</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.smartDetectBtn, { backgroundColor: themeColor, flex: 1, marginHorizontal: 2 }]} onPress={handleDetectMediaLinks}>
                  <Text style={styles.smartDetectBtnText}>🔗 Auto-detect Links</Text>
                </TouchableOpacity>
              </View>
            )}

            {confidence && (
              <View style={styles.badgeRow}>
                {confidence === "high" && (
                  <View style={[styles.badge, styles.badgeSuccess]}>
                    <Text style={styles.badgeText}>AI detected — High confidence ✓</Text>
                  </View>
                )}
                {confidence === "low" && (
                  <View style={[styles.badge, styles.badgeWarning]}>
                    <Text style={styles.badgeText}>AI detected — Low confidence ⚠️ Please verify before saving</Text>
                  </View>
                )}
                {confidence === "unknown" && (
                  <View style={[styles.badge, styles.badgeUnknown]}>
                    <Text style={styles.badgeText}>Song not found — please enter manually</Text>
                  </View>
                )}
              </View>
            )}
          </View>
        )}

        {/* 3. Original Key, BPM, and Time Signature Fields */}
        <View style={styles.row}>
          <View style={[styles.formGroup, { flex: 1.2, marginRight: 8 }]}>
            <Text style={styles.label}>Original Key</Text>
            <TouchableOpacity
              style={[
                styles.input,
                styles.keyDropdownTrigger,
                (!isAllowedToSave || isLyricsOnly) && styles.disabledInput,
              ]}
              onPress={() => isAllowedToSave && !isLyricsOnly && setKeyPickerVisible(true)}
              disabled={!isAllowedToSave || isLyricsOnly}
              activeOpacity={0.7}
            >
              <Text style={styles.keyDropdownText} numberOfLines={1}>
                {originalKey || "Select..."}
              </Text>
              {isAllowedToSave && !isLyricsOnly && (
                <Text style={[styles.dropdownChevron, { color: themeColor }]}>▼</Text>
              )}
            </TouchableOpacity>
            {autoFilledKey && (
              <Text style={styles.autoFilledLabel}>Auto-filled — tap to edit</Text>
            )}
          </View>

          <View style={[styles.formGroup, { flex: 0.9, marginRight: 8 }]}>
            <Text style={styles.label}>BPM (Tempo)</Text>
            <TextInput
              style={[styles.input, (!isAllowedToSave || isLyricsOnly) && styles.disabledInput]}
              placeholder="e.g. 78"
              placeholderTextColor="#64748B"
              value={bpm}
              onChangeText={(text) => {
                setBpm(text);
                setAutoFilledBpm(false);
              }}
              editable={isAllowedToSave && !isLyricsOnly}
              keyboardType="numeric"
            />
            {autoFilledBpm && (
              <Text style={styles.autoFilledLabel}>Auto-filled — tap to edit</Text>
            )}
          </View>

          <View style={[styles.formGroup, { flex: 0.9 }]}>
            <Text style={styles.label}>Time Sig</Text>
            <TextInput
              style={[styles.input, (!isAllowedToSave || isLyricsOnly) && styles.disabledInput]}
              placeholder="4/4"
              placeholderTextColor="#64748B"
              value={timeSignature}
              onChangeText={(text) => {
                setTimeSignature(text);
                setAutoFilledTimeSignature(false);
              }}
              editable={isAllowedToSave && !isLyricsOnly}
            />
            {autoFilledTimeSignature && (
              <Text style={styles.autoFilledLabel}>Auto-filled — tap to edit</Text>
            )}
          </View>
        </View>

        {/* 4. English Lyrics structured Section */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>English Lyrics</Text>
          {detectedTamilEnglishBadge.includes("English") && (
            <Text style={styles.detectedBadge}>English detected ✓</Text>
          )}
          {detectedTamilEnglishBadge.includes("Mixed") && (
            <Text style={styles.detectedBadge}>Mixed detected ✓</Text>
          )}
        </View>
        <View style={styles.sectionsListCard}>
          {sectionsEnglish.map((sec, idx) =>
            renderSectionCard(sec, idx, "english", sectionsEnglish, setSectionsEnglish)
          )}
          <TouchableOpacity
            style={styles.addSectionBtn}
            onPress={() => addBlankSection(sectionsEnglish, setSectionsEnglish)}
            activeOpacity={0.7}
          >
            <Text style={[styles.addSectionBtnText, { color: themeColor }]}>+ Add English Section</Text>
          </TouchableOpacity>
        </View>

        {/* 5. Tamil Lyrics structured Section */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Tamil Lyrics</Text>
          {detectedTamilEnglishBadge.includes("Tamil") && (
            <Text style={styles.detectedBadge}>Tamil detected ✓</Text>
          )}
          {detectedTamilEnglishBadge.includes("Mixed") && (
            <Text style={styles.detectedBadge}>Mixed detected ✓</Text>
          )}
        </View>
        <View style={styles.sectionsListCard}>
          {sectionsTamil.map((sec, idx) =>
            renderSectionCard(sec, idx, "tamil", sectionsTamil, setSectionsTamil)
          )}
          <TouchableOpacity
            style={styles.addSectionBtn}
            onPress={() => addBlankSection(sectionsTamil, setSectionsTamil)}
            activeOpacity={0.7}
          >
            <Text style={[styles.addSectionBtnText, { color: themeColor }]}>+ Add Tamil Section</Text>
          </TouchableOpacity>
        </View>

        {/* 6. Real-Time Structure Pattern display */}
        <View style={styles.patternBox}>
          <Text style={styles.patternTitle}>🎼 Song Structure Pattern</Text>
          <Text style={styles.patternText}>
            English: {getStructurePattern(sectionsEnglish)}
          </Text>
          <Text style={styles.patternText}>
            Tamil: {getStructurePattern(sectionsTamil)}
          </Text>
        </View>

        {/* 7. YouTube & Spotify Multimedia Links */}
        <View style={styles.formGroup}>
          <Text style={styles.label}>YouTube Video Link</Text>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <TextInput
              style={[styles.input, { flex: 1 }, (!isAllowedToSave || isLyricsOnly) && styles.disabledInput]}
              placeholder="https://youtube.com/..."
              placeholderTextColor="#64748B"
              value={youtubeLink}
              onChangeText={setYoutubeLink}
              editable={isAllowedToSave && !isLyricsOnly}
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {isAllowedToSave && !isLyricsOnly && (
              <TouchableOpacity
                style={[styles.inlineSearchBtn, { backgroundColor: themeColor }]}
                onPress={() => handleSearchMediaManual("youtube")}
              >
                <Text style={styles.inlineSearchBtnText}>🔍 Search</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.label}>Spotify Track Link</Text>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <TextInput
              style={[styles.input, { flex: 1 }, (!isAllowedToSave || isLyricsOnly) && styles.disabledInput]}
              placeholder="https://open.spotify.com/..."
              placeholderTextColor="#64748B"
              value={spotifyLink}
              onChangeText={setSpotifyLink}
              editable={isAllowedToSave && !isLyricsOnly}
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {isAllowedToSave && !isLyricsOnly && (
              <TouchableOpacity
                style={[styles.inlineSearchBtn, { backgroundColor: themeColor }]}
                onPress={() => handleSearchMediaManual("spotify")}
              >
                <Text style={styles.inlineSearchBtnText}>🔍 Search</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* 8. Tags input suggestion fields */}
        <View style={[styles.formGroup, { zIndex: 9 }]}>
          <Text style={styles.label}>Tags (Comma-separated)</Text>
          <TextInput
            style={[styles.input, (!isAllowedToSave || isLyricsOnly) && styles.disabledInput]}
            placeholder="e.g. Praise, Slow, Worship"
            placeholderTextColor="#64748B"
            value={tagsInput}
            onChangeText={(text) => {
              setTagsInput(text);
              setTagsDropdownVisible(true);
            }}
            onFocus={() => {
              if (!isLyricsOnly) setTagsDropdownVisible(true);
            }}
            onBlur={() => {
              setTimeout(() => setTagsDropdownVisible(false), 250);
            }}
            editable={isAllowedToSave && !isLyricsOnly}
          />
          {tagsDropdownVisible && isAllowedToSave && !isLyricsOnly && filteredTags.length > 0 && (
            <View style={styles.tagsSuggestionsContainer}>
              <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled={true}>
                {filteredTags.map((item, idx) => (
                  <TouchableOpacity
                    key={idx}
                    style={styles.suggestionItem}
                    onPress={() => {
                      const parts = tagsInput.split(",");
                      parts.pop();
                      parts.push(item);
                      setTagsInput(parts.join(", ").trim() + ", ");
                      setTagsDropdownVisible(false);
                    }}
                  >
                    <Text style={styles.suggestionText}>{item}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}
        </View>

        {/* 9. CCLI, Rehearsal Notes */}
        <View style={styles.formGroup}>
          <Text style={styles.label}>CCLI Number</Text>
          <TextInput
            style={[styles.input, (!isAllowedToSave || isLyricsOnly) && styles.disabledInput]}
            placeholder="e.g. 7112345"
            placeholderTextColor="#64748B"
            value={ccli}
            onChangeText={setCcli}
            editable={isAllowedToSave && !isLyricsOnly}
            keyboardType="numeric"
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.label}>Rehearsal & Performance Notes</Text>
          <TextInput
            style={[styles.input, styles.textArea, (!isAllowedToSave || isLyricsOnly) && styles.disabledInput]}
            placeholder="e.g. Bass guitar starts on verse 2."
            placeholderTextColor="#64748B"
            value={notes}
            onChangeText={setNotes}
            multiline={true}
            numberOfLines={4}
            editable={isAllowedToSave && !isLyricsOnly}
            textAlignVertical="top"
          />
        </View>

        {/* Bottom Save Song Button */}
        {isAllowedToSave && (
          <TouchableOpacity
            style={[styles.saveSongButton, { backgroundColor: themeColor }]}
            onPress={handleSubmit}
            activeOpacity={0.8}
          >
            <Text style={styles.saveSongButtonText}>Save Song</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* RENAME SECTION MODAL */}
      <Modal
        visible={renameModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setRenameModalVisible(false)}
      >
        <TouchableOpacity 
          style={styles.modalOverlay} 
          activeOpacity={1} 
          onPress={() => setRenameModalVisible(false)}
        >
          <TouchableOpacity 
            style={[styles.modalContent, { maxHeight: "70%", paddingBottom: 24 }]} 
            activeOpacity={1}
          >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Rename Song Section</Text>
              <TouchableOpacity style={styles.modalCloseButton} onPress={() => setRenameModalVisible(false)}>
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <TextInput
              style={[styles.input, { color: "#FFFFFF", backgroundColor: "#1E293B", paddingVertical: 12, marginBottom: 14 }]}
              placeholder="Enter custom section name (e.g. Verse 3)"
              placeholderTextColor="#64748B"
              value={newLabelText}
              onChangeText={setNewLabelText}
            />

            <Text style={{ color: "#94A3B8", fontSize: 12, fontWeight: "700", marginBottom: 8 }}>Quick Presets:</Text>
            
            <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 20 }}>
              {["Verse 1", "Verse 2", "Verse 3", "Verse 4", "Verse 5", "Chorus", "Chorus 2", "Bridge", "Intro", "Outro", "Pre-Chorus"].map((preset) => (
                <TouchableOpacity
                  key={preset}
                  style={{
                    backgroundColor: "#1E293B",
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 8,
                    marginRight: 8,
                    marginBottom: 8,
                    borderWidth: 1,
                    borderColor: newLabelText === preset ? themeColor : "#334155"
                  }}
                  onPress={() => setNewLabelText(preset)}
                >
                  <Text style={{ color: newLabelText === preset ? themeColor : "#E2E8F0", fontSize: 12, fontWeight: "600" }}>{preset}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <TouchableOpacity
                style={{
                  flex: 1,
                  backgroundColor: "#334155",
                  paddingVertical: 12,
                  borderRadius: 10,
                  alignItems: "center",
                  marginRight: 8
                }}
                onPress={() => setRenameModalVisible(false)}
              >
                <Text style={{ color: "#E2E8F0", fontWeight: "700" }}>Cancel</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={{
                  flex: 1,
                  backgroundColor: themeColor,
                  paddingVertical: 12,
                  borderRadius: 10,
                  alignItems: "center"
                }}
                onPress={() => {
                  const trimmed = newLabelText.trim();
                  if (trimmed && renameTarget.index !== null) {
                    const newList = [...renameTarget.sectionsList];
                    newList[renameTarget.index].sectionLabel = trimmed;
                    renameTarget.setSectionsList(newList);
                  }
                  setRenameModalVisible(false);
                }}
              >
                <Text style={{ color: "#FFFFFF", fontWeight: "700" }}>Rename</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* KEY PICKER MODAL */}
      <Modal
        visible={keyPickerVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setKeyPickerVisible(false)}
      >
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setKeyPickerVisible(false)}>
          <TouchableOpacity style={styles.modalContent} activeOpacity={1}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {isEditMode ? "Change Key To" : "Select Original Key"}
              </Text>
              <TouchableOpacity style={styles.modalCloseButton} onPress={() => setKeyPickerVisible(false)}>
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.scaleTabsContainer}>
              <TouchableOpacity
                style={[scaleType === "Major" && [styles.activeScaleTab, { backgroundColor: themeColor }], styles.scaleTab]}
                onPress={() => setScaleType("Major")}
              >
                <Text style={[styles.scaleTabText, scaleType === "Major" && styles.activeScaleTabText]}>Major Keys</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[scaleType === "Minor" && [styles.activeScaleTab, { backgroundColor: themeColor }], styles.scaleTab]}
                onPress={() => setScaleType("Minor")}
              >
                <Text style={[styles.scaleTabText, scaleType === "Minor" && styles.activeScaleTabText]}>Minor Keys</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.keysGridContainer}>
              {["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"].map((note) => {
                const fullKeyName = `${note} ${scaleType}`;
                const isActive = isEditMode ? currentKey === fullKeyName : originalKey === fullKeyName;
                return (
                  <TouchableOpacity
                    key={note}
                    style={[styles.keyGridTile, isActive && [styles.activeKeyGridTile, { borderColor: themeColor }]]}
                    onPress={() => {
                      if (isEditMode) {
                        setCurrentKey(fullKeyName);
                      } else {
                        setOriginalKey(fullKeyName);
                        setCurrentKey(fullKeyName);
                      }
                      setAutoFilledKey(false);
                      setKeyPickerVisible(false);
                    }}
                  >
                    <Text style={[styles.keyGridTileText, isActive && { color: themeColor, fontWeight: "900" }]}>{note}</Text>
                    <Text style={styles.keyGridTileSubtext}>{scaleType.toLowerCase()}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* ONLINE BROWSER MODAL */}
      <Modal
        visible={browserVisible}
        animationType="slide"
        onRequestClose={() => setBrowserVisible(false)}
      >
        <View style={styles.browserContainer}>
          {/* Top Bar */}
          <View style={styles.browserHeader}>
            <TouchableOpacity style={styles.browserBackBtn} onPress={() => setBrowserVisible(false)}>
              <Text style={styles.browserBackBtnText}>←</Text>
            </TouchableOpacity>
            <View style={styles.browserUrlBox}>
              <Text style={styles.browserUrlText} numberOfLines={1}>{browserUrl}</Text>
            </View>
            <TouchableOpacity style={styles.browserImportBtn} onPress={handleImportBrowserText}>
              <Text style={styles.browserImportBtnText}>
                {browserMode === "lyrics" ? "Select & Import" : "Use Current Link"}
              </Text>
            </TouchableOpacity>
          </View>

          {/* WebView */}
          <WebView
            ref={webViewRef}
            source={{ uri: browserUrl }}
            injectedJavaScript={`
              (function() {
                document.addEventListener('selectionchange', function() {
                  var selection = window.getSelection().toString();
                  window.ReactNativeWebView.postMessage(JSON.stringify({
                    type: 'selection',
                    text: selection
                  }));
                });
              })();
              true;
            `}
            onMessage={handleWebViewMessage}
            onNavigationStateChange={handleNavigationStateChange}
            style={{ flex: 1 }}
          />

          {/* Floating Import Button */}
          {selectedText.trim().length > 0 && (
            <TouchableOpacity style={styles.floatingImportBtn} onPress={handleImportBrowserText}>
              <Text style={styles.floatingImportBtnText}>📋 Import Selected Text</Text>
            </TouchableOpacity>
          )}

          {/* Bottom Hint Bar */}
          <View style={styles.browserHintBar}>
            <Text style={styles.browserHintText}>
              Long press any text on this page to select it, then tap Import
            </Text>
          </View>
        </View>
      </Modal>

      {/* AI PROCESSING OVERLAYS */}
      {(isAiOrganizing || isAiDetecting || isAiDetectingLinks) && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={themeColor} />
          <Text style={styles.loadingText}>
            {isAiOrganizing 
              ? "AI is organizing your lyrics..." 
              : isAiDetecting 
                ? "AI is detecting key and chords..." 
                : "AI is fetching YouTube and Spotify links..."}
          </Text>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

// Handlers removed - moved inside component scope

const styles = StyleSheet.create({
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
  cancelButton: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  cancelButtonText: {
    color: "#64748B",
    fontSize: 15,
    fontWeight: "700",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  saveButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  saveButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 60,
  },
  readOnlyBanner: {
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.3)",
    borderRadius: 12,
    padding: 12,
    marginBottom: 20,
  },
  readOnlyText: {
    color: "#F87171",
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
  },
  formGroup: {
    marginBottom: 20,
  },
  label: {
    color: "#94A3B8",
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 8,
  },
  input: {
    backgroundColor: "#1E293B",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#334155",
    color: "#FFFFFF",
    paddingHorizontal: 16,
    height: 48,
    fontSize: 15,
  },
  textArea: {
    height: 120,
    paddingTop: 12,
    paddingBottom: 12,
  },
  disabledInput: {
    backgroundColor: "#111827",
    color: "#64748B",
    borderColor: "#1E293B",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  keyDropdownTrigger: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  keyDropdownText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  dropdownChevron: {
    fontSize: 11,
    marginLeft: 6,
  },
  autoFilledLabel: {
    color: "#64748B",
    fontSize: 10,
    fontWeight: "500",
    marginTop: 4,
    marginLeft: 4,
  },
  
  // Smart Import Styling
  smartImportBox: {
    backgroundColor: "rgba(30, 41, 59, 0.4)",
    borderColor: "#334155",
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
  },
  smartImportTitle: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
    marginBottom: 12,
  },
  smartButtonsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  smartBtn: {
    flex: 1,
    height: 40,
    borderWidth: 1,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    marginHorizontal: 4,
    backgroundColor: "rgba(255, 255, 255, 0.02)",
  },
  smartBtnText: {
    fontSize: 12,
    fontWeight: "700",
  },
  smartDetectBtn: {
    height: 42,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    marginHorizontal: 4,
    marginTop: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  smartDetectBtnText: {
    color: "#0B0F19",
    fontSize: 13,
    fontWeight: "800",
  },
  badgeRow: {
    flexDirection: "row",
    marginTop: 12,
    justifyContent: "center",
  },
  badge: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  badgeSuccess: {
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    borderColor: "rgba(16, 185, 129, 0.3)",
  },
  badgeWarning: {
    backgroundColor: "rgba(245, 158, 11, 0.15)",
    borderColor: "rgba(245, 158, 11, 0.3)",
  },
  badgeUnknown: {
    backgroundColor: "rgba(100, 116, 139, 0.15)",
    borderColor: "rgba(100, 116, 139, 0.3)",
  },
  badgeText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
    textAlign: "center",
  },

  // Structured Section manager styles
  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
    marginTop: 10,
  },
  sectionTitle: {
    color: "#94A3B8",
    fontSize: 13,
    fontWeight: "700",
  },
  detectedBadge: {
    color: "#10B981",
    fontSize: 11,
    fontWeight: "700",
  },
  sectionsListCard: {
    backgroundColor: "#111827",
    borderColor: "#1E293B",
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    marginBottom: 20,
  },
  sectionCard: {
    backgroundColor: "#1E293B",
    borderColor: "#334155",
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  dragHandlesContainer: {
    width: 30,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 6,
  },
  dragHandleText: {
    color: "#64748B",
    fontSize: 18,
    fontWeight: "bold",
    marginVertical: 2,
  },
  arrowBtn: {
    padding: 2,
  },
  arrowText: {
    color: "#94A3B8",
    fontSize: 11,
  },
  disabledText: {
    color: "#334155",
  },
  sectionCardCenter: {
    flex: 1,
  },
  labelButton: {
    paddingVertical: 2,
    alignSelf: "flex-start",
  },
  sectionCardLabel: {
    color: "#F59E0B",
    fontWeight: "900",
    fontSize: 13,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  sectionLyricsInput: {
    backgroundColor: "#0B0F19",
    color: "#FFFFFF",
    borderColor: "#1E293B",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 13,
    minHeight: 60,
  },
  cardDeleteIconBtn: {
    paddingHorizontal: 8,
    paddingVertical: 12,
  },
  addSectionBtn: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 10,
    borderColor: "#334155",
    height: 38,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 4,
    backgroundColor: "rgba(255, 255, 255, 0.01)",
  },
  addSectionBtnText: {
    fontSize: 12,
    fontWeight: "700",
  },

  // Pattern display Box
  patternBox: {
    backgroundColor: "#1E293B",
    borderColor: "#334155",
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 20,
  },
  patternTitle: {
    color: "#94A3B8",
    fontSize: 12,
    fontWeight: "800",
    marginBottom: 6,
  },
  patternText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
    marginVertical: 2,
  },

  // Save Song Button
  saveSongButton: {
    height: 48,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 5,
  },
  saveSongButtonText: {
    color: "#0B0F19",
    fontSize: 16,
    fontWeight: "800",
  },

  // Modal styling
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(3, 7, 18, 0.75)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: "#1E293B",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 48,
    borderWidth: 1,
    borderColor: "#334155",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  modalCloseButton: {
    backgroundColor: "#334155",
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  modalCloseText: {
    color: "#94A3B8",
    fontSize: 12,
    fontWeight: "bold",
  },
  scaleTabsContainer: {
    flexDirection: "row",
    backgroundColor: "#0B0F19",
    borderRadius: 12,
    padding: 4,
    marginBottom: 20,
  },
  scaleTab: {
    flex: 1,
    paddingVertical: 10,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 8,
  },
  activeScaleTab: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  scaleTabText: {
    color: "#64748B",
    fontSize: 13,
    fontWeight: "700",
  },
  activeScaleTabText: {
    color: "#FFFFFF",
  },
  keysGridContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  keyGridTile: {
    width: "30.5%",
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#1E293B",
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  activeKeyGridTile: {
    borderWidth: 2,
    backgroundColor: "rgba(255, 255, 255, 0.02)",
  },
  keyGridTileText: {
    color: "#E2E8F0",
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 2,
  },
  keyGridTileSubtext: {
    color: "#475569",
    fontSize: 8,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  // Browser Screen Styling
  browserContainer: {
    flex: 1,
    backgroundColor: "#0B0F19",
  },
  browserHeader: {
    flexDirection: "row",
    alignItems: "center",
    height: 56,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderColor: "#1E293B",
    backgroundColor: "#111827",
  },
  browserBackBtn: {
    width: 36,
    height: 36,
    justifyContent: "center",
    alignItems: "center",
  },
  browserBackBtnText: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "bold",
  },
  browserUrlBox: {
    flex: 1,
    marginHorizontal: 8,
    paddingHorizontal: 10,
    height: 36,
    justifyContent: "center",
    backgroundColor: "#0B0F19",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#1E293B",
  },
  browserUrlText: {
    color: "#64748B",
    fontSize: 12,
  },
  browserImportBtn: {
    backgroundColor: "#EF4444",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  browserImportBtnText: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 11,
  },
  floatingImportBtn: {
    position: "absolute",
    bottom: 60,
    alignSelf: "center",
    backgroundColor: "#10B981",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 25,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 6,
  },
  floatingImportBtnText: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 13,
  },
  browserHintBar: {
    height: 36,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#1E293B",
    borderTopWidth: 1,
    borderColor: "#334155",
  },
  browserHintText: {
    color: "#94A3B8",
    fontSize: 11,
    fontWeight: "600",
  },

  // Suggestions panel helpers
  artistSuggestionsContainer: {
    position: "absolute",
    top: 76,
    left: 0,
    right: 0,
    backgroundColor: "#1E293B",
    borderColor: "#334155",
    borderWidth: 1,
    borderRadius: 12,
    maxHeight: 180,
    zIndex: 999,
  },
  suggestionItem: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#334155",
  },
  suggestionText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "600",
  },
  tagsSuggestionsContainer: {
    position: "absolute",
    top: 76,
    left: 0,
    right: 0,
    backgroundColor: "#1E293B",
    borderColor: "#334155",
    borderWidth: 1,
    borderRadius: 12,
    maxHeight: 180,
    zIndex: 999,
  },

  // Loading overlay
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(3, 7, 18, 0.8)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 9999,
  },
  loadingText: {
    color: "#FFFFFF",
    marginTop: 12,
    fontWeight: "800",
    fontSize: 14,
  },
  inlineSearchBtn: {
    height: 48,
    paddingHorizontal: 16,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 8,
  },
  inlineSearchBtnText: {
    color: "#0B0F19",
    fontWeight: "800",
    fontSize: 13,
  },
});
