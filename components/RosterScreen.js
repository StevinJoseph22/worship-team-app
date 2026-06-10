import React, { useState, useEffect } from "react";
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  FlatList,
  Modal,
  Alert,
  Dimensions,
  Linking,
  ActivityIndicator,
  Image,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { StatusBar } from "expo-status-bar";
import SongDetailScreen from "./SongDetailScreen";
import AddSongScreen from "./AddSongScreen";
import * as Clipboard from "expo-clipboard";

// Import custom configurations
import { USE_DEMO_MODE, db } from "../firebaseConfig";
import {
  collection,
  doc,
  deleteDoc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  where,
} from "firebase/firestore";
import { sendWhatsApp, getWhatsAppMessageTemplate } from "../services/whatsappService";
import { sendPushNotificationToUsers } from "../services/notificationService";

const { width } = Dimensions.get("window");

export default function RosterScreen({ user, songs, directRosterTargetId, clearDirectRosterTarget, onAddSongInline, onUpdateSongInline }) {
  const { uid, role, displayName } = user;

  // Modal active song detail sheet
  const [activeRosterSongDetail, setActiveRosterSongDetail] = useState(null);

  const handleUpdateRosterSongDetail = (updatedSong) => {
    if (onUpdateSongInline) {
      onUpdateSongInline(updatedSong);
    }
    setActiveRosterSongDetail(updatedSong);
  };

  // View state: "list" | "create" | "detail"
  const [activeView, setActiveView] = useState("list");
  const [loading, setLoading] = useState(true);

  // Roster lists and logs
  const [rosters, setRosterList] = useState([]);
  const [teamMembers, setTeamMembers] = useState([]);
  const [selectedRoster, setSelectedRoster] = useState(null);

  // Inline Song Creator & Editor States
  const [inlineSongModalVisible, setInlineSongModalVisible] = useState(false);
  const [inlineEditMode, setInlineEditMode] = useState(false); // false = create, true = edit
  const [selectedSongToEditId, setSelectedSongToEditId] = useState(null);
  const [inlineTitle, setInlineTitle] = useState("");
  const [inlineArtist, setInlineArtist] = useState("");
  const [inlineKeyRoot, setInlineKeyRoot] = useState("C");
  const [inlineKeyQuality, setInlineKeyQuality] = useState("Major");
  const [inlineBpm, setInlineBpm] = useState("75");
  const [inlineLyricsEnglish, setInlineLyricsEnglish] = useState("");
  const [inlineLyricsTamil, setInlineLyricsTamil] = useState("");
  const [inlineYoutubeLink, setInlineYoutubeLink] = useState("");
  const [inlineSpotifyLink, setInlineSpotifyLink] = useState("");

  // Dropdown / Auto-complete Visibility states
  const [keyRootDropdownVisible, setKeyRootDropdownVisible] = useState(false);
  const [keyQualityDropdownVisible, setKeyQualityDropdownVisible] = useState(false);
  const [artistDropdownVisible, setArtistDropdownVisible] = useState(false);

  // Practiced and ready status trackers
  // Store logs as maps: { [songId]: timestamp }
  const [practicedLogs, setPracticedLogs] = useState({});
  const [readyLogs, setReadyLogs] = useState({});
  const [editingRosterId, setEditingRosterId] = useState(null);
  const [allPracticedLogs, setAllPracticedLogs] = useState({});
  const [allReadyLogs, setAllReadyLogs] = useState({});

  // Worship Leader Create Roster states
  const [eventName, setEventName] = useState("");
  const [eventType, setEventType] = useState("Sunday Morning"); // "Sunday Morning" | "Youth Night" | "Special Event"
  const [eventDate, setEventDate] = useState("");
  const [rehearsalDate, setRehearsalDate] = useState("");
  const [selectedRosterSongs, setSelectedRosterSongs] = useState([]); // [{ songId, order, assignedChoir: [], assignedMusicians: [], notes: "" }]

  // Selection/picker modals and search queries
  const [songSearchQuery, setSongSearchQuery] = useState("");
  const [songPickerVisible, setSongPickerVisible] = useState(false);
  const [eventTypePickerVisible, setEventTypePickerVisible] = useState(false);

  const DEFAULT_EVENT_TYPES = ["Sunday Morning", "Youth Night", "Special Event", "Tamil Service", "English Service"];
  const [eventTypes, setEventTypes] = useState(DEFAULT_EVENT_TYPES);
  const [customEventTypeInput, setCustomEventTypeInput] = useState("");

  useEffect(() => {
    const loadEventTypes = async () => {
      try {
        if (USE_DEMO_MODE) {
          const stored = await AsyncStorage.getItem("@worship_team_custom_event_types");
          if (stored) {
            const parsed = JSON.parse(stored);
            setEventTypes([...DEFAULT_EVENT_TYPES, ...parsed]);
          }
        } else {
          if (db) {
            const docRef = doc(db, "config", "roster");
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
              const data = docSnap.data();
              if (data && Array.isArray(data.eventTypes)) {
                const combined = Array.from(new Set([...DEFAULT_EVENT_TYPES, ...data.eventTypes]));
                setEventTypes(combined);
              }
            }
          }
        }
      } catch (err) {
        console.warn("Error loading custom event types:", err);
      }
    };
    loadEventTypes();
  }, []);

  // Calendar picker states
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const [datePickerTarget, setDatePickerTarget] = useState("event"); // "event" | "practice"
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [selectedCalendarDay, setSelectedCalendarDay] = useState(new Date().getDate());
  const [selectedHour, setSelectedHour] = useState("09");
  const [selectedMinute, setSelectedMinute] = useState("30");
  const [selectedAmpm, setSelectedAmpm] = useState("AM");
  const [timeSubPicker, setTimeSubPicker] = useState("none"); // "none" | "hour" | "minute"

  const MONTHS_LIST = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

  const openDatePicker = (target) => {
    setDatePickerTarget(target);
    setTimeSubPicker("none");
    const existingVal = target === "event" ? eventDate : rehearsalDate;
    
    let parsedDate = new Date();
    let pDay = parsedDate.getDate();
    let pHour = "09";
    let pMin = "30";
    let pAmpm = "AM";

    if (existingVal && existingVal.trim()) {
      try {
        const parts = existingVal.split(",");
        if (parts.length >= 3) {
          const monthDay = parts[0].trim().split(" ");
          const year = parseInt(parts[1].trim(), 10);
          
          const timeFullParts = parts[2].trim().split(" ");
          const hourMin = timeFullParts[0].trim().split(":");
          const ampm = timeFullParts[1].trim().toUpperCase();

          const monthIdx = MONTHS_LIST.indexOf(monthDay[0].trim());
          const dayVal = parseInt(monthDay[1].trim(), 10);

          if (monthIdx !== -1 && !isNaN(dayVal) && !isNaN(year)) {
            parsedDate = new Date(year, monthIdx, 1);
            pDay = dayVal;
          }
          if (hourMin.length === 2) {
            pHour = hourMin[0].padStart(2, "0");
            pMin = hourMin[1].padStart(2, "0");
          }
          if (ampm === "AM" || ampm === "PM") {
            pAmpm = ampm;
          }
        }
      } catch (e) {
        console.log("Error parsing date, using default", e);
      }
    }

    setCalendarMonth(parsedDate);
    setSelectedCalendarDay(pDay);
    setSelectedHour(pHour);
    setSelectedMinute(pMin);
    setSelectedAmpm(pAmpm);
    setDatePickerVisible(true);
  };

  const handleConfirmPickedDate = () => {
    const monthName = MONTHS_LIST[calendarMonth.getMonth()];
    const year = calendarMonth.getFullYear();
    const formattedVal = `${monthName} ${selectedCalendarDay}, ${year}, ${selectedHour}:${selectedMinute} ${selectedAmpm}`;
    
    if (datePickerTarget === "event") {
      setEventDate(formattedVal);
    } else {
      setRehearsalDate(formattedVal);
    }
    setDatePickerVisible(false);
  };

  const adjustCalendarMonth = (newMonthDate) => {
    const maxDays = new Date(newMonthDate.getFullYear(), newMonthDate.getMonth() + 1, 0).getDate();
    if (selectedCalendarDay > maxDays) {
      setSelectedCalendarDay(maxDays);
    }
    setCalendarMonth(newMonthDate);
  };

  const handlePrevMonth = () => {
    adjustCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    adjustCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1));
  };

  const getDaysInMonth = (year, month) => {
    return new Date(year, month + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (year, month) => {
    return new Date(year, month, 1).getDay();
  };

  // Detail screen expanded sections (for lyrics)
  const [expandedSongId, setExpandedSongId] = useState(null);
  const [activeLyricsTab, setActiveLyricsTab] = useState("english"); // "english" | "tamil"

  // Storage keys for demo mode
  const ROSTERS_DB_KEY = "@worship_team_rosters";
  const DEMO_USERS_DB_KEY = "@worship_team_demo_users";
  const PRACTICED_LOGS_KEY = "@worship_team_rosters_practiced";
  const READY_LOGS_KEY = "@worship_team_rosters_ready";

  // Determine active theme color based on role
  const getRoleColor = (userRole) => {
    switch (userRole) {
      case "super_admin":
        return "#EF4444"; // Crimson Red
      case "worship_leader":
        return "#F59E0B"; // Gold
      case "musician":
        return "#A855F7"; // Purple
      case "choir_member":
        return "#0D9488"; // Teal
      default:
        return "#3B82F6"; // Blue
    }
  };

  const themeColor = getRoleColor(role);

  // Load team users and rosters list (using live real-time Firestore listeners)
  useEffect(() => {
    let unsubscribeRosters = null;
    let unsubscribeUsers = null;

    async function loadInitialData() {
      setLoading(true);
      try {
        // 1. Load team members for assignments
        if (USE_DEMO_MODE) {
          const storedUsers = await AsyncStorage.getItem(DEMO_USERS_DB_KEY);
          if (storedUsers) {
            setTeamMembers(Object.values(JSON.parse(storedUsers)));
          } else {
            setTeamMembers([
              { uid: "demo-leader-111", displayName: "Pastor Alex", role: "worship_leader", phone: "+919876543210" },
              { uid: "demo-musician-222", displayName: "Sarah (Guitarist)", role: "musician", phone: "+919876543211" },
              { uid: "demo-choir-333", displayName: "David (Tenor Lead)", role: "choir_member", phone: "+919876543212" },
              { uid: "demo-member-444", displayName: "Sister Grace", role: "member", phone: "+919876543213" },
            ]);
          }

          // Load rosters list from AsyncStorage
          const storedRosters = await AsyncStorage.getItem(ROSTERS_DB_KEY);
          if (storedRosters) {
            setRosterList(JSON.parse(storedRosters));
          } else {
            // Seed a default published roster in demo mode
            const mockRoster = {
              rosterId: "mock-roster-1",
              eventName: "Sunday Resurrection Celebration",
              eventType: "Sunday Morning",
              eventDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
              rehearsalDate: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString(),
              status: "published",
              createdBy: "demo-leader-111",
              createdAt: new Date().toISOString(),
              songs: [
                {
                  songId: "mock-song-1", // How Great Is Our God
                  order: 1,
                  assignedChoir: ["demo-choir-333"],
                  assignedMusicians: ["demo-musician-222"],
                  notes: "Metronome sync starts at standard 78 BPM. David leads verse 1.",
                },
                {
                  songId: "mock-song-2", // Amazing Grace
                  order: 2,
                  assignedChoir: ["demo-choir-333"],
                  assignedMusicians: ["demo-musician-222"],
                  notes: "Sarah starts with ambient acoustic guitars. Band enters at Chorus 1.",
                },
              ],
            };
            await AsyncStorage.setItem(ROSTERS_DB_KEY, JSON.stringify([mockRoster]));
            setRosterList([mockRoster]);
          }
        } else {
          // Firebase mode: Set up real-time users listener to immediately grab new registrations
          const usersColl = collection(db, "users");
          const usersQuery = query(usersColl);
          unsubscribeUsers = onSnapshot(usersQuery, (usersSnapshot) => {
            const uList = [];
            usersSnapshot.forEach((docSnap) => {
              uList.push({ uid: docSnap.id, ...docSnap.data() });
            });
            setTeamMembers(
              uList.length > 0
                ? uList
                : [
                    { uid: "demo-leader-111", displayName: "Pastor Alex", role: "worship_leader" },
                    { uid: "demo-musician-222", displayName: "Sarah (Guitarist)", role: "musician" },
                    { uid: "demo-choir-333", displayName: "David (Tenor Lead)", role: "choir_member" },
                    { uid: "demo-member-444", displayName: "Sister Grace", role: "member" },
                  ]
            );
          }, (err) => {
            console.error("Firestore users list snapshot error:", err);
          });

          // Firebase mode: Set up real-time rosters listener
          const rosterColl = collection(db, "rosters");
          const q = query(rosterColl, orderBy("createdAt", "desc"));
          unsubscribeRosters = onSnapshot(
            q,
            (snapshot) => {
              const list = [];
              snapshot.forEach((d) => {
                list.push({ rosterId: d.id, ...d.data() });
              });
              setRosterList(list);
            },
            (err) => {
              console.error("Firestore roster listener error:", err);
            }
          );
        }
      } catch (err) {
        console.error("Roster initial load error:", err);
      } finally {
        setLoading(false);
      }
    }

    loadInitialData();

    return () => {
      if (unsubscribeRosters) unsubscribeRosters();
      if (unsubscribeUsers) unsubscribeUsers();
    };
  }, []);

  // Handle direct navigation jump from Home screen notifications
  useEffect(() => {
    if (directRosterTargetId && rosters.length > 0) {
      const matched = rosters.find((r) => r.rosterId === directRosterTargetId);
      if (matched) {
        setSelectedRoster(matched);
        fetchRosterLogs(matched.rosterId);
        setActiveView("detail");
        if (clearDirectRosterTarget) clearDirectRosterTarget();
      }
    }
  }, [directRosterTargetId, rosters]);

  // Fetch practiced & ready check-in logs when a specific roster is selected
  const fetchRosterLogs = async (rosterId) => {
    if (!rosterId) return;
    try {
      if (USE_DEMO_MODE) {
        // Practiced logs
        const pStored = await AsyncStorage.getItem(PRACTICED_LOGS_KEY);
        const parsedP = pStored ? JSON.parse(pStored) : {};
        setPracticedLogs(parsedP[`${rosterId}_${uid}`] || {});

        // Ready logs
        const rStored = await AsyncStorage.getItem(READY_LOGS_KEY);
        const parsedR = rStored ? JSON.parse(rStored) : {};
        setReadyLogs(parsedR[`${rosterId}_${uid}`] || {});

        // Extract all members' practiced logs for this roster
        const allP = {};
        Object.keys(parsedP).forEach((k) => {
          if (k.startsWith(`${rosterId}_`)) {
            const uId = k.replace(`${rosterId}_`, "");
            allP[uId] = parsedP[k];
          }
        });
        setAllPracticedLogs(allP);

        // Extract all members' ready logs for this roster
        const allR = {};
        Object.keys(parsedR).forEach((k) => {
          if (k.startsWith(`${rosterId}_`)) {
            const uId = k.replace(`${rosterId}_`, "");
            allR[uId] = parsedR[k];
          }
        });
        setAllReadyLogs(allR);
      } else {
        // Firestore: Fetch Choir Practiced document
        const pDocRef = doc(db, "rosters", rosterId, "practiced", uid);
        const pSnap = await getDoc(pDocRef);
        setPracticedLogs(pSnap.exists() ? pSnap.data() : {});

        // Firestore: Fetch Musician Ready document
        const rDocRef = doc(db, "rosters", rosterId, "ready", uid);
        const rSnap = await getDoc(rDocRef);
        setReadyLogs(rSnap.exists() ? rSnap.data() : {});

        // Fetch all practiced logs in subcollection
        const pColl = collection(db, "rosters", rosterId, "practiced");
        const pSnapshot = await getDocs(pColl);
        const allP = {};
        pSnapshot.forEach((docSnap) => {
          allP[docSnap.id] = docSnap.data();
        });
        setAllPracticedLogs(allP);

        // Fetch all ready logs in subcollection
        const rColl = collection(db, "rosters", rosterId, "ready");
        const rSnapshot = await getDocs(rColl);
        const allR = {};
        rSnapshot.forEach((docSnap) => {
          allR[docSnap.id] = docSnap.data();
        });
        setAllReadyLogs(allR);
      }
    } catch (err) {
      console.error("Failed to load roster practicing/ready logs:", err);
    }
  };

  const handleDeleteRoster = () => {
    if (!selectedRoster) return;
    Alert.alert(
      "Delete Roster Plan",
      `Are you sure you want to permanently delete "${selectedRoster.eventName}"? This action cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              if (USE_DEMO_MODE) {
                const storedRosters = await AsyncStorage.getItem(ROSTERS_DB_KEY);
                if (storedRosters) {
                  const parsed = JSON.parse(storedRosters);
                  const filtered = parsed.filter((r) => r.rosterId !== selectedRoster.rosterId);
                  await AsyncStorage.setItem(ROSTERS_DB_KEY, JSON.stringify(filtered));
                  setRosterList(filtered);
                }
              } else {
                await deleteDoc(doc(db, "rosters", selectedRoster.rosterId));
              }
              
              setActiveView("list");
              setSelectedRoster(null);
              Alert.alert("Success", "Roster deleted successfully!");
            } catch (err) {
              console.error("Failed to delete roster:", err);
              Alert.alert("Error", "Failed to delete roster: " + err.message);
            }
          }
        }
      ]
    );
  };

  // Toggle Vocalist Practiced Status
  const handleTogglePracticed = async (rosterId, songId) => {
    const isPracticed = !!practicedLogs[songId];
    const updated = { ...practicedLogs };

    if (isPracticed) {
      delete updated[songId];
    } else {
      updated[songId] = new Date().toISOString();
    }

    setPracticedLogs(updated);
    setAllPracticedLogs((prev) => ({
      ...prev,
      [uid]: updated,
    }));

    try {
      if (USE_DEMO_MODE) {
        const stored = await AsyncStorage.getItem(PRACTICED_LOGS_KEY);
        const parsed = stored ? JSON.parse(stored) : {};
        parsed[`${rosterId}_${uid}`] = updated;
        await AsyncStorage.setItem(PRACTICED_LOGS_KEY, JSON.stringify(parsed));
      } else {
        const docRef = doc(db, "rosters", rosterId, "practiced", uid);
        await setDoc(docRef, updated);
      }
    } catch (err) {
      console.error("Failed to toggle practiced status:", err);
      Alert.alert("Error", "Could not save practiced progress.");
    }
  };

  // Toggle Musician Ready Status
  const handleToggleReady = async (rosterId, songId) => {
    const isReady = !!readyLogs[songId];
    const updated = { ...readyLogs };

    if (isReady) {
      delete updated[songId];
    } else {
      updated[songId] = new Date().toISOString();
    }

    setReadyLogs(updated);
    setAllReadyLogs((prev) => ({
      ...prev,
      [uid]: updated,
    }));

    try {
      if (USE_DEMO_MODE) {
        const stored = await AsyncStorage.getItem(READY_LOGS_KEY);
        const parsed = stored ? JSON.parse(stored) : {};
        parsed[`${rosterId}_${uid}`] = updated;
        await AsyncStorage.setItem(READY_LOGS_KEY, JSON.stringify(parsed));
      } else {
        const docRef = doc(db, "rosters", rosterId, "ready", uid);
        await setDoc(docRef, updated);
      }
    } catch (err) {
      console.error("Failed to toggle ready status:", err);
      Alert.alert("Error", "Could not save readiness progress.");
    }
  };

  const handleCopyRosterWhatsAppMessage = async (rosterData) => {
    try {
      if (!rosterData) return;
      
      let message = `🎵 *Elim Worship Team — Service Schedule*\n\n`;
      message += `*Praise the Lord Team*\n\n`;
      message += `*Title*: ${rosterData.eventName}\n`;
      message += `*Event Type*: ${rosterData.eventType || "Service"}\n`;
      message += `*Service Date*: ${formattedDate(rosterData.eventDate)}\n`;
      message += `*Practice Date*: ${rosterData.rehearsalDate && rosterData.rehearsalDate !== "TBD" ? formattedDate(rosterData.rehearsalDate) : "TBD"}\n\n`;
      message += `📋 *Setlist & Team Assignments*:\n\n`;
      
      if (rosterData.songs && rosterData.songs.length > 0) {
        rosterData.songs.forEach((rosterSong, idx) => {
          const fullSong = songs.find((s) => s.songId === rosterSong.songId || s.id === rosterSong.songId) || {};
          const songTitle = fullSong.title || "Selected Song";
          const artistName = fullSong.artist ? ` - ${fullSong.artist}` : "";
          
          message += `*${idx + 1}. ${songTitle}${artistName}*\n\n`;
        });
      } else {
        message += `(No songs added to the setlist yet)\n\n`;
      }
      
      message += `🔗 *Worship App*: https://worshipteamapp-c84e2.web.app`;
      
      await Clipboard.setStringAsync(message);
      Alert.alert("Copied to Clipboard", "WhatsApp broadcast message copied successfully!");
    } catch (err) {
      console.error("Failed to copy WhatsApp message:", err);
      Alert.alert("Error", "Could not copy message to clipboard: " + err.message);
    }
  };

  // Open a Roster's detail view
  const handleSelectRoster = (roster) => {
    setSelectedRoster(roster);
    setExpandedSongId(null);
    fetchRosterLogs(roster.rosterId);
    setActiveView("detail");
  };

  const getUpcomingSundayString = () => {
    const d = new Date();
    const day = d.getDay();
    const daysToAdd = day === 0 ? 0 : 7 - day;
    d.setDate(d.getDate() + daysToAdd);
    const monthName = MONTHS_LIST[d.getMonth()];
    const dateNum = d.getDate();
    const year = d.getFullYear();
    return `${monthName} ${dateNum}, ${year}, 07:00 AM`;
  };

  const getPrecedingSaturdayString = () => {
    const d = new Date();
    const day = d.getDay();
    const daysToAdd = day === 0 ? 0 : 7 - day;
    d.setDate(d.getDate() + daysToAdd - 1);
    const monthName = MONTHS_LIST[d.getMonth()];
    const dateNum = d.getDate();
    const year = d.getFullYear();
    return `${monthName} ${dateNum}, ${year}, 04:00 PM`;
  };

  // Initialize form to create roster
  const handleInitiateCreate = () => {
    setEditingRosterId(null);
    setEventName("");
    setEventType("Sunday Morning");
    setEventDate(getUpcomingSundayString());
    setRehearsalDate(getPrecedingSaturdayString());
    setSelectedRosterSongs([]);
    setSongSearchQuery("");
    setActiveView("create");
  };

  const handleAddCustomEventType = async () => {
    const trimmed = customEventTypeInput.trim();
    if (!trimmed) return;
    
    // Check if it already exists
    if (eventTypes.includes(trimmed)) {
      Alert.alert("Already Exists", "This event type is already in the list.");
      return;
    }
    
    const updatedTypes = [...eventTypes, trimmed];
    setEventTypes(updatedTypes);
    setCustomEventTypeInput("");
    
    // Pick this new custom event type immediately
    setEventType(trimmed);
    setEventTypePickerVisible(false);
    
    // Persist it!
    try {
      const customOnly = updatedTypes.filter(t => !DEFAULT_EVENT_TYPES.includes(t));
      if (USE_DEMO_MODE) {
        await AsyncStorage.setItem("@worship_team_custom_event_types", JSON.stringify(customOnly));
      } else {
        if (db) {
          const docRef = doc(db, "config", "roster");
          await setDoc(docRef, { eventTypes: customOnly }, { merge: true });
        }
      }
    } catch (err) {
      console.warn("Failed to persist custom event type:", err);
    }
  };

  // Load an existing roster into the editor form states
  const handleInitiateEdit = (roster) => {
    setEditingRosterId(roster.rosterId);
    setEventName(roster.eventName);
    setEventType(roster.eventType || "Sunday Morning");
    setEventDate(roster.eventDate);
    setRehearsalDate(roster.rehearsalDate === "TBD" ? "" : roster.rehearsalDate);
    setSelectedRosterSongs(roster.songs.map((s) => ({ ...s })));
    setSongSearchQuery("");
    setActiveView("create");
  };

  // Helper: Parse Key string like "G Major" or "C Minor" into { root, quality }
  const parseOriginalKey = (keyStr) => {
    let root = "C";
    let quality = "Major";
    if (keyStr) {
      const parts = keyStr.trim().split(" ");
      if (parts.length > 0) {
        root = parts[0];
      }
      if (parts.length > 1) {
        const q = parts[1].charAt(0).toUpperCase() + parts[1].slice(1).toLowerCase();
        if (q === "Major" || q === "Minor") {
          quality = q;
        }
      }
    }
    return { root, quality };
  };

  // Helper: Safely open external links for Spotify or YouTube
  const handleOpenLink = async (url) => {
    if (!url) {
      Alert.alert("Link Unavailable", "No link provided for this song.");
      return;
    }
    try {
      const trimmedUrl = url.trim();
      const supported = await Linking.canOpenURL(trimmedUrl);
      if (supported) {
        await Linking.openURL(trimmedUrl);
      } else {
        await Linking.openURL(trimmedUrl);
      }
    } catch (e) {
      Alert.alert("Error Opening Link", "Could not open link in your browser or application.");
    }
  };

  // Helper: Check if song is newly created (last 7 days)
  const isNewSong = (song) => {
    if (!song || !song.createdAt) return false;
    try {
      const createdTime = new Date(song.createdAt).getTime();
      const nowTime = new Date().getTime();
      const diffMs = nowTime - createdTime;
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      return diffDays <= 7;
    } catch (e) {
      return false;
    }
  };

  // Helper: Build detailed roster diff message for notifications
  const getRosterDiffMessage = (isEdit, oldRoster) => {
    const cleanEventName = eventName.trim();
    
    const getSongTitle = (id) => {
      const s = songs.find(x => x.songId === id || x.id === id);
      return s ? s.title : "Unknown Song";
    };

    if (!isEdit || !oldRoster) {
      // New roster published - list new songs if any
      const newSongs = selectedRosterSongs
        .filter(s => s.isNewInlineSong === true)
        .map(s => getSongTitle(s.songId));
      
      let diffStr = "";
      if (newSongs.length > 0) {
        diffStr = ` (new song added (${newSongs.join(", ")}))`;
      }
      return `${displayName} published a new roster: "${cleanEventName}"${diffStr}`;
    }

    // Edited roster - construct granular changes log
    const changes = [];
    
    if (oldRoster.eventName !== cleanEventName) {
      changes.push(`title: "${oldRoster.eventName}" -> "${cleanEventName}"`);
    }
    
    if (oldRoster.eventDate !== eventDate.trim()) {
      changes.push(`date shifted to "${eventDate.trim()}"`);
    }
    
    const oldPracticeDate = oldRoster.rehearsalDate || "TBD";
    const newPracticeDate = rehearsalDate.trim() || "TBD";
    if (oldPracticeDate !== newPracticeDate) {
      changes.push(`practice date shifted to "${newPracticeDate}"`);
    }

    // Songs diff calculation
    const oldSongIds = new Set((oldRoster.songs || []).map(s => s.songId));
    const newSongIds = new Set(selectedRosterSongs.map(s => s.songId));

    const addedSongObjects = selectedRosterSongs.filter(s => !oldSongIds.has(s.songId));
    const removedSongObjects = (oldRoster.songs || []).filter(s => !newSongIds.has(s.songId));

    const addedNewSongs = addedSongObjects
      .filter(s => s.isNewInlineSong === true)
      .map(s => getSongTitle(s.songId));
    
    const addedRegularSongs = addedSongObjects
      .filter(s => s.isNewInlineSong !== true)
      .map(s => getSongTitle(s.songId));

    const removedSongTitles = removedSongObjects.map(s => getSongTitle(s.songId));

    if (addedNewSongs.length > 0) {
      changes.push(`new song added (${addedNewSongs.join(", ")})`);
    }
    if (addedRegularSongs.length > 0) {
      changes.push(`Added: ${addedRegularSongs.join(", ")}`);
    }
    if (removedSongTitles.length > 0) {
      changes.push(`Removed: ${removedSongTitles.join(", ")}`);
    }

    const changesStr = changes.length > 0 ? ` (${changes.join(" | ")})` : "";
    return `${displayName} updated the roster "${cleanEventName}"${changesStr}`;
  };

  // Inline Song creation & editing handlers
  const handleOpenInlineAddSong = (initialTitle) => {
    setInlineEditMode(false);
    setSelectedSongToEditId(null);
    setInlineTitle(initialTitle);
    setInlineArtist("");
    setInlineKeyRoot("C");
    setInlineKeyQuality("Major");
    setInlineBpm("75");
    setInlineLyricsEnglish("");
    setInlineLyricsTamil("");
    setInlineYoutubeLink("");
    setInlineSpotifyLink("");
    setKeyRootDropdownVisible(false);
    setKeyQualityDropdownVisible(false);
    setArtistDropdownVisible(false);
    setInlineSongModalVisible(true);
  };

  const handleOpenInlineEditSong = (songObj) => {
    setInlineEditMode(true);
    setSelectedSongToEditId(songObj.songId || songObj.id);
    setInlineTitle(songObj.title || "");
    setInlineArtist(songObj.artist || "");
    
    const { root, quality } = parseOriginalKey(songObj.originalKey || "C Major");
    setInlineKeyRoot(root);
    setInlineKeyQuality(quality);
    
    setInlineBpm(songObj.bpm ? songObj.bpm.toString() : "75");
    setInlineLyricsEnglish(songObj.lyricsEnglish || "");
    setInlineLyricsTamil(songObj.lyricsTamil || "");
    setInlineYoutubeLink(songObj.youtubeLink || "");
    setInlineSpotifyLink(songObj.spotifyLink || "");
    
    setKeyRootDropdownVisible(false);
    setKeyQualityDropdownVisible(false);
    setArtistDropdownVisible(false);
    setInlineSongModalVisible(true);
  };

  const handleSaveInlineSong = async () => {
    if (!inlineTitle.trim()) {
      Alert.alert("Required Field", "Please enter a song title.");
      return;
    }
    if (!inlineArtist.trim()) {
      Alert.alert("Required Field", "Please enter an artist name.");
      return;
    }
    if (!inlineYoutubeLink.trim() && !inlineSpotifyLink.trim()) {
      Alert.alert("Link Required", "Please enter either a YouTube link or a Spotify link.");
      return;
    }

    const combinedKey = `${inlineKeyRoot} ${inlineKeyQuality}`;

    const songData = {
      title: inlineTitle.trim(),
      artist: inlineArtist.trim(),
      originalKey: combinedKey,
      currentKey: combinedKey,
      bpm: parseInt(inlineBpm.trim(), 10) || 75,
      timeSignature: "4/4",
      lyricsEnglish: inlineLyricsEnglish.trim(),
      lyricsTamil: inlineLyricsTamil.trim(),
      youtubeLink: inlineYoutubeLink.trim(),
      spotifyLink: inlineSpotifyLink.trim(),
      tags: ["Worship"],
    };

    try {
      if (USE_DEMO_MODE) {
        const storedSongs = await AsyncStorage.getItem("@worship_team_songs");
        let currentSongs = storedSongs ? JSON.parse(storedSongs) : [];

        if (inlineEditMode) {
          const updatedSongs = currentSongs.map((s) => {
            if (s.songId === selectedSongToEditId || s.id === selectedSongToEditId) {
              const updated = {
                ...s,
                ...songData,
                lastEditedBy: uid,
                lastEditedByName: displayName,
                lastEditedAt: new Date().toISOString(),
              };
              if (onUpdateSongInline) onUpdateSongInline(updated);
              return updated;
            }
            return s;
          });
          await AsyncStorage.setItem("@worship_team_songs", JSON.stringify(updatedSongs));
          if (selectedRoster) {
            setSelectedRoster({
              ...selectedRoster,
              songs: selectedRoster.songs.map((s) => s.songId === selectedSongToEditId ? { ...s } : s)
            });
          }
          Alert.alert("Success", "Song updated successfully in catalog and roster!");
        } else {
          const newSong = {
            songId: "mock-song-" + Math.floor(Math.random() * 100000),
            ...songData,
            addedBy: uid,
            addedByName: displayName,
            createdAt: new Date().toISOString(),
          };
          currentSongs = [newSong, ...currentSongs];
          await AsyncStorage.setItem("@worship_team_songs", JSON.stringify(currentSongs));
          if (onAddSongInline) onAddSongInline(newSong);

          const firstSong = selectedRosterSongs[0];
          const initialChoir = firstSong ? [...(firstSong.assignedChoir || [])] : [];
          const initialMusicians = firstSong ? [...(firstSong.assignedMusicians || [])] : [];
          const initialLeaders = firstSong ? [...(firstSong.assignedLeaders || [])] : [];

          setSelectedRosterSongs([
            ...selectedRosterSongs,
            {
              songId: newSong.songId,
              order: selectedRosterSongs.length + 1,
              assignedChoir: initialChoir,
              assignedMusicians: initialMusicians,
              assignedLeaders: initialLeaders,
              notes: "",
              isNewInlineSong: true,
            }
          ]);
          setSongPickerVisible(false);
          Alert.alert("Success", `"${newSong.title}" added inline and inserted into your setlist!`);
        }
      } else {
        // Firestore
        if (inlineEditMode) {
          const songDocRef = doc(db, "songs", selectedSongToEditId);
          const updatedFields = {
            ...songData,
            lastEditedBy: uid,
            lastEditedByName: displayName,
            lastEditedAt: new Date().toISOString(),
          };
          await updateDoc(songDocRef, updatedFields);
          
          const updatedSongObj = { songId: selectedSongToEditId, ...updatedFields };
          if (onUpdateSongInline) onUpdateSongInline(updatedSongObj);

          if (selectedRoster) {
            setSelectedRoster({
              ...selectedRoster,
              songs: selectedRoster.songs.map((s) => s.songId === selectedSongToEditId ? { ...s } : s)
            });
          }
          Alert.alert("Success", "Song updated successfully in Firestore!");
        } else {
          const songsCollectionRef = collection(db, "songs");
          const addedDocRef = await addDoc(songsCollectionRef, {
            ...songData,
            addedBy: uid,
            addedByName: displayName,
            createdAt: new Date().toISOString(),
          });
          
          const newSongObj = {
            songId: addedDocRef.id,
            ...songData,
            addedBy: uid,
            addedByName: displayName,
            createdAt: new Date().toISOString(),
          };
          if (onAddSongInline) onAddSongInline(newSongObj);

          const firstSong = selectedRosterSongs[0];
          const initialChoir = firstSong ? [...(firstSong.assignedChoir || [])] : [];
          const initialMusicians = firstSong ? [...(firstSong.assignedMusicians || [])] : [];
          const initialLeaders = firstSong ? [...(firstSong.assignedLeaders || [])] : [];

          setSelectedRosterSongs([
            ...selectedRosterSongs,
            {
              songId: newSongObj.songId,
              order: selectedRosterSongs.length + 1,
              assignedChoir: initialChoir,
              assignedMusicians: initialMusicians,
              assignedLeaders: initialLeaders,
              notes: "",
              isNewInlineSong: true,
            }
          ]);
          setSongPickerVisible(false);
          Alert.alert("Success", `"${newSongObj.title}" added to Firestore and your setlist!`);
        }
      }
      setInlineSongModalVisible(false);
      setInlineTitle("");
      setInlineArtist("");
      setInlineKeyRoot("C");
      setInlineKeyQuality("Major");
      setInlineBpm("75");
      setInlineLyricsEnglish("");
      setInlineLyricsTamil("");
      setInlineYoutubeLink("");
      setInlineSpotifyLink("");
      setKeyRootDropdownVisible(false);
      setKeyQualityDropdownVisible(false);
      setArtistDropdownVisible(false);
    } catch (error) {
      console.error("Failed to save inline song:", error);
      Alert.alert("Error", "Could not save song details: " + error.message);
    }
  };

  // Helper to trigger automated WhatsApp notifications on publish
  const triggerWhatsAppNotifications = async (rosterData) => {
    const dispatchOutcomes = [];
    try {
      console.log("Triggering automatic personalized WhatsApp alerts for roster:", rosterData.eventName);
      
      // 1. Gather all assigned UIDs in the roster setlist
      const assignedUserIds = new Set();
      rosterData.songs.forEach((song) => {
        if (song.assignedMusicians) {
          song.assignedMusicians.forEach((mId) => assignedUserIds.add(mId));
        }
        if (song.assignedChoir) {
          song.assignedChoir.forEach((cId) => assignedUserIds.add(cId));
        }
        if (song.assignedLeaders) {
          song.assignedLeaders.forEach((lId) => assignedUserIds.add(lId));
        }
      });
      
      const uniqueUids = Array.from(assignedUserIds);
      console.log("Unique UIDs assigned to this roster:", uniqueUids);
      
      // 2. Map UIDs to their corresponding user documents from our loaded team directory
      const assignedMembers = uniqueUids.map((uId) => {
        return teamMembers.find((m) => m.uid === uId);
      }).filter(Boolean);
      
      console.log("Resolved assigned team members with profiles:", assignedMembers.map(m => m.displayName));
      
      // 3. For each unique member, compile their personalized setlist message
      for (const member of assignedMembers) {
        if (!member.phone) {
          console.warn(`No phone number configured for user ${member.displayName}`);
          dispatchOutcomes.push({
            name: member.displayName,
            success: false,
            error: "No phone number configured in profile.",
          });
          continue;
        }
        
        const isMusician = member.role === "musician" || member.role === "musicians";
        const isChoir = member.role === "choir_member" || member.role === "choir";
        const isMember = member.role === "member" || member.role === "team_member" || member.role === "team member";
        
        // Find songs in this roster assigned to this specific member
        const memberSongs = [];
        rosterData.songs.forEach((rosterSong) => {
          const isAssigned = (rosterSong.assignedMusicians && rosterSong.assignedMusicians.includes(member.uid)) ||
                             (rosterSong.assignedChoir && rosterSong.assignedChoir.includes(member.uid)) ||
                             (rosterSong.assignedLeaders && rosterSong.assignedLeaders.includes(member.uid));
          if (isAssigned) {
            // Fetch full song details from the global songs array
            const fullSong = songs.find((s) => s.songId === rosterSong.songId) || {};
            memberSongs.push({
              ...rosterSong,
              ...fullSong
            });
          }
        });
        
        if (memberSongs.length === 0) continue;
        
        // Build the beautiful personalized header
        let message = `🎵 *Elim Worship Team*\n\n`;
        message += `*Title*: ${rosterData.eventName}\n`;
        message += `*Event Type*: ${rosterData.eventType || "Service"}\n`;
        message += `*Service Date*: ${rosterData.eventDate}\n`;
        message += `*Practice Date*: ${rosterData.rehearsalDate || "TBD"}\n\n`;
        message += `📋 *Your Assigned Setlist*:\n`;
        
        // Add each song in the order
        memberSongs.forEach((song, idx) => {
          const songNum = idx + 1;
          const songTitle = song.title || "Selected Song";
          const artistName = song.artist ? ` - ${song.artist}` : "";
          
          if (isMusician) {
            // Musician format: include Key, BPM, Time Signature, and Chords/Cue notes
            const keyVal = song.currentKey || song.originalKey || "C Major";
            const bpmVal = song.bpm || "75";
            const timeSigVal = song.timeSignature || "4/4";
            message += `\n*${songNum}. ${songTitle}${artistName}*\n`;
            message += `🎹 Key: ${keyVal} | Tempo: ${bpmVal} BPM | Time Sig: ${timeSigVal}\n`;
            if (song.notes && song.notes.trim()) {
              message += `📝 Chords/Cues: ${song.notes.trim()}\n`;
            }
          } else {
            // Choir & General Member format: include YouTube & Spotify links
            message += `\n*${songNum}. ${songTitle}${artistName}*\n`;
            if (song.youtubeLink) {
              message += `🔗 YouTube: ${song.youtubeLink}\n`;
            }
            if (song.spotifyLink) {
              message += `🔗 Spotify: ${song.spotifyLink}\n`;
            }
            if (!song.youtubeLink && !song.spotifyLink) {
              message += `ℹ️ Links: Open the app to view lyrics.\n`;
            }
          }
        });
        
        message += `\n`;
        
        // Add important instructions
        if (isMusician) {
          message += `💡 *Note*: Please check the app and click on "Ready" once you have prepared your instrumental parts.`;
        } else if (isChoir || isMember) {
          message += `💡 *Note*: Please check the app and click on "Practiced" once you have prepared your vocal parts.`;
        } else {
          message += `💡 *Note*: Please check the app to view your setlist assignments and prepare accordingly.`;
        }
        
        message += `\n\n🔗 *Click here to open the app*: https://worshipteamapp-c84e2.web.app`;
        
        console.log(`Sending personalized setlist alert to ${member.displayName} (${member.phone})`);
        const result = await sendWhatsApp(member.phone, message, "roster_published");
        if (result.success) {
          dispatchOutcomes.push({
            name: member.displayName,
            phone: member.phone,
            success: true,
          });
        } else {
          dispatchOutcomes.push({
            name: member.displayName,
            phone: member.phone,
            success: false,
            error: result.error || "Delivery failed.",
          });
        }
      }
    } catch (err) {
      console.error("Failed to execute automatic WhatsApp dispatch:", err);
    }
    return dispatchOutcomes;
  };

  // Save Roster Form (either draft or published status)
  const getRosterAssignedUids = (roster) => {
    const uids = new Set();
    if (roster && roster.songs) {
      roster.songs.forEach((s) => {
        if (s.assignedChoir && Array.isArray(s.assignedChoir)) {
          s.assignedChoir.forEach((id) => uids.add(id));
        }
        if (s.assignedMusicians && Array.isArray(s.assignedMusicians)) {
          s.assignedMusicians.forEach((id) => uids.add(id));
        }
        if (s.assignedLeaders && Array.isArray(s.assignedLeaders)) {
          s.assignedLeaders.forEach((id) => uids.add(id));
        }
      });
    }
    return Array.from(uids);
  };

  const handleSaveRoster = async (status) => {
    if (!eventName.trim()) {
      Alert.alert("Required Field", "Please enter an Event Name.");
      return;
    }
    if (!eventDate.trim()) {
      Alert.alert("Required Field", "Please enter Event Date & Time details.");
      return;
    }
    if (selectedRosterSongs.length === 0) {
      Alert.alert("Empty Setlist", "Please add at least one song to your setlist.");
      return;
    }

    const rosterData = {
      eventName: eventName.trim(),
      eventType: eventType,
      eventDate: eventDate.trim(),
      rehearsalDate: rehearsalDate.trim() || "TBD",
      status: status, // "draft" | "published"
      createdBy: uid,
      songs: selectedRosterSongs.map((s, idx) => ({ ...s, order: idx + 1 })),
    };

    try {
      if (USE_DEMO_MODE) {
        let updatedList;
        let finalRosterId = editingRosterId;
        const oldRoster = editingRosterId ? rosters.find(r => r.rosterId === editingRosterId) : null;
        
        if (editingRosterId) {
          updatedList = rosters.map((r) =>
            r.rosterId === editingRosterId
              ? { ...r, ...rosterData, updatedAt: new Date().toISOString() }
              : r
          );
        } else {
          finalRosterId = "mock-roster-" + Math.floor(Math.random() * 100000);
          const newRoster = {
            rosterId: finalRosterId,
            ...rosterData,
            createdAt: new Date().toISOString(),
          };
          updatedList = [newRoster, ...rosters];
        }

        await AsyncStorage.setItem(ROSTERS_DB_KEY, JSON.stringify(updatedList));
        setRosterList(updatedList);

        if (editingRosterId) {
          const updated = updatedList.find((r) => r.rosterId === editingRosterId);
          setSelectedRoster(updated);
          setActiveView("detail");
        } else {
          setActiveView("list");
        }

        if (status === "published") {
          const notifTitle = editingRosterId ? "✏️ Roster Updated" : "📅 New Roster Published";
          const notifMsg = getRosterDiffMessage(!!editingRosterId, oldRoster);
          
          const storedNotifs = await AsyncStorage.getItem("@worship_team_notifications");
          let currentNotifs = storedNotifs ? JSON.parse(storedNotifs) : [];
          const existingIdx = currentNotifs.findIndex((n) => n.rosterId === finalRosterId);
          
          if (existingIdx !== -1) {
            currentNotifs[existingIdx] = {
              ...currentNotifs[existingIdx],
              title: notifTitle,
              message: notifMsg,
              eventDate: eventDate.trim(),
              createdAt: new Date().toISOString(),
              senderName: displayName,
              senderUid: uid,
              acknowledgements: {}
            };
            const updatedNotif = currentNotifs[existingIdx];
            currentNotifs.splice(existingIdx, 1);
            currentNotifs.unshift(updatedNotif);
          } else {
            const newNotif = {
              notificationId: "mock-notif-" + Math.floor(Math.random() * 100000),
              title: notifTitle,
              message: notifMsg,
              rosterId: finalRosterId,
              eventDate: eventDate.trim(),
              createdAt: new Date().toISOString(),
              senderName: displayName,
              senderUid: uid,
              acknowledgements: {}
            };
            currentNotifs.unshift(newNotif);
          }
          await AsyncStorage.setItem("@worship_team_notifications", JSON.stringify(currentNotifs));

          // Trigger automatic WhatsApp dispatches
          const outcomes = await triggerWhatsAppNotifications(rosterData);

          // Send push notifications to assigned users
          try {
            const assignedUids = getRosterAssignedUids(rosterData);
            if (assignedUids.length > 0) {
              await sendPushNotificationToUsers(
                assignedUids,
                editingRosterId ? "✏️ Roster Plan Updated" : "📅 New Roster Published",
                `You have been scheduled for "${rosterData.eventName}" on ${rosterData.eventDate}.`,
                { rosterId: finalRosterId }
              );
            }
          } catch (pushErr) {
            console.warn("Failed to dispatch roster push notifications in demo mode:", pushErr);
          }
          
          let alertTitle = "📅 Roster Published & Alerts Dispatched";
          let alertMsg = `Roster saved successfully in Demo Mode!\n\n`;
          
          if (outcomes.length > 0) {
            alertMsg += `📢 WhatsApp Broadcast Delivery Summary:\n`;
            outcomes.forEach((out) => {
              if (out.success) {
                alertMsg += `✅ ${out.name} (${out.phone}) - Sent!\n`;
              } else {
                alertMsg += `❌ ${out.name} (${out.phone || "No Phone"}) - Failed: ${out.error}\n`;
              }
            });
            
            const hasSandboxFail = outcomes.some(out => !out.success && (out.error && (out.error.includes("Channel") || out.error.includes("From address") || out.error.includes("sandbox"))));
            if (hasSandboxFail) {
              alertMsg += `\n⚠️ IMPORTANT: Some numbers failed because they haven't joined the Twilio Sandbox. Remind them to send: "join <sandbox-keyword>" to the Twilio number!`;
            }
          } else {
            alertMsg += `ℹ️ No team members were assigned to songs, so no WhatsApp dispatches were required.`;
          }
          
          Alert.alert(alertTitle, alertMsg);
        } else {
          Alert.alert("Success", `Roster saved as draft successfully!`);
        }
      } else {
        // Firestore mode
        let finalRosterId = editingRosterId;
        const oldRoster = editingRosterId ? rosters.find(r => r.rosterId === editingRosterId) : null;
        
        if (editingRosterId) {
          const docRef = doc(db, "rosters", editingRosterId);
          await updateDoc(docRef, {
            ...rosterData,
            updatedAt: new Date().toISOString(),
          });
          
          setSelectedRoster({
            rosterId: editingRosterId,
            ...selectedRoster,
            ...rosterData,
            updatedAt: new Date().toISOString(),
          });
          setActiveView("detail");
        } else {
          const collRef = collection(db, "rosters");
          const addedDocRef = await addDoc(collRef, {
            ...rosterData,
            createdAt: new Date().toISOString(),
          });
          finalRosterId = addedDocRef.id;
          setActiveView("list");
        }

        if (status === "published") {
          const notifTitle = editingRosterId ? "✏️ Roster Updated" : "📅 New Roster Published";
          const notifMsg = getRosterDiffMessage(!!editingRosterId, oldRoster);
          
          const notifCollRef = collection(db, "notifications");
          const q = query(notifCollRef, where("rosterId", "==", finalRosterId));
          const querySnapshot = await getDocs(q);
          
          if (!querySnapshot.empty) {
            const existingDoc = querySnapshot.docs[0];
            const existingDocRef = doc(db, "notifications", existingDoc.id);
            await updateDoc(existingDocRef, {
              title: notifTitle,
              message: notifMsg,
              eventDate: eventDate.trim(),
              createdAt: new Date().toISOString(),
              senderName: displayName,
              senderUid: uid,
              acknowledgements: {}
            });
            console.log("Updated existing roster notification document:", existingDoc.id);
          } else {
            await addDoc(notifCollRef, {
              title: notifTitle,
              message: notifMsg,
              rosterId: finalRosterId,
              eventDate: eventDate.trim(),
              createdAt: new Date().toISOString(),
              senderName: displayName,
              senderUid: uid,
              acknowledgements: {}
            });
            console.log("Created new roster notification document");
          }

          // Trigger automatic WhatsApp dispatches
          const outcomes = await triggerWhatsAppNotifications(rosterData);

          // Send push notifications to assigned users
          try {
            const assignedUids = getRosterAssignedUids(rosterData);
            if (assignedUids.length > 0) {
              await sendPushNotificationToUsers(
                assignedUids,
                editingRosterId ? "✏️ Roster Plan Updated" : "📅 New Roster Published",
                `You have been scheduled for "${rosterData.eventName}" on ${rosterData.eventDate}.`,
                { rosterId: finalRosterId }
              );
            }
          } catch (pushErr) {
            console.warn("Failed to dispatch roster push notifications in live mode:", pushErr);
          }
          
          let alertTitle = "📅 Roster Published & Alerts Dispatched";
          let alertMsg = `Roster saved successfully!\n\n`;
          
          if (outcomes.length > 0) {
            alertMsg += `📢 WhatsApp Broadcast Delivery Summary:\n`;
            outcomes.forEach((out) => {
              if (out.success) {
                alertMsg += `✅ ${out.name} (${out.phone}) - Sent!\n`;
              } else {
                alertMsg += `❌ ${out.name} (${out.phone || "No Phone"}) - Failed: ${out.error}\n`;
              }
            });
            
            const hasSandboxFail = outcomes.some(out => !out.success && (out.error && (out.error.includes("Channel") || out.error.includes("From address") || out.error.includes("sandbox"))));
            if (hasSandboxFail) {
              alertMsg += `\n⚠️ IMPORTANT: Some numbers failed because they haven't joined the Twilio Sandbox. Remind them to send: "join <sandbox-keyword>" to the Twilio number!`;
            }
          } else {
            alertMsg += `ℹ️ No team members were assigned to songs, so no WhatsApp dispatches were required.`;
          }
          
          Alert.alert(alertTitle, alertMsg);
        } else {
          Alert.alert("Success", `Roster saved as draft successfully!`);
        }
      }
    } catch (err) {
      console.error("Save Roster error:", err);
      Alert.alert("Error", "Unable to save roster: " + err.message);
    }
  };

  // Add song to setlist in Draft builder
  const handleAddSongToRoster = (song) => {
    // Check if song already exists in draft setlist
    if (selectedRosterSongs.some((s) => s.songId === song.songId)) {
      Alert.alert("Song Added", "This song is already in your setlist.");
      return;
    }

    const firstSong = selectedRosterSongs[0];
    const initialChoir = firstSong ? [...(firstSong.assignedChoir || [])] : [];
    const initialMusicians = firstSong ? [...(firstSong.assignedMusicians || [])] : [];
    const initialLeaders = firstSong ? [...(firstSong.assignedLeaders || [])] : [];

    setSelectedRosterSongs([
      ...selectedRosterSongs,
      {
        songId: song.songId,
        order: selectedRosterSongs.length + 1,
        assignedChoir: initialChoir,
        assignedMusicians: initialMusicians,
        assignedLeaders: initialLeaders,
        notes: "",
      },
    ]);
    setSongPickerVisible(false);
    setSongSearchQuery("");
  };

  // Remove song from setlist in Draft builder
  const handleRemoveSongFromRoster = (songId) => {
    const updated = selectedRosterSongs.filter((s) => s.songId !== songId);
    setSelectedRosterSongs(updated);
  };

  // Reorder Songs inside setlist
  const moveSong = (index, direction) => {
    const updated = [...selectedRosterSongs];
    if (direction === "up" && index > 0) {
      const temp = updated[index];
      updated[index] = updated[index - 1];
      updated[index - 1] = temp;
    } else if (direction === "down" && index < updated.length - 1) {
      const temp = updated[index];
      updated[index] = updated[index + 1];
      updated[index + 1] = temp;
    }
    setSelectedRosterSongs(updated);
  };

  // Toggle user assignment on draft song item
  const handleToggleAssignUser = (songId, userUid, assignmentType) => {
    const isFirstSong = selectedRosterSongs[0]?.songId === songId;
    const updated = selectedRosterSongs.map((s) => {
      if (s.songId === songId) {
        let listField = "assignedMusicians";
        if (assignmentType === "choir") listField = "assignedChoir";
        else if (assignmentType === "leader") listField = "assignedLeaders";

        const currentList = s[listField] || [];
        const newList = currentList.includes(userUid)
          ? currentList.filter((id) => id !== userUid)
          : [...currentList, userUid];
        return { ...s, [listField]: newList };
      }
      return s;
    });

    if (isFirstSong) {
      let listField = "assignedMusicians";
      if (assignmentType === "choir") listField = "assignedChoir";
      else if (assignmentType === "leader") listField = "assignedLeaders";

      const targetFirstSong = updated[0];
      if (targetFirstSong) {
        const firstSongList = targetFirstSong[listField] || [];
        for (let i = 1; i < updated.length; i++) {
          updated[i] = { ...updated[i], [listField]: [...firstSongList] };
        }
      }
    }

    setSelectedRosterSongs(updated);
  };

  // Edit song notes in draft builder
  const handleEditSongNote = (songId, notesText) => {
    const updated = selectedRosterSongs.map((s) => {
      if (s.songId === songId) {
        return { ...s, notes: notesText };
      }
      return s;
    });
    setSelectedRosterSongs(updated);
  };

  // Helper: Find Song Details by ID
  const getSongById = (songId) => {
    return songs.find((s) => s.songId === songId || s.id === songId) || {};
  };

  // Helper: Find User Details by ID
  const getUserById = (userUid) => {
    return teamMembers.find((m) => m.uid === userUid) || { displayName: "Unknown User" };
  };

  // Filter roster list based on user role (Members/Band see published only; Worship Leader sees drafts too)
  const getFilteredRosters = () => {
    if (role === "worship_leader" || role === "super_admin") {
      return rosters;
    }
    return rosters.filter((r) => r.status === "published");
  };

  const formattedDate = (isoStr) => {
    if (!isoStr) return "N/A";
    try {
      const date = new Date(isoStr);
      if (isNaN(date.getTime())) return isoStr;
      return date.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return isoStr;
    }
  };

  // =========================================================================
  // VIEW RENDERERS
  // =========================================================================

  // RENDERER: Roster Dashboard List Page
  const renderRosterList = () => {
    const listData = getFilteredRosters();

    return (
      <View style={styles.viewContainer}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Service Rosters</Text>
          {(role === "worship_leader" || role === "super_admin") && (
            <TouchableOpacity
              style={[styles.addButton, { backgroundColor: themeColor }]}
              activeOpacity={0.8}
              onPress={handleInitiateCreate}
            >
              <Text style={styles.addButtonText}>+ Create Roster</Text>
            </TouchableOpacity>
          )}
        </View>

        {listData.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyEmoji}>📅</Text>
            <Text style={styles.emptyText}>No rosters have been scheduled yet</Text>
            {(role === "worship_leader" || role === "super_admin") ? (
              <TouchableOpacity
                style={[styles.emptyAddButton, { borderColor: themeColor }]}
                activeOpacity={0.8}
                onPress={handleInitiateCreate}
              >
                <Text style={[styles.emptyAddButtonText, { color: themeColor }]}>
                  Schedule First Roster
                </Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.emptySubtext}>
                Check back soon! Worship leaders will publish schedules once sets are planned.
              </Text>
            )}
          </View>
        ) : (
          <FlatList
            data={listData}
            keyExtractor={(item) => item.rosterId}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => {
              const isDraft = item.status === "draft";
              return (
                <TouchableOpacity
                  style={styles.rosterCard}
                  activeOpacity={0.7}
                  onPress={() => handleSelectRoster(item)}
                >
                  <View style={styles.cardHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rosterTitle} numberOfLines={1}>
                        {item.eventName}
                      </Text>
                      <Text style={styles.rosterDate}>
                        📅 {formattedDate(item.eventDate)}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.statusBadge,
                        {
                          backgroundColor: isDraft
                            ? "rgba(245, 158, 11, 0.15)"
                            : "rgba(16, 185, 129, 0.15)",
                          borderColor: isDraft
                            ? "rgba(245, 158, 11, 0.3)"
                            : "rgba(16, 185, 129, 0.3)",
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.statusBadgeText,
                          { color: isDraft ? "#F59E0B" : "#10B981" },
                        ]}
                      >
                        {isDraft ? "Draft" : "Published"}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.cardDivider} />

                  <View style={styles.cardFooter}>
                    <Text style={styles.footerItem}>
                      🎵 {item.songs ? item.songs.length : 0} Songs
                    </Text>
                    <Text style={styles.footerItem}>
                      🏛️ {item.eventType}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            }}
          />
        )}
      </View>
    );
  };

  // RENDERER: Roster Create & Edit Draft Page (Worship Leader Only)
  const renderCreateRosterForm = () => {
    // Filter songs for search addition in modal
    const matchedSearchSongs = songs.filter((s) => {
      const q = songSearchQuery.toLowerCase().trim();
      if (!q) return true;
      return (
        s.title?.toLowerCase().includes(q) ||
        s.artist?.toLowerCase().includes(q) ||
        s.originalKey?.toLowerCase().includes(q) ||
        (s.currentKey && s.currentKey.toLowerCase().includes(q))
      );
    });

    const activeChoirList = teamMembers.filter((m) => m.role === "choir_member" || m.role === "member");
    const activeMusicianList = teamMembers.filter((m) => m.role === "musician" || m.role === "musicians");
    const activeWorshipLeaderList = teamMembers.filter((m) => m.role === "worship_leader");

    return (
      <View style={styles.viewContainer}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => setActiveView(editingRosterId ? "detail" : "list")}
            activeOpacity={0.7}
          >
            <Text style={styles.backButtonText}>← Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {editingRosterId ? "Edit Service Roster" : "Plan New Service"}
          </Text>
          <TouchableOpacity
            style={[styles.saveButton, { backgroundColor: "#10B981" }]}
            activeOpacity={0.8}
            onPress={() => handleSaveRoster("published")}
          >
            <Text style={styles.saveButtonText}>
              {editingRosterId ? "Save" : "Publish"}
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Metadata Form Section */}
          <View style={styles.metaCard}>
            <Text style={styles.formSectionTitle}>Event Information</Text>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Event Title *</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Sunday Morning Thanksgiving"
                placeholderTextColor="#64748B"
                value={eventName}
                onChangeText={setEventName}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Event Type</Text>
              <TouchableOpacity
                style={[styles.input, styles.dropdownTrigger]}
                onPress={() => setEventTypePickerVisible(true)}
                activeOpacity={0.7}
              >
                <Text style={styles.dropdownValueText}>{eventType}</Text>
                <Text style={[styles.dropdownChevron, { color: themeColor }]}>▼</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.row}>
              <View style={[styles.formGroup, { flex: 1, marginRight: 8 }]}>
                <Text style={styles.label}>Service Date & Time *</Text>
                <TouchableOpacity
                  style={[styles.input, styles.datePickerTrigger]}
                  onPress={() => openDatePicker("event")}
                  activeOpacity={0.7}
                >
                  <Text style={eventDate ? styles.datePickerValueText : styles.datePickerPlaceholderText}>
                    {eventDate || "Choose Date & Time"}
                  </Text>
                  <Text style={[styles.datePickerIcon, { color: themeColor }]}>📅</Text>
                </TouchableOpacity>
              </View>

              <View style={[styles.formGroup, { flex: 1 }]}>
                <Text style={styles.label}>Practice Date & Time</Text>
                <TouchableOpacity
                  style={[styles.input, styles.datePickerTrigger]}
                  onPress={() => openDatePicker("practice")}
                  activeOpacity={0.7}
                >
                  <Text style={rehearsalDate ? styles.datePickerValueText : styles.datePickerPlaceholderText}>
                    {rehearsalDate || "Choose Date & Time"}
                  </Text>
                  <Text style={[styles.datePickerIcon, { color: themeColor }]}>📅</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Roster Setlist Creator Section */}
          <View style={styles.setlistContainer}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Service Setlist</Text>
              <TouchableOpacity
                style={[styles.smallAddButton, { borderColor: themeColor }]}
                activeOpacity={0.7}
                onPress={() => setSongPickerVisible(true)}
              >
                <Text style={[styles.smallAddButtonText, { color: themeColor }]}>
                  + Add Song
                </Text>
              </TouchableOpacity>
            </View>

            {selectedRosterSongs.length === 0 ? (
              <View style={styles.emptySetlistPlaceholder}>
                <Text style={styles.emptyPlaceholderEmoji}>🎵</Text>
                <Text style={styles.emptyPlaceholderText}>No songs in this setlist yet</Text>
                <TouchableOpacity
                  style={[styles.inlineAddButton, { backgroundColor: themeColor }]}
                  activeOpacity={0.8}
                  onPress={() => setSongPickerVisible(true)}
                >
                  <Text style={styles.inlineAddButtonText}>Select Songs</Text>
                </TouchableOpacity>
              </View>
            ) : (
              selectedRosterSongs.map((rosterSong, index) => {
                const songDetail = getSongById(rosterSong.songId);
                const activeKey = songDetail.currentKey || songDetail.originalKey || "N/A";

                return (
                  <View key={rosterSong.songId} style={styles.draftSongItem}>
                    {/* Song Basic Info & Order Actions */}
                    <View style={styles.draftSongHeader}>
                      <View style={styles.draftSongInfo}>
                        <Text style={styles.draftSongOrderText}>#{index + 1}</Text>
                        <View style={{ flex: 1, paddingRight: 6 }}>
                          <Text style={styles.draftSongTitle} numberOfLines={1}>
                            {songDetail.title || "Unknown Song"}
                          </Text>
                          <Text style={styles.draftSongArtist} numberOfLines={1}>
                            {songDetail.artist || "Unknown Artist"} • Key: {activeKey}
                          </Text>
                        </View>
                      </View>

                      {/* Sorting & Deletion Triggers */}
                      <View style={styles.draftSongActions}>
                        <TouchableOpacity
                          style={[styles.sortArrowButton, index === 0 && styles.disabledSortArrow]}
                          disabled={index === 0}
                          onPress={() => moveSong(index, "up")}
                        >
                          <Text style={styles.sortArrowText}>▲</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[
                            styles.sortArrowButton,
                            index === selectedRosterSongs.length - 1 && styles.disabledSortArrow,
                          ]}
                          disabled={index === selectedRosterSongs.length - 1}
                          onPress={() => moveSong(index, "down")}
                        >
                          <Text style={styles.sortArrowText}>▼</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.deleteSongButton}
                          onPress={() => handleRemoveSongFromRoster(rosterSong.songId)}
                        >
                          <Text style={styles.deleteSongText}>✕</Text>
                        </TouchableOpacity>
                      </View>
                    </View>

                    {/* Member assignment checkboxes */}
                    <View style={styles.assignmentPanel}>
                      {index === 0 && (
                        <View style={styles.propagationNoteContainer}>
                          <Text style={styles.propagationNoteText}>
                            💡 Smart Auto-Propagation: Assigning vocalists and musicians to this 1st song automatically propagates them to all subsequent songs in your setlist!
                          </Text>
                        </View>
                      )}
                      {/* Worship Leaders Assignment List */}
                      <Text style={styles.assignmentLabel}>Assign Worship Leaders:</Text>
                      <View style={styles.checkboxesContainer}>
                        {activeWorshipLeaderList.map((leaderUser) => {
                          const isAssigned = rosterSong.assignedLeaders?.includes(leaderUser.uid);
                          return (
                            <TouchableOpacity
                              key={leaderUser.uid}
                              style={[
                                styles.checkboxBadge,
                                {
                                  backgroundColor: isAssigned ? "#F59E0B" : "#111827",
                                  borderColor: isAssigned ? "#F59E0B" : "#334155",
                                },
                              ]}
                              onPress={() =>
                                handleToggleAssignUser(rosterSong.songId, leaderUser.uid, "leader")
                              }
                            >
                              <Text
                                style={[
                                  styles.checkboxBadgeText,
                                  { color: isAssigned ? "#FFFFFF" : "#94A3B8" },
                                ]}
                              >
                                👑 {leaderUser.displayName}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>

                      {/* Choir Vocalists Assignment List */}
                      <Text style={styles.assignmentLabel}>Assign Choir Vocals:</Text>
                      <View style={styles.checkboxesContainer}>
                        {activeChoirList.map((choirUser) => {
                          const isAssigned = rosterSong.assignedChoir?.includes(choirUser.uid);
                          return (
                            <TouchableOpacity
                              key={choirUser.uid}
                              style={[
                                styles.checkboxBadge,
                                {
                                  backgroundColor: isAssigned ? "#0D9488" : "#111827",
                                  borderColor: isAssigned ? "#0D9488" : "#334155",
                                },
                              ]}
                              onPress={() =>
                                handleToggleAssignUser(rosterSong.songId, choirUser.uid, "choir")
                              }
                            >
                              <Text
                                style={[
                                  styles.checkboxBadgeText,
                                  { color: isAssigned ? "#FFFFFF" : "#94A3B8" },
                                ]}
                              >
                                🎤 {choirUser.displayName}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>

                      {/* Musician Band Assignment List */}
                      <Text style={styles.assignmentLabel}>Assign Musicians:</Text>
                      <View style={styles.checkboxesContainer}>
                        {activeMusicianList.map((musicUser) => {
                          const isAssigned = rosterSong.assignedMusicians?.includes(musicUser.uid);
                          return (
                            <TouchableOpacity
                              key={musicUser.uid}
                              style={[
                                styles.checkboxBadge,
                                {
                                  backgroundColor: isAssigned ? "#A855F7" : "#111827",
                                  borderColor: isAssigned ? "#A855F7" : "#334155",
                                },
                              ]}
                              onPress={() =>
                                handleToggleAssignUser(rosterSong.songId, musicUser.uid, "musician")
                              }
                            >
                              <Text
                                style={[
                                  styles.checkboxBadgeText,
                                  { color: isAssigned ? "#FFFFFF" : "#94A3B8" },
                                ]}
                              >
                                🎸 {musicUser.displayName}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>

                      {/* Per-Song notes input */}
                      <Text style={styles.assignmentLabel}>Song Performance Notes:</Text>
                      <TextInput
                        style={styles.notesFieldInput}
                        placeholder="e.g. Bass guitar starts on verse 2. Swells on electric..."
                        placeholderTextColor="#475569"
                        value={rosterSong.notes}
                        onChangeText={(txt) => handleEditSongNote(rosterSong.songId, txt)}
                        multiline={true}
                        numberOfLines={2}
                      />
                    </View>
                  </View>
                );
              })
            )}
          </View>

          {/* Action Buttons Row */}
          <View style={styles.draftActionsContainer}>
            <TouchableOpacity
              style={[styles.primaryActionButton, { backgroundColor: "#10B981" }]}
              activeOpacity={0.8}
              onPress={() => handleSaveRoster("published")}
            >
              <Text style={styles.primaryActionButtonText}>
                {editingRosterId ? "Save Changes & Publish" : "Publish Roster"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.secondaryActionButton, { backgroundColor: "#1E293B", borderColor: "#334155", borderWidth: 1 }]}
              activeOpacity={0.8}
              onPress={() => handleSaveRoster("draft")}
            >
              <Text style={styles.secondaryActionButtonText}>
                {editingRosterId ? "Save Changes as Draft" : "Save as Draft"}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>

        {/* MODAL: EVENT TYPE PICKER */}
        <Modal
          visible={eventTypePickerVisible}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setEventTypePickerVisible(false)}
        >
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setEventTypePickerVisible(false)}
          >
            <View style={styles.pickerModalContent}>
              <Text style={styles.modalTitle}>Select Event Type</Text>
              {eventTypes.map((type) => (
                <TouchableOpacity
                  key={type}
                  style={[
                    styles.pickerOptionTile,
                    eventType === type && { backgroundColor: themeColor + "20" },
                  ]}
                  onPress={() => {
                    setEventType(type);
                    setEventTypePickerVisible(false);
                  }}
                >
                  <Text
                    style={[
                      styles.pickerOptionText,
                      eventType === type ? { color: themeColor, fontWeight: "800" } : null,
                    ]}
                  >
                    {type}
                  </Text>
                </TouchableOpacity>
              ))}

              <View style={styles.addCustomEventContainer}>
                <TextInput
                  style={styles.customEventInput}
                  placeholder="Create custom event type..."
                  placeholderTextColor="#64748B"
                  value={customEventTypeInput}
                  onChangeText={setCustomEventTypeInput}
                />
                <TouchableOpacity
                  style={[styles.addCustomEventBtn, { backgroundColor: themeColor }]}
                  onPress={handleAddCustomEventType}
                >
                  <Text style={styles.addCustomEventBtnText}>Add</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableOpacity>
        </Modal>

        {/* MODAL: DUAL-MODE CALENDAR DATE PICKER */}
        <Modal
          visible={datePickerVisible}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setDatePickerVisible(false)}
        >
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setDatePickerVisible(false)}
          >
            <View style={styles.calendarModalContent}>
              {/* Header */}
              <View style={styles.calendarHeader}>
                <Text style={styles.calendarHeaderTitle}>
                  {datePickerTarget === "event" ? "Service Date & Time" : "Practice Date & Time"}
                </Text>
                <TouchableOpacity
                  style={styles.calendarCloseButton}
                  onPress={() => setDatePickerVisible(false)}
                >
                  <Text style={styles.calendarCloseText}>✕</Text>
                </TouchableOpacity>
              </View>

              {/* Toggle row between Calendar view and time elements */}
              <View style={styles.pickerModeSelectionRow}>
                <TouchableOpacity
                  style={[
                    styles.pickerModeTab,
                    timeSubPicker === "none" && [styles.pickerModeTabActive, { borderBottomColor: themeColor }]
                  ]}
                  onPress={() => setTimeSubPicker("none")}
                >
                  <Text style={[styles.pickerModeTabText, timeSubPicker === "none" && { color: themeColor }]}>
                    Date Calendar
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.pickerModeTab,
                    timeSubPicker === "hour" && [styles.pickerModeTabActive, { borderBottomColor: themeColor }]
                  ]}
                  onPress={() => setTimeSubPicker("hour")}
                >
                  <Text style={[styles.pickerModeTabText, timeSubPicker === "hour" && { color: themeColor }]}>
                    Set Hour ({selectedHour})
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.pickerModeTab,
                    timeSubPicker === "minute" && [styles.pickerModeTabActive, { borderBottomColor: themeColor }]
                  ]}
                  onPress={() => setTimeSubPicker("minute")}
                >
                  <Text style={[styles.pickerModeTabText, timeSubPicker === "minute" && { color: themeColor }]}>
                    Set Minute ({selectedMinute})
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Dynamic Sub-View Picker */}
              {timeSubPicker === "none" && (
                <View style={styles.calendarContainer}>
                  {/* Month Year Navigation */}
                  <View style={styles.calendarMonthNav}>
                    <TouchableOpacity onPress={handlePrevMonth} style={styles.calendarArrowBtn}>
                      <Text style={styles.calendarArrowText}>◀</Text>
                    </TouchableOpacity>
                    <Text style={styles.calendarMonthNavText}>
                      {MONTHS_LIST[calendarMonth.getMonth()]} {calendarMonth.getFullYear()}
                    </Text>
                    <TouchableOpacity onPress={handleNextMonth} style={styles.calendarArrowBtn}>
                      <Text style={styles.calendarArrowText}>▶</Text>
                    </TouchableOpacity>
                  </View>

                  {/* Weekday headers */}
                  <View style={styles.calendarWeekDays}>
                    {WEEKDAYS.map((day) => (
                      <View key={day} style={styles.calendarWeekDayCell}>
                        <Text style={styles.calendarWeekDayText}>{day}</Text>
                      </View>
                    ))}
                  </View>

                  {/* Days grid generator */}
                  <FlatList
                    data={(() => {
                      const totalDays = getDaysInMonth(calendarMonth.getFullYear(), calendarMonth.getMonth());
                      const firstDay = getFirstDayOfMonth(calendarMonth.getFullYear(), calendarMonth.getMonth());
                      const arr = [];
                      for (let i = 0; i < firstDay; i++) arr.push(null);
                      for (let d = 1; d <= totalDays; d++) arr.push(d);
                      return arr;
                    })()}
                    keyExtractor={(item, index) => index.toString()}
                    numColumns={7}
                    scrollEnabled={false}
                    renderItem={({ item }) => {
                      if (item === null) {
                        return <View style={styles.calendarEmptyCell} />;
                      }
                      const isSelected = selectedCalendarDay === item;
                      return (
                        <TouchableOpacity
                          style={[
                            styles.calendarDayCell,
                            isSelected && [styles.calendarDaySelected, { backgroundColor: themeColor }]
                          ]}
                          onPress={() => setSelectedCalendarDay(item)}
                        >
                          <Text style={[styles.calendarDayText, isSelected && styles.calendarDaySelectedText]}>
                            {item ? item.toString() : ""}
                          </Text>
                        </TouchableOpacity>
                      );
                    }}
                  />
                </View>
              )}

              {timeSubPicker === "hour" && (
                <View style={styles.selectionGridContainer}>
                  <Text style={styles.selectionSectionTitle}>Select Hour (AM/PM style)</Text>
                  <FlatList
                    data={["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"]}
                    keyExtractor={(item) => item}
                    numColumns={4}
                    scrollEnabled={false}
                    renderItem={({ item }) => {
                      const isSel = selectedHour === item;
                      return (
                        <TouchableOpacity
                          style={[
                            styles.timeGridItem,
                            isSel && [styles.timeGridItemSelected, { backgroundColor: themeColor }]
                          ]}
                          onPress={() => {
                            setSelectedHour(item);
                            setTimeSubPicker("none"); // Return to calendar on selection
                          }}
                        >
                          <Text style={[styles.timeGridItemText, isSel && styles.timeGridItemSelectedText]}>
                            {item}
                          </Text>
                        </TouchableOpacity>
                      );
                    }}
                  />
                </View>
              )}

              {timeSubPicker === "minute" && (
                <View style={styles.selectionGridContainer}>
                  <Text style={styles.selectionSectionTitle}>Select Minute</Text>
                  <FlatList
                    data={["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"]}
                    keyExtractor={(item) => item}
                    numColumns={4}
                    scrollEnabled={false}
                    renderItem={({ item }) => {
                      const isSel = selectedMinute === item;
                      return (
                        <TouchableOpacity
                          style={[
                            styles.timeGridItem,
                            isSel && [styles.timeGridItemSelected, { backgroundColor: themeColor }]
                          ]}
                          onPress={() => {
                            setSelectedMinute(item);
                            setTimeSubPicker("none"); // Return to calendar on selection
                          }}
                        >
                          <Text style={[styles.timeGridItemText, isSel && styles.timeGridItemSelectedText]}>
                            {item}
                          </Text>
                        </TouchableOpacity>
                      );
                    }}
                  />
                </View>
              )}

              {/* AM/PM and Display row */}
              <View style={styles.calendarTimeDisplayRow}>
                <View style={styles.timeValueDisplayBox}>
                  <Text style={styles.timeValueDisplayText}>
                    Time: {selectedHour}:{selectedMinute} {selectedAmpm}
                  </Text>
                </View>

                <View style={styles.ampmButtonsContainer}>
                  {["AM", "PM"].map((mode) => (
                    <TouchableOpacity
                      key={mode}
                      style={[
                        styles.ampmSelectorBtn,
                        selectedAmpm === mode && [styles.ampmSelectorBtnActive, { backgroundColor: themeColor }]
                      ]}
                      onPress={() => setSelectedAmpm(mode)}
                    >
                      <Text style={[styles.ampmSelectorBtnText, selectedAmpm === mode && styles.ampmSelectorBtnTextActive]}>
                        {mode}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Confirm trigger */}
              <TouchableOpacity
                style={[styles.confirmDatePickerBtn, { backgroundColor: "#10B981" }]}
                onPress={handleConfirmPickedDate}
              >
                <Text style={styles.confirmDatePickerBtnText}>
                  Confirm Date & Time
                </Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>

        {/* MODAL: SONGS DATABASE PICKER */}
        <Modal
          visible={songPickerVisible}
          transparent={true}
          animationType="slide"
          onRequestClose={() => setSongPickerVisible(false)}
        >
          <View style={styles.songPickerOverlay}>
            <View style={styles.songPickerContent}>
              {/* Modal Header */}
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Search & Add Songs</Text>
                <TouchableOpacity
                  style={styles.modalCloseButton}
                  onPress={() => setSongPickerVisible(false)}
                >
                  <Text style={styles.modalCloseText}>✕</Text>
                </TouchableOpacity>
              </View>

              {/* Inline Search Box */}
              <View style={styles.modalSearchContainer}>
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search by title, artist, key..."
                  placeholderTextColor="#64748B"
                  value={songSearchQuery}
                  onChangeText={setSongSearchQuery}
                />
              </View>

              {/* Filtered Songs List */}
              <FlatList
                data={matchedSearchSongs}
                keyExtractor={(item) => item.songId || item.id}
                contentContainerStyle={{ padding: 16 }}
                ListEmptyComponent={() => (
                  <View style={styles.emptySearchContainer}>
                    <Text style={styles.emptySearchText}>No songs found matching "{songSearchQuery}"</Text>
                    <TouchableOpacity
                      style={styles.inlineAddSongBtn}
                      onPress={() => handleOpenInlineAddSong(songSearchQuery)}
                    >
                      <Text style={styles.inlineAddSongBtnText}>➕ Add "{songSearchQuery}" Inline</Text>
                    </TouchableOpacity>
                  </View>
                )}
                renderItem={({ item }) => {
                  const activeKey = item.currentKey || item.originalKey || "N/A";
                  const alreadyAdded = selectedRosterSongs.some((s) => s.songId === item.songId);

                  return (
                    <View style={styles.pickerSongCard}>
                      <View style={{ flex: 1, paddingRight: 8 }}>
                        <Text style={styles.pickerSongTitle} numberOfLines={1}>
                          {item.title}
                        </Text>
                        <Text style={styles.pickerSongArtist} numberOfLines={1}>
                          {item.artist} • Key: {activeKey}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={[
                          styles.addSongButtonTrigger,
                          {
                            backgroundColor: alreadyAdded
                              ? "rgba(16, 185, 129, 0.15)"
                              : themeColor,
                            borderColor: alreadyAdded ? "rgba(16, 185, 129, 0.3)" : themeColor,
                          },
                        ]}
                        disabled={alreadyAdded}
                        onPress={() => handleAddSongToRoster(item)}
                      >
                        <Text
                          style={[
                            styles.addSongButtonTriggerText,
                            { color: alreadyAdded ? "#10B981" : "#FFFFFF" },
                          ]}
                        >
                          {alreadyAdded ? "✓ Added" : "+ Add"}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  );
                }}
              />
            </View>
          </View>
        </Modal>
      </View>
    );
  };

  // RENDERER: Roster Details & Practice Tracker Screens (Role Specific)
  const renderRosterDetails = () => {
    if (!selectedRoster) return null;

    const eventDateFormatted = formattedDate(selectedRoster.eventDate);
    const rehearsalDateFormatted = formattedDate(selectedRoster.rehearsalDate);

    // Choir Practice Tracker Progress Counts
    const choirAssignedSongs = selectedRoster.songs?.filter((s) =>
      (s.assignedChoir || []).includes(uid)
    ) || [];
    const countChoirPracticed = choirAssignedSongs.filter((s) => !!practicedLogs[s.songId]).length;
    const choirPercentage = choirAssignedSongs.length > 0 ? (countChoirPracticed / choirAssignedSongs.length) * 100 : 0;

    // Musician Ready Tracker Progress Counts
    const musicianSongsCount = selectedRoster.songs?.length || 0;
    const countMusicianReady = selectedRoster.songs?.filter((s) => !!readyLogs[s.songId]).length || 0;
    const musicianPercentage = musicianSongsCount > 0 ? (countMusicianReady / musicianSongsCount) * 100 : 0;

    // Calculate Admin overall dashboard metrics
    let totalVocalistAssignments = 0;
    let practicedVocalistAssignments = 0;
    let totalMusicianAssignments = 0;
    let readyMusicianAssignments = 0;

    selectedRoster.songs?.forEach((rosterSong) => {
      const assignedChoir = rosterSong.assignedChoir || [];
      const assignedMusicians = rosterSong.assignedMusicians || [];

      totalVocalistAssignments += assignedChoir.length;
      assignedChoir.forEach((vUid) => {
        if (allPracticedLogs[vUid]?.[rosterSong.songId]) {
          practicedVocalistAssignments++;
        }
      });

      totalMusicianAssignments += assignedMusicians.length;
      assignedMusicians.forEach((mUid) => {
        if (allReadyLogs[mUid]?.[rosterSong.songId]) {
          readyMusicianAssignments++;
        }
      });
    });

    const adminVocalistPercent = totalVocalistAssignments > 0 ? (practicedVocalistAssignments / totalVocalistAssignments) * 100 : 0;
    const adminMusicianPercent = totalMusicianAssignments > 0 ? (readyMusicianAssignments / totalMusicianAssignments) * 100 : 0;

    return (
      <View style={styles.viewContainer}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => setActiveView("list")}
            activeOpacity={0.7}
          >
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {selectedRoster.eventName}
          </Text>
          {(role === "worship_leader" || role === "super_admin") ? (
            <TouchableOpacity
              style={[styles.editButton, { borderColor: themeColor }]}
              onPress={() => handleInitiateEdit(selectedRoster)}
              activeOpacity={0.7}
            >
              <Text style={[styles.editButtonText, { color: themeColor }]}>Edit</Text>
            </TouchableOpacity>
          ) : (
            <View style={{ width: 60 }} />
          )}
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {/* Metadata banner card */}
          <View style={styles.metaCard}>
            <Text style={[styles.rosterSubtitle, { color: themeColor }]}>
              {(selectedRoster.eventType || "").toUpperCase()}
            </Text>
            <Text style={styles.detailRosterTitle}>{selectedRoster.eventName}</Text>

            <View style={styles.divider} />

            <View style={styles.timeInfoGrid}>
              <View style={styles.timeInfoItem}>
                <Text style={styles.timeInfoLabel}>⏰ SERVICE TIME</Text>
                <Text style={styles.timeInfoValue}>{eventDateFormatted}</Text>
              </View>
              <View style={styles.timeInfoItem}>
                <Text style={styles.timeInfoLabel}>⏰ PRACTICE TIME</Text>
                <Text style={styles.timeInfoValue}>{rehearsalDateFormatted}</Text>
              </View>
            </View>

            {(role === "worship_leader" || role === "super_admin") && (
              <TouchableOpacity
                style={[styles.copyWhatsAppBtn, { backgroundColor: themeColor + "15", borderColor: themeColor, borderWidth: 1 }]}
                onPress={() => handleCopyRosterWhatsAppMessage(selectedRoster)}
                activeOpacity={0.8}
              >
                <Text style={[styles.copyWhatsAppBtnText, { color: themeColor }]}>
                  📋 Copy WhatsApp Message to Clipboard
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Worship Leader (Admin) Dashboard Overview */}
          {(role === "worship_leader" || role === "super_admin") && (
            <View style={styles.adminDashboardCard}>
              <Text style={styles.adminDashboardTitle}>📋 Practice Completion Overview</Text>

              <View style={styles.adminMetricRow}>
                <Text style={styles.adminMetricLabel}>🎤 Choir Vocalist Practice:</Text>
                <Text style={styles.adminMetricValue}>
                  {practicedVocalistAssignments} of {totalVocalistAssignments} completed ({Math.round(adminVocalistPercent)}%)
                </Text>
              </View>
              <View style={styles.progressBarBg}>
                <View
                  style={[
                    styles.progressBarActive,
                    {
                      backgroundColor: "#0D9488",
                      width: `${adminVocalistPercent}%`,
                    },
                  ]}
                />
              </View>

              <View style={[styles.adminMetricRow, { marginTop: 12 }]}>
                <Text style={styles.adminMetricLabel}>🎸 Band Readiness Checklist:</Text>
                <Text style={styles.adminMetricValue}>
                  {readyMusicianAssignments} of {totalMusicianAssignments} completed ({Math.round(adminMusicianPercent)}%)
                </Text>
              </View>
              <View style={styles.progressBarBg}>
                <View
                  style={[
                    styles.progressBarActive,
                    {
                      backgroundColor: "#A855F7",
                      width: `${adminMusicianPercent}%`,
                    },
                  ]}
                />
              </View>
            </View>
          )}

          {/* Dynamic role progress bar indicators */}
          {(role === "choir_member" || role === "member") && choirAssignedSongs.length > 0 && (
            <View style={[styles.roleProgressCard, { borderColor: "#0D9488" }]}>
              <Text style={styles.roleProgressTitle}>🎤 Choir Practice Progress</Text>
              <Text style={styles.roleProgressSub}>
                {countChoirPracticed} of {choirAssignedSongs.length} songs marked as practiced
              </Text>
              <View style={styles.progressBarBg}>
                <View
                  style={[
                    styles.progressBarActive,
                    {
                      backgroundColor: "#0D9488",
                      width: `${choirPercentage}%`,
                    },
                  ]}
                />
              </View>
            </View>
          )}

          {role === "musician" && musicianSongsCount > 0 && (
            <View style={[styles.roleProgressCard, { borderColor: "#A855F7" }]}>
              <Text style={styles.roleProgressTitle}>🎸 Band Readiness Checklist</Text>
              <Text style={styles.roleProgressSub}>
                {countMusicianReady} of {musicianSongsCount} songs marked as ready
              </Text>
              <View style={styles.progressBarBg}>
                <View
                  style={[
                    styles.progressBarActive,
                    {
                      backgroundColor: "#A855F7",
                      width: `${musicianPercentage}%`,
                    },
                  ]}
                />
              </View>
            </View>
          )}

          {/* Roster Setlist Display Section */}
          <Text style={styles.setlistHeader}>Worship Setlist</Text>

          <View style={styles.setlistContainer}>
            {(selectedRoster.songs || []).map((rosterSong, index) => {
              const song = getSongById(rosterSong.songId);
              const assignedChoir = rosterSong.assignedChoir || [];
              const assignedMusicians = rosterSong.assignedMusicians || [];
              const assignedLeaders = rosterSong.assignedLeaders || [];

              const isChoirAssigned = !!assignedChoir.includes(uid);
              const isMusicianAssigned = !!assignedMusicians.includes(uid);
              const isLeaderAssigned = !!assignedLeaders.includes(uid);
              const isCurrentUserAssigned = isChoirAssigned || isMusicianAssigned || isLeaderAssigned;
              const hasAnyAssignments = assignedChoir.length > 0 || assignedMusicians.length > 0 || assignedLeaders.length > 0;
              const isAssigned = isCurrentUserAssigned ||
                                 ((role === "worship_leader" || role === "super_admin") && hasAnyAssignments);

              const isPracticed = !!practicedLogs[rosterSong.songId];
              const isReady = !!readyLogs[rosterSong.songId];

              // Active Key
              const activeKey = song.currentKey || song.originalKey || "N/A";

              // Expand collapsible for Choir practice & Member lyric sheets
              const isExpanded = expandedSongId === rosterSong.songId;

              // Roles check
              const isChoirVocalist = role === "choir_member" || role === "member";
              const isBandMusician = role === "musician" || role === "musicians";
              const isGeneralMember = role === "member";

              const isSongBrandNew = rosterSong.isNewInlineSong === true;
              return (
                <View
                  key={rosterSong.songId}
                  style={[
                    styles.songDetailCard,
                    isChoirVocalist && isChoirAssigned && styles.choirAssignedCardBorder,
                    isChoirVocalist && isChoirAssigned && isPracticed && styles.choirPracticedCardBg,
                    (isChoirVocalist || isBandMusician) && isSongBrandNew && styles.newSongCardHighlight,
                    isAssigned && {
                      borderLeftWidth: 4,
                      borderLeftColor: isLeaderAssigned
                        ? "#F59E0B"
                        : isChoirAssigned
                        ? "#0D9488"
                        : isMusicianAssigned
                        ? "#A855F7"
                        : role === "super_admin"
                        ? "#EF4444"
                        : "#F59E0B",
                      paddingLeft: 12,
                    }
                  ]}
                >
                  {/* Song Details Row */}
                  <View style={styles.songDetailHeader}>
                    <TouchableOpacity 
                      style={styles.songMainRowInfo}
                      activeOpacity={0.7}
                      onPress={() => setActiveRosterSongDetail(song)}
                    >
                      <View style={styles.songOrderBadge}>
                        <Text style={styles.songOrderBadgeText}>{index + 1}</Text>
                      </View>
                      <View style={{ flex: 1, paddingRight: 6 }}>
                        <View style={styles.songTitleRow}>
                          <Text style={styles.songDetailTitle} numberOfLines={1}>
                            {song.title || "Unknown Song"}
                          </Text>
                          {isAssigned && (
                            <View
                              style={[
                                styles.assignedBadge,
                                {
                                  backgroundColor: isLeaderAssigned
                                    ? "#F59E0B"
                                    : isChoirAssigned
                                    ? "#0D9488"
                                    : isMusicianAssigned
                                    ? "#A855F7"
                                    : role === "super_admin"
                                    ? "#EF4444"
                                    : "#F59E0B",
                                },
                              ]}
                            >
                              <Text style={styles.assignedBadgeText}>Assigned</Text>
                            </View>
                          )}
                          {isChoirVocalist && isChoirAssigned && (
                            <Text style={styles.starHighlight}>⭐</Text>
                          )}
                          {(isChoirVocalist || isBandMusician) && isSongBrandNew && (
                            <View style={styles.newSongBadge}>
                              <Text style={styles.newSongBadgeText}>NEW</Text>
                            </View>
                          )}
                        </View>
                        <Text style={styles.songDetailArtist} numberOfLines={1}>
                          {song.artist || "Unknown Artist"}
                          {isBandMusician ? ` • BPM: ${song.bpm || "--"}` : ""}
                          {` • Key: ${activeKey}`}
                        </Text>
                        {(song.youtubeLink || song.spotifyLink) && (
                          <View style={styles.mediaLinksContainer}>
                            {song.youtubeLink ? (
                              <TouchableOpacity
                                style={styles.youtubeMediaBtn}
                                onPress={() => handleOpenLink(song.youtubeLink)}
                                activeOpacity={0.7}
                              >
                                <Text style={styles.youtubeMediaBtnText}>▶ YouTube</Text>
                              </TouchableOpacity>
                            ) : null}
                            {song.spotifyLink ? (
                              <TouchableOpacity
                                style={styles.spotifyMediaBtn}
                                onPress={() => handleOpenLink(song.spotifyLink)}
                                activeOpacity={0.7}
                              >
                                <Text style={styles.spotifyMediaBtnText}>♫ Spotify</Text>
                              </TouchableOpacity>
                            ) : null}
                          </View>
                        )}
                      </View>
                    </TouchableOpacity>

                    {/* Interactive action toggles */}
                    <View style={styles.detailActionControls}>
                      {(role === "worship_leader" || role === "super_admin") && (
                        <TouchableOpacity
                          style={styles.adminEditSongBtn}
                          onPress={() => handleOpenInlineEditSong(song)}
                          activeOpacity={0.7}
                        >
                          <Text style={styles.adminEditSongBtnText}>✏️ Edit Song</Text>
                        </TouchableOpacity>
                      )}

                      {isChoirVocalist && isChoirAssigned && (
                        <TouchableOpacity
                          style={[
                            styles.vocalPracticedCheckbox,
                            isPracticed && { backgroundColor: "#0D9488", borderColor: "#0D9488" },
                          ]}
                          activeOpacity={0.7}
                          onPress={() => handleTogglePracticed(selectedRoster.rosterId, rosterSong.songId)}
                        >
                          <Text style={styles.checkboxIconText}>{isPracticed ? "✓" : ""}</Text>
                        </TouchableOpacity>
                      )}

                      {isBandMusician && (
                        <TouchableOpacity
                          style={[
                            styles.musicianReadyToggle,
                            isReady && { backgroundColor: "#A855F7", borderColor: "#A855F7" },
                          ]}
                          activeOpacity={0.7}
                          onPress={() => handleToggleReady(selectedRoster.rosterId, rosterSong.songId)}
                        >
                          <Text style={styles.musicianReadyToggleText}>
                            {isReady ? "Ready" : "Mark Ready"}
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>

                  {/* Choir & Band Members Rostered lists for Musician / Worship Leader */}
                  {(role === "worship_leader" || role === "super_admin" || isBandMusician) && (
                    <View style={styles.assignedRosterListGrid}>
                      {assignedLeaders && assignedLeaders.length > 0 && (
                        <View style={styles.rosteredBlock}>
                          <Text style={styles.rosteredLabel}>Worship Leaders:</Text>
                          <View style={styles.rosteredRow}>
                            {assignedLeaders.map((lUid) => {
                              return (
                                <View
                                  key={lUid}
                                  style={[
                                    styles.musicianMiniBadge,
                                    { backgroundColor: "rgba(245, 158, 11, 0.15)", borderColor: "#F59E0B", borderWidth: 1 }
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.musicianMiniBadgeText,
                                      { color: "#F59E0B" }
                                    ]}
                                  >
                                    👑 {getUserById(lUid).displayName}
                                  </Text>
                                </View>
                              );
                            })}
                          </View>
                        </View>
                      )}

                      {assignedChoir.length > 0 && (
                        <View style={styles.rosteredBlock}>
                          <Text style={styles.rosteredLabel}>Vocalists:</Text>
                          <View style={styles.rosteredRow}>
                            {assignedChoir.map((vUid) => {
                              const hasPracticed = !!allPracticedLogs[vUid]?.[rosterSong.songId];
                              return (
                                <View
                                  key={vUid}
                                  style={[
                                    styles.vocalistMiniBadge,
                                    hasPracticed && styles.vocalistPracticedBadge,
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.vocalistMiniBadgeText,
                                      hasPracticed && styles.vocalistPracticedBadgeText,
                                    ]}
                                  >
                                    🎤 {getUserById(vUid).displayName} {hasPracticed ? "✓" : ""}
                                  </Text>
                                </View>
                              );
                            })}
                          </View>
                        </View>
                      )}

                      {assignedMusicians.length > 0 && (
                        <View style={styles.rosteredBlock}>
                          <Text style={styles.rosteredLabel}>Musicians:</Text>
                          <View style={styles.rosteredRow}>
                            {assignedMusicians.map((mUid) => {
                              const hasReady = !!allReadyLogs[mUid]?.[rosterSong.songId];
                              return (
                                <View
                                  key={mUid}
                                  style={[
                                    styles.musicianMiniBadge,
                                    hasReady && styles.musicianReadyBadge,
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.musicianMiniBadgeText,
                                      hasReady && styles.musicianReadyBadgeText,
                                    ]}
                                  >
                                    🎸 {getUserById(mUid).displayName} {hasReady ? "✓" : ""}
                                  </Text>
                                </View>
                              );
                            })}
                          </View>
                        </View>
                      )}

                      {rosterSong.notes ? (
                        <Text style={styles.assignedNotesText}>📝 Note: {rosterSong.notes}</Text>
                      ) : null}
                    </View>
                  )}

                  {/* Expanded practicing panels & lyrics (Choir, read-only General Members, Worship Leaders, or Musicians) */}
                  {((isChoirVocalist && isChoirAssigned) || isGeneralMember || role === "worship_leader" || role === "super_admin" || isBandMusician) && (
                    <View style={styles.lyricsExpansionSection}>
                      <TouchableOpacity
                        style={styles.expansionToggleTrigger}
                        activeOpacity={0.7}
                        onPress={() => setExpandedSongId(isExpanded ? null : rosterSong.songId)}
                      >
                        <Text style={styles.expansionToggleText}>
                          {isExpanded ? "▲ Hide Lyrics & Details" : "▼ View Lyrics & Details"}
                        </Text>
                      </TouchableOpacity>

                      {isExpanded && (
                        <View style={styles.expandedLyricsPanel}>
                          {/* Key & Notes */}
                          {isChoirVocalist && (
                            <View style={styles.panelKeyNotesBlock}>
                              <Text style={styles.vocalOriginalKeyText}>
                                Original Key: <Text style={{ color: "#E2E8F0" }}>{song.originalKey}</Text>
                              </Text>
                              {rosterSong.notes ? (
                                <View style={styles.vocalNotesBadge}>
                                  <Text style={styles.vocalNotesText}>📝 {rosterSong.notes}</Text>
                                </View>
                              ) : null}
                            </View>
                          )}

                          {/* Segmented bilingual lyrics controller */}
                          <View style={styles.detailLyricsContainer}>
                            <View style={styles.lyricsHeaderTabs}>
                              <TouchableOpacity
                                style={[
                                  styles.lyricsHeaderTab,
                                  activeLyricsTab === "english" && [
                                    styles.activeLyricsHeaderTab,
                                    { borderBottomColor: themeColor },
                                  ],
                                ]}
                                onPress={() => setActiveLyricsTab("english")}
                              >
                                <Text
                                  style={[
                                    styles.lyricsHeaderTabText,
                                    activeLyricsTab === "english" && { color: themeColor },
                                  ]}
                                >
                                  English
                                </Text>
                              </TouchableOpacity>

                              <TouchableOpacity
                                style={[
                                  styles.lyricsHeaderTab,
                                  activeLyricsTab === "tamil" && [
                                    styles.activeLyricsHeaderTab,
                                    { borderBottomColor: themeColor },
                                  ],
                                ]}
                                onPress={() => setActiveLyricsTab("tamil")}
                              >
                                <Text
                                  style={[
                                    styles.lyricsHeaderTabText,
                                    activeLyricsTab === "tamil" && { color: themeColor },
                                  ]}
                                >
                                  Tamil
                                </Text>
                              </TouchableOpacity>
                            </View>

                            <View style={styles.lyricsPanelBody}>
                              {activeLyricsTab === "english" ? (
                                song.lyricsEnglish ? (
                                  <Text style={styles.detailLyricsText}>{song.lyricsEnglish}</Text>
                                ) : (
                                  <Text style={styles.noLyricsText}>No English lyrics loaded.</Text>
                                )
                              ) : song.lyricsTamil ? (
                                <Text style={[styles.detailLyricsText, styles.tamilFont]}>
                                  {song.lyricsTamil}
                                </Text>
                              ) : (
                                <Text style={styles.noLyricsText}>No Tamil lyrics loaded.</Text>
                              )}
                            </View>
                          </View>
                        </View>
                      )}
                    </View>
                  )}
                </View>
              );
            })}
          </View>

          {/* Super Admin Delete Roster Button */}
          {role === "super_admin" && (
            <TouchableOpacity
              style={styles.deleteRosterFullBtn}
              onPress={handleDeleteRoster}
              activeOpacity={0.8}
            >
              <Text style={styles.deleteRosterFullBtnText}>🗑️ Delete Roster Plan</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </View>
    );
  };

  // =========================================================================
  // APP VIEW DISPATCHER
  // =========================================================================
  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <StatusBar style="light" />
        <Image 
          source={require("../assets/logo.png")} 
          style={{ width: 100, height: 100, marginBottom: 20 }} 
          resizeMode="contain"
        />
        <ActivityIndicator size="large" color="#F59E0B" style={{ marginBottom: 16 }} />
        <Text style={styles.loadingText}>Loading Roster Plans...</Text>
      </View>
    );
  }

  // RENDERER: Inline Song Form Modal (Create or Edit)
  const renderInlineSongModal = () => {
    // Resolve the active songToEdit object
    const songToEdit = inlineEditMode
      ? songs.find((s) => s.songId === selectedSongToEditId || s.id === selectedSongToEditId)
      : null;

    return (
      <Modal
        visible={inlineSongModalVisible}
        transparent={false}
        animationType="slide"
        onRequestClose={() => setInlineSongModalVisible(false)}
      >
        <AddSongScreen
          songToEdit={songToEdit}
          defaultTitle={inlineTitle} // Pass pre-filled search query if any
          user={user}
          songs={songs}
          onCancel={() => {
            setInlineSongModalVisible(false);
          }}
          onSave={async (songData) => {
            try {
              if (USE_DEMO_MODE) {
                const storedSongs = await AsyncStorage.getItem("@worship_team_songs");
                let currentSongs = storedSongs ? JSON.parse(storedSongs) : [];

                if (inlineEditMode) {
                  const updatedSongs = currentSongs.map((s) => {
                    if (s.songId === selectedSongToEditId || s.id === selectedSongToEditId) {
                      const updated = {
                        ...s,
                        ...songData,
                        lastEditedBy: uid,
                        lastEditedByName: displayName,
                        lastEditedAt: new Date().toISOString(),
                      };
                      if (onUpdateSongInline) onUpdateSongInline(updated);
                      return updated;
                    }
                    return s;
                  });
                  await AsyncStorage.setItem("@worship_team_songs", JSON.stringify(updatedSongs));
                  if (selectedRoster) {
                    setSelectedRoster({
                      ...selectedRoster,
                      songs: selectedRoster.songs.map((s) => s.songId === selectedSongToEditId ? { ...s } : s)
                    });
                  }
                  Alert.alert("Success", "Song updated successfully in catalog and roster!");
                } else {
                  const newSong = {
                    songId: "mock-song-" + Math.floor(Math.random() * 100000),
                    ...songData,
                    addedBy: uid,
                    addedByName: displayName,
                    createdAt: new Date().toISOString(),
                  };
                  currentSongs = [newSong, ...currentSongs];
                  await AsyncStorage.setItem("@worship_team_songs", JSON.stringify(currentSongs));
                  if (onAddSongInline) onAddSongInline(newSong);

                  const firstSong = selectedRosterSongs[0];
                  const initialChoir = firstSong ? [...(firstSong.assignedChoir || [])] : [];
                  const initialMusicians = firstSong ? [...(firstSong.assignedMusicians || [])] : [];
                  const initialLeaders = firstSong ? [...(firstSong.assignedLeaders || [])] : [];

                  setSelectedRosterSongs([
                    ...selectedRosterSongs,
                    {
                      songId: newSong.songId,
                      order: selectedRosterSongs.length + 1,
                      assignedChoir: initialChoir,
                      assignedMusicians: initialMusicians,
                      assignedLeaders: initialLeaders,
                      notes: "",
                      isNewInlineSong: true,
                    }
                  ]);
                  setSongPickerVisible(false);
                  Alert.alert("Success", `"${newSong.title}" added inline and inserted into your setlist!`);
                }
              } else {
                // Firestore
                if (inlineEditMode) {
                  const songDocRef = doc(db, "songs", selectedSongToEditId);
                  const updatedFields = {
                    ...songData,
                    lastEditedBy: uid,
                    lastEditedByName: displayName,
                    lastEditedAt: new Date().toISOString(),
                  };
                  await updateDoc(songDocRef, updatedFields);
                  
                  const updatedSongObj = { songId: selectedSongToEditId, ...updatedFields };
                  if (onUpdateSongInline) onUpdateSongInline(updatedSongObj);

                  if (selectedRoster) {
                    setSelectedRoster({
                      ...selectedRoster,
                      songs: selectedRoster.songs.map((s) => s.songId === selectedSongToEditId ? { ...s } : s)
                    });
                  }
                  Alert.alert("Success", "Song updated successfully in Firestore!");
                } else {
                  const songsCollectionRef = collection(db, "songs");
                  const addedDocRef = await addDoc(songsCollectionRef, {
                    ...songData,
                    addedBy: uid,
                    addedByName: displayName,
                    createdAt: new Date().toISOString(),
                  });
                  
                  const newSongObj = {
                    songId: addedDocRef.id,
                    ...songData,
                    addedBy: uid,
                    addedByName: displayName,
                    createdAt: new Date().toISOString(),
                  };
                  if (onAddSongInline) onAddSongInline(newSongObj);

                  const firstSong = selectedRosterSongs[0];
                  const initialChoir = firstSong ? [...(firstSong.assignedChoir || [])] : [];
                  const initialMusicians = firstSong ? [...(firstSong.assignedMusicians || [])] : [];
                  const initialLeaders = firstSong ? [...(firstSong.assignedLeaders || [])] : [];

                  setSelectedRosterSongs([
                    ...selectedRosterSongs,
                    {
                      songId: newSongObj.songId,
                      order: selectedRosterSongs.length + 1,
                      assignedChoir: initialChoir,
                      assignedMusicians: initialMusicians,
                      assignedLeaders: initialLeaders,
                      notes: "",
                      isNewInlineSong: true,
                    }
                  ]);
                  setSongPickerVisible(false);
                  Alert.alert("Success", `"${newSongObj.title}" added to Firestore and your setlist!`);
                }
              }
              setInlineSongModalVisible(false);
            } catch (error) {
              Alert.alert("Error Saving Song", error.message);
            }
          }}
        />
      </Modal>
    );
  };

  const renderMainContent = () => {
    switch (activeView) {
      case "create":
        return renderCreateRosterForm();
      case "detail":
        return renderRosterDetails();
      case "list":
      default:
        return renderRosterList();
    }
  };

  return (
    <>
      {renderMainContent()}
      {renderInlineSongModal()}

      {/* Premium Roster Setlist Chords & Lyrics Sheets Slide-up Modal */}
      <Modal
        visible={activeRosterSongDetail !== null}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setActiveRosterSongDetail(null)}
      >
        <View style={{ flex: 1, backgroundColor: "#0B0F19" }}>
          {activeRosterSongDetail && (
            <SongDetailScreen
              song={activeRosterSongDetail}
              onBack={() => setActiveRosterSongDetail(null)}
              user={user}
              onUpdateSong={handleUpdateRosterSongDetail}
              onEditSong={(songObj) => {
                // Launch the inline editor
                setActiveRosterSongDetail(null);
                handleOpenInlineEditSong(songObj);
              }}
              setlist={(selectedRoster.songs || []).map(rs => getSongById(rs.songId)).filter(Boolean)}
              initialSongIndex={(selectedRoster.songs || []).findIndex(rs => rs.songId === activeRosterSongDetail.songId)}
            />
          )}
        </View>
      </Modal>
    </>
  );
}

