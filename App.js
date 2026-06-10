import React, { useState, useEffect } from "react";
import { StyleSheet, View, Text, Alert, ActivityIndicator, Image } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import FirebaseRecaptchaVerifierModal from "./components/FirebaseRecaptchaVerifierModal";

// Import firebase modules
import { USE_DEMO_MODE, auth, db } from "./firebaseConfig";
import { 
  signInWithCredential, 
  PhoneAuthProvider,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInAnonymously,
  EmailAuthProvider,
  linkWithCredential,
  updatePassword
} from "firebase/auth";
import { 
  doc, 
  getDoc, 
  setDoc, 
  serverTimestamp,
  collection,
  addDoc,
  updateDoc,
  onSnapshot,
  query,
  orderBy,
  where,
  getDocs,
  deleteDoc
} from "firebase/firestore";

// Import custom screens
import * as Notifications from "expo-notifications";
import { registerForPushNotificationsAsync, savePushTokenToFirestore } from "./services/notificationService";

import SplashScreen from "./components/SplashScreen";
import LoginScreen from "./components/LoginScreen";
import PhoneInputScreen from "./components/PhoneInputScreen";
import OtpVerifyScreen from "./components/OtpVerifyScreen";
import RegisterScreen from "./components/RegisterScreen";
import Dashboards from "./components/Dashboards";
import ProfileScreen from "./components/ProfileScreen";
import SongSearchScreen from "./components/SongSearchScreen";
import SongDetailScreen from "./components/SongDetailScreen";
import AddSongScreen from "./components/AddSongScreen";
import BottomNavBar from "./components/BottomNavBar";
import RosterScreen from "./components/RosterScreen";
import AdminPanelScreen from "./components/AdminPanelScreen";
import TasksScreen from "./components/TasksScreen";
import AnalyticsScreen from "./components/AnalyticsScreen";
import OnboardingScreen from "./components/OnboardingScreen";
import ResetPasswordModal from "./components/ResetPasswordModal";


// =========================================================================
// MOCK DATABASE FOR INSTANT OFFLINE TESTING (DEMO MODE)
// =========================================================================
const INITIAL_DEMO_USERS = {
  "1111111111": {
    uid: "demo-leader-111",
    displayName: "Pastor Alex",
    phone: "1111111111",
    role: "worship_leader",
    password: "password123",
  },
  "2222222222": {
    uid: "demo-musician-222",
    displayName: "Sarah (Guitarist)",
    phone: "2222222222",
    role: "musician",
    password: "password123",
  },
  "3333333333": {
    uid: "demo-choir-333",
    displayName: "David (Tenor Lead)",
    phone: "3333333333",
    role: "choir_member",
    password: "password123",
  },
  "4444444444": {
    uid: "demo-member-444",
    displayName: "Sister Grace",
    phone: "4444444444",
    role: "member",
    password: "password123",
  },
  "7777777777": {
    uid: "demo-super-777",
    displayName: "Chief Admin Samuel",
    phone: "7777777777",
    role: "super_admin",
    password: "password123",
  },
};

const stripCountryCode = (phone) => {
  if (!phone) return "";
  const codes = ["+91", "+1", "+44", "+61", "+65", "+971", "+27", "+49", "+33", "+81"];
  for (const code of codes) {
    if (phone.startsWith(code)) {
      return phone.substring(code.length);
    }
  }
  return phone.replace(/^\+/, ""); // fallback
};

const getSyntheticEmail = (phone) => {
  if (!phone) return "";
  const clean = stripCountryCode(phone).replace(/\D/g, "");
  return `${clean}@worshipteam.app`;
};

