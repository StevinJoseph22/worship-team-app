import React, { useState, useEffect, useRef } from "react";
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Modal,
  Dimensions,
  Animated,
  Alert,
  ActivityIndicator,
  LogBox,
} from "react-native";
import { Audio } from "expo-av";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { USE_DEMO_MODE, db } from "../firebaseConfig";
import { doc, updateDoc } from "firebase/firestore";

// Suppress the SDK 54 deprecation warning for clean development logs
LogBox.ignoreLogs(["[expo-av]", "Expo AV has been deprecated"]);

const { width, height } = Dimensions.get("window");

// One ultra-reliable, crisp mechanical click sound asset that supports raw hotlinking
const TICK_SOUND_URL = "https://raw.githubusercontent.com/zarocknz/javascript-winwheel/master/examples/wheel_of_fortune/tick.mp3";

export default function MetronomeScreen({
  visible,
  onClose,
  initialBpm,
  song,
  user,
  onUpdateSong,
}) {
  const [bpm, setBpm] = useState(initialBpm || 100);
  const [timeSignature, setTimeSignature] = useState("4/4");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentBeat, setCurrentBeat] = useState(1);
  const [tapTimes, setTapTimes] = useState([]);
  const [isSaving, setIsSaving] = useState(false);

  // Audio refs
  const highSoundRef = useRef(null);
  const lowSoundRef = useRef(null);
  const soundsLoaded = useRef(false);

  // Timer loop refs
  const timerRef = useRef(null);

  // Visual Animation Refs
  const flashAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Determine user permissions
  const canSaveBpm =
    song &&
    user &&
    ["worship_leader", "musician", "super_admin"].includes(user.role);

  // Theme configuration based on roles
  const getRoleTheme = (userRole) => {
    switch (userRole) {
      case "super_admin":
        return { primary: "#EF4444", accent: "rgba(239, 68, 68, 0.15)" };
      case "worship_leader":
        return { primary: "#F59E0B", accent: "rgba(245, 158, 11, 0.15)" };
      case "musician":
        return { primary: "#A855F7", accent: "rgba(168, 85, 247, 0.15)" };
      case "choir_member":
        return { primary: "#0D9488", accent: "rgba(13, 148, 136, 0.15)" };
      default:
        return { primary: "#3B82F6", accent: "rgba(59, 130, 246, 0.15)" };
    }
  };

  const theme = getRoleTheme(user?.role);

  // Set BPM when modal changes song context
  useEffect(() => {
    if (initialBpm) {
      setBpm(initialBpm);
    }
    if (song?.timeSignature) {
      setTimeSignature(song.timeSignature);
    }
  }, [initialBpm, song]);

  // Audio Initialization
  useEffect(() => {
    async function loadAudio() {
      try {
        // Configure audio for high-precision metronome ticks (silent mode override)
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          staysActiveInBackground: false,
          shouldRouteThroughEarpieceAndroid: false,
        });

        // Load high downbeat sound (High Pitch, High Volume)
        const { sound: highSound } = await Audio.Sound.createAsync(
          { uri: TICK_SOUND_URL },
          {
            shouldPlay: false,
            volume: 1.0,
            rate: 1.45,
            shouldCorrectPitch: false, // Disabling pitch correction creates a higher woodblock sound
          }
        );
        highSoundRef.current = highSound;

        // Load low regular beat sound (Lower Pitch, Lower Volume)
        const { sound: lowSound } = await Audio.Sound.createAsync(
          { uri: TICK_SOUND_URL },
          {
            shouldPlay: false,
            volume: 0.55,
            rate: 0.95,
            shouldCorrectPitch: false, // Disabling pitch correction creates a lower woodblock sound
          }
        );
        lowSoundRef.current = lowSound;

        soundsLoaded.current = true;
      } catch (err) {
        console.warn("Failed to preload metronome click audio assets:", err);
      }
    }

    if (visible) {
      loadAudio();
    }

    return () => {
      // Clean up sound references when exiting metronome screen
      if (highSoundRef.current) {
        highSoundRef.current.unloadAsync().catch(() => {});
        highSoundRef.current = null;
      }
      if (lowSoundRef.current) {
        lowSoundRef.current.unloadAsync().catch(() => {});
        lowSoundRef.current = null;
      }
      soundsLoaded.current = false;
    };
  }, [visible]);

  // Play Sound Utility
  const playClickSound = async (isDownbeat) => {
    try {
      if (!soundsLoaded.current) return;
      const soundObj = isDownbeat ? highSoundRef.current : lowSoundRef.current;
      if (soundObj) {
        await soundObj.replayAsync();
      }
    } catch (err) {
      console.log("Audio beat execution error:", err);
    }
  };

  // Pulse & Flash Animations Trigger
  const triggerVisualFeedback = (isDownbeat) => {
    // 1. Reset values
    flashAnim.setValue(0);
    pulseAnim.setValue(1);

    // 2. Run Parallel animations for high premium visual look
    Animated.parallel([
      Animated.sequence([
        Animated.timing(flashAnim, {
          toValue: 1,
          duration: 60,
          useNativeDriver: true,
        }),
        Animated.timing(flashAnim, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        }),
      ]),
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.25,
          duration: 70,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1.0,
          duration: 120,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  };

  // Helper parsing denominators e.g., "4/4" -> 4 beats
  const getBeatsPerMeasure = (sig) => {
    if (sig === "2/4") return 2;
    if (sig === "3/4") return 3;
    if (sig === "4/4") return 4;
    if (sig === "6/8") return 6;
    if (sig === "12/8") return 12;
    return 4;
  };

  // Main Metronome Scheduler Loop
  useEffect(() => {
    if (!isPlaying) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setCurrentBeat(1);
      return;
    }

    const intervalMs = (60 / bpm) * 1000;
    let nextBeat = 1;

    // Trigger instantly on clicking play button
    setCurrentBeat(nextBeat);
    playClickSound(true);
    triggerVisualFeedback(true);

    timerRef.current = setInterval(() => {
      const beatsCount = getBeatsPerMeasure(timeSignature);
      nextBeat = (nextBeat % beatsCount) + 1;
      
      setCurrentBeat(nextBeat);
      const isDownbeat = nextBeat === 1;
      playClickSound(isDownbeat);
      triggerVisualFeedback(isDownbeat);
    }, intervalMs);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isPlaying, bpm, timeSignature]);

  // Stop metronome when modal closes
  const handleClose = () => {
    setIsPlaying(false);
    onClose();
  };

  // Increment / Decrement BPM
  const adjustBpm = (amount) => {
    setBpm((prev) => {
      const target = prev + amount;
      return Math.max(40, Math.min(220, target));
    });
  };

  // Tap Tempo Averaging Logic
  const handleTapTempo = () => {
    const now = Date.now();
    let updatedTaps = [...tapTimes];

    // If last tap was more than 2.5 seconds ago, reset the rolling stack
    if (updatedTaps.length > 0 && now - updatedTaps[updatedTaps.length - 1] > 2500) {
      updatedTaps = [];
    }

    updatedTaps.push(now);

    // Track up to last 5 taps (which gives 4 interval deltas)
    if (updatedTaps.length > 5) {
      updatedTaps.shift();
    }

    setTapTimes(updatedTaps);

    if (updatedTaps.length >= 2) {
      const intervals = [];
      for (let i = 1; i < updatedTaps.length; i++) {
        intervals.push(updatedTaps[i] - updatedTaps[i - 1]);
      }
      const avgInterval = intervals.reduce((sum, v) => sum + v, 0) / intervals.length;
      const calculatedBpm = Math.round(60000 / avgInterval);
      const clampedBpm = Math.max(40, Math.min(220, calculatedBpm));
      setBpm(clampedBpm);
    }
  };

  // Save BPM to Firestore (Global song update)
  const handleSaveBpm = async () => {
    if (!song || !song.songId) return;
    setIsSaving(true);
    try {
      const timestamp = new Date().toISOString();
      const updatedFields = {
        bpm: Number(bpm),
        timeSignature: timeSignature,
        bpmLastChangedBy: user?.uid || "unknown-uid",
        bpmLastChangedByName: user?.displayName || "Unknown User",
        bpmLastChangedAt: timestamp,
      };

      if (USE_DEMO_MODE) {
        const stored = await AsyncStorage.getItem("@worship_team_songs");
        if (stored) {
          const songsList = JSON.parse(stored);
          const updatedList = songsList.map((s) =>
            s.songId === song.songId ? { ...s, ...updatedFields } : s
          );
          await AsyncStorage.setItem("@worship_team_songs", JSON.stringify(updatedList));
        }
      } else {
        const songDocRef = doc(db, "songs", song.songId);
        await updateDoc(songDocRef, updatedFields);
      }

      if (onUpdateSong) {
        onUpdateSong({
          ...song,
          ...updatedFields,
        });
      }

      Alert.alert("BPM Saved", `Successfully updated tempo to ${bpm} BPM and time signature to ${timeSignature}!`);
    } catch (err) {
      console.warn("Failed to write BPM back to Firestore:", err);
      Alert.alert("Database Error", "Could not save BPM back to the song: " + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  // Dynamic dots visual rendering based on Time Signature
  const renderBeatDots = () => {
    const totalBeats = getBeatsPerMeasure(timeSignature);
    const dots = [];

    for (let i = 1; i <= totalBeats; i++) {
      const isCurrent = i === currentBeat && isPlaying;
      const isBeatOne = i === 1;

      // Color mapping
      let dotColor = "rgba(255, 255, 255, 0.2)";
      if (isCurrent) {
        dotColor = isBeatOne ? "#EF4444" : "#FFFFFF"; // Red for beat 1, White for others
      } else {
        dotColor = isBeatOne ? "rgba(239, 68, 68, 0.25)" : "rgba(255, 255, 255, 0.1)";
      }

      dots.push(
        <Animated.View
          key={i}
          style={[
            styles.beatDot,
            {
              backgroundColor: dotColor,
              borderColor: isBeatOne ? "rgba(239, 68, 68, 0.4)" : "rgba(255, 255, 255, 0.2)",
              borderWidth: 1,
              transform: [{ scale: isCurrent ? pulseAnim : 1.0 }],
              shadowColor: isBeatOne ? "#EF4444" : "#FFFFFF",
              shadowRadius: isCurrent ? 8 : 0,
              shadowOpacity: isCurrent ? 0.6 : 0,
              shadowOffset: { width: 0, height: 0 },
            },
          ]}
        />
      );
    }

    return <View style={styles.dotsRow}>{dots}</View>;
  };

  // Large Flash Swell background interpolations
  const flashBgStyle = flashAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [
      "rgba(11, 15, 25, 0)",
      currentBeat === 1 ? "rgba(239, 68, 68, 0.08)" : "rgba(255, 255, 255, 0.05)",
    ],
  });

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={handleClose}
    >
      <View style={styles.container}>
        {/* Dynamic Flash Swell Background Overlay */}
        <Animated.View style={[styles.flashOverlay, { backgroundColor: flashBgStyle }]} />

        {/* Ambient Thematic Role Glow */}
        <View style={[styles.roleGlowCircle, { backgroundColor: theme.primary }]} />

        {/* Header Bar */}
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>⏱️ Worship Metronome</Text>
            {song?.title ? (
              <View style={styles.songPill}>
                <Text style={styles.songPillText} numberOfLines={1}>
                  🎼 Song: {song.title}
                </Text>
              </View>
            ) : (
              <Text style={styles.headerSubtitle}>Standalone Band Practice Tool</Text>
            )}
          </View>

          <TouchableOpacity style={styles.closeBtn} onPress={handleClose} activeOpacity={0.7}>
            <Text style={styles.closeBtnText}>✕ Close</Text>
          </TouchableOpacity>
        </View>

        {/* Dynamic Beat Visual dots tracker */}
        {renderBeatDots()}

        {/* Main Central Panel: BPM display & adjusting actions */}
        <View style={styles.bpmDisplayWrapper}>
          <Text style={styles.bpmLabel}>BEATS PER MINUTE</Text>
          
          <Animated.View
            style={[
              styles.bpmValueContainer,
              isPlaying && {
                transform: [{ scale: pulseAnim }],
              },
            ]}
          >
            <Text style={[styles.bpmValueText, { color: isPlaying ? (currentBeat === 1 ? "#EF4444" : "#FFFFFF") : "#FFFFFF" }]}>
              {bpm}
            </Text>
            <Text style={styles.bpmTextSuffix}>BPM</Text>
          </Animated.View>

          {/* Quick & Fine Tune adjustments row */}
          <View style={styles.controlsGridRow}>
            {/* Quick decrease */}
            <TouchableOpacity
              style={styles.adjustButton}
              onPress={() => adjustBpm(-5)}
              activeOpacity={0.6}
            >
              <Text style={styles.adjustBtnTextDouble}>-5</Text>
            </TouchableOpacity>

            {/* Fine decrease */}
            <TouchableOpacity
              style={styles.adjustButton}
              onPress={() => adjustBpm(-1)}
              activeOpacity={0.6}
            >
              <Text style={styles.adjustBtnTextSingle}>-1</Text>
            </TouchableOpacity>

            {/* Fine increase */}
            <TouchableOpacity
              style={styles.adjustButton}
              onPress={() => adjustBpm(1)}
              activeOpacity={0.6}
            >
              <Text style={styles.adjustBtnTextSingle}>+1</Text>
            </TouchableOpacity>

            {/* Quick increase */}
            <TouchableOpacity
              style={styles.adjustButton}
              onPress={() => adjustBpm(5)}
              activeOpacity={0.6}
            >
              <Text style={styles.adjustBtnTextDouble}>+5</Text>
            </TouchableOpacity>
          </View>

          {/* Tap Tempo active glass pad */}
          <TouchableOpacity
            style={[styles.tapTempoPad, { borderColor: theme.primary + "30" }]}
            onPress={handleTapTempo}
            activeOpacity={0.75}
          >
            <Text style={styles.tapTempoText}>TAP TEMPO</Text>
            <Text style={styles.tapTempoSubText}>Tap repeatedly to set beat</Text>
          </TouchableOpacity>
        </View>

        {/* Time Signature horizontal row */}
        <View style={styles.timeSigSection}>
          <Text style={styles.sectionHeading}>Time Signature</Text>
          <View style={styles.timeSigTabsRow}>
            {["2/4", "3/4", "4/4", "6/8", "12/8"].map((sig) => {
              const isActive = timeSignature === sig;
              return (
                <TouchableOpacity
                  key={sig}
                  style={[
                    styles.timeSigTabCard,
                    isActive && {
                      backgroundColor: theme.primary,
                      borderColor: theme.primary,
                    },
                  ]}
                  onPress={() => {
                    setTimeSignature(sig);
                    setCurrentBeat(1);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.timeSigTabText, isActive && styles.timeSigTabTextActive]}>
                    {sig}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Large Play/Stop Trigger & Save buttons footer */}
        <View style={styles.bottomFooterWrapper}>
          <TouchableOpacity
            style={[
              styles.mainPlayBtn,
              {
                backgroundColor: isPlaying ? "#EF4444" : theme.primary,
                shadowColor: isPlaying ? "#EF4444" : theme.primary,
              },
            ]}
            onPress={() => setIsPlaying(!isPlaying)}
            activeOpacity={0.8}
          >
            <Text style={styles.playBtnSymbol}>{isPlaying ? "■" : "▶"}</Text>
          </TouchableOpacity>
          <Text style={styles.playBtnLabel}>{isPlaying ? "STOP METRONOME" : "START METRONOME"}</Text>

          {/* Role-based database synchronization button */}
          {canSaveBpm && (
            <TouchableOpacity
              style={[styles.saveBpmBtn, { borderColor: theme.primary + "40" }]}
              onPress={handleSaveBpm}
              disabled={isSaving}
              activeOpacity={0.7}
            >
              {isSaving ? (
                <ActivityIndicator color={theme.primary} size="small" />
              ) : (
                <Text style={[styles.saveBpmBtnText, { color: theme.primary }]}>
                  💾 Save BPM to Song Details
                </Text>
              )}
            </TouchableOpacity>
          )}

          {song?.bpmLastChangedByName && (
            <Text style={styles.lastEditedMetaText}>
              Last updated by {song.bpmLastChangedByName} on{" "}
              {new Date(song.bpmLastChangedAt).toLocaleDateString([], {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </Text>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0B0F19",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 50,
    paddingBottom: 40,
    paddingHorizontal: 20,
    position: "relative",
  },
  flashOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 0,
  },
  roleGlowCircle: {
    position: "absolute",
    top: -100,
    right: -100,
    width: 250,
    height: 250,
    borderRadius: 125,
    opacity: 0.1,
    blurRadius: 80,
  },
  headerRow: {
    width: "100%",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    zIndex: 1,
    borderBottomWidth: 1,
    borderColor: "#1E293B",
    paddingBottom: 15,
  },
  headerTitle: {
    color: "#FFFFFF",
    fontSize: 19,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  headerSubtitle: {
    color: "#64748B",
    fontSize: 12,
    marginTop: 2,
    fontWeight: "500",
  },
  songPill: {
    backgroundColor: "rgba(59, 130, 246, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(59, 130, 246, 0.2)",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 3,
    marginTop: 4,
    alignSelf: "flex-start",
    maxWidth: width * 0.65,
  },
  songPillText: {
    color: "#3B82F6",
    fontSize: 11,
    fontWeight: "700",
  },
  closeBtn: {
    backgroundColor: "#1E293B",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#334155",
  },
  closeBtnText: {
    color: "#94A3B8",
    fontSize: 12,
    fontWeight: "700",
  },
  dotsRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
    marginVertical: 15,
    zIndex: 1,
  },
  beatDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    marginHorizontal: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  bpmDisplayWrapper: {
    width: "100%",
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#1E293B",
    borderRadius: 24,
    paddingVertical: 24,
    paddingHorizontal: 20,
    alignItems: "center",
    zIndex: 1,
  },
  bpmLabel: {
    color: "#64748B",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  bpmValueContainer: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "center",
    marginBottom: 20,
  },
  bpmValueText: {
    fontSize: 78,
    fontWeight: "900",
    letterSpacing: -1,
  },
  bpmTextSuffix: {
    color: "#64748B",
    fontSize: 16,
    fontWeight: "800",
    marginLeft: 6,
  },
  controlsGridRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
    marginBottom: 22,
  },
  adjustButton: {
    backgroundColor: "#1E293B",
    borderWidth: 1,
    borderColor: "#334155",
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: "center",
    alignItems: "center",
    marginHorizontal: 8,
  },
  adjustBtnTextDouble: {
    color: "#E2E8F0",
    fontSize: 15,
    fontWeight: "800",
  },
  adjustBtnTextSingle: {
    color: "#94A3B8",
    fontSize: 14,
    fontWeight: "700",
  },
  tapTempoPad: {
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderRadius: 16,
    width: "100%",
    paddingVertical: 14,
    justifyContent: "center",
    alignItems: "center",
  },
  tapTempoText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 1,
  },
  tapTempoSubText: {
    color: "#64748B",
    fontSize: 11,
    marginTop: 2,
    fontWeight: "500",
  },
  timeSigSection: {
    width: "100%",
    zIndex: 1,
  },
  sectionHeading: {
    color: "#94A3B8",
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 10,
    alignSelf: "flex-start",
    paddingLeft: 4,
  },
  timeSigTabsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: "100%",
  },
  timeSigTabCard: {
    flex: 1,
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#1E293B",
    borderRadius: 10,
    paddingVertical: 10,
    justifyContent: "center",
    alignItems: "center",
    marginHorizontal: 3,
  },
  timeSigTabText: {
    color: "#94A3B8",
    fontSize: 12,
    fontWeight: "700",
  },
  timeSigTabTextActive: {
    color: "#FFFFFF",
    fontWeight: "800",
  },
  bottomFooterWrapper: {
    width: "100%",
    alignItems: "center",
    zIndex: 1,
  },
  mainPlayBtn: {
    width: 74,
    height: 74,
    borderRadius: 37,
    justifyContent: "center",
    alignItems: "center",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 8,
    marginBottom: 10,
  },
  playBtnSymbol: {
    color: "#FFFFFF",
    fontSize: 28,
    fontWeight: "700",
    lineHeight: 28,
    textAlign: "center",
  },
  playBtnLabel: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.5,
    marginBottom: 20,
  },
  saveBpmBtn: {
    backgroundColor: "rgba(255, 255, 255, 0.02)",
    borderWidth: 1,
    borderRadius: 12,
    width: "100%",
    paddingVertical: 12,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 8,
  },
  saveBpmBtnText: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  lastEditedMetaText: {
    color: "#64748B",
    fontSize: 10,
    fontWeight: "500",
    marginTop: 4,
  },
});
