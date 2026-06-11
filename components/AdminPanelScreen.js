import React, { useState, useEffect } from "react";
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  Modal,
  FlatList,
  Alert,
  Dimensions,
  ActivityIndicator,
  TextInput,
  Platform,
  Linking,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { USE_DEMO_MODE, db } from "../firebaseConfig";
import {
  collection,
  doc,
  getDocs,
  getDoc,
  updateDoc,
  onSnapshot,
  query,
  addDoc,
} from "firebase/firestore";
import { sendWhatsApp, getWhatsAppMessageTemplate } from "../services/whatsappService";

const { width } = Dimensions.get("window");

// Role configuration list for visual badges and modal selects
const ROLE_DETAILS = {
  super_admin: {
    label: "Super Admin",
    emoji: "👑",
    color: "#EF4444",
    bg: "rgba(239, 68, 68, 0.12)",
    border: "rgba(239, 68, 68, 0.3)",
    description: "Highest system clearance. Lockable fixed role. Approves pending role promotions proposed by Worship Leaders.",
  },
  worship_leader: {
    label: "Worship Leader",
    emoji: "👑",
    color: "#F59E0B",
    bg: "rgba(245, 158, 11, 0.12)",
    border: "rgba(245, 158, 11, 0.3)",
    description: "Full admin access to schedule setlists, broadcast alerts, and manage team roles.",
  },
  musician: {
    label: "Band Musician",
    emoji: "🎸",
    color: "#A855F7",
    bg: "rgba(168, 85, 247, 0.12)",
    border: "rgba(168, 85, 247, 0.3)",
    description: "Access to prepare song charts, listen to tracks, and check-in readiness.",
  },
  choir_member: {
    label: "Choir Vocalist",
    emoji: "🎤",
    color: "#0D9488",
    bg: "rgba(13, 148, 136, 0.12)",
    border: "rgba(13, 148, 136, 0.3)",
    description: "Access to view lyric sheets, vocal guides, and complete practice check-ins.",
  },
  member: {
    label: "Team Member",
    emoji: "⛪",
    color: "#3B82F6",
    bg: "rgba(59, 130, 246, 0.12)",
    border: "rgba(59, 130, 246, 0.3)",
    description: "Default account. Can view general bulletins and setlist listings once published.",
  },
};

