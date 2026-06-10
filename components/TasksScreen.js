import React, { useState, useEffect } from "react";
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  Modal,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  FlatList,
  Image,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  collection,
  addDoc,
  updateDoc,
  doc,
  onSnapshot,
  query,
  where,
  orderBy,
  getDocs,
  deleteDoc,
} from "firebase/firestore";
import { db, USE_DEMO_MODE } from "../firebaseConfig";
import { sendWhatsApp } from "../services/whatsappService";
import { sendPushNotificationToUsers } from "../services/notificationService";

const TASKS_DB_KEY = "@worship_team_tasks";

const PRIORITY_COLORS = {
  low: { color: "#10B981", bg: "rgba(16, 185, 129, 0.12)", border: "rgba(16, 185, 129, 0.3)" },
  medium: { color: "#F59E0B", bg: "rgba(245, 158, 11, 0.12)", border: "rgba(245, 158, 11, 0.3)" },
  high: { color: "#EF4444", bg: "rgba(239, 68, 68, 0.12)", border: "rgba(239, 68, 68, 0.3)" },
};

export default function TasksScreen({ user, songs, onJumpToRoster, onJumpToSongDetail }) {
  const { uid, displayName, role } = user;
  const isLeader = role === "worship_leader" || role === "super_admin";

  const [activeTab, setActiveTab] = useState("my_tasks"); // "my_tasks" | "delegated_tasks"
  const [statusFilter, setStatusFilter] = useState("pending"); // "pending" | "in_progress" | "completed"

  // Tasks states
  const [myTasks, setMyTasks] = useState([]);
  const [delegatedTasks, setDelegatedTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  // App data loaders
  const [users, setUsers] = useState([]);
  const [rosters, setRosters] = useState([]);

  // Detail Modal states
  const [selectedTask, setSelectedTask] = useState(null);
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [completionNote, setCompletionNote] = useState("");
  const [showCompletionPrompt, setShowCompletionPrompt] = useState(false);

  // Create Modal states
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDesc, setTaskDesc] = useState("");
  const [selectedAssignees, setSelectedAssignees] = useState([]);
  const [taskPriority, setTaskPriority] = useState("medium");
  const [selectedRosterLink, setSelectedRosterLink] = useState(null);
  const [selectedSongLink, setSelectedSongLink] = useState(null);
  const [taskDueDate, setTaskDueDate] = useState("");
  const [isSavingTask, setIsSavingTask] = useState(false);
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const [currentCalendarMonth, setCurrentCalendarMonth] = useState(new Date());

  // Select Picker states
  const [pickerType, setPickerType] = useState(null); // "user" | "roster" | "song" | null
  const [pickerModalVisible, setPickerModalVisible] = useState(false);

  // Load active data
  useEffect(() => {
    let unsubscribeMy = null;
    let unsubscribeDelegated = null;

    async function loadTasks() {
      setLoading(true);
      try {
        if (USE_DEMO_MODE) {
          const stored = await AsyncStorage.getItem(TASKS_DB_KEY);
          const allTasks = stored ? JSON.parse(stored) : getMockTasks();
          if (!stored) {
            await AsyncStorage.setItem(TASKS_DB_KEY, JSON.stringify(allTasks));
          }

          setMyTasks(allTasks.filter(t => Array.isArray(t.assignedTo) ? t.assignedTo.includes(uid) : t.assignedTo === uid));
          setDelegatedTasks(allTasks.filter(t => t.assignedBy === uid));
          setLoading(false);
        } else {
          // Firestore live sync
          const tasksColl = collection(db, "tasks");
          
          // Query for My Tasks
          const myQuery = query(
            tasksColl,
            where("assignedTo", "array-contains", uid)
          );
          unsubscribeMy = onSnapshot(myQuery, (snapshot) => {
            const list = [];
            snapshot.forEach((docSnap) => {
              list.push({ taskId: docSnap.id, ...docSnap.data() });
            });
            // Client-side sort by createdAt descending
            list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
            setMyTasks(list);
          }, (err) => console.error("My tasks listen error:", err));

          // Query for Delegated Tasks
          const delegatedQuery = query(
            tasksColl,
            where("assignedBy", "==", uid)
          );
          unsubscribeDelegated = onSnapshot(delegatedQuery, (snapshot) => {
            const list = [];
            snapshot.forEach((docSnap) => {
              list.push({ taskId: docSnap.id, ...docSnap.data() });
            });
            // Client-side sort by createdAt descending
            list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
            setDelegatedTasks(list);
            setLoading(false);
          }, (err) => {
            console.error("Delegated tasks listen error:", err);
            setLoading(false);
          });
        }
      } catch (err) {
        console.error("Tasks fetch failure:", err);
        setLoading(false);
      }
    }

    async function loadAuxiliaryData() {
      try {
        if (USE_DEMO_MODE) {
          const storedUsers = await AsyncStorage.getItem("@worship_team_users_directory");
          if (storedUsers) {
            setUsers(Object.values(JSON.parse(storedUsers)));
          } else {
            setUsers([
              { uid: "demo-leader-111", displayName: "Pastor Alex", role: "worship_leader", phone: "+919876543210" },
              { uid: "demo-musician-222", displayName: "Sarah (Guitarist)", role: "musician", phone: "+919876543211" },
              { uid: "demo-choir-333", displayName: "David (Tenor Lead)", role: "choir_member", phone: "+919876543212" },
              { uid: "demo-member-444", displayName: "Sister Grace", role: "member", phone: "+919876543213" },
            ]);
          }

          const storedRosters = await AsyncStorage.getItem("@worship_team_rosters_db");
          if (storedRosters) {
            setRosters(JSON.parse(storedRosters));
          }
        } else {
          // Fetch users list
          const usersSnap = await getDocs(collection(db, "users"));
          const usersList = [];
          usersSnap.forEach((d) => {
            usersList.push({ uid: d.id, ...d.data() });
          });
          setUsers(usersList);

          // Fetch rosters list
          const rostersSnap = await getDocs(collection(db, "rosters"));
          const rostersList = [];
          rostersSnap.forEach((d) => {
            rostersList.push({ rosterId: d.id, ...d.data() });
          });
          setRosters(rostersList);
        }
      } catch (err) {
        console.error("Load auxiliary directory data failed:", err);
      }
    }

    loadTasks();
    loadAuxiliaryData();

    return () => {
      if (unsubscribeMy) unsubscribeMy();
      if (unsubscribeDelegated) unsubscribeDelegated();
    };
  }, []);

  const getMockTasks = () => {
    return [
      {
        taskId: "task-1",
        title: "🎸 Prep Chord Sheets & Capo positions",
        description: "Verify transposition of 'Amazing Grace' chords to E Major. Share cues with keys player.",
        assignedTo: "demo-musician-222",
        assignedToName: "Sarah (Guitarist)",
        assignedBy: "demo-leader-111",
        assignedByName: "Pastor Alex",
        relatedRosterId: "mock-roster-1",
        relatedSongId: "mock-song-2",
        dueDate: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        priority: "high",
        status: "pending",
        createdAt: new Date().toISOString(),
      },
      {
        taskId: "task-2",
        title: "🎤 Vocal Parts Rehearsal Check",
        description: "Arrange harmony vocal charts for Alto and Tenors on Resurrection Celebration songs.",
        assignedTo: "demo-choir-333",
        assignedToName: "David (Tenor Lead)",
        assignedBy: "demo-leader-111",
        assignedByName: "Pastor Alex",
        relatedRosterId: "mock-roster-1",
        relatedSongId: "mock-song-1",
        dueDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // Overdue
        priority: "medium",
        status: "in_progress",
        createdAt: new Date().toISOString(),
      },
    ];
  };

  const handleCreateTask = async () => {
    if (!taskTitle.trim() || !taskDesc.trim() || selectedAssignees.length === 0 || !taskDueDate.trim()) {
      Alert.alert("Missing Fields", "Please complete all mandatory fields: Assignee, Title, Description, and Due Date.");
      return;
    }

    setIsSavingTask(true);
    const newTask = {
      title: taskTitle.trim(),
      description: taskDesc.trim(),
      assignedTo: selectedAssignees.map(u => u.uid), // Array of uids
      assignedToNames: selectedAssignees.map(u => u.displayName), // Array of display names
      assignedToName: selectedAssignees.map(u => u.displayName).join(", "), // Comma-separated names for quick rendering
      assignedBy: uid,
      assignedByName: displayName,
      relatedRosterId: selectedRosterLink ? selectedRosterLink.rosterId : null,
      relatedSongId: selectedSongLink ? selectedSongLink.songId : null,
      dueDate: taskDueDate.trim(),
      priority: taskPriority,
      status: "pending",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      let finalTaskId;
      if (USE_DEMO_MODE) {
        const stored = await AsyncStorage.getItem(TASKS_DB_KEY);
        const parsed = stored ? JSON.parse(stored) : [];
        newTask.taskId = "mock-task-" + Math.floor(Math.random() * 100000);
        finalTaskId = newTask.taskId;
        const updatedList = [newTask, ...parsed];
        await AsyncStorage.setItem(TASKS_DB_KEY, JSON.stringify(updatedList));

        // Update local views
        setMyTasks(updatedList.filter(t => Array.isArray(t.assignedTo) ? t.assignedTo.includes(uid) : t.assignedTo === uid));
        setDelegatedTasks(updatedList.filter(t => t.assignedBy === uid));
      } else {
        const addedDocRef = await addDoc(collection(db, "tasks"), newTask);
        finalTaskId = addedDocRef.id;
      }

      // 💬 Fire automatic WhatsApp Notification for each assignee
      const waMsg = `✅ *New Task Assigned* — *${displayName}* has assigned you a task: *${newTask.title}*.\nDescription: ${newTask.description}\nDue: ${newTask.dueDate}\n\n🔗 *Open App to Accept*: https://worshipteamapp-c84e2.web.app`;
      
      for (const assignee of selectedAssignees) {
        console.log(`Triggering WhatsApp dispatch for newly assigned task to ${assignee.displayName} (${assignee.phone || "No phone"})`);
        try {
          await sendWhatsApp(assignee.phone || "", waMsg, "task_assigned");
        } catch (waErr) {
          console.warn(`WhatsApp notification failed for ${assignee.displayName}:`, waErr);
        }
      }

      // Send push notifications to assigned users
      try {
        const assignUids = selectedAssignees.map(u => u.uid);
        if (assignUids.length > 0) {
          await sendPushNotificationToUsers(
            assignUids,
            "📋 New Task Assigned",
            `${displayName} assigned you a task: "${taskTitle}"`,
            { taskId: finalTaskId }
          );
        }
      } catch (pushErr) {
        console.warn("Failed to dispatch task assigned push notifications:", pushErr);
      }

      Alert.alert(
        "Success 🎉", 
        `Task successfully delegated to ${selectedAssignees.map(u => u.displayName).join(", ")}. WhatsApp notifications dispatched!`
      );
      
      // Reset Create Form
      setTaskTitle("");
      setTaskDesc("");
      setSelectedAssignees([]);
      setTaskPriority("medium");
      setSelectedRosterLink(null);
      setSelectedSongLink(null);
      setTaskDueDate("");
      setCreateModalVisible(false);
    } catch (err) {
      console.error("Save task failed:", err);
      Alert.alert("Error", "Could not delegate task: " + err.message);
    } finally {
      setIsSavingTask(false);
    }
  };

  const handleUpdateStatus = async (taskId, newStatus, currentNote = "") => {
    try {
      if (USE_DEMO_MODE) {
        const stored = await AsyncStorage.getItem(TASKS_DB_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          const updated = parsed.map((t) => {
            if (t.taskId === taskId) {
              const u = { ...t, status: newStatus, updatedAt: new Date().toISOString() };
              if (currentNote.trim()) u.completionNote = currentNote.trim();
              return u;
            }
            return t;
          });
          await AsyncStorage.setItem(TASKS_DB_KEY, JSON.stringify(updated));

          // Reload local state
          setMyTasks(updated.filter(t => t.assignedTo === uid));
          setDelegatedTasks(updated.filter(t => t.assignedBy === uid));
          
          if (selectedTask && selectedTask.taskId === taskId) {
            setSelectedTask(updated.find(t => t.taskId === taskId));
          }
        }
      } else {
        const docRef = doc(db, "tasks", taskId);
        const updates = {
          status: newStatus,
          updatedAt: new Date().toISOString(),
        };
        if (currentNote.trim()) {
          updates.completionNote = currentNote.trim();
        }
        await updateDoc(docRef, updates);

        if (selectedTask && selectedTask.taskId === taskId) {
          setSelectedTask({
            ...selectedTask,
            ...updates,
          });
        }
      }

      // Log success and raise simple alert
      Alert.alert("Status Updated 📈", `Task status is now "${newStatus.replace('_', ' ').toUpperCase()}"!`);

      // Send push notification to task creator
      const creatorUid = selectedTask?.assignedBy;
      if (creatorUid && creatorUid !== uid) {
        try {
          await sendPushNotificationToUsers(
            [creatorUid],
            "📋 Task Status Updated",
            `${displayName} marked task "${selectedTask.title}" as ${newStatus.replace('_', ' ').toUpperCase()}`,
            { taskId }
          );
        } catch (pushErr) {
          console.warn("Failed to dispatch task update push notification:", pushErr);
        }
      }

      setShowCompletionPrompt(false);
      setCompletionNote("");
    } catch (err) {
      console.error("Status update error:", err);
      Alert.alert("Error", "Could not update task status: " + err.message);
    }
  };

  const handleCancelTask = async (taskId) => {
    Alert.alert(
      "Cancel Task?",
      "Are you sure you want to cancel this delegated task? This action cannot be undone.",
      [
        { text: "Keep Active", style: "cancel" },
        {
          text: "Yes, Cancel",
          style: "destructive",
          onPress: async () => {
            await handleUpdateStatus(taskId, "cancelled");
            setDetailModalVisible(false);
          }
        }
      ]
    );
  };

  const handleDeleteTask = async (taskId) => {
    Alert.alert(
      "Delete Task?",
      "Are you sure you want to permanently delete this task? This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              if (USE_DEMO_MODE) {
                const stored = await AsyncStorage.getItem(TASKS_DB_KEY);
                if (stored) {
                  const parsed = JSON.parse(stored);
                  const updated = parsed.filter((t) => t.taskId !== taskId);
                  await AsyncStorage.setItem(TASKS_DB_KEY, JSON.stringify(updated));

                  setMyTasks(updated.filter(t => Array.isArray(t.assignedTo) ? t.assignedTo.includes(uid) : t.assignedTo === uid));
                  setDelegatedTasks(updated.filter(t => t.assignedBy === uid));
                }
              } else {
                await deleteDoc(doc(db, "tasks", taskId));
              }
              setDetailModalVisible(false);
              setSelectedTask(null);
              Alert.alert("Success", "Task permanently deleted.");
            } catch (err) {
              console.error("Delete task error:", err);
              Alert.alert("Error", "Could not delete task: " + err.message);
            }
          }
        }
      ]
    );
  };

  const getFilteredTasksList = () => {
    const listToFilter = activeTab === "my_tasks" ? myTasks : delegatedTasks;
    return listToFilter.filter((t) => t.status === statusFilter);
  };

  const isOverdue = (dueDate, status) => {
    if (status === "completed" || status === "cancelled") return false;
    const now = new Date().toISOString().split("T")[0];
    return dueDate < now;
  };

  // Select item pickers triggers
  const triggerPicker = (type) => {
    setPickerType(type);
    setPickerModalVisible(true);
  };

  const getPickerData = () => {
    if (pickerType === "user") return users;
    if (pickerType === "roster") return rosters;
    if (pickerType === "song") return songs;
    return [];
  };

  const handlePickerSelect = (item) => {
    if (pickerType === "user") {
      setSelectedAssignees((prev) => {
        const exists = prev.some((u) => u.uid === item.uid);
        if (exists) {
          return prev.filter((u) => u.uid !== item.uid);
        } else {
          return [...prev, item];
        }
      });
    } else {
      if (pickerType === "roster") setSelectedRosterLink(item);
      if (pickerType === "song") setSelectedSongLink(item);
      setPickerModalVisible(false);
    }
  };

  const getDaysInMonth = (year, month) => {
    return new Date(year, month + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (year, month) => {
    return new Date(year, month, 1).getDay();
  };

  const handleDateSelect = (day) => {
    const year = currentCalendarMonth.getFullYear();
    const month = String(currentCalendarMonth.getMonth() + 1).padStart(2, "0");
    const formattedDay = String(day).padStart(2, "0");
    setTaskDueDate(`${year}-${month}-${formattedDay}`);
    setDatePickerVisible(false);
  };

  const navigateMonth = (direction) => {
    const nextMonth = new Date(currentCalendarMonth);
    nextMonth.setMonth(currentCalendarMonth.getMonth() + direction);
    setCurrentCalendarMonth(nextMonth);
  };

  const renderCalendar = () => {
    const year = currentCalendarMonth.getFullYear();
    const month = currentCalendarMonth.getMonth();
    const daysInMonth = getDaysInMonth(year, month);
    const firstDay = getFirstDayOfMonth(year, month);

    const monthNames = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];

    const weekdays = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

    const cells = [];
    for (let i = 0; i < firstDay; i++) {
      cells.push({ key: `blank-${i}`, type: "blank" });
    }
    for (let day = 1; day <= daysInMonth; day++) {
      cells.push({ key: `day-${day}`, type: "day", value: day });
    }

    return (
      <View style={styles.calendarContainer}>
        <View style={styles.calendarHeaderRow}>
          <TouchableOpacity onPress={() => navigateMonth(-1)} style={styles.arrowBtn}>
            <Text style={styles.arrowBtnText}>◀</Text>
          </TouchableOpacity>
          <Text style={styles.calendarTitle}>{monthNames[month]} {year}</Text>
          <TouchableOpacity onPress={() => navigateMonth(1)} style={styles.arrowBtn}>
            <Text style={styles.arrowBtnText}>▶</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.weekdaysRow}>
          {weekdays.map((w, idx) => (
            <Text key={idx} style={styles.weekdayCell}>{w}</Text>
          ))}
        </View>

        <View style={styles.daysGrid}>
          {cells.map((cell) => {
            if (cell.type === "blank") {
              return <View key={cell.key} style={styles.dayCellEmpty} />;
            }
            
            const isToday =
              new Date().getDate() === cell.value &&
              new Date().getMonth() === month &&
              new Date().getFullYear() === year;

            const selectedFormatted = `${year}-${String(month + 1).padStart(2, "0")}-${String(cell.value).padStart(2, "0")}`;
            const isSelected = taskDueDate === selectedFormatted;

            return (
              <TouchableOpacity
                key={cell.key}
                style={[
                  styles.dayCell,
                  isToday && styles.todayCell,
                  isSelected && styles.selectedDayCell,
                ]}
                onPress={() => handleDateSelect(cell.value)}
              >
                <Text style={[
                  styles.dayCellText,
                  isToday && styles.todayCellText,
                  isSelected && styles.selectedDayCellText
                ]}>
                  {cell.value}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  };

  const renderTaskCard = (task) => {
    const isTaskOverdue = isOverdue(task.dueDate, task.status);
    const pStyle = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.medium;
    const showAssignInfo = activeTab === "my_tasks"
      ? `By: ${task.assignedByName}`
      : `To: ${task.assignedToName}`;

    return (
      <TouchableOpacity
        key={task.taskId}
        style={[styles.taskCard, isTaskOverdue && styles.overdueBorder]}
        activeOpacity={0.8}
        onPress={() => {
          setSelectedTask(task);
          setDetailModalVisible(true);
        }}
      >
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle} numberOfLines={1}>{task.title}</Text>
          <View style={[styles.priorityBadge, { backgroundColor: pStyle.bg, borderColor: pStyle.border }]}>
            <Text style={[styles.priorityText, { color: pStyle.color }]}>
              {task.priority.toUpperCase()}
            </Text>
          </View>
        </View>

        <Text style={styles.cardDesc} numberOfLines={2}>{task.description}</Text>

        <View style={styles.cardFooter}>
          <Text style={styles.cardAssignLabel}>{showAssignInfo}</Text>
          <Text style={[styles.cardDateLabel, isTaskOverdue && styles.overdueText]}>
            📅 Due: {task.dueDate} {isTaskOverdue ? "⚠️ OVERDUE" : ""}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* Dynamic Glow Glow Background */}
      <View style={styles.topGlow} />

      {/* Header Bar */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>📋 Tasks Workspace</Text>
        <Text style={styles.headerSubtitle}>
          Delegate preparations and track readiness checklists in real-time.
        </Text>
      </View>

      {/* Tab Nav Controls (Only for worship leaders / admins) */}
      {isLeader && (
        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tabButton, activeTab === "my_tasks" && styles.tabButtonActive]}
            onPress={() => {
              setActiveTab("my_tasks");
              setStatusFilter("pending");
            }}
          >
            <Text style={[styles.tabButtonText, activeTab === "my_tasks" && styles.tabButtonTextActive]}>
              📥 Assigned To Me
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabButton, activeTab === "delegated_tasks" && styles.tabButtonActive]}
            onPress={() => {
              setActiveTab("delegated_tasks");
              setStatusFilter("pending");
            }}
          >
            <Text style={[styles.tabButtonText, activeTab === "delegated_tasks" && styles.tabButtonTextActive]}>
              📤 Delegated Tasks
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Status Segmented Filter Row */}
      <View style={styles.segmentedContainer}>
        {["pending", "in_progress", "completed"].map((status) => {
          const isActive = statusFilter === status;
          let label = "⏳ Pending";
          if (status === "in_progress") label = "⚡ In Progress";
          if (status === "completed") label = "🟢 Completed";

          return (
            <TouchableOpacity
              key={status}
              style={[styles.segmentBtn, isActive && styles.segmentBtnActive]}
              onPress={() => setStatusFilter(status)}
            >
              <Text style={[styles.segmentText, isActive && styles.segmentTextActive]}>
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Task List */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <Image 
            source={require("../assets/logo.png")} 
            style={{ width: 100, height: 100, marginBottom: 20 }} 
            resizeMode="contain"
          />
          <ActivityIndicator size="large" color="#F59E0B" style={{ marginBottom: 16 }} />
          <Text style={styles.loadingText}>Syncing tasks...</Text>
        </View>
      ) : getFilteredTasksList().length === 0 ? (
        <ScrollView contentContainerStyle={styles.emptyContainer}>
          <Text style={styles.emptyEmoji}>📋</Text>
          <Text style={styles.emptyText}>
            No tasks found in this tab.{`\n`}Everything is clean and completed!
          </Text>
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollList}>
          {getFilteredTasksList().map(renderTaskCard)}
        </ScrollView>
      )}

      {/* Floating Plus Button (Worship Leaders only) */}
      {isLeader && (
        <TouchableOpacity
          style={styles.floatingActionButton}
          activeOpacity={0.8}
          onPress={() => setCreateModalVisible(true)}
        >
          <Text style={styles.fabText}>+</Text>
        </TouchableOpacity>
      )}

      {/* 1. TASK DETAIL MODAL */}
      <Modal visible={detailModalVisible} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.detailCard}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalHeaderTitle}>📋 Task Specification</Text>
              <TouchableOpacity onPress={() => {
                setDetailModalVisible(false);
                setShowCompletionPrompt(false);
                setCompletionNote("");
              }}>
                <Text style={styles.closeBtnText}>✕ Close</Text>
              </TouchableOpacity>
            </View>

            {selectedTask && (
              <ScrollView contentContainerStyle={styles.modalScrollBody}>
                {/* Title */}
                <Text style={styles.detailTitle}>{selectedTask.title}</Text>
                
                {/* Priority & Status pills */}
                <View style={styles.modalStatusRow}>
                  <View style={[
                    styles.statusBadge,
                    {
                      backgroundColor:
                        selectedTask.status === "completed" ? "rgba(16, 185, 129, 0.12)" :
                        selectedTask.status === "in_progress" ? "rgba(245, 158, 11, 0.12)" :
                        "rgba(239, 68, 68, 0.12)",
                      borderColor:
                        selectedTask.status === "completed" ? "rgba(16, 185, 129, 0.3)" :
                        selectedTask.status === "in_progress" ? "rgba(245, 158, 11, 0.3)" :
                        "rgba(239, 68, 68, 0.3)"
                    }
                  ]}>
                    <Text style={[
                      styles.statusBadgeText,
                      {
                        color:
                          selectedTask.status === "completed" ? "#10B981" :
                          selectedTask.status === "in_progress" ? "#F59E0B" :
                          "#EF4444"
                      }
                    ]}>
                      {selectedTask.status.replace('_', ' ').toUpperCase()}
                    </Text>
                  </View>

                  <View style={[
                    styles.statusBadge,
                    {
                      backgroundColor: PRIORITY_COLORS[selectedTask.priority].bg,
                      borderColor: PRIORITY_COLORS[selectedTask.priority].border
                    }
                  ]}>
                    <Text style={[styles.statusBadgeText, { color: PRIORITY_COLORS[selectedTask.priority].color }]}>
                      {selectedTask.priority.toUpperCase()} PRIORITY
                    </Text>
                  </View>
                </View>

                {/* Description */}
                <Text style={styles.detailLabel}>Task Description</Text>
                <View style={styles.descCard}>
                  <Text style={styles.detailDesc}>{selectedTask.description}</Text>
                </View>

                {/* Metadata details */}
                <View style={styles.metaLogBox}>
                  <Text style={styles.metaRowText}>👥 **Assigned By**: {selectedTask.assignedByName}</Text>
                  <Text style={styles.metaRowText}>👤 **Assigned To**: {selectedTask.assignedToName}</Text>
                  <Text style={styles.metaRowText}>📅 **Due Date**: {selectedTask.dueDate}</Text>
                  
                  {selectedTask.relatedRosterId && (
                    <TouchableOpacity 
                      style={styles.linkedItemBtn}
                      activeOpacity={0.7}
                      onPress={() => {
                        setDetailModalVisible(false);
                        onJumpToRoster && onJumpToRoster(selectedTask.relatedRosterId);
                      }}
                    >
                      <Text style={styles.linkedItemBtnText}>📅 Linked Roster: View Service Plan ➔</Text>
                    </TouchableOpacity>
                  )}
                  
                  {selectedTask.relatedSongId && (() => {
                    const matchingSong = (songs || []).find(s => s.songId === selectedTask.relatedSongId);
                    return (
                      <TouchableOpacity 
                        style={styles.linkedItemBtn}
                        activeOpacity={0.7}
                        onPress={() => {
                          if (matchingSong) {
                            setDetailModalVisible(false);
                            onJumpToSongDetail && onJumpToSongDetail(matchingSong);
                          } else {
                            Alert.alert("Link Unavailable", "Song details could not be found in active directory.");
                          }
                        }}
                      >
                        <Text style={styles.linkedItemBtnText}>
                          🎵 Linked Song: {matchingSong ? matchingSong.title : "Assigned Song Detail"} ➔
                        </Text>
                      </TouchableOpacity>
                    );
                  })()}
                </View>

                {/* Completion Note */}
                {selectedTask.completionNote && (
                  <View style={[styles.descCard, { borderColor: "#10B981", borderLeftWidth: 4 }]}>
                    <Text style={styles.detailLabel}>Assignee Completion Note</Text>
                    <Text style={styles.completionNoteText}>"{selectedTask.completionNote}"</Text>
                  </View>
                )}

                {/* Action Buttons based on context */}
                {activeTab === "my_tasks" && (selectedTask.status === "pending" || selectedTask.status === "in_progress") && (
                  <View style={{ marginTop: 24 }}>
                    {selectedTask.status === "pending" && (
                      <TouchableOpacity
                        style={[styles.primaryActionBtn, { backgroundColor: "#F59E0B", shadowColor: "#F59E0B" }]}
                        onPress={() => handleUpdateStatus(selectedTask.taskId, "in_progress")}
                      >
                        <Text style={styles.primaryActionBtnText}>⚡ Mark as In Progress</Text>
                      </TouchableOpacity>
                    )}

                    {!showCompletionPrompt ? (
                      <TouchableOpacity
                        style={[styles.primaryActionBtn, { backgroundColor: "#10B981", shadowColor: "#10B981", marginTop: 12 }]}
                        onPress={() => setShowCompletionPrompt(true)}
                      >
                        <Text style={styles.primaryActionBtnText}>✓ Mark as Completed</Text>
                      </TouchableOpacity>
                    ) : (
                      <View style={styles.promptCard}>
                        <Text style={styles.promptTitle}>📝 Add Completion Note (Optional)</Text>
                        <TextInput
                          style={styles.promptInput}
                          placeholder="e.g. Chord charts uploaded and verified..."
                          placeholderTextColor="#475569"
                          value={completionNote}
                          onChangeText={setCompletionNote}
                        />
                        <View style={styles.promptBtnRow}>
                          <TouchableOpacity
                            style={styles.promptCancelBtn}
                            onPress={() => {
                              setShowCompletionPrompt(false);
                              setCompletionNote("");
                            }}
                          >
                            <Text style={styles.promptCancelText}>Cancel</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.promptSubmitBtn}
                            onPress={() => handleUpdateStatus(selectedTask.taskId, "completed", completionNote)}
                          >
                            <Text style={styles.promptSubmitText}>Submit Done</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    )}
                  </View>
                )}

                {/* Cancel Action for creator */}
                {activeTab === "delegated_tasks" && selectedTask.status !== "completed" && selectedTask.status !== "cancelled" && (
                  <TouchableOpacity
                    style={[styles.primaryActionBtn, { backgroundColor: "#EF4444", shadowColor: "#EF4444", marginTop: 24 }]}
                    onPress={() => handleCancelTask(selectedTask.taskId)}
                  >
                    <Text style={styles.primaryActionBtnText}>✕ Cancel Delegated Task</Text>
                  </TouchableOpacity>
                )}

                {/* Permanent Delete Action for Super Admin */}
                {role === "super_admin" && (
                  <TouchableOpacity
                    style={[styles.primaryActionBtn, { backgroundColor: "#EF4444", shadowColor: "#EF4444", marginTop: 12 }]}
                    onPress={() => handleDeleteTask(selectedTask.taskId)}
                  >
                    <Text style={styles.primaryActionBtnText}>🗑️ Permanent Delete Task</Text>
                  </TouchableOpacity>
                )}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* 2. CREATE TASK MODAL */}
      <Modal visible={createModalVisible} animationType="slide" transparent={true}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.createCard}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalHeaderTitle}>✍️ Delegate Ministry Task</Text>
              <TouchableOpacity onPress={() => setCreateModalVisible(false)}>
                <Text style={styles.closeBtnText}>Cancel</Text>
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.createFormScroll}>
              {/* Assignee selection dropdown trigger */}
              <Text style={styles.formLabel}>Assignees *</Text>
              <TouchableOpacity style={styles.formSelector} onPress={() => triggerPicker("user")}>
                <Text style={styles.formSelectorText} numberOfLines={1}>
                  {selectedAssignees.length > 0 
                    ? `👤 ${selectedAssignees.map(u => u.displayName).join(", ")}` 
                    : "Choose Team Members (Multiple)..."}
                </Text>
              </TouchableOpacity>

              {/* Title input */}
              <Text style={styles.formLabel}>Task Title *</Text>
              <TextInput
                style={styles.formInput}
                placeholder="e.g. Transpose chords / Prep vocal chart"
                placeholderTextColor="#475569"
                value={taskTitle}
                onChangeText={setTaskTitle}
              />

              {/* Description input */}
              <Text style={styles.formLabel}>Description *</Text>
              <TextInput
                style={[styles.formInput, { height: 80, textAlignVertical: "top", paddingTop: 12 }]}
                placeholder="Describe details, steps, or resources needed..."
                placeholderTextColor="#475569"
                multiline
                numberOfLines={3}
                value={taskDesc}
                onChangeText={setTaskDesc}
              />

              {/* Due Date input */}
              <Text style={styles.formLabel}>Due Date *</Text>
              <TouchableOpacity
                style={styles.formSelector}
                onPress={() => setDatePickerVisible(true)}
              >
                <Text style={styles.formSelectorText}>
                  {taskDueDate ? `📅 Due: ${taskDueDate}` : "Select Due Date..."}
                </Text>
              </TouchableOpacity>

              {/* Priority Chips */}
              <Text style={styles.formLabel}>Priority Level</Text>
              <View style={styles.priorityChipsRow}>
                {["low", "medium", "high"].map((p) => {
                  const isActive = taskPriority === p;
                  let color = "#64748B";
                  if (p === "low") color = "#10B981";
                  if (p === "medium") color = "#F59E0B";
                  if (p === "high") color = "#EF4444";

                  return (
                    <TouchableOpacity
                      key={p}
                      style={[
                        styles.priorityChipBtn,
                        isActive && { backgroundColor: color, borderColor: color }
                      ]}
                      onPress={() => setTaskPriority(p)}
                    >
                      <Text style={[styles.priorityChipText, isActive && { color: "#0B0F19" }]}>
                        {p.toUpperCase()}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Link Roster (Optional) */}
              <Text style={styles.formLabel}>Link to Service Roster (Optional)</Text>
              <TouchableOpacity style={styles.formSelector} onPress={() => triggerPicker("roster")}>
                <Text style={styles.formSelectorText}>
                  {selectedRosterLink ? `📅 ${selectedRosterLink.eventName}` : "Select Roster..."}
                </Text>
              </TouchableOpacity>

              {/* Link Song (Optional) */}
              <Text style={styles.formLabel}>Link to Song Profile (Optional)</Text>
              <TouchableOpacity style={styles.formSelector} onPress={() => triggerPicker("song")}>
                <Text style={styles.formSelectorText}>
                  {selectedSongLink ? `🎵 ${selectedSongLink.title}` : "Select Song..."}
                </Text>
              </TouchableOpacity>

              {/* Submit */}
              <TouchableOpacity
                style={[styles.submitBtn, isSavingTask && { opacity: 0.6 }]}
                activeOpacity={0.8}
                onPress={handleCreateTask}
                disabled={isSavingTask}
              >
                {isSavingTask ? (
                  <ActivityIndicator size="small" color="#0B0F19" />
                ) : (
                  <Text style={styles.submitBtnText}>✓ Delegate Task</Text>
                )}
              </TouchableOpacity>

              <View style={{ height: 40 }} />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* 3. DROPDOWN SEARCH PICKER MODAL */}
      <Modal visible={pickerModalVisible} animationType="fade" transparent={true}>
        <View style={styles.pickerOverlay}>
          <View style={styles.pickerWindow}>
            <View style={styles.pickerHeaderRow}>
              <Text style={styles.pickerHeaderTitle}>
                {pickerType === "user" ? "Assign Team Members" : `Select ${pickerType ? pickerType.toUpperCase() : ""}`}
              </Text>
              <TouchableOpacity onPress={() => setPickerModalVisible(false)}>
                <Text style={styles.pickerCloseText}>Cancel</Text>
              </TouchableOpacity>
            </View>

            <FlatList
              data={getPickerData()}
              keyExtractor={(item) => item.uid || item.rosterId || item.songId || String(Math.random())}
              renderItem={({ item }) => {
                let title = "";
                let sub = "";
                let isSel = false;

                if (pickerType === "user") {
                  title = item.displayName;
                  sub = item.role.replace('_', ' ').toUpperCase();
                  isSel = selectedAssignees.some(u => u.uid === item.uid);
                } else if (pickerType === "roster") {
                  title = item.eventName;
                  sub = `${item.eventDate} (${item.eventType})`;
                } else if (pickerType === "song") {
                  title = item.title;
                  sub = `Artist: ${item.artist || "Unknown"}`;
                }

                return (
                  <TouchableOpacity
                    style={[
                      styles.pickerRow,
                      isSel && { 
                        backgroundColor: "rgba(245, 158, 11, 0.08)", 
                        borderLeftWidth: 3, 
                        borderLeftColor: "#F59E0B" 
                      }
                    ]}
                    onPress={() => handlePickerSelect(item)}
                    activeOpacity={0.7}
                  >
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.pickerRowTitle, isSel && { color: "#F59E0B" }]}>{title}</Text>
                        <Text style={styles.pickerRowSub}>{sub}</Text>
                      </View>
                      {pickerType === "user" && (
                        <View style={{
                          width: 20,
                          height: 20,
                          borderRadius: 4,
                          borderWidth: 1.5,
                          borderColor: isSel ? "#F59E0B" : "#475569",
                          backgroundColor: isSel ? "#F59E0B" : "transparent",
                          alignItems: "center",
                          justifyContent: "center"
                        }}>
                          {isSel && <Text style={{ color: "#0B0F19", fontSize: 11, fontWeight: "900" }}>✓</Text>}
                        </View>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              }}
            />

            {pickerType === "user" && (
              <TouchableOpacity
                style={[styles.primaryActionBtn, { backgroundColor: "#F59E0B", shadowColor: "#F59E0B", margin: 16, marginTop: 8 }]}
                onPress={() => setPickerModalVisible(false)}
                activeOpacity={0.8}
              >
                <Text style={styles.primaryActionBtnText}>✓ Confirm Selection ({selectedAssignees.length})</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>

      {/* 4. DATE PICKER POPUP MODAL */}
      <Modal visible={datePickerVisible} animationType="fade" transparent={true}>
        <View style={styles.pickerOverlay}>
          <View style={[styles.pickerWindow, { maxHeight: "80%" }]}>
            <View style={styles.pickerHeaderRow}>
              <Text style={styles.pickerHeaderTitle}>📅 Select Due Date</Text>
              <TouchableOpacity onPress={() => setDatePickerVisible(false)}>
                <Text style={styles.pickerCloseText}>Cancel</Text>
              </TouchableOpacity>
            </View>

            {renderCalendar()}
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
    paddingBottom: 76,
  },
  topGlow: {
    position: "absolute",
    top: -120,
    alignSelf: "center",
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: "rgba(245, 158, 11, 0.08)",
    shadowColor: "#F59E0B",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 100,
  },
  header: {
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: "900",
    color: "#FFFFFF",
  },
  headerSubtitle: {
    fontSize: 13,
    color: "#94A3B8",
    marginTop: 6,
    lineHeight: 18,
  },
  tabContainer: {
    flexDirection: "row",
    backgroundColor: "#1E293B",
    borderRadius: 14,
    marginHorizontal: 20,
    padding: 4,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#334155",
  },
  tabButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  tabButtonActive: {
    backgroundColor: "#0B0F19",
  },
  tabButtonText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#64748B",
  },
  tabButtonTextActive: {
    color: "#FFFFFF",
    fontWeight: "800",
  },
  segmentedContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginHorizontal: 20,
    marginBottom: 16,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderBottomWidth: 2,
    borderColor: "transparent",
  },
  segmentBtnActive: {
    borderColor: "#F59E0B",
  },
  segmentText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#64748B",
  },
  segmentTextActive: {
    color: "#F59E0B",
    fontWeight: "800",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    color: "#94A3B8",
    marginTop: 12,
    fontSize: 14,
  },
  emptyContainer: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 40,
    paddingVertical: 80,
  },
  emptyEmoji: {
    fontSize: 48,
    opacity: 0.3,
  },
  emptyText: {
    color: "#64748B",
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    marginTop: 16,
  },
  scrollList: {
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  taskCard: {
    backgroundColor: "#1E293B",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#334155",
    padding: 16,
    marginBottom: 14,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 3,
  },
  overdueBorder: {
    borderColor: "#EF4444",
    borderWidth: 1.5,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: "#FFFFFF",
    flex: 1,
    marginRight: 10,
  },
  priorityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
  },
  priorityText: {
    fontSize: 9,
    fontWeight: "800",
  },
  cardDesc: {
    fontSize: 13,
    color: "#94A3B8",
    lineHeight: 18,
    marginBottom: 14,
  },
  cardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: "rgba(51, 65, 85, 0.3)",
    paddingTop: 10,
  },
  cardAssignLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#64748B",
  },
  cardDateLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#94A3B8",
  },
  overdueText: {
    color: "#EF4444",
  },
  floatingActionButton: {
    position: "absolute",
    bottom: 96,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#F59E0B",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#F59E0B",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
  },
  fabText: {
    fontSize: 28,
    color: "#0B0F19",
    fontWeight: "700",
    marginTop: -2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(11, 15, 25, 0.85)",
    justifyContent: "flex-end",
  },
  detailCard: {
    backgroundColor: "#1E293B",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 24,
    paddingHorizontal: 24,
    maxHeight: "85%",
    borderWidth: 1,
    borderColor: "#334155",
  },
  modalHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#334155",
    paddingBottom: 16,
    marginBottom: 16,
  },
  modalHeaderTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: "#FFFFFF",
  },
  closeBtnText: {
    fontSize: 14,
    color: "#64748B",
    fontWeight: "700",
  },
  modalScrollBody: {
    paddingBottom: 40,
  },
  detailTitle: {
    fontSize: 20,
    fontWeight: "900",
    color: "#FFFFFF",
    marginBottom: 12,
  },
  modalStatusRow: {
    flexDirection: "row",
    marginBottom: 20,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: 1,
    marginRight: 10,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: "900",
  },
  detailLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#64748B",
    marginBottom: 8,
    textTransform: "uppercase",
  },
  descCard: {
    backgroundColor: "#0B0F19",
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "#334155",
    marginBottom: 20,
  },
  detailDesc: {
    fontSize: 14,
    color: "#E2E8F0",
    lineHeight: 22,
  },
  metaLogBox: {
    backgroundColor: "#0B0F19",
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "#334155",
    marginBottom: 20,
  },
  metaRowText: {
    color: "#94A3B8",
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 6,
  },
  completionNoteText: {
    color: "#34D399",
    fontSize: 13,
    fontStyle: "italic",
    lineHeight: 20,
  },
  primaryActionBtn: {
    height: 52,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryActionBtnText: {
    color: "#0B0F19",
    fontSize: 15,
    fontWeight: "800",
  },
  promptCard: {
    backgroundColor: "#0B0F19",
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "#334155",
  },
  promptTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#FFFFFF",
    marginBottom: 10,
  },
  promptInput: {
    backgroundColor: "#1E293B",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#334155",
    height: 48,
    paddingHorizontal: 12,
    color: "#FFFFFF",
    fontSize: 14,
    marginBottom: 14,
  },
  promptBtnRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  promptCancelBtn: {
    flex: 1,
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#334155",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 8,
  },
  promptCancelText: {
    color: "#94A3B8",
    fontSize: 13,
    fontWeight: "700",
  },
  promptSubmitBtn: {
    flex: 2,
    height: 40,
    borderRadius: 8,
    backgroundColor: "#10B981",
    justifyContent: "center",
    alignItems: "center",
  },
  promptSubmitText: {
    color: "#0B0F19",
    fontSize: 13,
    fontWeight: "800",
  },
  createCard: {
    backgroundColor: "#1E293B",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 24,
    paddingHorizontal: 24,
    height: "90%",
    borderWidth: 1,
    borderColor: "#334155",
  },
  createFormScroll: {
    paddingBottom: 40,
  },
  formLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#94A3B8",
    marginBottom: 8,
    marginLeft: 2,
  },
  formInput: {
    backgroundColor: "#0B0F19",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#334155",
    height: 52,
    paddingHorizontal: 16,
    color: "#FFFFFF",
    fontSize: 15,
    marginBottom: 16,
  },
  formSelector: {
    backgroundColor: "#0B0F19",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#334155",
    height: 52,
    paddingHorizontal: 16,
    justifyContent: "center",
    marginBottom: 16,
  },
  formSelectorText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "600",
  },
  priorityChipsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  priorityChipBtn: {
    flex: 1,
    height: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#334155",
    justifyContent: "center",
    alignItems: "center",
    marginHorizontal: 4,
  },
  priorityChipText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#64748B",
  },
  submitBtn: {
    backgroundColor: "#F59E0B",
    height: 54,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 10,
    shadowColor: "#F59E0B",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 4,
  },
  submitBtnText: {
    color: "#0B0F19",
    fontSize: 16,
    fontWeight: "800",
  },
  pickerOverlay: {
    flex: 1,
    backgroundColor: "rgba(11, 15, 25, 0.8)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  pickerWindow: {
    width: "100%",
    maxHeight: "70%",
    backgroundColor: "#1E293B",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#334155",
    padding: 20,
  },
  pickerHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#334155",
    paddingBottom: 12,
    marginBottom: 14,
  },
  pickerHeaderTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: "#FFFFFF",
  },
  pickerCloseText: {
    fontSize: 14,
    color: "#F59E0B",
    fontWeight: "700",
  },
  pickerRow: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(51, 65, 85, 0.3)",
  },
  pickerRowTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#FFFFFF",
    marginBottom: 4,
  },
  pickerRowSub: {
    fontSize: 11,
    color: "#64748B",
    fontWeight: "600",
  },
  calendarContainer: {
    backgroundColor: "#0B0F19",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#334155",
    padding: 16,
    marginBottom: 20,
    width: "100%",
  },
  calendarHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  arrowBtn: {
    padding: 10,
    backgroundColor: "#1E293B",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#334155",
  },
  arrowBtnText: {
    color: "#F59E0B",
    fontSize: 12,
    fontWeight: "700",
  },
  calendarTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  weekdaysRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(51, 65, 85, 0.2)",
    paddingBottom: 6,
  },
  weekdayCell: {
    width: "14%",
    textAlign: "center",
    color: "#64748B",
    fontSize: 11,
    fontWeight: "700",
  },
  daysGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  dayCell: {
    width: "14%",
    height: 38,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 4,
    borderRadius: 8,
  },
  dayCellEmpty: {
    width: "14%",
    height: 38,
    marginBottom: 4,
  },
  dayCellText: {
    color: "#E2E8F0",
    fontSize: 13,
    fontWeight: "600",
  },
  todayCell: {
    borderWidth: 1,
    borderColor: "#F59E0B",
  },
  todayCellText: {
    color: "#F59E0B",
    fontWeight: "800",
  },
  selectedDayCell: {
    backgroundColor: "#F59E0B",
  },
  selectedDayCellText: {
    color: "#0B0F19",
    fontWeight: "800",
  },
  linkedItemBtn: {
    backgroundColor: "rgba(245, 158, 11, 0.08)",
    borderWidth: 1.5,
    borderColor: "rgba(245, 158, 11, 0.25)",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  linkedItemBtnText: {
    color: "#F59E0B",
    fontSize: 13,
    fontWeight: "800",
  },
});
