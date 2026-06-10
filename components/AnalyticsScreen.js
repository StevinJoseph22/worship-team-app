import React, { useState, useEffect } from "react";
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Modal,
  Dimensions,
  Platform,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { USE_DEMO_MODE, db } from "../firebaseConfig";
import { collection, getDocs } from "firebase/firestore";

const { width } = Dimensions.get("window");

// Local Storage Cache Keys
const ANALYTICS_CACHE_KEY = "@worship_team_analytics_cache";
const DEMO_USERS_DB_KEY = "@worship_team_demo_users";
const ROSTERS_DB_KEY = "@worship_team_rosters";
const PRACTICED_LOGS_KEY = "@worship_team_rosters_practiced";
const READY_LOGS_KEY = "@worship_team_rosters_ready";

// Helper to calculate date differences
const getDaysDifference = (dateStr) => {
  if (!dateStr) return 999;
  const target = new Date(dateStr);
  const now = new Date();
  const diffTime = Math.abs(now - target);
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

export default function AnalyticsScreen({ user, onBack }) {
  const themeColor = "#F59E0B"; // Gold color for Worship Leader
  const accentBg = "rgba(245, 158, 11, 0.1)";

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

  // Filters
  const [songFilter, setSongFilter] = useState("month"); // "month" | "3months" | "alltime"

  // Raw Database Data Caches
  const [cachedRosters, setCachedRosters] = useState([]);
  const [cachedUsers, setCachedUsers] = useState([]);
  const [cachedPracticedMap, setCachedPracticedMap] = useState({});
  const [cachedReadyMap, setCachedReadyMap] = useState({});

  // Render Metric States
  const [songStats, setSongStats] = useState([]);
  const [recentPracticeList, setRecentPracticeList] = useState([]);
  const [teamOverview, setTeamOverview] = useState({
    worship_leader: 0,
    musician: 0,
    choir_member: 0,
    member: 0,
  });
  const [rosterHistoryList, setRosterHistoryList] = useState([]);

  // Roster History Modal States
  const [historyModalVisible, setHistoryModalVisible] = useState(false);
  const [selectedRoster, setSelectedRoster] = useState(null);
  const [selectedRosterDetails, setSelectedRosterDetails] = useState([]);

  // Load cached metrics immediately on mount
  useEffect(() => {
    async function loadCache() {
      try {
        const cacheString = await AsyncStorage.getItem(ANALYTICS_CACHE_KEY);
        if (cacheString) {
          const cache = JSON.parse(cacheString);
          setLastUpdated(cache.lastUpdated || "Never");
          setSongStats(cache.songStats || []);
          setRecentPracticeList(cache.recentPracticeList || []);
          setTeamOverview(
            cache.teamOverview || {
              worship_leader: 0,
              musician: 0,
              choir_member: 0,
              member: 0,
            }
          );
          setRosterHistoryList(cache.rosterHistoryList || []);
          setCachedRosters(cache.rosters || []);
          setCachedUsers(cache.users || []);
          setCachedPracticedMap(cache.practicedMap || {});
          setCachedReadyMap(cache.readyMap || {});
          setLoading(false);
        }
      } catch (err) {
        console.warn("Failed to load analytics cache from AsyncStorage:", err);
      }
      // Run background fetch to refresh the data
      fetchData();
    };

    loadCache();
  }, []);

  // Compute metrics dynamically when songFilter shifts or cached data updates
  useEffect(() => {
    if (cachedRosters.length > 0 && cachedUsers.length > 0) {
      calculateAllMetrics(cachedRosters, cachedUsers, cachedPracticedMap, cachedReadyMap);
    }
  }, [songFilter, cachedRosters, cachedUsers, cachedPracticedMap, cachedReadyMap]);

  // Main Data Retrieval Function
  const fetchData = async () => {
    try {
      let users = [];
      let rosters = [];
      let practicedMap = {};
      let readyMap = {};

      if (USE_DEMO_MODE) {
        // 1. Fetch Users
        const storedUsers = await AsyncStorage.getItem(DEMO_USERS_DB_KEY);
        if (storedUsers) {
          users = Object.values(JSON.parse(storedUsers));
        } else {
          users = [
            { uid: "demo-leader-111", displayName: "Pastor Alex", role: "worship_leader" },
            { uid: "demo-musician-222", displayName: "Sarah (Guitarist)", role: "musician" },
            { uid: "demo-choir-333", displayName: "David (Tenor Lead)", role: "choir_member" },
            { uid: "demo-member-444", displayName: "Sister Grace", role: "member" },
          ];
        }

        // 2. Fetch Rosters
        const storedRosters = await AsyncStorage.getItem(ROSTERS_DB_KEY);
        if (storedRosters) {
          rosters = JSON.parse(storedRosters);
        } else {
          rosters = [];
        }

        // 3. Fetch check-in logs
        const storedPracticed = await AsyncStorage.getItem(PRACTICED_LOGS_KEY);
        practicedMap = storedPracticed ? JSON.parse(storedPracticed) : {};

        const storedReady = await AsyncStorage.getItem(READY_LOGS_KEY);
        readyMap = storedReady ? JSON.parse(storedReady) : {};

      } else {
        // 1. Fetch Users from Firestore
        const usersSnapshot = await getDocs(collection(db, "users"));
        usersSnapshot.forEach((doc) => {
          users.push({ uid: doc.id, ...doc.data() });
        });

        // 2. Fetch all Rosters from Firestore (index-free client-side filtering)
        const rostersSnapshot = await getDocs(collection(db, "rosters"));
        rostersSnapshot.forEach((doc) => {
          rosters.push({ rosterId: doc.id, ...doc.data() });
        });

        // Get only published rosters for analytics
        const publishedRosters = rosters.filter((r) => r.status === "published");

        // Sort by date/createdAt descending
        publishedRosters.sort((a, b) => {
          const aDate = new Date(a.eventDate || a.createdAt || 0);
          const bDate = new Date(b.eventDate || b.createdAt || 0);
          return bDate - aDate;
        });

        // Grab only the last 10 rosters to process check-in subcollections (conserves Firestore reads)
        const last10Rosters = publishedRosters.slice(0, 10);

        // 3. Fetch subcollections in parallel
        await Promise.all(
          last10Rosters.map(async (roster) => {
            try {
              // Practiced subcollection
              const pColl = collection(db, "rosters", roster.rosterId, "practiced");
              const pSnap = await getDocs(pColl);
              pSnap.forEach((doc) => {
                practicedMap[`${roster.rosterId}_${doc.id}`] = doc.data();
              });

              // Ready subcollection
              const rColl = collection(db, "rosters", roster.rosterId, "ready");
              const rSnap = await getDocs(rColl);
              rSnap.forEach((doc) => {
                readyMap[`${roster.rosterId}_${doc.id}`] = doc.data();
              });
            } catch (subErr) {
              console.warn(`Failed to load subcollections for roster ${roster.rosterId}:`, subErr);
            }
          })
        );

        // Keep rosters reference sorted
        rosters = publishedRosters;
      }

      const timestamp = new Date().toLocaleString();
      setLastUpdated(timestamp);

      // Save raw data to states
      setCachedRosters(rosters);
      setCachedUsers(users);
      setCachedPracticedMap(practicedMap);
      setCachedReadyMap(readyMap);

      // Compute & save metrics to state & storage cache
      const metrics = calculateAllMetrics(rosters, users, practicedMap, readyMap);
      
      const cacheObject = {
        lastUpdated: timestamp,
        songStats: metrics.songStats,
        recentPracticeList: metrics.recentPracticeList,
        teamOverview: metrics.teamOverview,
        rosterHistoryList: metrics.rosterHistoryList,
        rosters,
        users,
        practicedMap,
        readyMap,
      };

      await AsyncStorage.setItem(ANALYTICS_CACHE_KEY, JSON.stringify(cacheObject));
    } catch (err) {
      console.error("Failed to load fresh analytics data:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  // Compile calculations for the 4 core dashboard panels
  const calculateAllMetrics = (publishedRosters, allUsers, practiced, ready) => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    // -------------------------------------------------------------
    // SECTION 1: SONG STATS
    // -------------------------------------------------------------
    const filteredRosters = publishedRosters.filter((r) => {
      const rDate = new Date(r.eventDate || r.createdAt);
      if (songFilter === "month") {
        return rDate.getFullYear() === currentYear && rDate.getMonth() === currentMonth;
      } else if (songFilter === "3months") {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 90);
        return rDate >= cutoff;
      }
      return true; // All Time
    });

    const songFrequency = {};
    filteredRosters.forEach((roster) => {
      if (roster.songs && Array.isArray(roster.songs)) {
        roster.songs.forEach((s) => {
          if (s.songId) {
            if (!songFrequency[s.songId]) {
              songFrequency[s.songId] = {
                title: s.title || "Unknown Song",
                count: 0,
              };
            }
            songFrequency[s.songId].count += 1;
          }
        });
      }
    });

    const sortedSongs = Object.values(songFrequency)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    setSongStats(sortedSongs);

    // -------------------------------------------------------------
    // SECTION 2: PRACTICE COMPLETION (MOST RECENT PUBLISHED ROSTER)
    // -------------------------------------------------------------
    // Find the single most recent published roster in the filtered list or original rosters list
    const sortedPublished = [...publishedRosters].sort((a, b) => {
      const aDate = new Date(a.eventDate || a.createdAt || 0);
      const bDate = new Date(b.eventDate || b.createdAt || 0);
      return bDate - aDate;
    });

    const mostRecentRoster = sortedPublished[0];
    const practiceList = [];

    if (mostRecentRoster && mostRecentRoster.songs) {
      const choirUsers = allUsers.filter((u) => u.role === "choir_member");
      choirUsers.forEach((member) => {
        // Count songs this choir member is assigned to
        const assignedSongs = mostRecentRoster.songs.filter((s) =>
          (s.assignedChoir || []).includes(member.uid)
        );

        if (assignedSongs.length > 0) {
          // Count how many of these assigned songs are marked as practiced
          const memberPracticedSongs = practiced[`${mostRecentRoster.rosterId}_${member.uid}`] || {};
          const practicedCount = assignedSongs.filter(
            (s) => !!memberPracticedSongs[s.songId]
          ).length;

          practiceList.push({
            name: member.displayName || "Unknown Choir Vocalist",
            practicedCount,
            assignedCount: assignedSongs.length,
          });
        }
      });
    }

    setRecentPracticeList(practiceList);

    // -------------------------------------------------------------
    // SECTION 3: TEAM OVERVIEW (2x2 GRID COUNTS)
    // -------------------------------------------------------------
    const counts = {
      worship_leader: 0,
      musician: 0,
      choir_member: 0,
      member: 0,
    };

    allUsers.forEach((u) => {
      if (u.role === "worship_leader" || u.role === "super_admin") {
        counts.worship_leader += 1;
      } else if (u.role === "musician") {
        counts.musician += 1;
      } else if (u.role === "choir_member") {
        counts.choir_member += 1;
      } else {
        counts.member += 1; // Default "member" role
      }
    });

    setTeamOverview(counts);

    // -------------------------------------------------------------
    // SECTION 4: ROSTER HISTORY (LAST 10 PUBLISHED ROSTERS)
    // -------------------------------------------------------------
    const historyList = sortedPublished.slice(0, 10).map((roster) => {
      const uniqueUids = new Set();
      if (roster.songs) {
        roster.songs.forEach((s) => {
          if (s.assignedChoir) s.assignedChoir.forEach((id) => uniqueUids.add(id));
          if (s.assignedMusicians) s.assignedMusicians.forEach((id) => uniqueUids.add(id));
        });
      }

      return {
        rosterId: roster.rosterId,
        eventName: roster.eventName || "Sunday Morning Worship",
        date: roster.eventDate || roster.createdAt || "",
        songCount: roster.songs ? roster.songs.length : 0,
        teamCount: uniqueUids.size,
        rawRoster: roster,
      };
    });

    setRosterHistoryList(historyList);

    return {
      songStats: sortedSongs,
      recentPracticeList: practiceList,
      teamOverview: counts,
      rosterHistoryList: historyList,
    };
  };

  // Compile detailed metrics for historical rosters summary modal
  const handleOpenRosterHistoryDetails = (rosterItem) => {
    setSelectedRoster(rosterItem);
    const roster = rosterItem.rawRoster;
    const details = [];

    if (roster && roster.songs) {
      // Find all unique assignees in this roster
      const uniqueVocalistUids = new Set();
      const uniqueMusicianUids = new Set();

      roster.songs.forEach((s) => {
        if (s.assignedChoir) s.assignedChoir.forEach((id) => uniqueVocalistUids.add(id));
        if (s.assignedMusicians) s.assignedMusicians.forEach((id) => uniqueMusicianUids.add(id));
      });

      // Process Choir Vocalists
      uniqueVocalistUids.forEach((vUid) => {
        const memberInfo = cachedUsers.find((u) => u.uid === vUid);
        const assignedSongs = roster.songs.filter((s) => (s.assignedChoir || []).includes(vUid));
        const memberLogs = cachedPracticedMap[`${roster.rosterId}_${vUid}`] || {};
        const completedCount = assignedSongs.filter((s) => !!memberLogs[s.songId]).length;

        details.push({
          name: memberInfo ? memberInfo.displayName : "Unknown Vocalist",
          roleLabel: "Choir Vocalist",
          completedCount,
          assignedCount: assignedSongs.length,
          type: "vocalist",
        });
      });

      // Process Band Musicians
      uniqueMusicianUids.forEach((mUid) => {
        const memberInfo = cachedUsers.find((u) => u.uid === mUid);
        const assignedSongs = roster.songs.filter((s) => (s.assignedMusicians || []).includes(mUid));
        const memberLogs = cachedReadyMap[`${roster.rosterId}_${mUid}`] || {};
        const completedCount = assignedSongs.filter((s) => !!memberLogs[s.songId]).length;

        details.push({
          name: memberInfo ? memberInfo.displayName : "Unknown Instrumentalist",
          roleLabel: "Band Musician",
          completedCount,
          assignedCount: assignedSongs.length,
          type: "musician",
        });
      });
    }

    setSelectedRosterDetails(details);
    setHistoryModalVisible(true);
  };

  const getProgressColor = (completed, assigned) => {
    if (assigned === 0) return "#64748B"; // Neutral/Grey
    if (completed === assigned) return "#10B981"; // Green (Success)
    if (completed === 0) return "#EF4444"; // Red (No progress)
    return "#F59E0B"; // Amber (Partial)
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return "TBD";
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
    } catch {
      return dateStr;
    }
  };

  // Spinner Loading Layout
  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={themeColor} />
        <Text style={styles.loadingText}>Fetching Ministry Metrics...</Text>
      </View>
    );
  }

  // Find max song frequency to compute horizontal progress width
  const maxSongCount = songStats.length > 0 ? songStats[0].count : 0;

  return (
    <View style={styles.container}>
      {/* Background ambient gold glow */}
      <View style={[styles.roleGlow, { backgroundColor: themeColor }]} />

      {/* Header bar */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack} activeOpacity={0.7}>
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>📊 Team Analytics</Text>
        <View style={{ width: 50 }} />
      </View>

      {/* Last Updated cache subtitle */}
      {lastUpdated && (
        <View style={styles.updatedBanner}>
          <Text style={styles.updatedText}>🕒 Last synchronized: {lastUpdated}</Text>
        </View>
      )}

      {cachedRosters.length === 0 ? (
        <ScrollView
          contentContainerStyle={styles.emptyContainer}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={themeColor} />}
        >
          <Text style={styles.emptyText}>✨ No data yet. No published rosters were found in the database.</Text>
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={themeColor} />}
        >
          {/* =========================================================
             SECTION 1: SONG STATS
             ========================================================= */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>🎹 Top Used Songs</Text>
              <View style={styles.filterRow}>
                {[
                  { id: "month", label: "Month" },
                  { id: "3months", label: "3 Mos" },
                  { id: "alltime", label: "All Time" },
                ].map((f) => (
                  <TouchableOpacity
                    key={f.id}
                    style={[
                      styles.filterBtn,
                      songFilter === f.id && [styles.filterBtnActive, { backgroundColor: themeColor }],
                    ]}
                    onPress={() => setSongFilter(f.id)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.filterBtnText, songFilter === f.id && styles.filterBtnTextActive]}>
                      {f.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {songStats.length === 0 ? (
              <Text style={styles.emptyCardText}>No song usages recorded in this period.</Text>
            ) : (
              <View style={styles.songStatsList}>
                {songStats.map((item, index) => {
                  const widthPercent = maxSongCount > 0 ? (item.count / maxSongCount) * 100 : 0;
                  return (
                    <View key={index} style={styles.songStatRow}>
                      <View style={styles.songInfoMeta}>
                        <Text style={styles.songTitle} numberOfLines={1}>
                          {index + 1}. {item.title}
                        </Text>
                        <Text style={styles.songUsageCount}>{item.count} appearance{item.count > 1 ? "s" : ""}</Text>
                      </View>
                      <View style={styles.frequencyBarBg}>
                        <View style={[styles.frequencyBarFilled, { width: `${widthPercent}%`, backgroundColor: themeColor }]} />
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>

          {/* =========================================================
             SECTION 2: PRACTICE COMPLETION (MOST RECENT ROSTER)
             ========================================================= */}
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>🎤 Choir Practice Progress</Text>
            <Text style={styles.sectionSubtitle}>Assigned vocalists check-in counts for the most recent service plan</Text>

            {recentPracticeList.length === 0 ? (
              <Text style={styles.emptyCardText}>No choir members assigned to the most recent published service.</Text>
            ) : (
              <View style={styles.completionList}>
                {recentPracticeList.map((member, index) => {
                  const indicatorColor = getProgressColor(member.practicedCount, member.assignedCount);
                  return (
                    <View key={index} style={styles.completionRow}>
                      <Text style={styles.memberName} numberOfLines={1}>
                        🎤 {member.name}
                      </Text>
                      <View style={styles.completionBadgeContainer}>
                        <View style={[styles.statusIndicatorDot, { backgroundColor: indicatorColor }]} />
                        <Text style={[styles.completionValueText, { color: indicatorColor }]}>
                          {member.practicedCount} of {member.assignedCount} songs
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>

          {/* =========================================================
             SECTION 3: TEAM OVERVIEW
             ========================================================= */}
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>👥 Ministry Team Roll</Text>
            <Text style={styles.sectionSubtitle}>Total registered servants categorized by role</Text>

            <View style={styles.teamGrid}>
              <View style={styles.teamGridRow}>
                <View style={styles.teamMetricCard}>
                  <Text style={[styles.teamMetricValue, { color: "#F59E0B" }]}>
                    👑 {teamOverview.worship_leader}
                  </Text>
                  <Text style={styles.teamMetricLabel}>Leaders</Text>
                </View>
                <View style={styles.teamMetricCard}>
                  <Text style={[styles.teamMetricValue, { color: "#A855F7" }]}>
                    🎸 {teamOverview.musician}
                  </Text>
                  <Text style={styles.teamMetricLabel}>Musicians</Text>
                </View>
              </View>
              <View style={styles.teamGridRow}>
                <View style={styles.teamMetricCard}>
                  <Text style={[styles.teamMetricValue, { color: "#0D9488" }]}>
                    🎤 {teamOverview.choir_member}
                  </Text>
                  <Text style={styles.teamMetricLabel}>Vocalists</Text>
                </View>
                <View style={styles.teamMetricCard}>
                  <Text style={[styles.teamMetricValue, { color: "#3B82F6" }]}>
                    ⛪ {teamOverview.member}
                  </Text>
                  <Text style={styles.teamMetricLabel}>Members</Text>
                </View>
              </View>
            </View>
          </View>

          {/* =========================================================
             SECTION 4: ROSTER HISTORY
             ========================================================= */}
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>📅 Published Roster Logs</Text>
            <Text style={styles.sectionSubtitle}>Historical summary of the last 10 published service plans</Text>

            <View style={styles.historyList}>
              {rosterHistoryList.map((roster, index) => (
                <TouchableOpacity
                  key={index}
                  style={[styles.historyRowItem, { borderColor: themeColor + "20" }]}
                  activeOpacity={0.7}
                  onPress={() => handleOpenRosterHistoryDetails(roster)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.historyEventTitle} numberOfLines={1}>
                      📅 {roster.eventName}
                    </Text>
                    <Text style={styles.historyDate}>{formatDate(roster.date)}</Text>
                  </View>
                  <View style={styles.historyRightMeta}>
                    <View style={styles.historyMetaPill}>
                      <Text style={styles.historyMetaPillText}>🎵 {roster.songCount} Songs</Text>
                    </View>
                    <View style={[styles.historyMetaPill, { marginLeft: 6 }]}>
                      <Text style={styles.historyMetaPillText}>👥 {roster.teamCount} Servants</Text>
                    </View>
                  </View>
                  <Text style={styles.historyChevron}>➔</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </ScrollView>
      )}

      {/* =========================================================
         MODAL: ROSTER HISTORY SUMMARY DETAILS
         ========================================================= */}
      <Modal visible={historyModalVisible} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            {selectedRoster && (
              <>
                <View style={styles.modalHeaderRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modalEventTitle} numberOfLines={2}>
                      📅 {selectedRoster.eventName}
                    </Text>
                    <Text style={styles.modalDate}>Service Date: {formatDate(selectedRoster.date)}</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.modalCloseBtn}
                    onPress={() => {
                      setHistoryModalVisible(false);
                      setSelectedRoster(null);
                    }}
                  >
                    <Text style={styles.modalCloseBtnText}>✕ Close</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.modalDivider} />

                <ScrollView style={styles.modalScrollBody} showsVerticalScrollIndicator={false}>
                  {/* Detailed Assigned Songs list */}
                  <Text style={styles.modalSubHeader}>Songs Setlist Plan</Text>
                  {selectedRoster.rawRoster?.songs && selectedRoster.rawRoster.songs.length > 0 ? (
                    <View style={styles.modalSongsList}>
                      {selectedRoster.rawRoster.songs.map((s, idx) => (
                        <View key={idx} style={styles.modalSongRow}>
                          <Text style={styles.modalSongOrderText}>{idx + 1}</Text>
                          <View style={{ flex: 1, marginLeft: 10 }}>
                            <Text style={styles.modalSongTitle} numberOfLines={1}>{s.title}</Text>
                            <Text style={styles.modalSongNotes} numberOfLines={1}>{s.notes || "No practice cues"}</Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <Text style={styles.emptyModalText}>No songs loaded for this roster.</Text>
                  )}

                  {/* Individual Practice/Readiness completion */}
                  <Text style={[styles.modalSubHeader, { marginTop: 20 }]}>Servant Preparations checklist</Text>
                  {selectedRosterDetails.length === 0 ? (
                    <Text style={styles.emptyModalText}>No members were assigned to this roster.</Text>
                  ) : (
                    <View style={styles.modalDetailsList}>
                      {selectedRosterDetails.map((servant, idx) => {
                        const statusColor = getProgressColor(servant.completedCount, servant.assignedCount);
                        return (
                          <View key={idx} style={styles.modalDetailRow}>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.modalDetailName} numberOfLines={1}>
                                {servant.type === "vocalist" ? "🎤" : "🎸"} {servant.name}
                              </Text>
                              <Text style={styles.modalDetailRole}>{servant.roleLabel}</Text>
                            </View>
                            <View style={styles.modalDetailBadgeContainer}>
                              <View style={[styles.statusIndicatorDot, { backgroundColor: statusColor }]} />
                              <Text style={[styles.modalDetailBadgeText, { color: statusColor }]}>
                                {servant.completedCount} of {servant.assignedCount} {servant.type === "vocalist" ? "practiced" : "ready"}
                              </Text>
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  )}
                </ScrollView>
              </>
            )}
          </View>
        </View>
      </Modal>
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
    alignSelf: "center",
    width: 320,
    height: 320,
    borderRadius: 160,
    opacity: 0.1,
    blurRadius: 80,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: "#0B0F19",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  loadingText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
    marginTop: 14,
  },
  emptyContainer: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  emptyText: {
    color: "#64748B",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "ios" ? 54 : 40,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderColor: "#1E293B",
  },
  backBtn: {
    borderWidth: 1.2,
    borderColor: "rgba(255, 255, 255, 0.1)",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "rgba(255, 255, 255, 0.02)",
  },
  backBtnText: {
    color: "#94A3B8",
    fontSize: 13,
    fontWeight: "700",
  },
  headerTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "800",
  },
  updatedBanner: {
    backgroundColor: "rgba(245, 158, 11, 0.05)",
    borderBottomWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.1)",
    paddingVertical: 8,
    alignItems: "center",
  },
  updatedText: {
    color: "#F59E0B",
    fontSize: 11,
    fontWeight: "700",
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 110,
  },
  sectionCard: {
    backgroundColor: "#1E293B",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#334155",
    padding: 16,
    marginBottom: 16,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  sectionTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
  },
  sectionSubtitle: {
    color: "#64748B",
    fontSize: 12,
    fontWeight: "500",
    marginTop: 2,
    marginBottom: 16,
  },
  filterRow: {
    flexDirection: "row",
    backgroundColor: "#0B0F19",
    borderRadius: 8,
    padding: 2,
    borderWidth: 1,
    borderColor: "#334155",
  },
  filterBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  filterBtnActive: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  filterBtnText: {
    color: "#64748B",
    fontSize: 10,
    fontWeight: "800",
  },
  filterBtnTextActive: {
    color: "#0B0F19",
  },
  emptyCardText: {
    color: "#64748B",
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
    paddingVertical: 14,
  },
  songStatsList: {
    marginTop: 4,
  },
  songStatRow: {
    marginBottom: 14,
  },
  songInfoMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  songTitle: {
    color: "#E2E8F0",
    fontSize: 13,
    fontWeight: "700",
    flex: 1,
    marginRight: 10,
  },
  songUsageCount: {
    color: "#94A3B8",
    fontSize: 12,
    fontWeight: "600",
  },
  frequencyBarBg: {
    height: 6,
    backgroundColor: "#0B0F19",
    borderRadius: 3,
    overflow: "hidden",
  },
  frequencyBarFilled: {
    height: "100%",
    borderRadius: 3,
  },
  completionList: {
    marginTop: 4,
  },
  completionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderColor: "#334155",
  },
  memberName: {
    color: "#E2E8F0",
    fontSize: 13,
    fontWeight: "700",
    flex: 1,
    marginRight: 10,
  },
  completionBadgeContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  statusIndicatorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  completionValueText: {
    fontSize: 12,
    fontWeight: "800",
  },
  teamGrid: {
    marginTop: 4,
  },
  teamGridRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  teamMetricCard: {
    flex: 1,
    backgroundColor: "#0B0F19",
    borderWidth: 1.2,
    borderColor: "#334155",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginHorizontal: 4,
  },
  teamMetricValue: {
    fontSize: 22,
    fontWeight: "800",
    marginBottom: 4,
  },
  teamMetricLabel: {
    color: "#64748B",
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  historyList: {
    marginTop: 4,
  },
  historyRowItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#0B0F19",
    borderRadius: 12,
    borderWidth: 1.2,
    padding: 12,
    marginBottom: 10,
  },
  historyEventTitle: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
  },
  historyDate: {
    color: "#64748B",
    fontSize: 11,
    fontWeight: "600",
    marginTop: 4,
  },
  historyRightMeta: {
    flexDirection: "row",
    alignItems: "center",
    marginRight: 6,
  },
  historyMetaPill: {
    backgroundColor: "#1E293B",
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  historyMetaPillText: {
    color: "#94A3B8",
    fontSize: 10,
    fontWeight: "700",
  },
  historyChevron: {
    color: "#64748B",
    fontSize: 14,
    fontWeight: "700",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(11, 15, 25, 0.85)",
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: "#1E293B",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: "#334155",
    padding: 20,
    maxHeight: "85%",
  },
  modalHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  modalEventTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
    marginRight: 10,
  },
  modalDate: {
    color: "#64748B",
    fontSize: 12,
    fontWeight: "600",
    marginTop: 4,
  },
  modalCloseBtn: {
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  modalCloseBtnText: {
    color: "#EF4444",
    fontSize: 12,
    fontWeight: "700",
  },
  modalDivider: {
    height: 1,
    backgroundColor: "#334155",
    marginVertical: 16,
  },
  modalScrollBody: {
    marginBottom: Platform.OS === "ios" ? 30 : 10,
  },
  modalSubHeader: {
    color: "#94A3B8",
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  modalSongsList: {
    backgroundColor: "#0B0F19",
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: "#334155",
  },
  modalSongRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: "rgba(51, 65, 85, 0.5)",
  },
  modalSongOrderText: {
    color: "#F59E0B",
    fontSize: 13,
    fontWeight: "800",
    width: 18,
    textAlign: "center",
  },
  modalSongTitle: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
  modalSongNotes: {
    color: "#64748B",
    fontSize: 10,
    fontWeight: "500",
    marginTop: 2,
  },
  modalDetailsList: {
    backgroundColor: "#0B0F19",
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: "#334155",
  },
  modalDetailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderColor: "rgba(51, 65, 85, 0.5)",
  },
  modalDetailName: {
    color: "#E2E8F0",
    fontSize: 13,
    fontWeight: "700",
  },
  modalDetailRole: {
    color: "#64748B",
    fontSize: 10,
    fontWeight: "600",
    marginTop: 2,
  },
  modalDetailBadgeContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  modalDetailBadgeText: {
    fontSize: 11,
    fontWeight: "800",
  },
  emptyModalText: {
    color: "#64748B",
    fontSize: 12,
    fontWeight: "600",
    paddingVertical: 10,
    textAlign: "center",
  },
});