export default function AdminPanelScreen({ user }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Custom Bottom-sheet role assignment modal states
  const [selectedUser, setSelectedUser] = useState(null);
  const [roleModalVisible, setRoleModalVisible] = useState(false);

  // Task Delegation states
  const [taskDescription, setTaskDescription] = useState("");
  const [taskDueDate, setTaskDueDate] = useState("");
  const [selectedTaskAssignee, setSelectedTaskAssignee] = useState(null);
  const [assigneeModalVisible, setAssigneeModalVisible] = useState(false);
  const [submittingTask, setSubmittingTask] = useState(false);

  // Storage keys for demo mode
  const DEMO_USERS_DB_KEY = "@worship_team_demo_users";

  const handleDelegateTask = async () => {
    if (!selectedTaskAssignee) {
      Alert.alert("Required Field", "Please select a team member to assign the task to.");
      return;
    }
    if (!taskDescription.trim()) {
      Alert.alert("Required Field", "Please enter a task description.");
      return;
    }
    if (!taskDueDate.trim()) {
      Alert.alert("Required Field", "Please specify a due date.");
      return;
    }

    setSubmittingTask(true);
    
    const taskData = {
      description: taskDescription.trim(),
      dueDate: taskDueDate.trim(),
      assignedToUid: selectedTaskAssignee.uid,
      assignedToName: selectedTaskAssignee.displayName,
      assignedToPhone: selectedTaskAssignee.phone || "",
      delegatedByUid: user.uid,
      delegatedByName: user.displayName,
      createdAt: new Date().toISOString(),
      status: "pending"
    };

    try {
      if (USE_DEMO_MODE) {
        // Save to AsyncStorage under @worship_team_tasks
        const storedTasks = await AsyncStorage.getItem("@worship_team_tasks");
        const currentTasks = storedTasks ? JSON.parse(storedTasks) : [];
        const newTask = {
          taskId: "mock-task-" + Math.floor(Math.random() * 100000),
          ...taskData
        };
        await AsyncStorage.setItem("@worship_team_tasks", JSON.stringify([newTask, ...currentTasks]));
        console.log("Task successfully saved in AsyncStorage.");
      } else {
        // Save to live Firestore under /tasks
        const tasksCollRef = collection(db, "tasks");
        await addDoc(tasksCollRef, taskData);
        console.log("Task successfully saved in Firestore.");
      }

      // Trigger automatic WhatsApp notification
      if (selectedTaskAssignee.phone) {
        const taskAssignedMsg = getWhatsAppMessageTemplate("task_assigned", {
          delegatorName: user.displayName,
          taskDescription: taskDescription.trim(),
          date: taskDueDate.trim()
        });
        
        console.log(`Sending WhatsApp task notification to ${selectedTaskAssignee.displayName} (${selectedTaskAssignee.phone})`);
        const result = await sendWhatsApp(selectedTaskAssignee.phone, taskAssignedMsg, "task_assigned");
        
        if (result.success) {
          Alert.alert(
            "✅ Task Delegated", 
            `Task successfully assigned to ${selectedTaskAssignee.displayName}.\n\nWhatsApp notification dispatched!`
          );
        } else {
          Alert.alert(
            "⚠️ Task Delegated with Warning", 
            `Task assigned successfully, but WhatsApp notification failed to send: ${result.error}`
          );
        }
      } else {
        Alert.alert(
          "⚠️ Task Delegated with Warning", 
          `Task assigned successfully to ${selectedTaskAssignee.displayName}, but they don't have a phone number configured for WhatsApp alerts.`
        );
      }

      // Reset Form State
      setTaskDescription("");
      setTaskDueDate("");
      setSelectedTaskAssignee(null);
    } catch (err) {
      console.error("Failed to delegate task:", err);
      Alert.alert("Error", "Could not delegate task: " + err.message);
    } finally {
      setSubmittingTask(false);
    }
  };

  useEffect(() => {
    let unsubscribe = null;

    async function loadInitialData() {
      setLoading(true);
      try {
        if (USE_DEMO_MODE) {
          // Demo Mode Loader
          const stored = await AsyncStorage.getItem(DEMO_USERS_DB_KEY);
          if (stored) {
            const parsed = JSON.parse(stored);
            setUsers(Object.values(parsed));
          }
          setLoading(false);

          // Simulate live updates by polling storage occasionally in Demo Mode
          const interval = setInterval(async () => {
            const updated = await AsyncStorage.getItem(DEMO_USERS_DB_KEY);
            if (updated) {
              setUsers(Object.values(JSON.parse(updated)));
            }
          }, 3000);
          unsubscribe = () => clearInterval(interval);
        } else {
          // Production Mode: Set up a Firestore listener on the /users collection
          const usersColl = collection(db, "users");
          const q = query(usersColl);
          
          unsubscribe = onSnapshot(
            q,
            (snapshot) => {
              const uList = [];
              snapshot.forEach((docSnap) => {
                uList.push({ uid: docSnap.id, ...docSnap.data() });
              });
              setUsers(uList);
              setLoading(false);
            },
            (err) => {
              console.error("Firestore user listing error:", err);
              Alert.alert("Database Error", "Could not synchronize team directory.");
              setLoading(false);
            }
          );
        }
      } catch (err) {
        console.error("Failed to bootstrap user directory:", err);
        setLoading(false);
      }
    }

    loadInitialData();

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  // Update user role handler
  const handleUpdateRole = async (targetUid, newRole) => {
    try {
      if (USE_DEMO_MODE) {
        const stored = await AsyncStorage.getItem(DEMO_USERS_DB_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          let matchKey = null;
          
          // Match key by uid field inside each user profile record
          Object.keys(parsed).forEach((k) => {
            if (parsed[k].uid === targetUid) {
              matchKey = k;
            }
          });

          if (matchKey) {
            // Block downgrading/modifying super_admin
            if (parsed[matchKey].role === "super_admin") {
              Alert.alert("Permission Denied", "Cannot modify a Super Admin's role clearance.");
              return;
            }

            if (user?.role === "worship_leader") {
              // Propose role change instead of applying directly
              parsed[matchKey].pendingRole = newRole;
              parsed[matchKey].pendingRoleRequestedBy = user.displayName;
              parsed[matchKey].pendingRoleRequestedAt = new Date().toISOString();

              await AsyncStorage.setItem(DEMO_USERS_DB_KEY, JSON.stringify(parsed));
              setUsers(Object.values(parsed));
              Alert.alert("Submitted ⏳", `Proposed role clearance of "${ROLE_DETAILS[newRole].label}". Pending Super Admin approval!`);
            } else {
              // Direct promotion by super admin
              parsed[matchKey].role = newRole;
              delete parsed[matchKey].pendingRole;
              delete parsed[matchKey].pendingRoleRequestedBy;
              delete parsed[matchKey].pendingRoleRequestedAt;

              await AsyncStorage.setItem(DEMO_USERS_DB_KEY, JSON.stringify(parsed));
              setUsers(Object.values(parsed));
              Alert.alert("Success 👑", `Role upgraded to "${ROLE_DETAILS[newRole].label}" successfully!`);
            }
          }
        }
      } else {
        // Firestore Production Mode
        const userDocRef = doc(db, "users", targetUid);
        const userSnap = await getDoc(userDocRef);
        if (userSnap.exists()) {
          const uData = userSnap.data();
          if (uData.role === "super_admin") {
            Alert.alert("Permission Denied", "Cannot modify a Super Admin's role clearance.");
            return;
          }
        }

        if (user?.role === "worship_leader") {
          await updateDoc(userDocRef, {
            pendingRole: newRole,
            pendingRoleRequestedBy: user.displayName,
            pendingRoleRequestedAt: new Date().toISOString(),
          });
          Alert.alert("Submitted ⏳", `Proposed role clearance of "${ROLE_DETAILS[newRole].label}". Pending Super Admin approval!`);
        } else {
          // Direct promotion by super admin
          await updateDoc(userDocRef, {
            role: newRole,
            pendingRole: null,
            pendingRoleRequestedBy: null,
            pendingRoleRequestedAt: null,
          });
          Alert.alert("Success 👑", `Role upgraded to "${ROLE_DETAILS[newRole].label}" successfully!`);
        }
      }
    } catch (err) {
      console.error("Role update failed:", err);
      Alert.alert("Error", "Unable to update team role: " + err.message);
    } finally {
      setRoleModalVisible(false);
      setSelectedUser(null);
    }
  };

  const handleApproveRoleChange = async (targetUid) => {
    try {
      if (USE_DEMO_MODE) {
        const stored = await AsyncStorage.getItem(DEMO_USERS_DB_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          let matchKey = null;
          Object.keys(parsed).forEach((k) => {
            if (parsed[k].uid === targetUid) {
              matchKey = k;
            }
          });

          if (matchKey) {
            const proposedRole = parsed[matchKey].pendingRole;
            if (proposedRole) {
              parsed[matchKey].role = proposedRole;
              delete parsed[matchKey].pendingRole;
              delete parsed[matchKey].pendingRoleRequestedBy;
              delete parsed[matchKey].pendingRoleRequestedAt;

              await AsyncStorage.setItem(DEMO_USERS_DB_KEY, JSON.stringify(parsed));
              setUsers(Object.values(parsed));
              Alert.alert("Approved 🟢", `${parsed[matchKey].displayName}'s role is now upgraded to "${ROLE_DETAILS[proposedRole].label}"!`);
            }
          }
        }
      } else {
        const userDocRef = doc(db, "users", targetUid);
        const userSnap = await getDoc(userDocRef);
        if (userSnap.exists()) {
          const uData = userSnap.data();
          const proposedRole = uData.pendingRole;
          if (proposedRole) {
            await updateDoc(userDocRef, {
              role: proposedRole,
              pendingRole: null,
              pendingRoleRequestedBy: null,
              pendingRoleRequestedAt: null,
            });
            Alert.alert("Approved 🟢", `Role upgraded to "${ROLE_DETAILS[proposedRole].label}"!`);
          }
        }
      }
    } catch (err) {
      console.error("Failed to approve role:", err);
      Alert.alert("Error", "Could not approve role change: " + err.message);
    }
  };

  const handleRejectRoleChange = async (targetUid) => {
    try {
      if (USE_DEMO_MODE) {
        const stored = await AsyncStorage.getItem(DEMO_USERS_DB_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          let matchKey = null;
          Object.keys(parsed).forEach((k) => {
            if (parsed[k].uid === targetUid) {
              matchKey = k;
            }
          });

          if (matchKey) {
            delete parsed[matchKey].pendingRole;
            delete parsed[matchKey].pendingRoleRequestedBy;
            delete parsed[matchKey].pendingRoleRequestedAt;

            await AsyncStorage.setItem(DEMO_USERS_DB_KEY, JSON.stringify(parsed));
            setUsers(Object.values(parsed));
            Alert.alert("Rejected 🔴", "Role proposal discarded.");
          }
        }
      } else {
        const userDocRef = doc(db, "users", targetUid);
        await updateDoc(userDocRef, {
          pendingRole: null,
          pendingRoleRequestedBy: null,
          pendingRoleRequestedAt: null,
        });
        Alert.alert("Rejected 🔴", "Role proposal discarded.");
      }
    } catch (err) {
      console.error("Failed to reject role:", err);
      Alert.alert("Error", "Could not reject role change: " + err.message);
    }
  };

  const openRoleSelector = (userItem) => {
    setSelectedUser(userItem);
    setRoleModalVisible(true);
  };

  // Helper date logic to check if a user signed up in the last 7 days
  const isNewSignup = (u) => {
    if (u.role !== "member") return false;
    
    // In Demo Mode, if there is no registration date, treat Sister Grace as new to allow instant review
    if (!u.createdAt) {
      return u.uid === "demo-member-444";
    }

    try {
      const createdTime = new Date(u.createdAt).getTime();
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      return createdTime >= sevenDaysAgo;
    } catch (e) {
      return false;
    }
  };

  const newSignups = users.filter((u) => isNewSignup(u));
  const generalTeam = users.filter((u) => !isNewSignup(u));

  const getInitials = (name) => {
    if (!name) return "?";
    return name.substring(0, 2).toUpperCase();
  };

  const formatPhoneNumber = (num) => {
    if (!num) return "";
    
    // Check if the number already has a country code prefix starting with '+'
    if (num.startsWith("+")) {
      const clean = num.replace(/\D/g, "");
      // Handle standard India formatting
      if (num.startsWith("+91")) {
        const remaining = clean.substring(2);
        if (remaining.length === 10) {
          return `+91 ${remaining.substring(0, 5)}-${remaining.substring(5)}`;
        }
        return num;
      }
      
      // If it's a US/Canada number
      if (num.startsWith("+1") || (clean.length === 11 && clean.startsWith("1"))) {
        const rest = num.startsWith("+1") ? clean.substring(1) : clean.substring(1);
        if (rest.length === 10) {
          return `+1 (${rest.substring(0, 3)}) ${rest.substring(3, 6)}-${rest.substring(6)}`;
        }
      }
      return num;
    }
    
    // Fallback: If it's a 10-digit number without a leading '+'
    const cleaned = num.replace(/\D/g, "");
    if (cleaned.length === 10) {
      return `+1 (${cleaned.substring(0, 3)}) ${cleaned.substring(3, 6)}-${cleaned.substring(6)}`;
    }
    
    return num.startsWith("+") ? num : `+${num}`;
  };

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      {/* Premium ambient gold administrative glow */}
      <View style={styles.adminGlow} />

      {/* Header Panel */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>🛡️ Admin Panel</Text>
        <Text style={styles.headerSubtitle}>
          Manage team access, verify new registrations, and assign ministry roles in real-time.
        </Text>
      </View>

      {loading ? (
        <View style={styles.loaderContainer}>
          <ActivityIndicator size="large" color="#F59E0B" />
          <Text style={styles.loaderText}>Synchronizing directory...</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* BULK UPLOADER PORTAL LINK (Visible to super_admin) */}
          {user?.role === "super_admin" && (
            <View style={styles.sectionContainer}>
              <Text style={[styles.sectionHeader, { color: "#F59E0B", marginBottom: 6 }]}>📥 Bulk Song Uploader</Text>
              <Text style={styles.sectionDescription}>
                Access the Bulk Song Uploader portal to parse Word documents (.docx) and import song lyrics/chords to the database.
              </Text>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => {
                  if (Platform.OS === 'web') {
                    window.open('/admin.html', '_blank');
                  } else {
                    Linking.openURL('https://worshipteamapp-c84e2.web.app/admin.html');
                  }
                }}
                style={styles.uploaderBtn}
              >
                <Text style={styles.uploaderBtnText}>Open Bulk Song Uploader ➔</Text>
              </TouchableOpacity>
              <View style={styles.horizontalDivider} />
            </View>
          )}

          {/* 0. PENDING APPROVALS SECTION (Visible only to super_admin) */}
          {user?.role === "super_admin" && users.filter((u) => u.pendingRole).length > 0 && (
            <View style={styles.sectionContainer}>
              <View style={styles.newSignupsTitleRow}>
                <Text style={[styles.newSignupsHeader, { color: "#EF4444" }]}>⏳ Pending Role Approvals</Text>
                <View style={[styles.pendingBadge, { backgroundColor: "rgba(239, 68, 68, 0.15)", borderColor: "rgba(239, 68, 68, 0.3)" }]}>
                  <Text style={[styles.pendingBadgeText, { color: "#EF4444" }]}>
                    {users.filter((u) => u.pendingRole).length} Action Needed
                  </Text>
                </View>
              </View>
              <Text style={styles.sectionDescription}>
                Review role clearance updates proposed by Worship Leaders. Approving commits the role update instantly.
              </Text>

              {users.filter((u) => u.pendingRole).map((pendingItem) => {
                const targetConf = ROLE_DETAILS[pendingItem.pendingRole] || ROLE_DETAILS.member;
                const currentConf = ROLE_DETAILS[pendingItem.role] || ROLE_DETAILS.member;
                return (
                  <View key={pendingItem.uid} style={[styles.userCard, styles.pendingApprovalCard]}>
                    <View style={styles.userInfoRow}>
                      <View style={[styles.avatar, { borderColor: "#EF4444" }]}>
                        <Text style={styles.avatarText}>{getInitials(pendingItem.displayName)}</Text>
                      </View>
                      <View style={styles.userDetails}>
                        <Text style={styles.userName}>{pendingItem.displayName}</Text>
                        <Text style={styles.userPhone}>📱 {formatPhoneNumber(pendingItem.phone)}</Text>
                        <Text style={styles.requestedMetaText}>
                          Clearance: {currentConf.emoji} {currentConf.label} ➔ {targetConf.emoji} <Text style={{ color: targetConf.color, fontWeight: "800" }}>{targetConf.label}</Text>
                        </Text>
                        {pendingItem.pendingRoleRequestedBy && (
                          <Text style={styles.requestedByText}>
                            Proposed by {pendingItem.pendingRoleRequestedBy}
                          </Text>
                        )}
                      </View>

                      {/* Approval Action Buttons */}
                      <View style={styles.approvalButtonsColumn}>
                        <TouchableOpacity
                          activeOpacity={0.7}
                          onPress={() => handleApproveRoleChange(pendingItem.uid)}
                          style={[styles.approvalActionBtn, styles.approveBtn]}
                        >
                          <Text style={styles.approvalActionBtnText}>Approve</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          activeOpacity={0.7}
                          onPress={() => handleRejectRoleChange(pendingItem.uid)}
                          style={[styles.approvalActionBtn, styles.rejectBtn]}
                        >
                          <Text style={styles.approvalActionBtnText}>Reject</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                );
              })}
              <View style={styles.horizontalDivider} />
            </View>
          )}

          {/* 1. NEW SIGNUPS SECTION */}
          {newSignups.length > 0 && (
            <View style={styles.sectionContainer}>
              <View style={styles.newSignupsTitleRow}>
                <Text style={styles.newSignupsHeader}>🆕 New Signups (Last 7 Days)</Text>
                <View style={styles.pendingBadge}>
                  <Text style={styles.pendingBadgeText}>{newSignups.length} Action Needed</Text>
                </View>
              </View>
              <Text style={styles.sectionDescription}>
                These users recently completed mobile registration. Tap their role badge below to grant them their ministry clearance levels.
              </Text>

              {newSignups.map((item) => (
                <View key={item.uid} style={[styles.userCard, styles.newSignupCard]}>
                  <View style={styles.userInfoRow}>
                    <View style={[styles.avatar, styles.newSignupAvatar]}>
                      <Text style={styles.avatarText}>{getInitials(item.displayName)}</Text>
                    </View>
                    <View style={styles.userDetails}>
                      <Text style={styles.userName}>{item.displayName}</Text>
                      <Text style={styles.userPhone}>📱 {formatPhoneNumber(item.phone)}</Text>
                      {item.createdAt && (
                        <Text style={styles.signupDate}>
                          Registered: {new Date(item.createdAt).toLocaleDateString([], { month: "short", day: "numeric" })}
                        </Text>
                      )}
                      {item.pendingRole && (
                        <Text style={styles.pendingProposedText}>
                          ⏳ Proposed: {ROLE_DETAILS[item.pendingRole]?.label || item.pendingRole}
                        </Text>
                      )}
                    </View>
                    
                    {/* Action Selector */}
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={() => openRoleSelector(item)}
                      style={[
                        styles.roleBadgeButton,
                        {
                          backgroundColor: ROLE_DETAILS.member.bg,
                          borderColor: ROLE_DETAILS.member.border,
                        },
                      ]}
                    >
                      <Text style={[styles.roleBadgeText, { color: ROLE_DETAILS.member.color }]}>
                        {ROLE_DETAILS.member.emoji} Promote
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
              <View style={styles.horizontalDivider} />
            </View>
          )}

          {/* 2. REGULAR MEMBERS SECTION */}
          <View style={styles.sectionContainer}>
            <Text style={styles.sectionHeader}>👥 Active Ministry Team ({users.length} registered)</Text>
            <Text style={styles.sectionDescription}>
              List of verified users in the system. Changing a role updates their app access immediately.
            </Text>

            {generalTeam.length === 0 && newSignups.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>✨ No registered team members found.</Text>
              </View>
            ) : (
              generalTeam.map((item) => {
                const roleConf = ROLE_DETAILS[item.role] || ROLE_DETAILS.member;
                return (
                  <View key={item.uid} style={styles.userCard}>
                    <View style={styles.userInfoRow}>
                      <View style={[styles.avatar, { borderColor: roleConf.color }]}>
                        <Text style={styles.avatarText}>{getInitials(item.displayName)}</Text>
                      </View>
                      <View style={styles.userDetails}>
                        <Text style={styles.userName}>{item.displayName}</Text>
                        <Text style={styles.userPhone}>📱 {formatPhoneNumber(item.phone)}</Text>
                        {item.pendingRole && (
                          <Text style={styles.pendingProposedText}>
                            ⏳ Proposed: {ROLE_DETAILS[item.pendingRole]?.label || item.pendingRole}
                          </Text>
                        )}
                      </View>
                      
                      {/* Active Selector */}
                      {item.role === "super_admin" ? (
                        <View
                          style={[
                            styles.roleBadgeButton,
                            {
                              backgroundColor: roleConf.bg,
                              borderColor: roleConf.border,
                            },
                          ]}
                        >
                          <Text style={[styles.roleBadgeText, { color: roleConf.color }]}>
                            🔒 {roleConf.label}
                          </Text>
                        </View>
                      ) : (
                        <TouchableOpacity
                          activeOpacity={0.7}
                          onPress={() => openRoleSelector(item)}
                          style={[
                            styles.roleBadgeButton,
                            {
                              backgroundColor: roleConf.bg,
                              borderColor: roleConf.border,
                            },
                          ]}
                        >
                          <Text style={[styles.roleBadgeText, { color: roleConf.color }]}>
                            {roleConf.emoji} {roleConf.label}
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                );
              })
            )}
          </View>

          {/* 3. DELEGATE MINISTRY TASK SECTION (Visible to worship_leader and super_admin) */}
          {(user?.role === "worship_leader" || user?.role === "super_admin") && (
            <View style={styles.sectionContainer}>
              <View style={styles.horizontalDivider} />
              <Text style={[styles.sectionHeader, { color: "#F59E0B" }]}>✅ Delegate Ministry Task</Text>
              <Text style={styles.sectionDescription}>
                Assign a specific task to any team member. They will instantly receive a standardized Twilio WhatsApp alert with your delegation details.
              </Text>

              <View style={[styles.userCard, { paddingVertical: 18, paddingHorizontal: 18 }]}>
                {/* Assignee Selector Button */}
                <Text style={styles.inputLabel}>Select Assignee</Text>
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => setAssigneeModalVisible(true)}
                  style={styles.assigneeSelectorBtn}
                >
                  <Text style={styles.assigneeSelectorBtnText}>
                    {selectedTaskAssignee 
                      ? `👤 ${selectedTaskAssignee.displayName} (${ROLE_DETAILS[selectedTaskAssignee.role]?.label || selectedTaskAssignee.role})`
                      : "🔍 Click to select team member..."}
                  </Text>
                </TouchableOpacity>

                {/* Task Description Input */}
                <Text style={styles.inputLabel}>Task Description</Text>
                <TextInput
                  style={styles.taskTextInput}
                  placeholder="e.g. Prepare chord sheet transposition for verse 2 or vocal guide harmonies"
                  placeholderTextColor="#475569"
                  value={taskDescription}
                  onChangeText={setTaskDescription}
                  multiline
                  numberOfLines={3}
                />

                {/* Due Date Input */}
                <Text style={styles.inputLabel}>Due Date</Text>
                <TextInput
                  style={styles.dueDateInput}
                  placeholder="e.g. Friday, May 29 or Resurrection Sunday"
                  placeholderTextColor="#475569"
                  value={taskDueDate}
                  onChangeText={setTaskDueDate}
                />

                {/* Submit button */}
                <TouchableOpacity
                  style={[styles.delegateSubmitBtn, submittingTask && styles.delegateSubmitBtnDisabled]}
                  onPress={handleDelegateTask}
                  disabled={submittingTask}
                  activeOpacity={0.8}
                >
                  {submittingTask ? (
                    <ActivityIndicator color="#0B0F19" />
                  ) : (
                    <Text style={styles.delegateSubmitBtnText}>Delegate Task & Dispatch WhatsApp</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </ScrollView>
      )}

      {/* 3. CENTERED ROLE SELECTOR BOTTOM SHEET MODAL */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={roleModalVisible}
        onRequestClose={() => {
          setRoleModalVisible(false);
          setSelectedUser(null);
        }}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => {
            setRoleModalVisible(false);
            setSelectedUser(null);
          }}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContainer}>
            {/* Modal Body */}
            <TouchableOpacity activeOpacity={1} style={styles.modalContent}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalTitle}>👑 Upgrade Clearance</Text>
                <TouchableOpacity
                  onPress={() => {
                    setRoleModalVisible(false);
                    setSelectedUser(null);
                  }}
                  style={styles.closeModalButton}
                >
                  <Text style={styles.closeModalText}>✕</Text>
                </TouchableOpacity>
              </View>

              {selectedUser && (
                <View style={styles.modalUserCard}>
                  <Text style={styles.modalUserIntro}>
                    Select ministry clearance role for:
                  </Text>
                  <Text style={styles.modalUserName}>
                    {selectedUser.displayName}
                  </Text>
                  <Text style={styles.modalUserPhone}>
                    📱 {formatPhoneNumber(selectedUser.phone)}
                  </Text>
                </View>
              )}

              <View style={styles.modalDivider} />

              {/* Roles Option items */}
              {Object.keys(ROLE_DETAILS).filter((roleKey) => roleKey !== "super_admin").map((roleKey) => {
                const conf = ROLE_DETAILS[roleKey];
                const isCurrent = selectedUser?.role === roleKey;
                return (
                  <TouchableOpacity
                    key={roleKey}
                    activeOpacity={0.8}
                    onPress={() => handleUpdateRole(selectedUser.uid, roleKey)}
                    style={[
                      styles.roleOptionCard,
                      { borderColor: conf.border },
                      isCurrent && { backgroundColor: conf.bg, borderColor: conf.color },
                    ]}
                  >
                    <View style={styles.roleOptionHeader}>
                      <View style={[styles.miniAvatarGlow, { backgroundColor: conf.color }]}>
                        <Text style={styles.miniAvatarEmoji}>{conf.emoji}</Text>
                      </View>
                      <View style={styles.roleOptionText}>
                        <Text style={[styles.roleOptionLabel, { color: conf.color }]}>
                          {conf.label}
                        </Text>
                        <Text style={styles.roleOptionDesc}>{conf.description}</Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}

              {/* Cancel Button */}
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => {
                  setRoleModalVisible(false);
                  setSelectedUser(null);
                }}
                style={styles.cancelModalButton}
              >
                <Text style={styles.cancelModalText}>Cancel Selection</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 4. ASSIGNEE SELECTOR MODAL */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={assigneeModalVisible}
        onRequestClose={() => setAssigneeModalVisible(false)}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setAssigneeModalVisible(false)}
          style={styles.modalOverlay}
        >
          <View style={[styles.modalContainer, { maxHeight: "70%" }]}>
            <TouchableOpacity activeOpacity={1} style={styles.modalContent}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalTitle}>👤 Select Assignee</Text>
                <TouchableOpacity
                  onPress={() => setAssigneeModalVisible(false)}
                  style={styles.closeModalButton}
                >
                  <Text style={styles.closeModalText}>✕</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.sectionDescription}>
                Choose the team member who will receive this ministry task assignment.
              </Text>

              <View style={styles.modalDivider} />

              <FlatList
                data={users}
                keyExtractor={(item) => item.uid}
                renderItem={({ item }) => {
                  const rDetails = ROLE_DETAILS[item.role] || ROLE_DETAILS.member;
                  return (
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={() => {
                        setSelectedTaskAssignee(item);
                        setAssigneeModalVisible(false);
                      }}
                      style={styles.modalUserItemRow}
                    >
                      <View style={[styles.avatar, { borderColor: rDetails.color, width: 36, height: 36, borderRadius: 18 }]}>
                        <Text style={[styles.avatarText, { fontSize: 12 }]}>{getInitials(item.displayName)}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.modalUserItemName}>{item.displayName}</Text>
                        <Text style={styles.modalUserItemRole}>
                          {rDetails.emoji} {rDetails.label}
                        </Text>
                      </View>
                      <Text style={styles.selectText}>Select</Text>
                    </TouchableOpacity>
                  );
                }}
                contentContainerStyle={{ paddingBottom: 20 }}
                style={{ maxHeight: 300 }}
              />
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0B0F19",
  },
  adminGlow: {
    position: "absolute",
    top: -120,
    right: -100,
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: "#F59E0B",
    opacity: 0.12,
    blurRadius: 100,
  },
  header: {
    paddingTop: 60,
    paddingHorizontal: 24,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderColor: "#1E293B",
  },
  headerTitle: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  headerSubtitle: {
    color: "#94A3B8",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "500",
  },
  loaderContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loaderText: {
    color: "#94A3B8",
    fontSize: 13,
    fontWeight: "600",
    marginTop: 12,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 100,
  },
  sectionContainer: {
    marginBottom: 20,
  },
  newSignupsTitleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  newSignupsHeader: {
    color: "#FBBF24", // Gold highlights
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  pendingBadge: {
    backgroundColor: "rgba(245, 158, 11, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.3)",
    borderRadius: 6,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  pendingBadgeText: {
    color: "#FBBF24",
    fontSize: 10,
    fontWeight: "800",
  },
  sectionHeader: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 0.3,
    marginBottom: 6,
  },
  sectionDescription: {
    color: "#64748B",
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 14,
    fontWeight: "500",
  },
  userCard: {
    backgroundColor: "rgba(30, 41, 59, 0.5)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.05)",
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  newSignupCard: {
    backgroundColor: "rgba(245, 158, 11, 0.04)",
    borderColor: "rgba(245, 158, 11, 0.15)",
  },
  userInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#1E293B",
    borderWidth: 2.5,
    borderColor: "#334155",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  newSignupAvatar: {
    borderColor: "#F59E0B",
    backgroundColor: "rgba(245, 158, 11, 0.08)",
  },
  avatarText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "750",
  },
  userDetails: {
    flex: 1,
    justifyContent: "center",
  },
  userName: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 3,
  },
  userPhone: {
    color: "#94A3B8",
    fontSize: 11,
    fontWeight: "600",
  },
  signupDate: {
    color: "#F59E0B",
    fontSize: 9,
    fontWeight: "700",
    marginTop: 2,
  },
  roleBadgeButton: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  roleBadgeText: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  horizontalDivider: {
    height: 1,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    marginVertical: 18,
  },
  emptyCard: {
    backgroundColor: "rgba(30, 41, 59, 0.25)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.03)",
    padding: 20,
    alignItems: "center",
  },
  emptyText: {
    color: "#64748B",
    fontSize: 12,
    fontWeight: "600",
  },
  // Modal Overlays and sheets styling
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(7, 10, 17, 0.85)", // Dark backdrop overlay
    justifyContent: "center",
    alignItems: "center",
  },
  modalContainer: {
    width: width - 40,
    maxWidth: 360,
    borderRadius: 20,
    backgroundColor: "#111827", // Deep charcoal dialog body
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 15,
    elevation: 10,
  },
  modalContent: {
    padding: 20,
  },
  modalHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  modalTitle: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  closeModalButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    justifyContent: "center",
    alignItems: "center",
  },
  closeModalText: {
    color: "#94A3B8",
    fontSize: 12,
    fontWeight: "700",
  },
  modalUserCard: {
    backgroundColor: "rgba(255, 255, 255, 0.02)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.04)",
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  modalUserIntro: {
    color: "#64748B",
    fontSize: 11,
    fontWeight: "600",
    marginBottom: 4,
  },
  modalUserName: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 2,
  },
  modalUserPhone: {
    color: "#94A3B8",
    fontSize: 11,
    fontWeight: "600",
  },
  modalDivider: {
    height: 1,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    marginBottom: 12,
  },
  roleOptionCard: {
    backgroundColor: "rgba(255, 255, 255, 0.01)",
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
  },
  roleOptionHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  miniAvatarGlow: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 10,
  },
  miniAvatarEmoji: {
    fontSize: 15,
  },
  roleOptionText: {
    flex: 1,
  },
  roleOptionLabel: {
    fontSize: 13,
    fontWeight: "800",
    marginBottom: 1,
  },
  roleOptionDesc: {
    color: "#64748B",
    fontSize: 10,
    lineHeight: 13,
    fontWeight: "500",
  },
  cancelModalButton: {
    backgroundColor: "rgba(255, 255, 255, 0.02)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.05)",
    borderRadius: 12,
    height: 44,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 6,
  },
  cancelModalText: {
    color: "#94A3B8",
    fontSize: 13,
    fontWeight: "750",
  },
  // Pending Approvals & workflow styling additions
  pendingApprovalCard: {
    backgroundColor: "rgba(239, 68, 68, 0.04)",
    borderColor: "rgba(239, 68, 68, 0.15)",
  },
  requestedMetaText: {
    color: "#E2E8F0",
    fontSize: 11,
    fontWeight: "600",
    marginTop: 4,
    lineHeight: 14,
  },
  requestedByText: {
    color: "#64748B",
    fontSize: 9,
    fontWeight: "750",
    marginTop: 3,
  },
  pendingProposedText: {
    color: "#FBBF24",
    fontSize: 10,
    fontWeight: "700",
    marginTop: 3,
  },
  approvalButtonsColumn: {
    justifyContent: "center",
    alignItems: "stretch",
    gap: 6,
    marginLeft: 8,
  },
  approvalActionBtn: {
    borderRadius: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 64,
  },
  approveBtn: {
    backgroundColor: "rgba(16, 185, 129, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.3)",
  },
  rejectBtn: {
    backgroundColor: "rgba(239, 68, 68, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.3)",
  },
  approvalActionBtnText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "800",
  },
  assigneeSelectorBtn: {
    backgroundColor: "#1E293B",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#334155",
    paddingHorizontal: 16,
    height: 50,
    justifyContent: "center",
    marginBottom: 16,
  },
  assigneeSelectorBtnText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "600",
  },
  taskTextInput: {
    backgroundColor: "#1E293B",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#334155",
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "500",
    textAlignVertical: "top",
    height: 80,
    marginBottom: 16,
  },
  dueDateInput: {
    backgroundColor: "#1E293B",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#334155",
    paddingHorizontal: 16,
    height: 50,
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 20,
  },
  delegateSubmitBtn: {
    backgroundColor: "#F59E0B",
    height: 50,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#F59E0B",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 3,
  },
  delegateSubmitBtnDisabled: {
    backgroundColor: "#1E293B",
    borderColor: "#334155",
    borderWidth: 1,
  },
  delegateSubmitBtnText: {
    color: "#0B0F19",
    fontSize: 14,
    fontWeight: "700",
  },
  modalUserItemRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.05)",
  },
  modalUserItemName: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  modalUserItemRole: {
    color: "#94A3B8",
    fontSize: 11,
    fontWeight: "600",
    marginTop: 2,
  },
  selectText: {
    color: "#F59E0B",
    fontSize: 12,
    fontWeight: "800",
    marginRight: 6,
  },
  uploaderBtn: {
    backgroundColor: "rgba(245, 158, 11, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.3)",
    borderRadius: 12,
    height: 48,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 12,
  },
  uploaderBtnText: {
    color: "#F59E0B",
    fontSize: 14,
    fontWeight: "750",
  },
});
