import React from "react";
import { StyleSheet, Text, View, TouchableOpacity, ScrollView, Dimensions, Alert, Linking, ActivityIndicator } from "react-native";
import { StatusBar } from "expo-status-bar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { USE_DEMO_MODE, db, auth } from "../firebaseConfig";
import { collection, query, orderBy, onSnapshot, doc, updateDoc, getDocs, deleteDoc, getDoc, setDoc, where } from "firebase/firestore";
import MetronomeScreen from "./MetronomeScreen";
import * as Notifications from "expo-notifications";
import { sendLocalNotification } from "../services/notificationService";

const { width } = Dimensions.get("window");

// Robust custom date string parsing utility
const parseEventDate = (eventDateStr) => {
  if (!eventDateStr || typeof eventDateStr !== "string") return null;
  try {
    const parts = eventDateStr.split(",");
    if (parts.length >= 3) {
      const monthDay = parts[0].trim().split(" ");
      const year = parseInt(parts[1].trim(), 10);
      const timeFullParts = parts[2].trim().split(" ");
      const hourMin = timeFullParts[0].trim().split(":");
      const ampm = timeFullParts[1].trim().toUpperCase();

      const MONTHS_LIST = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
      ];
      const MONTHS_SHORT = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
      ];
      
      const monthName = monthDay[0].trim();
      let monthIdx = MONTHS_LIST.indexOf(monthName);
      if (monthIdx === -1) {
        monthIdx = MONTHS_SHORT.indexOf(monthName);
      }
      if (monthIdx === -1) {
        monthIdx = MONTHS_LIST.findIndex(m => m.toLowerCase().startsWith(monthName.toLowerCase().substring(0, 3)));
      }
      
      const dayVal = parseInt(monthDay[1].trim(), 10);
      
      let hour = parseInt(hourMin[0], 10);
      const minute = parseInt(hourMin[1], 10);

      if (ampm === "PM" && hour < 12) hour += 12;
      if (ampm === "AM" && hour === 12) hour = 0;

      if (monthIdx !== -1 && !isNaN(dayVal) && !isNaN(year) && !isNaN(hour) && !isNaN(minute)) {
        return new Date(year, monthIdx, dayVal, hour, minute);
      }
    }
  } catch (e) {
    console.log("Error parsing eventDate:", e);
  }

  // Fallback to standard native parsing
  try {
    const d = new Date(eventDateStr);
    if (!isNaN(d.getTime())) return d;
  } catch (e) {}

  return null;
};

// Check if current time is past the day after the event date at 12:00 PM (noon)
const isNotificationExpired = (eventDateStr) => {
  const eventDateObj = parseEventDate(eventDateStr);
  if (!eventDateObj) return false;
  
  const threshold = new Date(
    eventDateObj.getFullYear(),
    eventDateObj.getMonth(),
    eventDateObj.getDate() + 1,
    12, 0, 0, 0
  );
  
  return new Date() >= threshold;
};

// Check if the event date is today or in the future
const isUpcomingEventDate = (eventDateStr) => {
  const eventDateObj = parseEventDate(eventDateStr);
  if (!eventDateObj) return true; // Keep if no valid event date
  
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  return eventDateObj >= today;
};

// Sort rosters so upcoming events are closest, then past events are reverse-chronological
const sortRostersUpcomingFirst = (rosterList) => {
  if (!rosterList || rosterList.length === 0) return [];
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  
  const upcoming = [];
  const past = [];
  
  rosterList.forEach(r => {
    const dateObj = parseEventDate(r.eventDate);
    if (dateObj && dateObj >= today) {
      upcoming.push({ r, d: dateObj });
    } else {
      past.push({ r, d: dateObj || new Date(0) });
    }
  });
  
  // Sort upcoming chronologically (closest date first)
  upcoming.sort((a, b) => a.d - b.d);
  
  // Sort past reverse-chronologically (most recent first)
  past.sort((a, b) => b.d - a.d);
  
  const combined = [...upcoming.map(x => x.r), ...past.map(x => x.r)];
  return combined;
};