export default function App() {
  const [currentScreen, setCurrentScreen] = useState("Splash");
  const [currentUser, setCurrentUser] = useState(null);
  const [tempPhone, setTempPhone] = useState("");
  const [isNewRegistration, setIsNewRegistration] = useState(false);
  const [verificationId, setVerificationId] = useState("");
  const recaptchaVerifier = React.useRef(null);
  const [appLoading, setAppLoading] = useState(true);
  const [resetPasswordPending, setResetPasswordPending] = useState(false);
  const [demoOtpCode, setDemoOtpCode] = useState("");


  // Bottom navigation tab state
  const [activeTab, setActiveTab] = useState("Home");
  const [directRosterTargetId, setDirectRosterTargetId] = useState(null);

  const handleJumpToRoster = (rosterId) => {
    setDirectRosterTargetId(rosterId);
    setActiveTab("Roster");
  };

  const handleJumpToSongDetail = (song, defaultTab = "chords") => {
    setSelectedSong(song);
    setSongTabScreen("Detail");
    setActiveTab("Songs");
    AsyncStorage.setItem("@default_song_detail_tab", defaultTab).catch(() => {});
  };

  const handleJumpToSongSearch = () => {
    setSongTabScreen("Search");
    setActiveTab("Songs");
  };
  // Song database sub-screens state
  const [songTabScreen, setSongTabScreen] = useState("Search"); // "Search" | "Detail" | "AddSong"
  const [selectedSong, setSelectedSong] = useState(null);
  const [songToEdit, setSongToEdit] = useState(null);
  const [songs, setSongs] = useState([]);
  const [songsLoading, setSongsLoading] = useState(false);

  // Local storage keys for Demo Mode persistence
  const SESSION_KEY = "@worship_team_session";
  const DEMO_USERS_DB_KEY = "@worship_team_demo_users";

  // Bootstrap App: Load sessions & mock data
  useEffect(() => {
    async function bootstrap() {
      try {
        if (USE_DEMO_MODE) {
          // Initialize demo database inside local storage if empty
          const existingDb = await AsyncStorage.getItem(DEMO_USERS_DB_KEY);
          if (!existingDb) {
            await AsyncStorage.setItem(
              DEMO_USERS_DB_KEY,
              JSON.stringify(INITIAL_DEMO_USERS)
            );
          } else {
            // Merge missing keys (e.g. Super Admin 7777777777) into existing demo database
            try {
              const parsed = JSON.parse(existingDb);
              let updated = false;
              Object.keys(INITIAL_DEMO_USERS).forEach((phoneKey) => {
                if (!parsed[phoneKey]) {
                  parsed[phoneKey] = INITIAL_DEMO_USERS[phoneKey];
                  updated = true;
                }
              });
              if (updated) {
                await AsyncStorage.setItem(DEMO_USERS_DB_KEY, JSON.stringify(parsed));
              }
            } catch (err) {
              console.error("Error merging new demo users into database:", err);
            }
          }

          // Check if session exists in storage
          const session = await AsyncStorage.getItem(SESSION_KEY);
          if (session) {
            setCurrentUser(JSON.parse(session));
            setCurrentScreen("Dashboard");
          } else {
            setCurrentScreen("Splash");
          }

          // Check if there is a pending password reset
          const pendingReset = await AsyncStorage.getItem("@reset_password_pending");
          if (pendingReset === "true") {
            setResetPasswordPending(true);
          }
        } else {
          // Real Live Firebase Session Handler
          if (auth) {
            onAuthStateChanged(auth, async (firebaseUser) => {
              if (firebaseUser && !firebaseUser.isAnonymous) {
                // Fetch user role from firestore
                try {
                  const userDoc = await getDoc(doc(db, "users", firebaseUser.uid));
                  if (userDoc.exists()) {
                    const userData = userDoc.data();
                    setCurrentUser({
                      uid: firebaseUser.uid,
                      displayName: userData.displayName || "Unknown User",
                      phone: userData.phone || "",
                      role: userData.role || "member",
                    });
                    setCurrentScreen("Dashboard");
                  } else {
                    // Profile not found but authenticated - transition to Register screen
                    let phoneFromEmail = "";
                    if (firebaseUser.email && firebaseUser.email.includes("@")) {
                      phoneFromEmail = firebaseUser.email.split("@")[0];
                    }
                    setTempPhone(firebaseUser.phoneNumber || phoneFromEmail || "");
                    setIsNewRegistration(true);
                    setCurrentScreen("Register");
                  }
                } catch (error) {
                  console.error("Firestore read error:", error);
                  Alert.alert("Database Error", "Failed to retrieve your team role.");
                }
              } else {
                // Either no user or anonymous session (for unauthenticated lookups)
                setCurrentUser(null);
                setCurrentScreen("Login");
                
                // If completely signed out (no anonymous session either), trigger anonymous sign in
                if (!firebaseUser) {
                  try {
                    await signInAnonymously(auth);
                  } catch (anonErr) {
                    console.warn("Failed to sign in anonymously on boot/logout:", anonErr);
                  }
                }
              }
            });
          }
        }
      } catch (err) {
        console.error("App bootstrapping failed:", err);
      } finally {
        setAppLoading(false);
      }
    }

    bootstrap();
  }, []);

  // Push Notifications: Listener and deep-linking routing
  useEffect(() => {
    // 1. Foreground notification handler configuration
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      }),
    });

    // 2. Foreground subscription listener
    const foregroundSubscription = Notifications.addNotificationReceivedListener(notification => {
      console.log("Foreground notification received in App.js:", notification);
    });

    // 3. Background tap listener (deep linking)
    const backgroundSubscription = Notifications.addNotificationResponseReceivedListener(response => {
      console.log("Background notification tap received in App.js:", response);
      try {
        const data = response.notification.request.content.data;
        if (data && data.screen) {
          const screen = data.screen;
          
          if (screen === "Roster" && data.rosterId) {
            handleJumpToRoster(data.rosterId);
          } else if (screen === "Songs" && data.songId) {
            // Find song by id in the current songs array state
            const matchingSong = songs.find(s => s.songId === data.songId);
            if (matchingSong) {
              handleJumpToSongDetail(matchingSong, "chords");
            } else {
              handleJumpToSongSearch();
            }
          } else if (screen === "Dashboard" || screen === "Home") {
            setActiveTab("Home");
          }
        }
      } catch (err) {
        console.error("Failed to route from notification tap deep-link:", err);
      }
    });

    return () => {
      foregroundSubscription.remove();
      backgroundSubscription.remove();
    };
  }, [songs]); // Re-subscribe if songs database shifts to keep deep-linking accurate

  // Push Notifications: Automatic push token registration on user login / session boot
  useEffect(() => {
    if (currentUser && currentUser.uid) {
      async function syncPushToken() {
        try {
          const token = await registerForPushNotificationsAsync();
          if (token) {
            await savePushTokenToFirestore(currentUser.uid, token);
          }
        } catch (err) {
          console.warn("Failed to synchronize push token for user " + currentUser.uid + ":", err);
        }
      }
      syncPushToken();
    }
  }, [currentUser?.uid]);

  const SONGS_DB_KEY = "@worship_team_songs";

  const INITIAL_MOCK_SONGS = [
    {
      songId: "mock-song-1",
      title: "How Great Is Our God",
      artist: "Chris Tomlin",
      originalKey: "G Major",
      currentKey: "G Major",
      bpm: 78,
      timeSignature: "4/4",
      youtubeLink: "https://www.youtube.com/watch?v=KBD186BpWXA",
      spotifyLink: "https://open.spotify.com/track/1ZJmXN7d2QJmQZ40K2K5iK",
      tags: ["Worship", "Praise", "Majesty"],
      ccli: "4348399",
      notes: "Key change from G to Ab for last chorus is optional. Lead electric guitar plays ambient swell during verse 1.",
      lyricsEnglish: "[Verse 1]\nThe splendor of the King, clothed in majesty\nLet all the earth rejoice, all the earth rejoice\nHe wraps Himself in light, and darkness tries to hide\nAnd trembles at His voice, trembles at His voice\n\n[Chorus]\nHow great is our God, sing with me\nHow great is our God, and all will see\nHow great, how great is our God\n\n[Verse 2]\nAge to age He stands, and time is in His hands\nBeginning and the end, beginning and the end\nThe Godhead Three in One, Father Spirit Son\nThe Lion and the Lamb, the Lion and the Lamb",
      lyricsTamil: "[பல்லவி]\nஎங்கள் தேவன் எவ்வளவோ பெரியவர்\nபாடுங்கள் என்னோடு எவ்வளவோ பெரியவர்\nஎல்லாரும் காண்பாரே எவ்வளவோ பெரியவர்\n\n[சரணங்கள்]\nஒளியால் தம்மை மூடி இருளை விரட்டுகிறார்\nஅவர் குரலைக் கேட்டு இருளும் நடுங்குதே\nகாலங்கள் கடந்தவர் காலங்கள் அவர் கையில்\nதுவக்கமும் முடிவும் அவரே அவரே\nமூவொரு கடவுளாய் தந்தை மகன் தூய ஆவி\nசிங்கமும் ஆட்டுக்குட்டியும் அவரே அவரே",
      addedBy: "demo-leader-111",
      addedByName: "Pastor Alex",
      createdAt: new Date().toISOString(),
    },
    {
      songId: "mock-song-2",
      title: "Amazing Grace (My Chains Are Gone)",
      artist: "Chris Tomlin",
      originalKey: "F Major",
      currentKey: "F Major",
      bpm: 64,
      timeSignature: "4/4",
      youtubeLink: "https://www.youtube.com/watch?v=JBeTylhlNJg",
      spotifyLink: "https://open.spotify.com/track/4jT9t4j2kG12V7J03UeJ8Q",
      tags: ["Hymn", "Grace", "Deliverance"],
      ccli: "4768151",
      notes: "Start acoustic only. Choir enters on chorus 2. Heavy orchestration on verse 4.",
      lyricsEnglish: "[Verse 1]\nAmazing grace! How sweet the sound\nThat saved a wretch like me!\nI once was lost, but now am found;\nWas blind, but now I see.\n\n[Chorus]\nMy chains are gone, I've been set free\nMy God, my Savior has ransomed me\nAnd like a flood His mercy reigns\nUnending love, amazing grace\n\n[Verse 2]\n'Twas grace that taught my heart to fear,\nAnd grace my fears relieved;\nHow precious did that grace appear\nThe hour I first believed!",
      lyricsTamil: "[சரணங்கள்]\nஆச்சரிய கிருபையே என்னே இனிமையான சத்தம்\nஎன்னை போன்ற பாவியை இரட்சித்ததே!\nநான் காணாமல் போனேன், இப்போது கண்டடையப்பட்டேன்\nகுருடனாயிருந்தேன், இப்போது காண்கிறேன்.\n\n[பல்லவி]\nஎன் சங்கிலிகள் உடைந்தன, நான் விடுவிக்கப்பட்டேன்\nஎன் தேவன், என் இரட்சகர் என்னை மீட்டுக் கொண்டார்\nவெள்ளம் போல அவருடைய இரக்கம் ஆளுகிறது\nமுடிவில்லாத அன்பு, ஆச்சரியமான கிருபை!\n\n[சரணங்கள் 2]\nஎன் இதயம் பயப்பட கற்றுக்கொடுத்தது கிருபையே,\nஎன் பயங்கள் நீங்கியது கிருபையினாலேயே;\nநான் முதன்முதலில் விசுவாசித்த போது\nஅந்த கிருபை எவ்வளவு அருமையானதாக தோன்றியது!",
      addedBy: "demo-leader-111",
      addedByName: "Pastor Alex",
      createdAt: new Date().toISOString(),
    },
    {
      songId: "mock-song-3",
      title: "10,000 Reasons (Bless The Lord)",
      artist: "Matt Redman",
      originalKey: "G Major",
      currentKey: "G Major",
      bpm: 73,
      timeSignature: "4/4",
      youtubeLink: "https://www.youtube.com/watch?v=DXDGE_lRI0E",
      spotifyLink: "https://open.spotify.com/track/4WjH6BfS3S06Y1fQ2c3Tpx",
      tags: ["Praise", "Gratitude", "Morning"],
      ccli: "6016351",
      notes: "Keep the tempo steady. Piano plays arpeggios in the background. End with fading chorus.",
      lyricsEnglish: "[Chorus]\nBless the Lord, O my soul, O my soul\nWorship His holy name\nSing like never before, O my soul\nI'll worship Your holy name\n\n[Verse 1]\nThe sun comes up, it's a new day dawning\nIt's time to sing Your song again\nWhatever may pass, and whatever lies before me\nLet me be singing when the evening comes\n\n[Verse 2]\nYou're rich in love, and You're slow to anger\nYour name is great, and Your heart is kind\nFor all Your goodness I will keep on singing\nTen thousand reasons for my heart to find",
      lyricsTamil: "[பல்லவி]\nஎன் ஆத்துமாவே கர்த்தரை ஸ்தோத்திரி\nஅவரது பரிசுத்த நாமத்தை ஆராதனை செய்\nமுன்பில்லாதபடி பாடு என் ஆத்துமாவே\nஉம்முடைய பரிசுத்த நாமத்தை ஆராதனை செய்வேன்\n\n[சரணங்கள்]\nசூரியன் உதிக்கிறது, புதிய நாள் புலர்கிறது\nமீண்டும் உம்மை துதிக்க வேண்டிய வேளை\nஎன்ன நடந்தாலும், என் முன்னே என்ன இருந்தாலும்\nமாலை வேளையிலும் நான் உம்மை பாடிக்கொண்டிருப்பேன்\n\n[சரணங்கள் 2]\nநீர் அன்பில் ஐசுவரியமுள்ளவர், கோபிக்க தாமதிப்பவர்\nஉம்முடைய நாமம் பெரியது, உம் இருதயம் தயவுள்ளது\nஉம்முடைய நன்மைகளுக்காக நான் பாடிக்கொண்டே இருப்பேன்\nஎன் இதயம் கண்டடைய பத்தாயிரம் காரணங்கள் உண்டு",
      addedBy: "demo-leader-111",
      addedByName: "Pastor Alex",
      createdAt: new Date().toISOString(),
    }
  ];

  // Load Songs Database
  useEffect(() => {
    if (!currentUser) return;

    let unsubscribe = null;

    async function loadSongs() {
      setSongsLoading(true);
      try {
        if (USE_DEMO_MODE) {
          const storedSongs = await AsyncStorage.getItem(SONGS_DB_KEY);
          if (storedSongs) {
            setSongs(JSON.parse(storedSongs));
          } else {
            // Seed initial songs
            await AsyncStorage.setItem(SONGS_DB_KEY, JSON.stringify(INITIAL_MOCK_SONGS));
            setSongs(INITIAL_MOCK_SONGS);
          }
        } else {
          // Real Live Firebase Firestore listener
          const songsCollectionRef = collection(db, "songs");
          const q = query(songsCollectionRef, orderBy("createdAt", "desc"));
          unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedSongs = [];
            snapshot.forEach((doc) => {
              fetchedSongs.push({ songId: doc.id, ...doc.data() });
            });
            setSongs(fetchedSongs);
          }, (error) => {
            console.error("Firestore songs listener error:", error);
          });
        }
      } catch (err) {
        console.error("Failed to load songs:", err);
      } finally {
        setSongsLoading(false);
      }
    }

    loadSongs();

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [currentUser]);

  // Add or Edit song details
  const handleSaveSong = async (songData) => {
    try {
      let lastEditedFields = "";
      let keyChangeMeta = {};
      if (songToEdit) {
        const editedFieldsList = [];
        const formatFieldChange = (fieldName, oldVal, newVal, isLongText = false) => {
          const cleanOld = oldVal !== undefined && oldVal !== null && oldVal.toString().trim() !== "" 
            ? (isLongText ? (oldVal.toString().length > 15 ? oldVal.toString().substring(0, 15).replace(/\n/g, " ") + "..." : oldVal.toString().replace(/\n/g, " ")) : oldVal.toString()) 
            : "None";
          const cleanNew = newVal !== undefined && newVal !== null && newVal.toString().trim() !== "" 
            ? (isLongText ? (newVal.toString().length > 15 ? newVal.toString().substring(0, 15).replace(/\n/g, " ") + "..." : newVal.toString().replace(/\n/g, " ")) : newVal.toString()) 
            : "None";
          return `${fieldName}: ${cleanOld} ---> ${cleanNew} (edited)`;
        };

        if (songToEdit.title !== songData.title) {
          editedFieldsList.push(formatFieldChange("Title", songToEdit.title, songData.title));
        }
        if (songToEdit.artist !== songData.artist) {
          editedFieldsList.push(formatFieldChange("Artist", songToEdit.artist, songData.artist));
        }
        
        // Track transpositions / key changes!
        const prevKey = songToEdit.currentKey || songToEdit.originalKey || "C Major";
        if (prevKey !== songData.currentKey) {
          keyChangeMeta = {
            keyLastChangedBy: currentUser.uid,
            keyLastChangedByName: currentUser.displayName,
            keyLastChangedAt: new Date().toISOString(),
          };
          editedFieldsList.push(formatFieldChange("Key", prevKey, songData.currentKey));
        }
        if (songToEdit.originalKey !== songData.originalKey) {
          editedFieldsList.push(formatFieldChange("Original Key", songToEdit.originalKey, songData.originalKey));
        }
        if (Number(songToEdit.bpm) !== Number(songData.bpm)) {
          editedFieldsList.push(formatFieldChange("BPM", songToEdit.bpm, songData.bpm));
        }
        if (songToEdit.timeSignature !== songData.timeSignature) {
          editedFieldsList.push(formatFieldChange("Time Sig", songToEdit.timeSignature, songData.timeSignature));
        }
        if (songToEdit.lyricsEnglish !== songData.lyricsEnglish) {
          editedFieldsList.push(formatFieldChange("English Lyrics", songToEdit.lyricsEnglish, songData.lyricsEnglish, true));
        }
        if (songToEdit.lyricsTamil !== songData.lyricsTamil) {
          editedFieldsList.push(formatFieldChange("Tamil Lyrics", songToEdit.lyricsTamil, songData.lyricsTamil, true));
        }
        if (songToEdit.youtubeLink !== songData.youtubeLink) {
          editedFieldsList.push(formatFieldChange("YouTube Link", songToEdit.youtubeLink, songData.youtubeLink));
        }
        if (songToEdit.spotifyLink !== songData.spotifyLink) {
          editedFieldsList.push(formatFieldChange("Spotify Link", songToEdit.spotifyLink, songData.spotifyLink));
        }
        if (songToEdit.ccli !== songData.ccli) {
          editedFieldsList.push(formatFieldChange("CCLI", songToEdit.ccli, songData.ccli));
        }
        if (songToEdit.notes !== songData.notes) {
          editedFieldsList.push(formatFieldChange("Notes", songToEdit.notes, songData.notes, true));
        }

        const oldTags = songToEdit.tags || [];
        const newTags = songData.tags || [];
        if (JSON.stringify(oldTags) !== JSON.stringify(newTags)) {
          editedFieldsList.push(formatFieldChange("Tags", oldTags.join(", "), newTags.join(", ")));
        }

        lastEditedFields = editedFieldsList.length > 0 
          ? editedFieldsList.join(", ") 
          : "No major fields changed";
      }

      if (USE_DEMO_MODE) {
        const storedSongs = await AsyncStorage.getItem(SONGS_DB_KEY);
        const currentSongs = storedSongs ? JSON.parse(storedSongs) : INITIAL_MOCK_SONGS;

        if (songToEdit) {
          // Edit existing song
          const updatedSongs = currentSongs.map((s) => {
            if (s.songId === songToEdit.songId) {
              return {
                ...s,
                ...songData,
                ...keyChangeMeta,
                lastEditedBy: currentUser.uid,
                lastEditedByName: currentUser.displayName,
                lastEditedAt: new Date().toISOString(),
                lastEditedFields: lastEditedFields,
              };
            }
            return s;
          });
          await AsyncStorage.setItem(SONGS_DB_KEY, JSON.stringify(updatedSongs));
          setSongs(updatedSongs);
          // Update currently selected song view too!
          setSelectedSong({
            ...selectedSong,
            ...songData,
            ...keyChangeMeta,
            lastEditedBy: currentUser.uid,
            lastEditedByName: currentUser.displayName,
            lastEditedAt: new Date().toISOString(),
            lastEditedFields: lastEditedFields,
          });
          Alert.alert("Success", "Song updated successfully!");
        } else {
          // Create new song
          const newSong = {
            songId: "mock-song-" + Math.floor(Math.random() * 100000),
            ...songData,
            addedBy: currentUser.uid,
            addedByName: currentUser.displayName,
            createdAt: new Date().toISOString(),
          };
          const updatedSongs = [newSong, ...currentSongs];
          await AsyncStorage.setItem(SONGS_DB_KEY, JSON.stringify(updatedSongs));
          setSongs(updatedSongs);
          Alert.alert("Success", "New song added successfully!");
        }
        setSongTabScreen("Search");
        setSongToEdit(null);
      } else {
        // Real Live Firebase Firestore operation
        if (songToEdit) {
          // Edit mode
          const songDocRef = doc(db, "songs", songToEdit.songId);
          await updateDoc(songDocRef, {
            ...songData,
            ...keyChangeMeta,
            lastEditedBy: currentUser.uid,
            lastEditedByName: currentUser.displayName,
            lastEditedAt: serverTimestamp(),
            lastEditedFields: lastEditedFields,
          });
          setSelectedSong({
            ...selectedSong,
            ...songData,
            ...keyChangeMeta,
            lastEditedBy: currentUser.uid,
            lastEditedByName: currentUser.displayName,
            lastEditedAt: new Date(), // Local fallback representation for UI
            lastEditedFields: lastEditedFields,
          });
          Alert.alert("Success", "Song updated successfully!");
        } else {
          // Add mode
          const songsCollectionRef = collection(db, "songs");
          await addDoc(songsCollectionRef, {
            ...songData,
            addedBy: currentUser.uid,
            addedByName: currentUser.displayName,
            createdAt: serverTimestamp(),
          });
          Alert.alert("Success", "New song added successfully!");
        }
        setSongTabScreen("Search");
        setSongToEdit(null);
      }
    } catch (error) {
      console.error("Failed to save song:", error);
      Alert.alert("Error", "Could not save song details: " + error.message);
    }
  };

  // Handler: When Splash Transition finishes
  const handleSplashFinished = async () => {
    if (currentUser) {
      setCurrentScreen("Dashboard");
    } else {
      try {
        const completed = await AsyncStorage.getItem("@hasCompletedOnboarding");
        if (completed === "true") {
          setCurrentScreen("Login");
        } else {
          setCurrentScreen("Onboarding");
        }
      } catch (e) {
        setCurrentScreen("Onboarding");
      }
    }
  };

  const handleOnboardingFinished = () => {
    setCurrentScreen("PhoneInput");
  };

  const handleForgotPasswordTriggered = async () => {
    setResetPasswordPending(true);
    await AsyncStorage.setItem("@reset_password_pending", "true");
  };

  // Handler: Sending OTP Verification SMS Code
  const handleSendOtpCode = async (phone) => {
    setTempPhone(phone);
    if (USE_DEMO_MODE) {
      // Demo Flow: Generate a random 6-digit OTP code and alert it
      const randomOtp = Math.floor(100000 + Math.random() * 900000).toString();
      setDemoOtpCode(randomOtp);

      return new Promise((resolve) => {
        setTimeout(async () => {
          // Check if user is already registered in our mock database
          const dbString = await AsyncStorage.getItem(DEMO_USERS_DB_KEY);
          const localDb = dbString ? JSON.parse(dbString) : INITIAL_DEMO_USERS;
          
          const cleanPhone = stripCountryCode(phone);
          if (localDb[phone] || localDb[cleanPhone]) {
            setIsNewRegistration(false);
          } else {
            setIsNewRegistration(true);
          }

          // Show the simulated SMS OTP Alert to the user
          const formattedPhone = phone.startsWith("+") ? phone : `+1 ${phone}`;
          Alert.alert(
            "Demo Verification Code (SMS)",
            `[SIMULATED SMS]\nTo: ${formattedPhone}\n\nYour worship app verification code is: ${randomOtp}`
          );

          setCurrentScreen("OtpVerify");
          resolve(true);
        }, 1200);
      });
    } else {
      // Live Firebase Flow using real Phone Authentication
      try {
        if (!recaptchaVerifier.current) {
          throw new Error("reCAPTCHA verifier is not initialized yet.");
        }

        // Send SMS OTP code
        const phoneProvider = new PhoneAuthProvider(auth);
        const verId = await phoneProvider.verifyPhoneNumber(
          phone,
          recaptchaVerifier.current
        );
        setVerificationId(verId);

        const cleanPhone = stripCountryCode(phone);
        const usersColl = collection(db, "users");
        
        let q = query(usersColl, where("phone", "==", phone));
        let querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
          q = query(usersColl, where("phone", "==", cleanPhone));
          querySnapshot = await getDocs(q);
        }
        
        if (!querySnapshot.empty) {
          setIsNewRegistration(false);
        } else {
          setIsNewRegistration(true);
        }
        
        setCurrentScreen("OtpVerify");
        return true;
      } catch (err) {
        console.error("Firebase Phone Auth send error:", err);
        Alert.alert(
          "Verification Error",
          "Could not send verification SMS: " + err.message
        );
        throw err;
      }
    }
  };

  // Handler: Verify OTP
  const handleVerifyOtp = async (otpCode) => {
    if (USE_DEMO_MODE) {
      return new Promise((resolve, reject) => {
        setTimeout(async () => {
          // Verify that the code matches the generated demoOtpCode
          if (otpCode === demoOtpCode) {
            const dbString = await AsyncStorage.getItem(DEMO_USERS_DB_KEY);
            const localDb = dbString ? JSON.parse(dbString) : INITIAL_DEMO_USERS;

            if (isNewRegistration) {
              setCurrentScreen("Register");
            } else {
              // Retrieve existing user
              const cleanPhone = stripCountryCode(tempPhone);
              const existingUser = localDb[tempPhone] || localDb[cleanPhone];
              setCurrentUser({
                uid: existingUser.uid,
                displayName: existingUser.displayName,
                phone: existingUser.phone,
                role: existingUser.role,
              });
              // Persist session
              await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(existingUser));
              
              const pendingReset = await AsyncStorage.getItem("@reset_password_pending");
              if (pendingReset === "true") {
                setResetPasswordPending(true);
              }
              setCurrentScreen("Dashboard");
            }
            resolve(true);
          } else {
            reject(new Error("Invalid 6-digit verification code. Please try again."));
          }
        }, 1200);
      });
    } else {
      // Live Firebase verification implementation using PhoneAuth credential
      if (!verificationId) {
        throw new Error("No active verification session was found. Please request an OTP first.");
      }

      if (otpCode.length !== 6) {
        throw new Error("Verification code must be exactly 6 digits.");
      }

      try {
        const credential = PhoneAuthProvider.credential(verificationId, otpCode);
        const userCredential = await signInWithCredential(auth, credential);
        const firebaseUser = userCredential.user;

        if (isNewRegistration) {
          setCurrentScreen("Register");
        } else {
          const cleanPhone = stripCountryCode(tempPhone);
          const usersColl = collection(db, "users");
          
          let q = query(usersColl, where("phone", "==", tempPhone));
          let querySnapshot = await getDocs(q);
          
          if (querySnapshot.empty) {
            q = query(usersColl, where("phone", "==", cleanPhone));
            querySnapshot = await getDocs(q);
          }
          
          if (!querySnapshot.empty) {
            const userDoc = querySnapshot.docs[0];
            const existingUser = { uid: userDoc.id, ...userDoc.data() };
            
            // Migrate document ID to match real Phone Auth UID if it doesn't already
            if (userDoc.id !== firebaseUser.uid) {
              const migratedProfile = {
                ...existingUser,
                uid: firebaseUser.uid,
              };
              
              await setDoc(doc(db, "users", firebaseUser.uid), migratedProfile);
              try {
                await deleteDoc(doc(db, "users", userDoc.id));
              } catch (delErr) {
                console.warn("Could not delete old duplicate Firestore record:", delErr);
              }
              
              setCurrentUser(migratedProfile);
              await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(migratedProfile));
            } else {
              setCurrentUser(existingUser);
              await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(existingUser));
            }
            
            const pendingReset = await AsyncStorage.getItem("@reset_password_pending");
            if (pendingReset === "true") {
              setResetPasswordPending(true);
            }
            setCurrentScreen("Dashboard");
          } else {
            // Fallback to registration if profile isn't found
            setCurrentScreen("Register");
          }
        }
        return true;
      } catch (err) {
        console.error("Error during Phone OTP verification:", err);
        throw err;
      }
    }
  };

  // Handler: Resend verification code
  const handleResendCode = async (phone) => {
    if (USE_DEMO_MODE) {
      const formatted = phone.startsWith("+") ? phone : `+1 ${phone}`;
      Alert.alert(
        "OTP Bypass Active",
        `A simulated verification code has been sent to ${formatted}.\n\nDeveloper Note: Simply enter ANY 6-digit code to continue!`
      );
    } else {
      try {
        if (!recaptchaVerifier.current) {
          throw new Error("reCAPTCHA verifier is not initialized.");
        }
        const phoneProvider = new PhoneAuthProvider(auth);
        const verId = await phoneProvider.verifyPhoneNumber(
          phone,
          recaptchaVerifier.current
        );
        setVerificationId(verId);
        Alert.alert("SMS Sent", "A new verification code has been sent to your phone number.");
      } catch (err) {
        console.error("Error resending OTP code:", err);
        Alert.alert("Send Failed", err.message || "Failed to resend verification code.");
      }
    }
  };

  // Handler: Register Profile Completion
  const handleCompleteRegistration = async ({ displayName, password, phone }) => {
    if (USE_DEMO_MODE) {
      return new Promise((resolve) => {
        setTimeout(async () => {
          const dbString = await AsyncStorage.getItem(DEMO_USERS_DB_KEY);
          const localDb = dbString ? JSON.parse(dbString) : INITIAL_DEMO_USERS;

          const newUid = "demo-user-" + Math.floor(Math.random() * 100000);
          const newProfile = {
            uid: newUid,
            displayName: displayName,
            phone: phone,
            role: "member", // default role for all new signups
            password: password, // Store password to allow demo password logins later
            createdAt: new Date().toISOString(),
          };

          // Save to our persistent mock database
          localDb[phone] = newProfile;
          await AsyncStorage.setItem(DEMO_USERS_DB_KEY, JSON.stringify(localDb));

          // Set as active session
          setCurrentUser(newProfile);
          await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(newProfile));

          setCurrentScreen("Dashboard");
          resolve(true);
        }, 1500);
      });
    } else {
      // Live Firebase Profile Writing to Firestore
      try {
        const firebaseUser = auth.currentUser;
        if (!firebaseUser) {
          throw new Error("No active authenticated session. Please verify your phone number first.");
        }

        // Link synthetic email/password credentials to allow fallback password sign-ins
        const email = getSyntheticEmail(phone);
        const emailCred = EmailAuthProvider.credential(email, password);
        try {
          await linkWithCredential(firebaseUser, emailCred);
        } catch (linkErr) {
          console.warn("Attempt to link synthetic email/password to phone auth failed:", linkErr);
        }

        const newProfile = {
          uid: firebaseUser.uid,
          displayName: displayName,
          phone: phone,
          role: "member", // Default for new signups
          password: password,
          createdAt: new Date().toISOString(),
        };

        // Write directly to live Firestore users collection under the actual Firebase uid!
        await setDoc(doc(db, "users", firebaseUser.uid), newProfile);
        
        setCurrentUser(newProfile);
        await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(newProfile));
        setCurrentScreen("Dashboard");
      } catch (err) {
        console.error("Firestore/Auth registration error:", err);
        throw new Error("Unable to save profile info: " + err.message);
      }
    }
  };

  // Handler: Password Logins & OTP Successful returns
  const handlePasswordLoginSuccess = async (loginData) => {
    if (USE_DEMO_MODE) {
      const dbString = await AsyncStorage.getItem(DEMO_USERS_DB_KEY);
      const localDb = dbString ? JSON.parse(dbString) : INITIAL_DEMO_USERS;
      
      const cleanPhone = stripCountryCode(loginData.phone);
      const userRecord = localDb[loginData.phone] || localDb[cleanPhone];
      
      if (userRecord && userRecord.password === loginData.password) {
        setCurrentUser({
          uid: userRecord.uid,
          displayName: userRecord.displayName,
          phone: userRecord.phone,
          role: userRecord.role,
        });
        await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(userRecord));
        setCurrentScreen("Dashboard");
      } else {
        throw new Error("Incorrect phone number or password. Try logging in with: 1111111111 and password123");
      }
    } else {
      // Live Mode: Handle password authentication against live Firestore & Firebase Auth
      try {
        const cleanPhone = stripCountryCode(loginData.phone);
        const email = getSyntheticEmail(cleanPhone);
        
        // 1. Attempt Firebase Auth sign-in first
        try {
          const userCredential = await signInWithEmailAndPassword(auth, email, loginData.password);
          const firebaseUser = userCredential.user;
          
          // Fetch Firestore user doc
          const userDoc = await getDoc(doc(db, "users", firebaseUser.uid));
          if (userDoc.exists()) {
            const userData = userDoc.data();
            const loggedInUser = {
              uid: firebaseUser.uid,
              displayName: userData.displayName || "Unknown User",
              phone: userData.phone || loginData.phone,
              role: userData.role || "member",
            };
            setCurrentUser(loggedInUser);
            await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(loggedInUser));
            setCurrentScreen("Dashboard");
            return;
          } else {
            // Profile exists in Auth but not under this UID in Firestore.
            // Let's check if there is an existing profile under their phone number with a different UID!
            const cleanPhone = stripCountryCode(loginData.phone);
            const usersColl = collection(db, "users");
            let q = query(usersColl, where("phone", "==", loginData.phone));
            let querySnapshot = await getDocs(q);
            
            if (querySnapshot.empty) {
              q = query(usersColl, where("phone", "==", cleanPhone));
              querySnapshot = await getDocs(q);
            }
            
            if (!querySnapshot.empty) {
              // Found the profile under a different UID! Let's migrate it.
              const oldDoc = querySnapshot.docs[0];
              const oldProfile = oldDoc.data();
              const updatedProfile = {
                ...oldProfile,
                uid: firebaseUser.uid,
                password: loginData.password, // Keep password updated
              };
              
              await setDoc(doc(db, "users", firebaseUser.uid), updatedProfile);
              
              if (oldDoc.id !== firebaseUser.uid) {
                try {
                  await deleteDoc(doc(db, "users", oldDoc.id));
                } catch (delErr) {
                  console.warn("Could not delete old duplicate Firestore record:", delErr);
                }
              }
              
              setCurrentUser(updatedProfile);
              await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(updatedProfile));
              setCurrentScreen("Dashboard");
              return;
            } else {
              // No existing profile found at all. Create a new one.
              const newProfile = {
                uid: firebaseUser.uid,
                displayName: "Unknown User",
                phone: loginData.phone,
                role: "member",
                password: loginData.password,
                createdAt: new Date().toISOString(),
              };
              await setDoc(doc(db, "users", firebaseUser.uid), newProfile);
              setCurrentUser(newProfile);
              await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(newProfile));
              setCurrentScreen("Dashboard");
              return;
            }
          }
        } catch (authErr) {
          // If auth fails, check if the error is user-not-found or wrong-password
          // If the user exists in Firestore but NOT in Firebase Auth yet (e.g. registered before auth upgrade),
          // we should auto-upgrade them!
          console.log("Auth login attempt failed, checking Firestore fallback...", authErr.code);
          
          const usersColl = collection(db, "users");
          let q = query(usersColl, where("phone", "==", loginData.phone));
          let querySnapshot = await getDocs(q);
          
          if (querySnapshot.empty) {
            q = query(usersColl, where("phone", "==", cleanPhone));
            querySnapshot = await getDocs(q);
          }
          
          if (!querySnapshot.empty) {
            const userDoc = querySnapshot.docs[0];
            const userRecord = { uid: userDoc.id, ...userDoc.data() };
            
            if (userRecord.password === loginData.password) {
              // Valid Firestore password! Let's auto-register them in Firebase Auth under this email and password
              try {
                const userCredential = await createUserWithEmailAndPassword(auth, email, loginData.password);
                const newFirebaseUser = userCredential.user;
                
                // Let's migrate their Firestore doc to their new real Firebase UID if their old doc had a generated ID!
                const updatedProfile = {
                  ...userRecord,
                  uid: newFirebaseUser.uid,
                };
                
                // Save under new real Firebase uid
                await setDoc(doc(db, "users", newFirebaseUser.uid), updatedProfile);
                
                // Delete old generated Firestore doc if its ID wasn't the newFirebaseUser.uid
                if (userDoc.id !== newFirebaseUser.uid) {
                  try {
                    await deleteDoc(doc(db, "users", userDoc.id));
                  } catch (delErr) {
                    console.warn("Could not delete old duplicate Firestore record:", delErr);
                  }
                }
                
                setCurrentUser(updatedProfile);
                await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(updatedProfile));
                setCurrentScreen("Dashboard");
                return;
              } catch (regErr) {
                if (regErr.code === "auth/email-already-in-use") {
                  throw new Error("This account is already registered in Firebase Auth, but the passwords do not match. Please use the 'Forgot Password' link to reset your password via SMS OTP and sync your credentials.");
                }
                console.error("Auto-auth upgrade registration failed:", regErr);
                throw new Error("Authentication synchronization failed: " + regErr.message);
              }
            }
          } else {
            // Firestore is empty and auth failed. Let's check for Super Admin auto-seeding!
            if (cleanPhone === "7777777777" && loginData.password === "password123") {
              try {
                // Create Firebase Auth credentials
                const userCredential = await createUserWithEmailAndPassword(auth, email, "password123");
                const newFirebaseUser = userCredential.user;
                
                const superAdminProfile = {
                  uid: newFirebaseUser.uid,
                  displayName: "Chief Admin Samuel",
                  phone: loginData.phone,
                  role: "super_admin",
                  password: "password123",
                  createdAt: new Date().toISOString(),
                };
                await setDoc(doc(db, "users", newFirebaseUser.uid), superAdminProfile);
                
                setCurrentUser(superAdminProfile);
                await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(superAdminProfile));
                setCurrentScreen("Dashboard");
                return;
              } catch (seedErr) {
                console.error("Failed to seed Super Admin in Auth:", seedErr);
                // Fallback to Firestore only if Auth seeding fails
                const superAdminProfile = {
                  uid: "live-super-777",
                  displayName: "Chief Admin Samuel",
                  phone: loginData.phone,
                  role: "super_admin",
                  password: "password123",
                  createdAt: new Date().toISOString(),
                };
                await setDoc(doc(db, "users", "live-super-777"), superAdminProfile);
                
                setCurrentUser(superAdminProfile);
                await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(superAdminProfile));
                setCurrentScreen("Dashboard");
                return;
              }
            }
          }
          
          throw new Error("Incorrect phone number or password. Please verify your credentials.");
        }
      } catch (error) {
        console.error("Firestore password login error:", error);
        throw new Error(error.message || "Failed to log in via Firestore.");
      }
    }
  };

  // Handler: Logging out
  const handleLogout = async () => {
    if (USE_DEMO_MODE) {
      await AsyncStorage.removeItem(SESSION_KEY);
      setCurrentUser(null);
      setCurrentScreen("Login");
    } else {
      try {
        await firebaseSignOut(auth);
        setCurrentUser(null);
        setCurrentScreen("Login");
      } catch (error) {
        Alert.alert("Logout Failed", error.message);
      }
    }
  };

  // Mock Tab Screen Renderer for Phase 2 previews
  const renderMockTabScreen = (title, description) => {
    return (
      <View style={styles.mockTabContainer}>
        <Text style={styles.mockTabEmoji}>{title.split(" ")[0]}</Text>
        <Text style={styles.mockTabTitle}>{title.substring(title.indexOf(" ") + 1)}</Text>
        <Text style={styles.mockTabDesc}>{description}</Text>
        <View style={styles.mockTabBadge}>
          <Text style={styles.mockTabBadgeText}>Coming in Phase 2</Text>
        </View>
      </View>
    );
  };

  // Song Tab Sub-screen Controller
  const renderSongTabContent = () => {
    switch (songTabScreen) {
      case "Search":
        return (
          <SongSearchScreen
            songs={songs}
            user={currentUser}
            onSelectSong={(song) => {
              setSelectedSong(song);
              setSongTabScreen("Detail");
            }}
            onAddSong={() => {
              setSongToEdit(null);
              setSongTabScreen("AddSong");
            }}
          />
        );
      case "Detail":
        return selectedSong ? (
          <SongDetailScreen
            song={selectedSong}
            user={currentUser}
            onBack={() => setSongTabScreen("Search")}
            onEditSong={(song, hasLyricTask) => {
              setSongToEdit({ ...song, hasLyricTaskClearance: hasLyricTask });
              setSongTabScreen("AddSong");
            }}
            onUpdateSong={(updatedSong) => {
              setSelectedSong(updatedSong);
              setSongs((prev) => prev.map((s) => s.songId === updatedSong.songId ? updatedSong : s));
            }}
            onDeleteSong={(deletedSongId) => {
              setSongs((prev) => prev.filter((s) => s.songId !== deletedSongId));
              setSongTabScreen("Search");
            }}
            setlist={songs}
            initialSongIndex={songs.findIndex(s => s.songId === selectedSong.songId)}
          />
        ) : (
          <Text style={styles.errorText}>No song selected</Text>
        );
      case "AddSong":
        return (
          <AddSongScreen
            songToEdit={songToEdit}
            user={currentUser}
            onSave={handleSaveSong}
            songs={songs}
            onCancel={() => {
              if (songToEdit) {
                setSongTabScreen("Detail");
              } else {
                setSongTabScreen("Search");
              }
              setSongToEdit(null);
            }}
          />
        );
      default:
        return (
          <SongSearchScreen
            songs={songs}
            user={currentUser}
            onSelectSong={(song) => {
              setSelectedSong(song);
              setSongTabScreen("Detail");
            }}
            onAddSong={() => {
              setSongToEdit(null);
              setSongTabScreen("AddSong");
            }}
          />
        );
    }
  };

  // Central Logged-In Tab Nav Switch
  const renderTabContent = () => {
    switch (activeTab) {
      case "Home":
        return (
          <Dashboards
            user={currentUser}
            songs={songs}
            onLogout={handleLogout}
            onJumpToRoster={handleJumpToRoster}
            onJumpToSongDetail={handleJumpToSongDetail}
            onJumpToSongSearch={handleJumpToSongSearch}
            onNavigateToTasks={() => setActiveTab("Tasks")}
            onNavigateToAnalytics={() => setActiveTab("Analytics")}
          />
        );
      case "Songs":
        return renderSongTabContent();
      case "Profile":
        return (
          <ProfileScreen 
            user={currentUser} 
            onLogout={handleLogout} 
            onUpdateUser={(updatedUser) => setCurrentUser(updatedUser)}
          />
        );
      case "Roster":
        return (
          <RosterScreen
            user={currentUser}
            songs={songs}
            directRosterTargetId={directRosterTargetId}
            clearDirectRosterTarget={() => setDirectRosterTargetId(null)}
            onAddSongInline={(newSong) => setSongs((prev) => [newSong, ...prev])}
            onUpdateSongInline={(updatedSong) => setSongs((prev) => prev.map((s) => s.songId === updatedSong.songId ? updatedSong : s))}
          />
        );
      case "Admin":
        if (currentUser && (currentUser.role === "worship_leader" || currentUser.role === "super_admin")) {
          return <AdminPanelScreen user={currentUser} />;
        }
        return <Dashboards user={currentUser} onLogout={handleLogout} />;
      case "Tasks":
        return (
          <TasksScreen 
            user={currentUser} 
            songs={songs} 
            onJumpToRoster={handleJumpToRoster}
            onJumpToSongDetail={(song) => handleJumpToSongDetail(song, "lyrics")}
          />
        );
      case "Analytics":
        if (currentUser && (currentUser.role === "worship_leader" || currentUser.role === "super_admin")) {
          return (
            <AnalyticsScreen 
              user={currentUser} 
              onBack={() => setActiveTab("Home")} 
            />
          );
        }
        return <Dashboards user={currentUser} onLogout={handleLogout} />;
      default:
        return <Dashboards user={currentUser} onLogout={handleLogout} />;
    }
  };

  // Dynamic Navigation Render Switch
  const renderScreen = () => {
    switch (currentScreen) {
      case "Splash":
        return <SplashScreen onGetStarted={handleSplashFinished} />;
      case "Login":
        return (
          <LoginScreen
            onLoginSuccess={(data) => {
              if (data.method === "password") {
                return handlePasswordLoginSuccess(data);
              } else {
                setCurrentUser(data);
                setCurrentScreen("Dashboard");
              }
            }}
            onNavigateToRegister={() => setCurrentScreen("PhoneInput")}
            onSendOtpCode={handleSendOtpCode}
            isDemoMode={USE_DEMO_MODE}
            onForgotPasswordTriggered={handleForgotPasswordTriggered}
          />
        );
      case "PhoneInput":
        return (
          <PhoneInputScreen
            onSendOtpCode={handleSendOtpCode}
            onNavigateToLogin={() => setCurrentScreen("Login")}
          />
        );
      case "OtpVerify":
        return (
          <OtpVerifyScreen
            phoneNumber={tempPhone}
            onVerifyOtp={handleVerifyOtp}
            onResendCode={handleResendCode}
            onNavigateBack={() => setCurrentScreen("PhoneInput")}
            isDemoMode={USE_DEMO_MODE}
          />
        );
      case "Onboarding":
        return <OnboardingScreen onFinish={handleOnboardingFinished} />;
      case "Register":
        return (
          <RegisterScreen
            phoneNumber={tempPhone}
            onCompleteRegistration={handleCompleteRegistration}
          />
        );
      case "Dashboard":
        return currentUser ? (
          <View style={styles.dashboardShell}>
            <View style={styles.tabContentContainer}>
              {renderTabContent()}
            </View>
            <BottomNavBar
              activeTab={activeTab}
              onTabSelect={(tab) => {
                setActiveTab(tab);
                // Reset song sub-screens when switching tabs
                if (tab === "Songs") {
                  setSongTabScreen("Search");
                  setSelectedSong(null);
                  setSongToEdit(null);
                }
              }}
              user={currentUser}
            />
          </View>
        ) : (
          <LoginScreen
            onLoginSuccess={handlePasswordLoginSuccess}
            onNavigateToRegister={() => setCurrentScreen("PhoneInput")}
            onSendOtpCode={handleSendOtpCode}
            isDemoMode={USE_DEMO_MODE}
            onForgotPasswordTriggered={handleForgotPasswordTriggered}
          />
        );
      default:
        return <SplashScreen onGetStarted={handleSplashFinished} />;
    }
  };

  if (appLoading) {
    return (
      <View style={styles.loadingContainer}>
        <Image 
          source={require("./assets/logo.png")} 
          style={{ width: 120, height: 120, marginBottom: 24 }} 
          resizeMode="contain"
        />
        <Text style={{ fontSize: 26, fontWeight: "800", color: "#FFFFFF", letterSpacing: -0.5 }}>Worship Team</Text>
        <Text style={{ fontSize: 13, fontWeight: "900", color: "#3B82F6", letterSpacing: 8, marginTop: 6, textTransform: "uppercase" }}>APP</Text>
        <ActivityIndicator size="large" color="#3B82F6" style={{ marginTop: 32 }} />
        <Text style={{ color: "#475569", fontSize: 12, fontWeight: "600", marginTop: 24, letterSpacing: 0.5 }}>Securing connection...</Text>
      </View>
    );
  }

  return (
    <View style={styles.appContainer}>
      {renderScreen()}
      {currentUser && resetPasswordPending && (
        <ResetPasswordModal
          visible={resetPasswordPending}
          currentUser={currentUser}
          onSuccess={async (updatedUser) => {
            setCurrentUser(updatedUser);
            setResetPasswordPending(false);
            await AsyncStorage.removeItem("@reset_password_pending");
          }}
          onCancel={async () => {
            // Log out the user if they cancel the password reset
            if (USE_DEMO_MODE) {
              setCurrentUser(null);
              await AsyncStorage.removeItem(SESSION_KEY);
              setCurrentScreen("Login");
            } else {
              try {
                await firebaseSignOut(auth);
              } catch (e) {
                console.warn("Sign out on password reset cancel failed:", e);
              }
              setCurrentUser(null);
              setCurrentScreen("Login");
            }
            setResetPasswordPending(false);
            await AsyncStorage.removeItem("@reset_password_pending");
          }}
        />
      )}
      {!USE_DEMO_MODE && auth && auth.app && (
        <FirebaseRecaptchaVerifierModal
          ref={recaptchaVerifier}
          firebaseConfig={auth.app.options}
          attemptInvisibleVerification
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  appContainer: {
    flex: 1,
    backgroundColor: "#0B0F19",
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: "#0B0F19",
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  dashboardShell: {
    flex: 1,
    position: "relative",
  },
  tabContentContainer: {
    flex: 1,
    paddingBottom: 76, // Height of BottomNavBar (76)
  },
  mockTabContainer: {
    flex: 1,
    backgroundColor: "#0B0F19",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  mockTabEmoji: {
    fontSize: 64,
    marginBottom: 20,
  },
  mockTabTitle: {
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "800",
    marginBottom: 12,
  },
  mockTabDesc: {
    color: "#94A3B8",
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    marginBottom: 24,
    maxWidth: 300,
  },
  mockTabBadge: {
    backgroundColor: "rgba(59, 130, 246, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(59, 130, 246, 0.2)",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  mockTabBadgeText: {
    color: "#3B82F6",
    fontSize: 13,
    fontWeight: "800",
  },
  errorText: {
    color: "#EF4444",
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 40,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(11, 15, 25, 0.85)",
    justifyContent: "center",
    alignItems: "center",
  },
  resetCard: {
    width: "88%",
    backgroundColor: "#1E293B",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#334155",
    padding: 30,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 15,
    elevation: 8,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#FFFFFF",
    marginBottom: 10,
    textAlign: "center",
  },
  modalSubtitle: {
    fontSize: 14,
    color: "#94A3B8",
    textAlign: "center",
    marginBottom: 24,
    lineHeight: 20,
  },
  modalErrorText: {
    color: "#EF4444",
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 16,
    textAlign: "center",
    backgroundColor: "rgba(239, 68, 68, 0.1)",
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.2)",
    width: "100%",
  },
  modalInput: {
    width: "100%",
    backgroundColor: "#0B0F19",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#334155",
    height: 52,
    paddingHorizontal: 16,
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 16,
  },
  resetSubmitBtn: {
    width: "100%",
    backgroundColor: "#F59E0B",
    height: 52,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 10,
    shadowColor: "#F59E0B",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  resetSubmitBtnText: {
    color: "#0B0F19",
    fontSize: 16,
    fontWeight: "800",
  },
  disabledBtn: {
    backgroundColor: "#1E293B",
    borderColor: "#334155",
    borderWidth: 1,
  },
});