// =========================================================================
// PREMIUM STYLESHEET
// =========================================================================
const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: "#0B0F19",
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    color: "#94A3B8",
    fontSize: 15,
    fontWeight: "700",
  },
  viewContainer: {
    flex: 1,
    backgroundColor: "#0B0F19",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderColor: "#1E293B",
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#FFFFFF",
    flex: 1,
    textAlign: "center",
  },
  addButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  addButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
  backButton: {
    paddingVertical: 6,
  },
  backButtonText: {
    color: "#64748B",
    fontSize: 15,
    fontWeight: "700",
  },
  saveButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  saveButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 120,
    paddingHorizontal: 40,
  },
  emptyEmoji: {
    fontSize: 54,
    marginBottom: 16,
    opacity: 0.5,
  },
  emptyText: {
    color: "#94A3B8",
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 12,
  },
  emptyAddButton: {
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginTop: 8,
  },
  emptyAddButtonText: {
    fontSize: 13,
    fontWeight: "700",
  },
  emptySubtext: {
    color: "#475569",
    fontSize: 13,
    fontWeight: "500",
    textAlign: "center",
    lineHeight: 18,
  },
  listContent: {
    padding: 20,
    paddingBottom: 40,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  rosterCard: {
    backgroundColor: "#1E293B",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#334155",
    padding: 16,
    marginBottom: 14,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  rosterTitle: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "700",
    marginBottom: 6,
  },
  rosterDate: {
    color: "#94A3B8",
    fontSize: 13,
    fontWeight: "600",
  },
  statusBadge: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  cardDivider: {
    height: 1,
    backgroundColor: "#334155",
    marginVertical: 12,
  },
  cardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerItem: {
    color: "#64748B",
    fontSize: 12,
    fontWeight: "600",
  },
  metaCard: {
    backgroundColor: "#1E293B",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#334155",
    padding: 20,
    marginBottom: 20,
  },
  formSectionTitle: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 16,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  formGroup: {
    marginBottom: 16,
  },
  label: {
    color: "#94A3B8",
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 8,
  },
  input: {
    backgroundColor: "#0B0F19",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#334155",
    color: "#FFFFFF",
    paddingHorizontal: 14,
    height: 44,
    fontSize: 14,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  dropdownTrigger: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  dropdownValueText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  dropdownChevron: {
    fontSize: 10,
  },
  setlistContainer: {
    marginBottom: 20,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  smallAddButton: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: "rgba(255,255,255,0.01)",
  },
  smallAddButtonText: {
    fontSize: 12,
    fontWeight: "700",
  },
  emptySetlistPlaceholder: {
    backgroundColor: "#1E293B",
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: "#334155",
    borderRadius: 16,
    padding: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyPlaceholderEmoji: {
    fontSize: 36,
    marginBottom: 12,
    opacity: 0.5,
  },
  emptyPlaceholderText: {
    color: "#64748B",
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 16,
  },
  inlineAddButton: {
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  inlineAddButtonText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  draftSongItem: {
    backgroundColor: "#1E293B",
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
  },
  draftSongHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  draftSongInfo: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  draftSongOrderText: {
    color: "#64748B",
    fontSize: 15,
    fontWeight: "800",
    marginRight: 10,
  },
  draftSongTitle: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 2,
  },
  draftSongArtist: {
    color: "#94A3B8",
    fontSize: 12,
    fontWeight: "500",
  },
  draftSongActions: {
    flexDirection: "row",
    alignItems: "center",
  },
  sortArrowButton: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: "#0B0F19",
    borderWidth: 1,
    borderColor: "#334155",
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 4,
  },
  disabledSortArrow: {
    opacity: 0.25,
  },
  sortArrowText: {
    color: "#FFFFFF",
    fontSize: 10,
  },
  deleteSongButton: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: "rgba(239, 68, 68, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.2)",
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 6,
  },
  deleteSongText: {
    color: "#EF4444",
    fontSize: 10,
    fontWeight: "700",
  },
  assignmentPanel: {
    marginTop: 12,
    borderTopWidth: 1,
    borderColor: "#0B0F19",
    paddingTop: 10,
  },
  assignmentLabel: {
    color: "#64748B",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    marginBottom: 6,
    marginTop: 8,
  },
  checkboxesContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 6,
  },
  checkboxBadge: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: 6,
    marginBottom: 6,
  },
  checkboxBadgeText: {
    fontSize: 11,
    fontWeight: "700",
  },
  notesFieldInput: {
    backgroundColor: "#0B0F19",
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 8,
    color: "#FFFFFF",
    padding: 8,
    fontSize: 12,
    minHeight: 44,
    marginTop: 2,
  },
  saveDraftButton: {
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 12,
    height: 48,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#111827",
    marginBottom: 40,
  },
  saveDraftButtonText: {
    color: "#94A3B8",
    fontSize: 14,
    fontWeight: "700",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(3, 7, 18, 0.8)",
    justifyContent: "center",
    alignItems: "center",
  },
  pickerModalContent: {
    width: "80%",
    backgroundColor: "#1E293B",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#334155",
    padding: 20,
  },
  pickerOptionTile: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginVertical: 4,
  },
  pickerOptionText: {
    color: "#E2E8F0",
    fontSize: 14,
    fontWeight: "600",
  },
  songPickerOverlay: {
    flex: 1,
    backgroundColor: "rgba(3, 7, 18, 0.8)",
    justifyContent: "flex-end",
  },
  songPickerContent: {
    height: "75%",
    backgroundColor: "#1E293B",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: "#334155",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  modalCloseButton: {
    backgroundColor: "#334155",
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
  },
  modalCloseText: {
    color: "#94A3B8",
    fontSize: 10,
    fontWeight: "bold",
  },
  modalSearchContainer: {
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  pickerSongCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#0B0F19",
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  pickerSongTitle: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 2,
  },
  pickerSongArtist: {
    color: "#64748B",
    fontSize: 12,
    fontWeight: "600",
  },
  addSongButtonTrigger: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  addSongButtonTriggerText: {
    fontSize: 12,
    fontWeight: "700",
  },
  rosterSubtitle: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  detailRosterTitle: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "800",
  },
  divider: {
    height: 1,
    backgroundColor: "#334155",
    marginVertical: 14,
  },
  timeInfoGrid: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  timeInfoItem: {
    flex: 1,
  },
  timeInfoLabel: {
    color: "#64748B",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  timeInfoValue: {
    color: "#E2E8F0",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 16,
  },
  roleProgressCard: {
    backgroundColor: "rgba(255,255,255,0.01)",
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
  },
  roleProgressTitle: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
    marginBottom: 4,
  },
  roleProgressSub: {
    color: "#94A3B8",
    fontSize: 12,
    fontWeight: "500",
    marginBottom: 10,
  },
  progressBarBg: {
    height: 6,
    backgroundColor: "#1E293B",
    borderRadius: 3,
    overflow: "hidden",
  },
  progressBarActive: {
    height: 6,
    borderRadius: 3,
  },
  setlistHeader: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  songDetailCard: {
    backgroundColor: "#1E293B",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#334155",
    padding: 16,
    marginBottom: 12,
  },
  choirAssignedCardBorder: {
    borderColor: "#0D9488",
    borderWidth: 1.5,
  },
  choirPracticedCardBg: {
    backgroundColor: "rgba(13, 148, 136, 0.05)",
  },
  songDetailHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  songMainRowInfo: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  songOrderBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#0B0F19",
    borderWidth: 1,
    borderColor: "#334155",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 10,
  },
  songOrderBadgeText: {
    color: "#64748B",
    fontSize: 12,
    fontWeight: "800",
  },
  songTitleRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  songDetailTitle: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
    marginRight: 6,
  },
  starHighlight: {
    fontSize: 12,
  },
  songDetailArtist: {
    color: "#94A3B8",
    fontSize: 12,
    fontWeight: "500",
    marginTop: 2,
  },
  detailActionControls: {
    flexDirection: "row",
    alignItems: "center",
  },
  vocalPracticedCheckbox: {
    width: 26,
    height: 26,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: "#334155",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#0B0F19",
  },
  checkboxIconText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "800",
  },
  musicianReadyToggle: {
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "#0B0F19",
  },
  musicianReadyToggleText: {
    color: "#94A3B8",
    fontSize: 11,
    fontWeight: "700",
  },
  assignedRosterListGrid: {
    marginTop: 12,
    borderTopWidth: 1,
    borderColor: "#334155",
    paddingTop: 10,
  },
  rosteredBlock: {
    marginBottom: 8,
  },
  rosteredLabel: {
    color: "#64748B",
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  rosteredRow: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  vocalistMiniBadge: {
    backgroundColor: "rgba(13, 148, 136, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(13, 148, 136, 0.2)",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
    marginRight: 6,
    marginBottom: 4,
  },
  vocalistMiniBadgeText: {
    color: "#0D9488",
    fontSize: 10,
    fontWeight: "700",
  },
  musicianMiniBadge: {
    backgroundColor: "rgba(168, 85, 247, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(168, 85, 247, 0.2)",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
    marginRight: 6,
    marginBottom: 4,
  },
  musicianMiniBadgeText: {
    color: "#A855F7",
    fontSize: 10,
    fontWeight: "700",
  },
  assignedNotesText: {
    color: "#94A3B8",
    fontSize: 11,
    lineHeight: 16,
    fontStyle: "italic",
    marginTop: 4,
  },
  lyricsExpansionSection: {
    marginTop: 8,
    borderTopWidth: 1,
    borderColor: "#334155",
    paddingTop: 8,
  },
  expansionToggleTrigger: {
    paddingVertical: 4,
    alignItems: "center",
  },
  expansionToggleText: {
    color: "#64748B",
    fontSize: 11,
    fontWeight: "700",
  },
  expandedLyricsPanel: {
    marginTop: 10,
    borderTopWidth: 1,
    borderColor: "#334155",
    paddingTop: 10,
  },
  panelKeyNotesBlock: {
    marginBottom: 10,
  },
  vocalOriginalKeyText: {
    color: "#64748B",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 6,
  },
  vocalNotesBadge: {
    backgroundColor: "#0B0F19",
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 8,
    padding: 10,
  },
  vocalNotesText: {
    color: "#94A3B8",
    fontSize: 11,
    lineHeight: 16,
  },
  detailLyricsContainer: {
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#0B0F19",
  },
  lyricsHeaderTabs: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderColor: "#334155",
  },
  lyricsHeaderTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  activeLyricsHeaderTab: {
    backgroundColor: "rgba(255,255,255,0.01)",
  },
  lyricsHeaderTabText: {
    color: "#64748B",
    fontSize: 12,
    fontWeight: "700",
  },
  lyricsPanelBody: {
    padding: 14,
  },
  detailLyricsText: {
    color: "#E2E8F0",
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
    fontWeight: "500",
  },
  tamilFont: {
    fontSize: 14,
    lineHeight: 22,
  },
  noLyricsText: {
    color: "#475569",
    fontSize: 12,
    textAlign: "center",
    fontStyle: "italic",
    paddingVertical: 10,
  },
  datePickerTrigger: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 12,
  },
  datePickerValueText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "600",
  },
  datePickerPlaceholderText: {
    color: "#64748B",
    fontSize: 12,
    fontWeight: "500",
  },
  datePickerIcon: {
    fontSize: 14,
  },
  calendarModalContent: {
    width: "90%",
    backgroundColor: "#1E293B",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#334155",
    padding: 20,
    maxHeight: 520,
  },
  calendarHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  calendarHeaderTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
  },
  calendarCloseButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#0B0F19",
    justifyContent: "center",
    alignItems: "center",
  },
  calendarCloseText: {
    color: "#64748B",
    fontSize: 12,
    fontWeight: "700",
  },
  pickerModeSelectionRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderColor: "#334155",
    marginBottom: 12,
  },
  pickerModeTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  pickerModeTabActive: {
    backgroundColor: "rgba(255, 255, 255, 0.02)",
  },
  pickerModeTabText: {
    color: "#64748B",
    fontSize: 11,
    fontWeight: "700",
  },
  calendarContainer: {
    marginBottom: 10,
  },
  calendarMonthNav: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
    paddingHorizontal: 8,
  },
  calendarArrowBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: "#0B0F19",
    justifyContent: "center",
    alignItems: "center",
  },
  calendarArrowText: {
    color: "#FFFFFF",
    fontSize: 10,
  },
  calendarMonthNavText: {
    color: "#E2E8F0",
    fontSize: 14,
    fontWeight: "800",
  },
  calendarWeekDays: {
    flexDirection: "row",
    marginBottom: 6,
  },
  calendarWeekDayCell: {
    flex: 1,
    alignItems: "center",
  },
  calendarWeekDayText: {
    color: "#64748B",
    fontSize: 11,
    fontWeight: "700",
  },
  calendarEmptyCell: {
    flex: 1,
    height: 34,
  },
  calendarDayCell: {
    flex: 1,
    height: 34,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 8,
    margin: 2,
    backgroundColor: "rgba(11, 15, 25, 0.3)",
  },
  calendarDayText: {
    color: "#E2E8F0",
    fontSize: 12,
    fontWeight: "600",
  },
  calendarDaySelected: {
    borderRadius: 8,
  },
  calendarDaySelectedText: {
    color: "#FFFFFF",
    fontWeight: "800",
  },
  selectionGridContainer: {
    height: 200,
    marginBottom: 10,
  },
  selectionSectionTitle: {
    color: "#94A3B8",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 10,
    textAlign: "center",
  },
  timeGridItem: {
    flex: 1,
    height: 38,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#0B0F19",
    borderRadius: 8,
    margin: 4,
    borderWidth: 1,
    borderColor: "#334155",
  },
  timeGridItemText: {
    color: "#E2E8F0",
    fontSize: 12,
    fontWeight: "700",
  },
  timeGridItemSelected: {
    borderColor: "transparent",
  },
  timeGridItemSelectedText: {
    color: "#FFFFFF",
    fontWeight: "800",
  },
  calendarTimeDisplayRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 10,
    paddingTop: 12,
    borderTopWidth: 1,
    borderColor: "#334155",
    marginBottom: 16,
  },
  timeValueDisplayBox: {
    backgroundColor: "#0B0F19",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#334155",
  },
  timeValueDisplayText: {
    color: "#E2E8F0",
    fontSize: 12,
    fontWeight: "700",
  },
  ampmButtonsContainer: {
    flexDirection: "row",
    backgroundColor: "#0B0F19",
    borderRadius: 8,
    padding: 2,
    borderWidth: 1,
    borderColor: "#334155",
  },
  ampmSelectorBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  ampmSelectorBtnActive: {
    // dynamically sets color
  },
  ampmSelectorBtnText: {
    color: "#64748B",
    fontSize: 11,
    fontWeight: "700",
  },
  ampmSelectorBtnTextActive: {
    color: "#FFFFFF",
  },
  confirmDatePickerBtn: {
    height: 44,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  confirmDatePickerBtnText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },
  draftActionsContainer: {
    marginTop: 20,
    marginBottom: 40,
    gap: 12,
  },
  primaryActionButton: {
    height: 48,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  primaryActionButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },
  secondaryActionButton: {
    height: 48,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  secondaryActionButtonText: {
    color: "#94A3B8",
    fontSize: 14,
    fontWeight: "700",
  },
  vocalistPracticedBadge: {
    backgroundColor: "rgba(13, 148, 136, 0.25)",
    borderColor: "#0D9488",
  },
  vocalistPracticedBadgeText: {
    color: "#0D9488",
    fontWeight: "bold",
  },
  musicianReadyBadge: {
    backgroundColor: "rgba(168, 85, 247, 0.25)",
    borderColor: "#A855F7",
  },
  musicianReadyBadgeText: {
    color: "#A855F7",
    fontWeight: "bold",
  },
  adminDashboardCard: {
    backgroundColor: "#1E293B",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#334155",
    padding: 16,
    marginBottom: 20,
  },
  adminDashboardTitle: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
    marginBottom: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  adminMetricRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  adminMetricLabel: {
    color: "#94A3B8",
    fontSize: 12,
    fontWeight: "700",
  },
  adminMetricValue: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  editButton: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  editButtonText: {
    fontSize: 13,
    fontWeight: "700",
  },
  // Inline Song Creator & Search empty state
  emptySearchContainer: {
    padding: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  emptySearchText: {
    color: "#94A3B8",
    fontSize: 14,
    textAlign: "center",
    marginBottom: 16,
  },
  inlineAddSongBtn: {
    backgroundColor: "rgba(59, 130, 246, 0.15)",
    borderWidth: 1.5,
    borderColor: "rgba(59, 130, 246, 0.3)",
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  inlineAddSongBtnText: {
    color: "#3B82F6",
    fontSize: 13,
    fontWeight: "800",
  },
  // Admin inline song editing
  adminEditSongBtn: {
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.15)",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    marginRight: 6,
  },
  adminEditSongBtnText: {
    color: "#E2E8F0",
    fontSize: 11,
    fontWeight: "800",
  },
  // New song highlighting
  newSongCardHighlight: {
    borderColor: "#F97316",
    borderWidth: 2,
  },
  newSongBadge: {
    backgroundColor: "rgba(249, 115, 22, 0.12)",
    borderColor: "#F97316",
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    marginLeft: 6,
    alignSelf: "center",
  },
  newSongBadgeText: {
    color: "#F97316",
    fontSize: 8,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  assignedBadge: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginLeft: 8,
    alignSelf: "center",
  },
  assignedBadgeText: {
    color: "#0B0F19",
    fontSize: 10,
    fontWeight: "850",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  // Inline Song Modal form styles
  inlineModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(11, 15, 25, 0.85)",
    justifyContent: "flex-end",
  },
  inlineModalContent: {
    backgroundColor: "#0B0F19",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    maxHeight: "85%",
    paddingTop: 20,
    paddingHorizontal: 20,
  },
  inlineModalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.05)",
  },
  inlineModalTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "800",
  },
  inlineModalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    justifyContent: "center",
    alignItems: "center",
  },
  inlineModalCloseBtnText: {
    color: "#94A3B8",
    fontSize: 14,
    fontWeight: "700",
  },
  inlineFormScroll: {
    marginTop: 16,
  },
  inlineLabel: {
    color: "#94A3B8",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 16,
    marginBottom: 8,
  },
  inlineInput: {
    backgroundColor: "#1E293B",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.05)",
    borderRadius: 10,
    color: "#FFFFFF",
    fontSize: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  inlineInputTextArea: {
    minHeight: 100,
    textAlignVertical: "top",
  },
  inlineSubmitBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 28,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 6,
  },
  inlineSubmitBtnText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
  },
  // Dropdown & suggestion styling
  inlineDropdownTrigger: {
    backgroundColor: "#1E293B",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.05)",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  inlineDropdownText: {
    color: "#FFFFFF",
    fontSize: 14,
  },
  inlineDropdownChevron: {
    color: "#94A3B8",
    fontSize: 10,
  },
  inlineDropdownOverlayContainer: {
    position: "absolute",
    top: 72,
    left: 0,
    right: 0,
    backgroundColor: "#1E293B",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
    maxHeight: 180,
    zIndex: 9999,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 8,
  },
  inlineDropdownScroll: {
    maxHeight: 180,
  },
  inlineDropdownGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    padding: 6,
    justifyContent: "space-between",
  },
  inlineDropdownGridItem: {
    width: "30%",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    marginVertical: 4,
    marginHorizontal: "1.5%",
    borderRadius: 6,
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.02)",
  },
  inlineDropdownItem: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.03)",
  },
  inlineDropdownItemActive: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  inlineDropdownItemText: {
    color: "#94A3B8",
    fontSize: 14,
  },
  inlineDropdownItemTextActive: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
  inlineArtistSuggestionsContainer: {
    position: "absolute",
    top: 72,
    left: 0,
    right: 0,
    backgroundColor: "#1E293B",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
    maxHeight: 150,
    zIndex: 9999,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 8,
  },
  inlineArtistSuggestionsScroll: {
    maxHeight: 150,
  },
  inlineArtistSuggestionItem: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.03)",
  },
  inlineArtistSuggestionText: {
    color: "#FFFFFF",
    fontSize: 14,
  },
  // Media Links Row
  mediaLinksContainer: {
    flexDirection: "row",
    marginTop: 8,
    flexWrap: "wrap",
  },
  youtubeMediaBtn: {
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    borderColor: "rgba(239, 68, 68, 0.3)",
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 8,
    marginBottom: 4,
  },
  youtubeMediaBtnText: {
    color: "#F87171",
    fontSize: 11,
    fontWeight: "800",
  },
  spotifyMediaBtn: {
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    borderColor: "rgba(16, 185, 129, 0.3)",
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 8,
    marginBottom: 4,
  },
  spotifyMediaBtnText: {
    color: "#34D399",
    fontSize: 11,
    fontWeight: "800",
  },
  propagationNoteContainer: {
    backgroundColor: "rgba(245, 158, 11, 0.08)",
    borderColor: "rgba(245, 158, 11, 0.2)",
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  propagationNoteText: {
    color: "#F59E0B",
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
    lineHeight: 16,
  },
  deleteRosterFullBtn: {
    margin: 20,
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
  deleteRosterFullBtnText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
  },
  copyWhatsAppBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 16,
    marginHorizontal: 0,
  },
  copyWhatsAppBtnText: {
    fontSize: 13,
    fontWeight: "800",
  },
  addCustomEventContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.05)",
  },
  customEventInput: {
    flex: 1,
    height: 40,
    backgroundColor: "#1E293B",
    borderRadius: 8,
    paddingHorizontal: 12,
    color: "#FFFFFF",
    fontSize: 13,
    borderWidth: 1,
    borderColor: "#334155",
    marginRight: 8,
  },
  addCustomEventBtn: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  addCustomEventBtnText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
});