export default function Dashboards({ user, songs, onLogout, onJumpToRoster, onJumpToSongDetail, onJumpToSongSearch, onNavigateToTasks, onNavigateToAnalytics }) {
  const { displayName, role, phone, uid } = user;

  const [notifications, setNotifications] = React.useState([]);
  const [rawNotifications, setRawNotifications] = React.useState([]);
  const [loadingNotifs, setLoadingNotifs] = React.useState(true);
  const [teamMembers, setTeamMembers] = React.useState([]);
  const [rosters, setRosters] = React.useState([]);
  const [selectedRosterIndex, setSelectedRosterIndex] = React.useState(0);
  const [archivedNotifIds, setArchivedNotifIds] = React.useState([]);
  const [selectedTab, setSelectedTab] = React.useState("pending"); // 'pending' | 'cleared' | 'archived'
  const [nudgeSentStates, setNudgeSentStates] = React.useState({});
  const [acknowledgedCollapsedStates, setAcknowledgedCollapsedStates] = React.useState({});
  const [acknowledgedSectionExpanded, setAcknowledgedSectionExpanded] = React.useState(false);
  const [metronomeVisible, setMetronomeVisible] = React.useState(false);
  const [readyLogs, setReadyLogs] = React.useState({});
  const [pendingTasksCount, setPendingTasksCount] = React.useState(0);

  const scrollViewRef = React.useRef(null);
  const notifSectionYRef = React.useRef(0);

  // Keep track of tasks we have already alerted about in this session to prevent spamming
  const alertedTasksRef = React.useRef(new Set());

  // Real-time local notification dispatches and icon badge tracking
  const lastSeenNotifIdsRef = React.useRef(null);

  React.useEffect(() => {
    if (!notifications || notifications.length === 0) {
      Notifications.setBadgeCountAsync(0).catch(() => {});
      return;
    }

    const unreadCount = notifications.filter(n => !n.acknowledgements || !n.acknowledgements[uid]).length;
    Notifications.setBadgeCountAsync(unreadCount).catch(err => console.log("Failed to set badge count:", err));

    if (lastSeenNotifIdsRef.current === null) {
      // First load: initialize with the current list of notification IDs
      lastSeenNotifIdsRef.current = new Set(notifications.map(n => n.notificationId));
    } else {
      // Subsequent runs: identify new notifications and dispatch them
      notifications.forEach(notif => {
        if (!lastSeenNotifIdsRef.current.has(notif.notificationId)) {
          lastSeenNotifIdsRef.current.add(notif.notificationId);

          // Verify that it is a new/recent notification (created in the last 2 minutes)
          const createdAtMs = notif.createdAt ? new Date(notif.createdAt).getTime() : Date.now();
          if (Date.now() - createdAtMs < 120000) {
            sendLocalNotification(
              notif.title || "New Team Alert 📢",
              notif.message || "",
              { rosterId: notif.rosterId }
            );
          }
        }
      });
    }
  }, [notifications, uid]);

  const checkAndAlertDueSoonTasks = (tasks) => {
    if (!tasks || tasks.length === 0) return;
    
    const todayStr = new Date().toISOString().split("T")[0];
    
    // Calculate tomorrow's date string in YYYY-MM-DD
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split("T")[0];
    
    tasks.forEach((task) => {
      // Avoid duplicate alert for the same task in this session
      const taskKey = task.taskId || task.id || task.title;
      if (alertedTasksRef.current.has(taskKey)) return;
      
      const dueDate = task.dueDate;
      if (!dueDate) return;
      
      if (dueDate === tomorrowStr) {
        alertedTasksRef.current.add(taskKey);
        Alert.alert(
          "⏳ Task Deadline Tomorrow",
          `⚠️ "${task.title}" is due tomorrow (1 day left!).\n\nWould you like to open your Tasks Workspace to complete it?`,
          [
            { text: "Later", style: "cancel" },
            { 
              text: "Open Workspace", 
              style: "default",
              onPress: () => onNavigateToTasks && onNavigateToTasks()
            }
          ]
        );
      } else if (dueDate === todayStr) {
        alertedTasksRef.current.add(taskKey);
        Alert.alert(
          "🚨 Task Due Today!",
          `⚠️ "${task.title}" is due TODAY!\n\nPlease complete this task as soon as possible.`,
          [
            { text: "Later", style: "cancel" },
            { 
              text: "Open Workspace", 
              style: "default",
              onPress: () => onNavigateToTasks && onNavigateToTasks()
            }
          ]
        );
      }
    });
  };

  // Toggle song readiness checklist
  const handleToggleReady = async (rosterId, songId) => {
    const logKey = `${rosterId}_${songId}`;
    const isReady = !!readyLogs[logKey];
    const updated = { ...readyLogs };

    if (isReady) {
      delete updated[logKey];
    } else {
      updated[logKey] = true;
    }

    setReadyLogs(updated);

    try {
      if (USE_DEMO_MODE) {
        const stored = await AsyncStorage.getItem("@worship_team_rosters_ready");
        const parsed = stored ? JSON.parse(stored) : {};
        const userKey = `${rosterId}_${uid}`;
        const userReadyMap = parsed[userKey] || {};
        
        if (isReady) {
          delete userReadyMap[songId];
        } else {
          userReadyMap[songId] = new Date().toISOString();
        }
        
        parsed[userKey] = userReadyMap;
        await AsyncStorage.setItem("@worship_team_rosters_ready", JSON.stringify(parsed));
      } else {
        const docRef = doc(db, "rosters", rosterId, "ready", uid);
        const docSnap = await getDoc(docRef);
        const data = docSnap.exists() ? docSnap.data() : {};
        
        if (isReady) {
          delete data[songId];
        } else {
          data[songId] = new Date().toISOString();
        }
        
        await setDoc(docRef, data);
      }
    } catch (err) {
      console.warn("Failed to toggle readiness status:", err);
      Alert.alert("Sync Error", "Could not save ready status.");
    }
  };

  // Get active roster songs assigned to the logged-in user
  const getRosterAssignedSongs = () => {
    const activeRoster = rosters && rosters.length > 0 ? rosters[selectedRosterIndex] : null;
    if (!activeRoster) return [];
    
    const assignedSongs = (activeRoster.songs || []).filter((rosterSong) => 
      (rosterSong.assignedMusicians || []).includes(uid) ||
      (rosterSong.assignedChoir || []).includes(uid) ||
      (rosterSong.assignedLeaders || []).includes(uid)
    );
    
    return assignedSongs.map((rosterSong) => {
      const fullSong = songs?.find((s) => s.songId === rosterSong.songId || s.id === rosterSong.songId) || {};
      return {
        ...rosterSong,
        ...fullSong,
        rosterId: activeRoster.rosterId,
      };
    });
  };

  const assignedSongsList = React.useMemo(() => {
    return getRosterAssignedSongs();
  }, [rosters, selectedRosterIndex, songs, uid]);

  const activeRoster = rosters && rosters.length > 0 ? rosters[selectedRosterIndex] : null;

  const isCurrentUserAssignedToActiveRoster = React.useMemo(() => {
    if (!activeRoster || !activeRoster.songs) return false;
    return activeRoster.songs.some((songItem) => 
      (songItem.assignedMusicians || []).includes(uid) ||
      (songItem.assignedChoir || []).includes(uid) ||
      (songItem.assignedLeaders || []).includes(uid)
    );
  }, [activeRoster, uid]);

  const activeRosterSongs = React.useMemo(() => {
    if (!activeRoster || !activeRoster.songs) return [];
    return activeRoster.songs.map((rosterSong) => {
      const fullSong = songs?.find((s) => s.songId === rosterSong.songId || s.id === rosterSong.songId) || {};
      return {
        ...rosterSong,
        ...fullSong,
        rosterId: activeRoster.rosterId,
      };
    });
  }, [activeRoster, songs]);

  const parseTimestampToDate = (val) => {
    if (!val) return null;
    if (val instanceof Date) return val;
    if (typeof val.toDate === "function") return val.toDate();
    if (val.seconds !== undefined) return new Date(val.seconds * 1000);
    if (val._seconds !== undefined) return new Date(val._seconds * 1000);
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  };

  // Get last 4 chord chart modifications in the last 2 days
  const getRecentChordUpdates = () => {
    if (!songs || songs.length === 0) return [];
    const editedSongs = songs.filter((s) => s.lastEditedAt && s.lastEditedByName);
    
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    
    const recentlyEdited = editedSongs.filter((s) => {
      const editDate = parseTimestampToDate(s.lastEditedAt);
      return editDate && editDate >= twoDaysAgo;
    });

    const sorted = [...recentlyEdited].sort((a, b) => {
      const dateA = parseTimestampToDate(a.lastEditedAt) || new Date(0);
      const dateB = parseTimestampToDate(b.lastEditedAt) || new Date(0);
      return dateB - dateA;
    });
    return sorted.slice(0, 4);
  };

  // Relative time ago calculation
  const timeAgo = (dateVal) => {
    if (!dateVal) return "some time ago";
    try {
      const past = parseTimestampToDate(dateVal);
      if (!past) return "recently";
      
      const now = new Date();
      const diffMs = now - past;
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHours / 24);

      if (diffMins < 1) return "just now";
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      return `${diffDays}d ago`;
    } catch (e) {
      return "recently";
    }
  };

  React.useEffect(() => {
    let isCancelled = false;
    let unsubscribe = null;
    let unsubscribeTasks = null;
    let unsubscribeRosters = null;

    async function loadTasksCount() {
      try {
        if (USE_DEMO_MODE) {
          const stored = await AsyncStorage.getItem("@worship_team_tasks");
          const allTasks = stored ? JSON.parse(stored) : [];
          const activeTasks = allTasks.filter(t => {
            const isAssigned = Array.isArray(t.assignedTo) ? t.assignedTo.includes(uid) : t.assignedTo === uid;
            return isAssigned && (t.status === "pending" || t.status === "in_progress");
          });
          setPendingTasksCount(activeTasks.length);
          checkAndAlertDueSoonTasks(activeTasks);
        } else {
          const tasksColl = collection(db, "tasks");
          const q = query(
            tasksColl,
            where("assignedTo", "array-contains", uid),
            where("status", "in", ["pending", "in_progress"])
          );
          const unsub = onSnapshot(q, (snapshot) => {
            setPendingTasksCount(snapshot.size);
            const activeTasksList = [];
            snapshot.forEach((docSnap) => {
              activeTasksList.push({ id: docSnap.id, ...docSnap.data() });
            });
            checkAndAlertDueSoonTasks(activeTasksList);
          }, (err) => console.error("Dashboard tasks count listen error:", err));

          if (isCancelled) {
            unsub();
          } else {
            unsubscribeTasks = unsub;
          }
        }
      } catch (err) {
        console.warn("Failed to load tasks count in dashboard:", err);
      }
    }

    async function loadTeamMembers() {
      try {
        if (USE_DEMO_MODE) {
          const storedUsers = await AsyncStorage.getItem("@worship_team_users");
          if (storedUsers) {
            setTeamMembers(Object.values(JSON.parse(storedUsers)));
          } else {
            setTeamMembers([
              { uid: "demo-leader-111", displayName: "Pastor Alex", role: "worship_leader" },
              { uid: "demo-musician-222", displayName: "Sarah (Guitarist)", role: "musician" },
              { uid: "demo-choir-333", displayName: "David (Tenor Lead)", role: "choir_member" },
              { uid: "demo-member-444", displayName: "Sister Grace", role: "member" },
            ]);
          }
        } else {
          const usersColl = collection(db, "users");
          const snapshot = await getDocs(usersColl);
          const uList = [];
          snapshot.forEach((d) => {
            uList.push({ uid: d.id, ...d.data() });
          });
          setTeamMembers(uList.length > 0 ? uList : [
            { uid: "demo-leader-111", displayName: "Pastor Alex", role: "worship_leader" },
            { uid: "demo-musician-222", displayName: "Sarah (Guitarist)", role: "musician" },
            { uid: "demo-choir-333", displayName: "David (Tenor Lead)", role: "choir_member" },
            { uid: "demo-member-444", displayName: "Sister Grace", role: "member" },
          ]);
        }
      } catch (err) {
        console.error("Failed to load team members:", err);
        Alert.alert("Sync Error", "Could not load team directory from Firestore: " + err.message);
      }
    }

    async function loadRosters() {
      return new Promise((resolve, reject) => {
        try {
          if (USE_DEMO_MODE) {
            AsyncStorage.getItem("@worship_team_rosters").then((stored) => {
              if (stored) {
                const parsed = JSON.parse(stored);
                const sorted = sortRostersUpcomingFirst(parsed);
                const upcomingOnly = sorted.filter(r => r.eventDate && isUpcomingEventDate(r.eventDate));
                const filtered = (role === "worship_leader" || role === "super_admin")
                  ? upcomingOnly
                  : upcomingOnly.filter(r => r.status === "published");
                setRosters(filtered);
                resolve(filtered);
              } else {
                setRosters([]);
                resolve([]);
              }
            }).catch(reject);
          } else {
            const rostersColl = collection(db, "rosters");
            const unsub = onSnapshot(rostersColl, (snapshot) => {
              const rList = [];
              snapshot.forEach((d) => {
                rList.push({ rosterId: d.id, ...d.data() });
              });
              const sorted = sortRostersUpcomingFirst(rList);
              const upcomingOnly = sorted.filter(r => r.eventDate && isUpcomingEventDate(r.eventDate));
              const filtered = (role === "worship_leader" || role === "super_admin")
                ? upcomingOnly
                : upcomingOnly.filter(r => r.status === "published");
              setRosters(filtered);
              resolve(filtered);
            }, (err) => {
              console.error("Rosters real-time listener error:", err);
              reject(err);
            });
            if (isCancelled) {
              unsub();
            } else {
              unsubscribeRosters = unsub;
            }
          }
        } catch (err) {
          reject(err);
        }
      });
    }

    async function loadArchivedNotifications() {
      try {
        const stored = await AsyncStorage.getItem("@worship_team_archived_notifications");
        if (stored) {
          setArchivedNotifIds(JSON.parse(stored));
        }
      } catch (err) {
        console.error("Failed to load archived notifications:", err);
      }
    }

    async function loadNotifications(activeRostersList) {
      try {
        const rostersToUse = activeRostersList || [];
        
        const pruneList = async (list) => {
          let needsWrite = false;
          const filtered = list.filter((notif) => {
            let evDate = notif.eventDate;
            if (!evDate) {
              const matchingRoster = rostersToUse.find(r => r.rosterId === notif.rosterId);
              if (matchingRoster) evDate = matchingRoster.eventDate;
            }
            if (evDate && !isUpcomingEventDate(evDate)) {
              needsWrite = true;
              return false;
            }
            if (evDate && isNotificationExpired(evDate)) {
              needsWrite = true;
              return false;
            }
            return true;
          });
          if (needsWrite) {
            await AsyncStorage.setItem("@worship_team_notifications", JSON.stringify(filtered));
          }
          return filtered;
        };

        if (USE_DEMO_MODE) {
          const stored = await AsyncStorage.getItem("@worship_team_notifications");
          if (stored) {
            const cleaned = await pruneList(JSON.parse(stored));
            setRawNotifications(cleaned);
          }
          const interval = setInterval(async () => {
            const storedVal = await AsyncStorage.getItem("@worship_team_notifications");
            if (storedVal) {
              const cleanedVal = await pruneList(JSON.parse(storedVal));
              setRawNotifications(cleanedVal);
            }
          }, 2000);
          unsubscribe = () => clearInterval(interval);
        } else {
          // Firestore listener
          const notifColl = collection(db, "notifications");
          const q = query(notifColl, orderBy("createdAt", "desc"));
          const unsub = onSnapshot(
            q,
            (snapshot) => {
              const list = [];
              snapshot.forEach((d) => {
                list.push({ notificationId: d.id, ...d.data() });
              });
              
              setRawNotifications(list);

              // Execute deletions in background silently (only for administrators)
              const userIsAdmin = role === "worship_leader" || role === "super_admin";
              if (userIsAdmin) {
                list.forEach(async (notif) => {
                  let evDate = notif.eventDate;
                  if (!evDate) {
                    const matchingRoster = rosters.find(r => r.rosterId === notif.rosterId);
                    if (matchingRoster) evDate = matchingRoster.eventDate;
                  }
                  if (evDate && (!isUpcomingEventDate(evDate) || isNotificationExpired(evDate))) {
                    try {
                      const notifDocRef = doc(db, "notifications", notif.notificationId);
                      await deleteDoc(notifDocRef);
                    } catch (e) {
                      console.error("Failed to delete expired Firestore notification:", e);
                    }
                  }
                });
              }
            },
            (err) => {
              // Only alert if the user is still logged in and the component is active
              if (auth.currentUser && !isCancelled) {
                console.error("Firestore notification listener error:", err);
                Alert.alert(
                  "Sync Error", 
                  "Could not load real-time alerts from Firestore: " + err.message
                );
              } else {
                console.log("Ignored firestore permission error during logout/unmount.");
              }
            }
          );

          if (isCancelled) {
            unsub();
          } else {
            unsubscribe = unsub;
          }
        }
      } catch (err) {
        console.error("Failed to load notifications:", err);
      } finally {
        setLoadingNotifs(false);
      }
    }

    async function loadReadyLogs() {
      try {
        if (USE_DEMO_MODE) {
          const rStored = await AsyncStorage.getItem("@worship_team_rosters_ready");
          const parsedR = rStored ? JSON.parse(rStored) : {};
          const mapped = {};
          
          Object.keys(parsedR).forEach((key) => {
            const parts = key.split("_");
            if (parts.length >= 2 && parts[1] === uid) {
              const rId = parts[0];
              const songsMap = parsedR[key];
              Object.keys(songsMap).forEach((sId) => {
                mapped[`${rId}_${sId}`] = true;
              });
            }
          });
          setReadyLogs(mapped);
        } else {
          const rostersColl = collection(db, "rosters");
          const snapshot = await getDocs(rostersColl);
          const mapped = {};
          
          for (const docSnap of snapshot.docs) {
            const rosterId = docSnap.id;
            const rDocRef = doc(db, "rosters", rosterId, "ready", uid);
            const rDocSnap = await getDoc(rDocRef);
            if (rDocSnap.exists()) {
              const data = rDocSnap.data();
              Object.keys(data).forEach((sId) => {
                mapped[`${rosterId}_${sId}`] = true;
              });
            }
          }
          setReadyLogs(mapped);
        }
      } catch (err) {
        console.warn("Failed to load ready status logs:", err);
      }
    }

    async function init() {
      await loadTeamMembers();
      const activeRosters = await loadRosters();
      await loadArchivedNotifications();
      await loadReadyLogs();
      await loadTasksCount();
      await loadNotifications(activeRosters);
    }
    init();

    return () => {
      isCancelled = true;
      if (unsubscribe) unsubscribe();
      if (unsubscribeTasks) unsubscribeTasks();
      if (unsubscribeRosters) unsubscribeRosters();
    };
  }, []);

  React.useEffect(() => {
    if (rosters && rosters.length > 0 && selectedRosterIndex >= rosters.length) {
      setSelectedRosterIndex(0);
    }
  }, [rosters, selectedRosterIndex]);

  React.useEffect(() => {
    const filtered = rawNotifications.filter((notif) => {
      let evDate = notif.eventDate;
      if (!evDate) {
        const matchingRoster = rosters.find(r => r.rosterId === notif.rosterId);
        if (matchingRoster) evDate = matchingRoster.eventDate;
      }
      if (evDate && !isUpcomingEventDate(evDate)) {
        return false;
      }
      return !evDate || !isNotificationExpired(evDate);
    });
    setNotifications(filtered);
  }, [rawNotifications, rosters]);

  const handleAcknowledgeNotification = async (notifId) => {
    try {
      const timestamp = new Date().toISOString();
      if (USE_DEMO_MODE) {
        const stored = await AsyncStorage.getItem("@worship_team_notifications");
        if (stored) {
          const list = JSON.parse(stored);
          const updatedList = list.map((notif) => {
            if (notif.notificationId === notifId) {
              const acknowledgements = notif.acknowledgements || {};
              acknowledgements[uid] = {
                acknowledgedAt: timestamp,
                displayName: displayName,
              };
              return { ...notif, acknowledgements };
            }
            return notif;
          });
          await AsyncStorage.setItem("@worship_team_notifications", JSON.stringify(updatedList));
          setRawNotifications(updatedList);
        }
      } else {
        const notifDocRef = doc(db, "notifications", notifId);
        await updateDoc(notifDocRef, {
          [`acknowledgements.${uid}`]: {
            acknowledgedAt: timestamp,
            displayName: displayName,
          }
        });
      }
    } catch (e) {
      console.error("Failed to acknowledge notification:", e);
    }
  };

  const handleToggleArchive = async (notifId) => {
    try {
      let updated;
      if (archivedNotifIds.includes(notifId)) {
        updated = archivedNotifIds.filter(id => id !== notifId);
      } else {
        updated = [...archivedNotifIds, notifId];
      }
      setArchivedNotifIds(updated);
      await AsyncStorage.setItem("@worship_team_archived_notifications", JSON.stringify(updated));
    } catch (e) {
      console.error("Failed to toggle archive:", e);
    }
  };

  const handleDeleteNotification = async (notificationId) => {
    Alert.alert(
      "Delete Alert",
      "Are you sure you want to permanently delete this alert? This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              if (USE_DEMO_MODE) {
                const storedVal = await AsyncStorage.getItem("@worship_team_notifications");
                if (storedVal) {
                  const cleaned = JSON.parse(storedVal).filter((n) => n.notificationId !== notificationId);
                  await AsyncStorage.setItem("@worship_team_notifications", JSON.stringify(cleaned));
                  setRawNotifications(cleaned);
                }
              } else {
                const notifDocRef = doc(db, "notifications", notificationId);
                await deleteDoc(notifDocRef);
              }
              Alert.alert("Success", "Alert deleted successfully!");
            } catch (err) {
              console.error("Failed to delete notification:", err);
              Alert.alert("Error", "Failed to delete alert: " + err.message);
            }
          }
        }
      ]
    );
  };

  const handleNudgeTeam = async (notifId, pendingMembers) => {
    if (pendingMembers.length === 0) return;
    try {
      const namesList = pendingMembers.map(m => m.displayName).join(", ");
      setNudgeSentStates(prev => ({ ...prev, [notifId]: true }));
      alert(`🔔 SMS Reminders Sent!\n\nDispatched instant follow-up alerts to pending team members:\n"${namesList}"`);
    } catch (e) {
      console.error("Failed to nudge team:", e);
    }
  };

  const toggleAcknowledgementCollapse = (notifId) => {
    setAcknowledgedCollapsedStates((prev) => ({
      ...prev,
      [notifId]: !prev[notifId],
    }));
  };

  // Configuration mapper for visual customizability based on roles
  const getRoleConfig = (userRole) => {
    switch (userRole) {
      case "super_admin":
        return {
          title: "Super Admin Dashboard",
          primaryColor: "#EF4444", // Crimson Red
          accentBg: "rgba(239, 68, 68, 0.1)",
          roleLabel: "Super Admin",
          emoji: "👑",
          specialAccess: "Highest System Clearance & approvals",
          quickActions: ["🛡️ Approval Center", "⏱️ Metronome", "📅 Plan Sunday Setlist", "👥 Manage Volunteers"],
        };
      case "worship_leader":
        return {
          title: "Worship Leader Dashboard",
          primaryColor: "#F59E0B", // Gold/Amber
          accentBg: "rgba(245, 158, 11, 0.1)",
          roleLabel: "Worship Leader",
          emoji: "👑",
          specialAccess: "Full Administrative Controls",
          quickActions: ["📅 Plan Sunday Setlist", "⏱️ Metronome", "👥 Manage Volunteers", "🎵 Upload Sheet Music"],
        };
      case "musician":
        return {
          title: "Musician Dashboard",
          primaryColor: "#A855F7", // Purple
          accentBg: "rgba(168, 85, 247, 0.1)",
          roleLabel: "Band Musician",
          emoji: "🎸",
          specialAccess: "Chord Charts & Audio Tracks",
          quickActions: ["🎼 View Chord Charts", "⏱️ Metronome", "🎧 Practice Tracks", "⏰ Rehearsal Times"],
        };
      case "choir_member":
        return {
          title: "Choir Member Dashboard",
          primaryColor: "#0D9488", // Teal
          accentBg: "rgba(13, 148, 136, 0.1)",
          roleLabel: "Choir Vocalist",
          emoji: "🎤",
          specialAccess: "Lyric Booklets & Vocal Parts",
          quickActions: ["📖 Lyric Sheets", "🗣 Vocal Part Tracks", "👕 Attire Guidelines"],
        };
      case "member":
      default:
        return {
          title: "Member Dashboard",
          primaryColor: "#3B82F6", // Blue
          accentBg: "rgba(59, 130, 246, 0.1)",
          roleLabel: "Team Member",
          emoji: "⛪",
          specialAccess: "General Ministry Announcements",
          quickActions: ["💬 Group Chats", "📅 Service Schedules", "🙌 Song Requests"],
        };
    }
  };

  const config = getRoleConfig(role);

  // Divide notifications for team members
  const isAdmin = role === "worship_leader" || role === "super_admin";

  // Filter lists based on role
  let activeAlerts = [];
  let completedAlerts = []; // Only for admin
  let acknowledgedAlerts = []; // Only for members

  const nonAdminMembers = teamMembers.filter((m) => m.role !== "worship_leader" && m.role !== "super_admin");

  // Helper calculations for Admin Alert Stats & Split
  let adminPendingAlerts = [];
  let adminClearedAlerts = [];
  let adminArchivedAlerts = [];
  let complianceRate = 100;
  let totalBroadcastsCount = 0;

  if (isAdmin) {
    // 1. Separate archived notifications first
    adminArchivedAlerts = notifications.filter(notif => archivedNotifIds.includes(notif.notificationId));
    
    // 2. Unarchived notifications
    const unarchivedNotifs = notifications.filter(notif => !archivedNotifIds.includes(notif.notificationId));

    unarchivedNotifs.forEach(notif => {
      const acknowledgementsMap = notif.acknowledgements || {};
      const ackCount = Object.keys(acknowledgementsMap).filter((uid) => 
        nonAdminMembers.some((m) => m.uid === uid)
      ).length;

      const isPending = nonAdminMembers.length > 0 && ackCount < nonAdminMembers.length;
      
      if (isPending) {
        adminPendingAlerts.push(notif);
      } else {
        adminClearedAlerts.push(notif);
      }
    });

    // 3. Stats calculations for unarchived broadcasts
    totalBroadcastsCount = adminPendingAlerts.length + adminClearedAlerts.length;
    if (totalBroadcastsCount > 0 && nonAdminMembers.length > 0) {
      const totalExpectedAcks = totalBroadcastsCount * nonAdminMembers.length;
      let totalActualAcks = 0;
      
      [...adminPendingAlerts, ...adminClearedAlerts].forEach(notif => {
        const acknowledgementsMap = notif.acknowledgements || {};
        totalActualAcks += Object.keys(acknowledgementsMap).filter((uid) => 
          nonAdminMembers.some((m) => m.uid === uid)
        ).length;
      });

      complianceRate = Math.round((totalActualAcks / totalExpectedAcks) * 100);
    }

    if (selectedTab === "pending") {
      activeAlerts = adminPendingAlerts;
    } else if (selectedTab === "cleared") {
      activeAlerts = adminClearedAlerts;
    } else {
      activeAlerts = adminArchivedAlerts;
    }
  } else {
    // Regular members split by whether they acknowledged it themselves
    activeAlerts = notifications.filter(
      (notif) => !notif.acknowledgements || !notif.acknowledgements[uid]
    );
    acknowledgedAlerts = notifications.filter(
      (notif) => notif.acknowledgements && notif.acknowledgements[uid]
    );
  }

  // Admin Card Renderer for premium, compact glass list
  const renderAdminNotifCard = (notif) => {
    const acknowledgementsMap = notif.acknowledgements || {};
    const ackCount = Object.keys(acknowledgementsMap).filter((uid) => 
      nonAdminMembers.some((m) => m.uid === uid)
    ).length;
    const isLogExpanded = !!acknowledgedCollapsedStates[notif.notificationId];

    return (
      <View
        key={notif.notificationId}
        style={[
          styles.notificationCard,
          { borderColor: config.primaryColor + "40" },
          isLogExpanded && styles.notificationCardExpanded
        ]}
      >
        {/* Collapsed Header Bar */}
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => toggleAcknowledgementCollapse(notif.notificationId)}
          style={styles.compactHeaderRow}
        >
          <View style={{ flex: 1, flexDirection: "row", alignItems: "center" }}>
            <Text style={styles.compactTitle}>{notif.title}</Text>
            {ackCount === nonAdminMembers.length && nonAdminMembers.length > 0 ? (
              <View style={styles.miniBadgeCleared}>
                <Text style={styles.miniBadgeClearedText}>🟢 Cleared</Text>
              </View>
            ) : (
              <View style={styles.miniBadgePending}>
                <Text style={styles.miniBadgePendingText}>⏳ {ackCount}/{nonAdminMembers.length}</Text>
              </View>
            )}
          </View>
          <Text style={styles.compactTime}>
            {notif.createdAt ? new Date(notif.createdAt).toLocaleDateString([], { month: "short", day: "numeric" }) : ""}
          </Text>
          <Text style={styles.expandChevron}>{isLogExpanded ? "▲" : "▼"}</Text>
        </TouchableOpacity>

        {/* Expanded Body Content */}
        {isLogExpanded && (
          <View style={styles.expandedContentContainer}>
            <Text style={styles.notifTimeDetail}>
              Dispatched: {notif.createdAt ? new Date(notif.createdAt).toLocaleString([], {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit"
              }) : "N/A"}
            </Text>
            <Text style={styles.notifMessageDetail}>
              {notif.message}
            </Text>

            {/* Action Buttons Row */}
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 10 }}>
              <TouchableOpacity
                style={[
                  styles.rosterLinkButton,
                  { borderColor: config.primaryColor + "50", flex: 1, marginRight: 8, marginBottom: 0 }
                ]}
                activeOpacity={0.7}
                onPress={() => onJumpToRoster && onJumpToRoster(notif.rosterId)}
              >
                <Text style={[styles.rosterLinkButtonText, { color: config.primaryColor }]}>
                  📅 Go to Roster Details →
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.archiveButton,
                  { borderColor: archivedNotifIds.includes(notif.notificationId) ? "#64748B" : "rgba(239, 68, 68, 0.4)", flex: 1 }
                ]}
                activeOpacity={0.7}
                onPress={() => handleToggleArchive(notif.notificationId)}
              >
                <Text style={[
                  styles.archiveButtonText,
                  { color: archivedNotifIds.includes(notif.notificationId) ? "#CBD5E1" : "#EF4444" }
                ]}>
                  {archivedNotifIds.includes(notif.notificationId) ? "↩️ Restore Alert" : "📁 Archive Alert"}
                </Text>
              </TouchableOpacity>
            </View>

            {role === "super_admin" && (
              <TouchableOpacity
                style={[
                  styles.archiveButton,
                  { borderColor: "#EF4444", backgroundColor: "rgba(239, 68, 68, 0.15)", marginBottom: 10, width: "100%" }
                ]}
                activeOpacity={0.7}
                onPress={() => handleDeleteNotification(notif.notificationId)}
              >
                <Text style={[styles.archiveButtonText, { color: "#EF4444", fontWeight: "800" }]}>
                  🗑️ Delete Alert permanently
                </Text>
              </TouchableOpacity>
            )}

            <View style={styles.cardDivider} />

            {/* Admin Tracking Log */}
            <View style={{ width: "100%" }}>
              <View style={styles.adminStatsRow}>
                <Text style={styles.adminStatsText}>
                  👥 Acknowledged Log ({ackCount} of {nonAdminMembers.length})
                </Text>
                
                {/* Nudge Pending Button */}
                {nonAdminMembers.length > 0 && ackCount < nonAdminMembers.length && !archivedNotifIds.includes(notif.notificationId) && (
                  <TouchableOpacity
                    style={[
                      styles.nudgeButton,
                      nudgeSentStates[notif.notificationId] && styles.nudgeSuccess
                    ]}
                    disabled={!!nudgeSentStates[notif.notificationId]}
                    onPress={() => {
                      const pendingMembers = nonAdminMembers.filter(m => !acknowledgementsMap[m.uid]);
                      handleNudgeTeam(notif.notificationId, pendingMembers);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={[
                      styles.nudgeButtonText,
                      nudgeSentStates[notif.notificationId] && { color: "#34D399" }
                    ]}>
                      {nudgeSentStates[notif.notificationId] ? "✓ Nudged!" : "🔔 Nudge Team"}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>

              <View style={styles.logListOverlay}>
                {nonAdminMembers.map((member) => {
                  const ackInfo = acknowledgementsMap[member.uid];
                  return (
                    <View key={member.uid} style={styles.logMemberRow}>
                      <Text style={styles.logMemberName}>
                        {member.displayName}
                      </Text>
                      {ackInfo ? (
                        <View style={styles.statusBadgeAck}>
                          <Text style={styles.statusBadgeAckText}>
                            🟢 {new Date(ackInfo.acknowledgedAt).toLocaleDateString([], {
                              month: "short",
                              day: "numeric",
                            })}{" "}
                            {new Date(ackInfo.acknowledgedAt).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </Text>
                        </View>
                      ) : (
                        <View style={styles.statusBadgePend}>
                          <Text style={styles.statusBadgePendText}>⏳ Pending</Text>
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            </View>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Dynamic Background Glow representing the role color */}
      <View style={[styles.roleGlow, { backgroundColor: config.primaryColor }]} />

      {/* Header Bar */}
      <View style={styles.header}>
        <View style={styles.userInfo}>
          <View style={[styles.avatar, { borderColor: config.primaryColor }]}>
            <Text style={styles.avatarText}>{displayName.substring(0, 2).toUpperCase()}</Text>
          </View>
          <View style={styles.userTextContainer}>
            <Text style={styles.userName}>{displayName}</Text>
            <View style={[styles.roleBadge, { backgroundColor: config.accentBg }]}>
              <Text style={[styles.roleBadgeText, { color: config.primaryColor }]}>
                {config.emoji} {config.roleLabel}
              </Text>
            </View>
          </View>
        </View>

        <View style={{ flexDirection: "row", alignItems: "center" }}>
          {/* Tasks Badge Icon */}
          {(role === "musician" || role === "choir_member" || role === "member") && (
            <TouchableOpacity
              style={[styles.bellButton, { marginRight: 10 }]}
              onPress={() => onNavigateToTasks && onNavigateToTasks()}
              activeOpacity={0.7}
            >
              <Text style={styles.bellEmoji}>📋</Text>
              {pendingTasksCount > 0 && (
                <View style={[styles.bellBadge, { backgroundColor: "#EF4444" }]}>
                  <Text style={styles.bellBadgeText}>{pendingTasksCount}</Text>
                </View>
              )}
            </TouchableOpacity>
          )}

          {/* Notification Bell Icon */}
          <TouchableOpacity
            style={styles.bellButton}
            onPress={() => {
              if (scrollViewRef.current) {
                scrollViewRef.current.scrollTo({ y: 0, animated: true });
              }
            }}
            activeOpacity={0.7}
          >
            <Text style={styles.bellEmoji}>🔔</Text>
            {notifications.filter(n => !n.acknowledgements || !n.acknowledgements[uid]).length > 0 && (
              <View style={styles.bellBadge}>
                <Text style={styles.bellBadgeText}>
                  {notifications.filter(n => !n.acknowledgements || !n.acknowledgements[uid]).length}
                </Text>
              </View>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.logoutButton} onPress={onLogout} activeOpacity={0.7}>
            <Text style={styles.logoutButtonText}>Log Out</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView ref={scrollViewRef} contentContainerStyle={styles.scrollContent}>
        
        {/* 📊 Unified Dashboard Overview Metrics Hub */}
        <View style={[styles.statsHubContainer, { marginBottom: 20 }]}>
          <TouchableOpacity
            style={[styles.statCard, { borderColor: config.primaryColor + "30" }]}
            activeOpacity={0.7}
            onPress={() => onJumpToSongSearch && onJumpToSongSearch()}
          >
            <Text style={[styles.statValue, { color: config.primaryColor }]}>
              🎵 {assignedSongsList.length}
            </Text>
            <Text style={styles.statLabel}>Assigned Songs</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.statCard, { borderColor: pendingTasksCount > 0 ? "rgba(239, 68, 68, 0.3)" : "rgba(255, 255, 255, 0.05)" }]}
            activeOpacity={0.7}
            onPress={() => onNavigateToTasks && onNavigateToTasks()}
          >
            <Text style={[styles.statValue, pendingTasksCount > 0 && { color: "#EF4444" }]}>
              📋 {pendingTasksCount}
            </Text>
            <Text style={styles.statLabel}>Pending Tasks</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.statCard, { borderColor: "rgba(255, 255, 255, 0.05)" }]}
            activeOpacity={0.7}
            onPress={() => {
              if (scrollViewRef.current) {
                scrollViewRef.current.scrollTo({ y: notifSectionYRef.current, animated: true });
              }
            }}
          >
            <Text style={styles.statValue}>
              📢 {notifications.filter(n => !n.acknowledgements || !n.acknowledgements[uid]).length}
            </Text>
            <Text style={styles.statLabel}>Unread Alerts</Text>
          </TouchableOpacity>
        </View>

        {/* 📅 This Week's Roster Section */}
        <View style={styles.rosterSectionContainer}>
          <View style={styles.rosterHeaderRow}>
            <Text style={styles.rosterSectionTitle}>📅 This Week's Setlist Roster</Text>
            {assignedSongsList.length > 0 && (
              <Text style={styles.rosterProgressText}>
                Progress: {assignedSongsList.filter(s => !!readyLogs[`${s.rosterId}_${s.songId}`]).length} of {assignedSongsList.length} ready
              </Text>
            )}
          </View>

          {/* Roster switcher tabs if there are multiple rosters (showing date & event type) */}
          {rosters.length > 1 && (
            <View style={styles.multiRostersRow}>
              {rosters.map((r, rIdx) => {
                const isSelected = selectedRosterIndex === rIdx;
                const datePart = r.eventDate ? r.eventDate.split(",")[0] : "Date TBD";
                const isUserAssignedInRoster = (r.songs || []).some(songItem => 
                  (songItem.assignedMusicians || []).includes(uid) ||
                  (songItem.assignedChoir || []).includes(uid) ||
                  (songItem.assignedLeaders || []).includes(uid)
                );
                return (
                  <TouchableOpacity
                    key={r.rosterId}
                    style={[
                      styles.rosterHeaderTab,
                      isSelected && styles.rosterHeaderTabActive,
                      { borderColor: config.primaryColor }
                    ]}
                    onPress={() => setSelectedRosterIndex(rIdx)}
                    activeOpacity={0.8}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center" }}>
                      <Text style={[styles.rosterHeaderTabDate, isSelected && { color: "#FFFFFF" }]}>
                        📅 {datePart}
                      </Text>
                      {isUserAssignedInRoster && (
                        <View style={styles.rosterTabAssignedBadge}>
                          <Text style={styles.rosterTabAssignedBadgeText}>A</Text>
                        </View>
                      )}
                    </View>
                    <Text style={[styles.rosterHeaderTabType, { color: isSelected ? "#FFFFFF" : "#94A3B8" }]}>
                      {r.eventType || "Service"}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {!activeRoster ? (
            <View style={styles.emptyRosterCard}>
              <Text style={styles.emptyRosterText}>
                ✨ No upcoming rosters scheduled.
              </Text>
            </View>
          ) : (
            <View style={styles.rosterUnifiedCard}>
              <View style={styles.rosterUnifiedHeader}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <Text style={styles.rosterUnifiedHeaderTitle}>
                    🗓️ {activeRoster.eventDate || "Date TBD"}  •  ⭐ {activeRoster.eventType || activeRoster.eventName || "Service"}
                  </Text>
                  {isCurrentUserAssignedToActiveRoster && (
                    <View style={[styles.rosterTabAssignedBadge, { marginRight: 4 }]}>
                      <Text style={styles.rosterTabAssignedBadgeText}>A</Text>
                    </View>
                  )}
                </View>
              </View>
              <View style={styles.rosterRowDivider} />
              
              {activeRosterSongs.length === 0 ? (
                <View style={{ padding: 24, alignItems: "center" }}>
                  <Text style={styles.emptyRosterText}>
                    ✨ No songs added to this scheduled setlist yet.
                  </Text>
                </View>
              ) : (
                activeRosterSongs.map((songItem, idx) => {
                  const isReady = !!readyLogs[`${songItem.rosterId}_${songItem.songId}`];
                  const isCurrentUserAssigned = (songItem.assignedMusicians || []).includes(uid) ||
                                                 (songItem.assignedChoir || []).includes(uid) ||
                                                 (songItem.assignedLeaders || []).includes(uid);
                  const hasAnyAssignments = (songItem.assignedMusicians || []).length > 0 ||
                                            (songItem.assignedChoir || []).length > 0 ||
                                            (songItem.assignedLeaders || []).length > 0;
                  const isAssigned = isCurrentUserAssigned ||
                                     ((role === "worship_leader" || role === "super_admin") && hasAnyAssignments);
                  const isLast = idx === activeRosterSongs.length - 1;
                  return (
                    <View key={songItem.songId}>
                      <View
                        style={[
                          styles.rosterSongRow,
                          isAssigned && styles.rosterSongRowAssigned,
                          isAssigned && { borderLeftWidth: 4, borderLeftColor: config.primaryColor, paddingLeft: 12 }
                        ]}
                      >
                        <TouchableOpacity
                          activeOpacity={0.8}
                          onPress={() => onJumpToRoster && onJumpToRoster(songItem.rosterId)}
                          style={styles.rosterSongContent}
                        >
                          <View style={{ flex: 1 }}>
                            <View style={{ flexDirection: "row", alignItems: "center" }}>
                              <Text style={styles.rosterSongTitle}>{idx + 1}. {songItem.title}</Text>
                              {isAssigned && (
                                <View style={[styles.assignedBadge, { backgroundColor: config.primaryColor }]}>
                                  <Text style={styles.assignedBadgeText}>Assigned</Text>
                                </View>
                              )}
                            </View>
                            <Text style={styles.rosterSongArtist}>by {songItem.artist || "Unknown Artist"}</Text>
                            
                            <View style={styles.rosterMetaPillsRow}>
                              <View style={styles.metaPill}>
                                <Text style={styles.metaPillText}>🔑 {songItem.currentKey || songItem.originalKey || "C Major"}</Text>
                              </View>
                              <View style={styles.metaPill}>
                                <Text style={styles.metaPillText}>⏱️ {songItem.bpm || 100} BPM</Text>
                              </View>
                              <View style={styles.metaPill}>
                                <Text style={styles.metaPillText}>🎼 {songItem.timeSignature || "4/4"}</Text>
                              </View>
                            </View>

                            {/* Song Links Buttons */}
                            {(songItem.youtubeLink || songItem.spotifyLink) && (
                              <View style={styles.songLinksRow}>
                                {songItem.youtubeLink ? (
                                  <TouchableOpacity
                                    style={[styles.linkChipBtn, { backgroundColor: "#EF4444" }]}
                                    onPress={() => {
                                      Linking.openURL(songItem.youtubeLink).catch((err) => {
                                        Alert.alert("Error", "Could not open YouTube link: " + err.message);
                                      });
                                    }}
                                    activeOpacity={0.7}
                                  >
                                    <Text style={styles.linkChipText}>📺 YouTube</Text>
                                  </TouchableOpacity>
                                ) : null}

                                {songItem.spotifyLink ? (
                                  <TouchableOpacity
                                    style={[styles.linkChipBtn, { backgroundColor: "#1DB954" }]}
                                    onPress={() => {
                                      Linking.openURL(songItem.spotifyLink).catch((err) => {
                                        Alert.alert("Error", "Could not open Spotify link: " + err.message);
                                      });
                                    }}
                                    activeOpacity={0.7}
                                  >
                                    <Text style={styles.linkChipText}>🎵 Spotify</Text>
                                  </TouchableOpacity>
                                ) : null}
                              </View>
                            )}
                          </View>
                        </TouchableOpacity>
                      </View>
                      {!isLast && <View style={styles.rosterRowDivider} />}
                    </View>
                  );
                })
              )}
            </View>
          )}
        </View>

        {/* 🛠️ Quick Tools Section */}
        <View style={styles.quickToolsContainer}>
          <Text style={styles.toolsSectionTitle}>
            {role === "worship_leader" || role === "super_admin" ? "👑 Leader Quick Tools" : "🛠️ Musician Quick Tools"}
          </Text>
          
          <View style={styles.toolsButtonsGrid}>
            <TouchableOpacity
              style={[styles.toolActionBtn, { borderColor: config.primaryColor + "30" }]}
              onPress={() => setMetronomeVisible(true)}
              activeOpacity={0.7}
            >
              <Text style={styles.toolIcon}>⏱️</Text>
              <Text style={styles.toolLabel}>Open Metronome</Text>
              <Text style={styles.toolSubLabel}>High-accuracy click track</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.toolActionBtn, { borderColor: config.primaryColor + "30" }]}
              onPress={() => onJumpToSongSearch && onJumpToSongSearch()}
              activeOpacity={0.7}
            >
              <Text style={styles.toolIcon}>🎵</Text>
              <Text style={styles.toolLabel}>Song Library</Text>
              <Text style={styles.toolSubLabel}>Search sheet & chord chart</Text>
            </TouchableOpacity>

            {(role === "worship_leader" || role === "super_admin") && (
              <TouchableOpacity
                style={[styles.toolActionBtn, { borderColor: config.primaryColor + "30" }]}
                onPress={() => onNavigateToAnalytics && onNavigateToAnalytics()}
                activeOpacity={0.7}
              >
                <Text style={styles.toolIcon}>📊</Text>
                <Text style={styles.toolLabel}>Analytics</Text>
                <Text style={styles.toolSubLabel}>Team & Song stats</Text>
              </TouchableOpacity>
            )}

            {role === "super_admin" && (
              <TouchableOpacity
                style={[styles.toolActionBtn, { borderColor: config.primaryColor + "30" }]}
                onPress={() => {
                  Linking.openURL("https://worshipteamapp-c84e2.web.app/?mode=admin").catch(err => 
                    Alert.alert("Error", "Could not open portal URL: " + err.message)
                  );
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.toolIcon}>📤</Text>
                <Text style={styles.toolLabel}>Bulk Upload Portal</Text>
                <Text style={styles.toolSubLabel}>Upload songs via web browser</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* 🎹 Recent Chord Updates Section */}
        <View style={styles.recentUpdatesContainer}>
          <Text style={styles.updatesSectionTitle}>🎹 Recent Chord Updates</Text>
          <Text style={styles.updatesSectionSubtitle}>Real-time chord chart revisions across your team</Text>

          {getRecentChordUpdates().length === 0 ? (
            <View style={styles.emptyUpdatesCard}>
              <Text style={styles.emptyUpdatesText}>
                ✨ No recent chord chart revisions recorded yet.
              </Text>
            </View>
          ) : (
            getRecentChordUpdates().map((songItem) => {
              const isChordUpdate = songItem.lastEditedFields && songItem.lastEditedFields.toLowerCase().includes("chord");
              return (
                <TouchableOpacity
                  key={songItem.songId}
                  style={[
                    styles.updateRowItem,
                    isChordUpdate && {
                      borderColor: "rgba(168, 85, 247, 0.4)",
                      borderLeftWidth: 4,
                      borderLeftColor: "#A855F7",
                      backgroundColor: "rgba(168, 85, 247, 0.05)"
                    }
                  ]}
                  onPress={() => onJumpToSongDetail && onJumpToSongDetail(songItem, "chords")}
                  activeOpacity={0.7}
                >
                  <View style={[styles.updateIconWrapper, isChordUpdate && { backgroundColor: "rgba(168, 85, 247, 0.15)" }]}>
                    <Text style={[styles.updateIconEmoji, isChordUpdate && { color: "#A855F7" }]}>🎸</Text>
                  </View>
                  
                  <View style={{ flex: 1 }}>
                    <Text style={styles.updateMessageText}>
                      <Text style={styles.updateBoldText}>{songItem.lastEditedByName || "A team member"}</Text>{" "}
                      updated chords for{" "}
                      <Text style={[styles.updateBoldText, { color: isChordUpdate ? "#A855F7" : config.primaryColor }]}>{songItem.title}</Text>
                    </Text>
                    
                    {songItem.lastEditedFields ? (
                      <View style={styles.editFieldsBadge}>
                        <Text style={styles.editFieldsBadgeText} numberOfLines={1}>
                          🔧 {songItem.lastEditedFields}
                        </Text>
                      </View>
                    ) : null}

                    <Text style={styles.updateTimeAgoText}>
                      ⏰ {timeAgo(songItem.lastEditedAt)}
                    </Text>
                  </View>
                  
                  <Text style={styles.updateRowChevron}>→</Text>
                </TouchableOpacity>
              );
            })
          )}
        </View>

        {/* Sleek Bulletins & Team Notifications */}
        <View 
          style={styles.notifContainer}
          onLayout={(event) => {
            notifSectionYRef.current = event.nativeEvent.layout.y;
          }}
        >
          <Text style={styles.notifSectionTitle}>📢 Active Alerts & SMS Dispatches</Text>
          
          {/* Admin Stats & Tab Controls */}
          {isAdmin && !loadingNotifs && (
            <View style={{ marginBottom: 12 }}>
              {/* Alert Stats Hub */}
              <View style={styles.statsHubContainer}>
                <View style={styles.statCard}>
                  <Text style={styles.statValue}>📢 {totalBroadcastsCount}</Text>
                  <Text style={styles.statLabel}>Total Broadcasts</Text>
                </View>
                <View style={[styles.statCard, { borderColor: "rgba(245, 158, 11, 0.25)" }]}>
                  <Text style={[styles.statValue, { color: "#F59E0B" }]}>⏳ {adminPendingAlerts.length}</Text>
                  <Text style={styles.statLabel}>Pending Team</Text>
                </View>
                <View style={[styles.statCard, { borderColor: "rgba(52, 211, 153, 0.25)" }]}>
                  <Text style={[styles.statValue, { color: "#34D399" }]}>📈 {complianceRate}%</Text>
                  <Text style={styles.statLabel}>Compliance Rate</Text>
                </View>
              </View>

              {/* Segmented Control Tab Row */}
              <View style={styles.segmentedTabContainer}>
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => setSelectedTab("pending")}
                  style={[
                    styles.segmentedTab,
                    selectedTab === "pending" && styles.segmentedTabActive
                  ]}
                >
                  <Text style={[
                    styles.segmentedTabText,
                    selectedTab === "pending" && styles.segmentedTabTextActive
                  ]}>
                    ⚠️ Pending ({adminPendingAlerts.length})
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => setSelectedTab("cleared")}
                  style={[
                    styles.segmentedTab,
                    selectedTab === "cleared" && styles.segmentedTabActive
                  ]}
                >
                  <Text style={[
                    styles.segmentedTabText,
                    selectedTab === "cleared" && styles.segmentedTabTextActive
                  ]}>
                    🟢 Cleared ({adminClearedAlerts.length})
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => setSelectedTab("archived")}
                  style={[
                    styles.segmentedTab,
                    selectedTab === "archived" && styles.segmentedTabActive
                  ]}
                >
                  <Text style={[
                    styles.segmentedTabText,
                    selectedTab === "archived" && styles.segmentedTabTextActive
                  ]}>
                    📁 Archived ({adminArchivedAlerts.length})
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {loadingNotifs ? (
            <View style={{ padding: 24, alignItems: "center", justifyContent: "center" }}>
              <ActivityIndicator size="small" color={config.primaryColor || "#3B82F6"} style={{ marginBottom: 10 }} />
              <Text style={styles.loadingNotifsText}>Loading alerts...</Text>
            </View>
          ) : activeAlerts.length === 0 ? (
            <View style={[styles.emptyNotifCard, { borderColor: config.primaryColor + "30" }]}>
              <Text style={styles.emptyNotifText}>
                {isAdmin
                  ? `✨ No unarchived alerts in this tab.`
                  : `✨ No new active alerts. All team alerts are clear!`}
              </Text>
            </View>
          ) : (
            activeAlerts.map((notif) => {
              if (isAdmin) {
                return renderAdminNotifCard(notif);
              }

              // Member Card Layout
              const acknowledgementsMap = notif.acknowledgements || {};
              return (
                <View
                  key={notif.notificationId}
                  style={[styles.notificationCard, { borderColor: config.primaryColor + "40" }]}
                >
                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={() => onJumpToRoster && onJumpToRoster(notif.rosterId)}
                    style={{ flex: 1 }}
                  >
                    <View style={styles.notifHeader}>
                      <Text style={styles.notifTitle}>{notif.title}</Text>
                      <Text style={styles.notifTime}>
                        {notif.createdAt ? new Date(notif.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ""}
                      </Text>
                    </View>
                    <Text style={styles.notifMessage} numberOfLines={3}>
                      {notif.message}
                    </Text>
                  </TouchableOpacity>

                  {/* Actions Row */}
                  <View style={styles.notifActionsContainer}>
                    <TouchableOpacity
                      style={[styles.acknowledgeButton, { backgroundColor: config.primaryColor }]}
                      activeOpacity={0.8}
                      onPress={() => handleAcknowledgeNotification(notif.notificationId)}
                    >
                      <Text style={styles.acknowledgeButtonText}>✓ Acknowledge Alert</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })
          )}

          {/* Member's Collapsible Acknowledged Alerts Section */}
          {!isAdmin && acknowledgedAlerts.length > 0 && (
            <View style={{ marginTop: 12 }}>
              <TouchableOpacity
                style={styles.collapsibleSectionHeader}
                activeOpacity={0.8}
                onPress={() => setAcknowledgedSectionExpanded(!acknowledgedSectionExpanded)}
              >
                <Text style={styles.collapsibleSectionTitle}>
                  📁 Acknowledged Alerts ({acknowledgedAlerts.length})
                </Text>
                <Text style={styles.collapsibleSectionChevron}>
                  {acknowledgedSectionExpanded ? "▲" : "▼"}
                </Text>
              </TouchableOpacity>

              {acknowledgedSectionExpanded && (
                <View style={styles.collapsibleSectionContent}>
                  {acknowledgedAlerts.map((notif) => {
                    const ackInfo = notif.acknowledgements?.[uid];
                    return (
                      <TouchableOpacity
                        key={notif.notificationId}
                        style={[styles.notificationCard, styles.notificationCardAck]}
                        activeOpacity={0.8}
                        onPress={() => onJumpToRoster && onJumpToRoster(notif.rosterId)}
                      >
                        <View style={styles.notifHeader}>
                          <Text style={[styles.notifTitle, { color: "#94A3B8" }]}>
                            {notif.title}
                          </Text>
                          <Text style={styles.notifTime}>
                            {notif.createdAt ? new Date(notif.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ""}
                          </Text>
                        </View>
                        <Text style={[styles.notifMessage, { color: "#64748B" }]} numberOfLines={2}>
                          {notif.message}
                        </Text>
                        {ackInfo && (
                          <View style={styles.ackIndicatorBadge}>
                            <Text style={styles.ackIndicatorBadgeText}>
                              ✓ Acknowledged on {new Date(ackInfo.acknowledgedAt).toLocaleString([], {
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>
          )}
        </View>


        {/* Subtle Environment Branding Footer */}
        <View style={{ alignItems: "center", marginTop: 24, marginBottom: 8, opacity: 0.4 }}>
          <Text style={{ color: "#64748B", fontSize: 11, fontWeight: "700" }}>
            Worship Team App v1.0.0
          </Text>
        </View>

      </ScrollView>

      {/* ⏱️ Standing Metronome Overlay */}
      <MetronomeScreen
        visible={metronomeVisible}
        onClose={() => setMetronomeVisible(false)}
        initialBpm={100}
        song={null}
        user={user}
        onUpdateSong={null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0B0F19",
  },
  roleGlow: {
    position: "absolute",
    top: -150,
    right: -100,
    width: 320,
    height: 320,
    borderRadius: 160,
    opacity: 0.15,
    blurRadius: 100,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 100,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderColor: "#1E293B",
  },
  userInfo: {
    flexDirection: "row",
    alignItems: "center",
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "#1E293B",
    borderWidth: 2,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  avatarText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  userTextContainer: {
    justifyContent: "center",
  },
  userName: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  roleBadge: {
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 4,
    alignSelf: "flex-start",
  },
  roleBadgeText: {
    fontSize: 11,
    fontWeight: "800",
  },
  logoutButton: {
    backgroundColor: "rgba(239, 68, 68, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.2)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  logoutButtonText: {
    color: "#EF4444",
    fontSize: 13,
    fontWeight: "700",
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  mainCard: {
    backgroundColor: "#1E293B",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#334155",
    padding: 24,
    alignItems: "center",
    marginBottom: 30,
    marginTop: 10,
  },
  cardRoleEmoji: {
    fontSize: 48,
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  cardDivider: {
    width: 40,
    height: 3,
    backgroundColor: "#3B82F6",
    borderRadius: 2,
    marginVertical: 16,
  },
  welcomeMessage: {
    color: "#94A3B8",
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 20,
  },
  boldText: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
  accessBadge: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  accessText: {
    fontSize: 13,
    fontWeight: "700",
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#FFFFFF",
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: "#64748B",
    marginBottom: 16,
  },
  actionsGrid: {
    marginBottom: 30,
  },
  actionCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#111827",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1E293B",
    padding: 16,
    marginBottom: 12,
  },
  actionText: {
    color: "#E2E8F0",
    fontSize: 14,
    fontWeight: "600",
  },
  actionBadge: {
    backgroundColor: "#1E293B",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  actionBadgeText: {
    color: "#64748B",
    fontSize: 10,
    fontWeight: "700",
  },
  metaCard: {
    backgroundColor: "#111827",
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: "#1E293B",
  },
  metaTitle: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 12,
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  metaLabel: {
    color: "#64748B",
    fontSize: 13,
    fontWeight: "500",
  },
  metaValue: {
    color: "#E2E8F0",
    fontSize: 13,
    fontWeight: "600",
  },
  notifContainer: {
    marginBottom: 20,
    marginTop: 10,
  },
  notifSectionTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 12,
    letterSpacing: 0.5,
  },
  loadingNotifsText: {
    color: "#64748B",
    fontSize: 13,
    fontStyle: "italic",
    paddingVertical: 10,
  },
  emptyNotifCard: {
    backgroundColor: "rgba(30, 41, 59, 0.4)",
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    alignItems: "center",
  },
  emptyNotifText: {
    color: "#94A3B8",
    fontSize: 13,
    fontWeight: "500",
  },
  notificationCard: {
    backgroundColor: "rgba(30, 41, 59, 0.65)",
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    marginBottom: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 3,
  },
  notifHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  notifTitle: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "750",
    letterSpacing: 0.3,
  },
  notifTime: {
    color: "#64748B",
    fontSize: 11,
    fontWeight: "600",
  },
  notifMessage: {
    color: "#94A3B8",
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 10,
  },
  notifFooter: {
    borderTopWidth: 1,
    borderTopColor: "rgba(51, 65, 85, 0.3)",
    paddingTop: 8,
  },
  notifActionText: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  notifActionsContainer: {
    borderTopWidth: 1,
    borderTopColor: "rgba(51, 65, 85, 0.3)",
    paddingTop: 10,
    marginTop: 6,
  },
  acknowledgeButton: {
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
  },
  acknowledgeButtonText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "800",
  },
  adminStatsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  adminStatsText: {
    color: "#E2E8F0",
    fontSize: 12,
    fontWeight: "750",
  },
  viewLogButton: {
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  viewLogButtonText: {
    fontSize: 11,
    fontWeight: "800",
  },
  logListOverlay: {
    marginTop: 10,
    backgroundColor: "rgba(15, 23, 42, 0.6)",
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.05)",
  },
  logMemberRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.03)",
  },
  logMemberName: {
    color: "#E2E8F0",
    fontSize: 12,
    fontWeight: "600",
  },
  statusBadgeAck: {
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    borderRadius: 4,
    paddingVertical: 2,
    paddingHorizontal: 6,
  },
  statusBadgeAckText: {
    color: "#34D399",
    fontSize: 10,
    fontWeight: "700",
  },
  statusBadgePend: {
    backgroundColor: "rgba(245, 158, 11, 0.15)",
    borderRadius: 4,
    paddingVertical: 2,
    paddingHorizontal: 6,
  },
  statusBadgePendText: {
    color: "#FBBF24",
    fontSize: 10,
    fontWeight: "700",
  },
  collapsibleSectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "rgba(30, 41, 59, 0.4)",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginTop: 10,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.05)",
  },
  collapsibleSectionTitle: {
    color: "#E2E8F0",
    fontSize: 14,
    fontWeight: "800",
  },
  collapsibleSectionChevron: {
    color: "#94A3B8",
    fontSize: 12,
    fontWeight: "700",
  },
  collapsibleSectionContent: {
    marginTop: 8,
  },
  notificationCardAck: {
    backgroundColor: "rgba(15, 23, 42, 0.4)",
    borderColor: "rgba(255, 255, 255, 0.05)",
    borderWidth: 1,
  },
  ackIndicatorBadge: {
    backgroundColor: "rgba(16, 185, 129, 0.1)",
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    alignSelf: "flex-start",
    marginTop: 6,
  },
  ackIndicatorBadgeText: {
    color: "#34D399",
    fontSize: 11,
    fontWeight: "700",
  },
  notificationCardExpanded: {
    paddingBottom: 16,
  },
  compactHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  compactTitle: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "750",
    letterSpacing: 0.3,
  },
  compactTime: {
    color: "#64748B",
    fontSize: 11,
    fontWeight: "600",
    marginRight: 8,
  },
  expandChevron: {
    color: "#94A3B8",
    fontSize: 10,
    fontWeight: "700",
  },
  miniBadgeCleared: {
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    borderRadius: 4,
    paddingVertical: 1,
    paddingHorizontal: 6,
    marginLeft: 10,
  },
  miniBadgeClearedText: {
    color: "#34D399",
    fontSize: 9,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  miniBadgePending: {
    backgroundColor: "rgba(245, 158, 11, 0.15)",
    borderRadius: 4,
    paddingVertical: 1,
    paddingHorizontal: 6,
    marginLeft: 10,
  },
  miniBadgePendingText: {
    color: "#FBBF24",
    fontSize: 9,
    fontWeight: "800",
  },
  expandedContentContainer: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.05)",
    paddingTop: 10,
  },
  notifTimeDetail: {
    color: "#64748B",
    fontSize: 11,
    fontWeight: "500",
    marginBottom: 6,
  },
  notifMessageDetail: {
    color: "#CBD5E1",
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  rosterLinkButton: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.02)",
    marginBottom: 10,
  },
  rosterLinkButtonText: {
    fontSize: 12,
    fontWeight: "800",
  },
  statsHubContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: "rgba(30, 41, 59, 0.4)",
    borderColor: "rgba(255, 255, 255, 0.05)",
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: "center",
    marginHorizontal: 3,
  },
  statValue: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 2,
  },
  statLabel: {
    color: "#64748B",
    fontSize: 9,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  segmentedTabContainer: {
    flexDirection: "row",
    backgroundColor: "rgba(15, 23, 42, 0.8)",
    borderRadius: 10,
    padding: 2,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.05)",
    marginBottom: 10,
  },
  segmentedTab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: "center",
    borderRadius: 8,
  },
  segmentedTabActive: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
  },
  segmentedTabText: {
    color: "#64748B",
    fontSize: 11,
    fontWeight: "700",
  },
  segmentedTabTextActive: {
    color: "#FFFFFF",
    fontWeight: "800",
  },
  archiveButton: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.02)",
  },
  archiveButtonText: {
    fontSize: 12,
    fontWeight: "800",
  },
  nudgeButton: {
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.4)",
    borderRadius: 6,
    paddingVertical: 3,
    paddingHorizontal: 8,
    backgroundColor: "rgba(245, 158, 11, 0.05)",
  },
  nudgeButtonText: {
    color: "#FBBF24",
    fontSize: 10,
    fontWeight: "800",
  },
  nudgeSuccess: {
    borderColor: "rgba(16, 185, 129, 0.4)",
    backgroundColor: "rgba(16, 185, 129, 0.05)",
  },
  
  // Phase 2 Upgrade Styles
  rosterSectionContainer: {
    marginBottom: 26,
    marginTop: 10,
  },
  rosterHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  rosterSectionTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 0.5,
  },
  rosterProgressText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#34D399",
  },
  emptyRosterCard: {
    backgroundColor: "#111827",
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: "#1E293B",
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
  },
  emptyRosterText: {
    color: "#64748B",
    fontSize: 13,
    fontWeight: "500",
    textAlign: "center",
    lineHeight: 18,
  },
  rosterSongCard: {
    backgroundColor: "#1E293B",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 4,
  },
  rosterSongContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  rosterSongTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
  },
  rosterSongArtist: {
    color: "#94A3B8",
    fontSize: 13,
    marginTop: 2,
    fontWeight: "500",
  },
  rosterMetaPillsRow: {
    flexDirection: "row",
    marginTop: 10,
    flexWrap: "wrap",
  },
  metaPill: {
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: 6,
    marginBottom: 4,
  },
  metaPillText: {
    color: "#CBD5E1",
    fontSize: 11,
    fontWeight: "700",
  },
  readyToggleBtn: {
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
    borderRadius: 10,
    paddingVertical: 8,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 12,
  },
  readyToggleBtnActive: {
    backgroundColor: "#34D399",
    borderColor: "#34D399",
  },
  readyToggleBtnText: {
    color: "#94A3B8",
    fontSize: 12,
    fontWeight: "800",
  },
  readyToggleBtnTextActive: {
    color: "#FFFFFF",
  },
  quickToolsContainer: {
    marginBottom: 26,
  },
  toolsSectionTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#FFFFFF",
    marginBottom: 12,
    letterSpacing: 0.5,
  },
  toolsButtonsGrid: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  toolActionBtn: {
    flex: 1,
    backgroundColor: "#111827",
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    alignItems: "center",
    marginHorizontal: 4,
  },
  toolIcon: {
    fontSize: 24,
    marginBottom: 8,
  },
  toolLabel: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },
  toolSubLabel: {
    color: "#64748B",
    fontSize: 10,
    marginTop: 2,
    fontWeight: "500",
  },
  recentUpdatesContainer: {
    marginBottom: 26,
  },
  updatesSectionTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#FFFFFF",
    marginBottom: 2,
    letterSpacing: 0.5,
  },
  updatesSectionSubtitle: {
    fontSize: 12,
    color: "#64748B",
    marginBottom: 12,
  },
  emptyUpdatesCard: {
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#1E293B",
    borderRadius: 16,
    padding: 16,
    alignItems: "center",
  },
  emptyUpdatesText: {
    color: "#64748B",
    fontSize: 13,
    fontWeight: "500",
  },
  updateRowItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#1E293B",
    borderRadius: 16,
    padding: 12,
    marginBottom: 10,
  },
  updateIconWrapper: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  updateIconEmoji: {
    fontSize: 16,
  },
  updateMessageText: {
    color: "#E2E8F0",
    fontSize: 13,
    lineHeight: 18,
  },
  updateBoldText: {
    color: "#FFFFFF",
    fontWeight: "800",
  },
  updateTimeAgoText: {
    color: "#64748B",
    fontSize: 11,
    marginTop: 2,
    fontWeight: "600",
  },
  editFieldsBadge: {
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderColor: "rgba(255, 255, 255, 0.08)",
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 5,
    alignSelf: "flex-start",
  },
  editFieldsBadgeText: {
    color: "#94A3B8",
    fontSize: 10,
    fontWeight: "700",
  },
  updateRowChevron: {
    color: "#475569",
    fontSize: 16,
    fontWeight: "800",
    paddingLeft: 8,
  },
  bellButton: {
    position: "relative",
    marginRight: 14,
    padding: 8,
    backgroundColor: "#1E293B",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#334155",
  },
  bellEmoji: {
    fontSize: 16,
  },
  bellBadge: {
    position: "absolute",
    top: -5,
    right: -5,
    backgroundColor: "#EF4444",
    borderRadius: 8,
    width: 16,
    height: 16,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "#0B0F19",
  },
  bellBadgeText: {
    color: "#FFFFFF",
    fontSize: 8,
    fontWeight: "900",
  },
  activeRosterHeaderBar: {
    backgroundColor: "rgba(37, 99, 235, 0.12)",
    borderColor: "rgba(37, 99, 235, 0.25)",
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  activeRosterHeaderText: {
    color: "#E2E8F0",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  multiRostersRow: {
    flexDirection: "row",
    marginBottom: 14,
    flexWrap: "wrap",
  },
  rosterHeaderTab: {
    backgroundColor: "#111827",
    borderColor: "#334155",
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginRight: 10,
    marginBottom: 8,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 100,
  },
  rosterHeaderTabActive: {
    backgroundColor: "rgba(37, 99, 235, 0.18)",
    borderWidth: 1.5,
  },
  rosterHeaderTabDate: {
    color: "#94A3B8",
    fontSize: 12,
    fontWeight: "800",
  },
  rosterHeaderTabType: {
    fontSize: 10,
    fontWeight: "600",
    marginTop: 2,
    textTransform: "uppercase",
    letterSpacing: 0.5,
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
  songLinksRow: {
    flexDirection: "row",
    marginTop: 12,
    flexWrap: "wrap",
  },
  linkChipBtn: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 8,
    marginBottom: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  linkChipText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "800",
  },
  rosterUnifiedCard: {
    backgroundColor: "rgba(30, 41, 59, 0.45)",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.05)",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  rosterSongRow: {
    padding: 16,
  },
  rosterSongRowAssigned: {
    backgroundColor: "rgba(255, 255, 255, 0.02)",
  },
  rosterRowDivider: {
    height: 1,
    backgroundColor: "rgba(255, 255, 255, 0.05)",
  },
  rosterUnifiedHeader: {
    backgroundColor: "rgba(37, 99, 235, 0.12)",
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  rosterUnifiedHeaderTitle: {
    color: "#E2E8F0",
    fontSize: 13,
    fontWeight: "750",
    letterSpacing: 0.3,
  },
  rosterTabAssignedBadge: {
    backgroundColor: "#F59E0B",
    borderRadius: 8,
    width: 15,
    height: 15,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 6,
  },
  rosterTabAssignedBadgeText: {
    color: "#0B0F19",
    fontSize: 9,
    fontWeight: "900",
  },
});
