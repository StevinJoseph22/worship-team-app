import React from "react";
import { StyleSheet, Text, View, TouchableOpacity, ScrollView, Dimensions, Platform, Modal, TextInput, Alert, ActivityIndicator, Image, Switch } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { USE_DEMO_MODE, db, auth } from "../firebaseConfig";
import { doc, getDoc, updateDoc, setDoc } from "firebase/firestore";
import { updatePassword } from "firebase/auth";
import { sendLocalNotification, sendPushNotificationToUsers } from "../services/notificationService";
import * as ImagePicker from "expo-image-picker";

const { width } = Dimensions.get("window");

export default function ProfileScreen({ user, onLogout, onUpdateUser }) {
  const { displayName, role, phone } = user;

  const [notificationsEnabled, setNotificationsEnabled] = React.useState(true);
  const [pushToken, setPushToken] = React.useState("");
  const [savingSettings, setSavingSettings] = React.useState(false);

  // Edit Name states
  const [editModalVisible, setEditModalVisible] = React.useState(false);
  const [newName, setNewName] = React.useState(displayName || "");
  const [savingName, setSavingName] = React.useState(false);

  // Edit Password states
  const [passModalVisible, setPassModalVisible] = React.useState(false);
  const [newPass, setNewPass] = React.useState("");
  const [confirmPass, setConfirmPass] = React.useState("");
  const [savingPass, setSavingPass] = React.useState(false);

  // AI Toggle states
  const [enableAiDetection, setEnableAiDetection] = React.useState(true);
  const [loadingAiToggle, setLoadingAiToggle] = React.useState(false);

  React.useEffect(() => {
    setNewName(user.displayName || "");
  }, [user.displayName]);

  const handleSelectProfilePhoto = async () => {
    Alert.alert(
      "Update Profile Picture 📷",
      "Would you like to take a new photo with your camera or select an existing photo from your library?",
      [
        {
          text: "📷 Camera",
          onPress: () => launchImagePicker(true),
        },
        {
          text: "🖼️ Library",
          onPress: () => launchImagePicker(false),
        },
        {
          text: "Cancel",
          style: "cancel",
        },
      ]
    );
  };

  const launchImagePicker = async (useCamera) => {
    try {
      let permissionResult;
      if (useCamera) {
        permissionResult = await ImagePicker.requestCameraPermissionsAsync();
      } else {
        permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      }

      if (!permissionResult.granted) {
        Alert.alert(
          "Permission Denied",
          `We need access to your ${useCamera ? "camera" : "media library"} to update your profile photo!`
        );
        return;
      }

      let result;
      const options = {
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.4,
        base64: true,
      };

      if (useCamera) {
        result = await ImagePicker.launchCameraAsync(options);
      } else {
        result = await ImagePicker.launchImageLibraryAsync(options);
      }

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const base64Data = result.assets[0].base64;
      if (!base64Data) {
        throw new Error("Could not read image data.");
      }

      // Update locally and in database
      const updatedUser = {
        ...user,
        photoBase64: base64Data,
      };

      if (USE_DEMO_MODE) {
        await AsyncStorage.setItem("@worship_team_session", JSON.stringify(updatedUser));

        const storedUsers = await AsyncStorage.getItem("@worship_team_users");
        if (storedUsers) {
          const users = JSON.parse(storedUsers);
          if (users[user.uid]) {
            users[user.uid].photoBase64 = base64Data;
            await AsyncStorage.setItem("@worship_team_users", JSON.stringify(users));
          }
        }

        const storedDir = await AsyncStorage.getItem("@worship_team_users_directory");
        if (storedDir) {
          const dir = JSON.parse(storedDir);
          if (dir[user.uid]) {
            dir[user.uid].photoBase64 = base64Data;
            await AsyncStorage.setItem("@worship_team_users_directory", JSON.stringify(dir));
          }
        }
      } else {
        const userDocRef = doc(db, "users", user.uid);
        await updateDoc(userDocRef, {
          photoBase64: base64Data,
        });
        await AsyncStorage.setItem("@worship_team_session", JSON.stringify(updatedUser));
      }

      if (onUpdateUser) {
        onUpdateUser(updatedUser);
      }

      Alert.alert("Success", "Profile photo updated successfully!");
    } catch (err) {
      console.error("Failed to select/save profile photo:", err);
      Alert.alert("Error", "Failed to update profile photo: " + err.message);
    }
  };

  const handleSaveName = async () => {
    if (!newName.trim()) {
      Alert.alert("Error", "Name cannot be empty.");
      return;
    }
    setSavingName(true);
    try {
      const updatedUser = {
        ...user,
        displayName: newName.trim(),
      };

      if (USE_DEMO_MODE) {
        // 1. Update session
        await AsyncStorage.setItem("@worship_team_session", JSON.stringify(updatedUser));

        // 2. Update users list if present
        const storedUsers = await AsyncStorage.getItem("@worship_team_users");
        if (storedUsers) {
          const users = JSON.parse(storedUsers);
          if (users[user.uid]) {
            users[user.uid].displayName = newName.trim();
            await AsyncStorage.setItem("@worship_team_users", JSON.stringify(users));
          }
        }
        
        // Also update users directory
        const storedDir = await AsyncStorage.getItem("@worship_team_users_directory");
        if (storedDir) {
          const dir = JSON.parse(storedDir);
          if (dir[user.uid]) {
            dir[user.uid].displayName = newName.trim();
            await AsyncStorage.setItem("@worship_team_users_directory", JSON.stringify(dir));
          }
        }
      } else {
        // Update in Firestore
        const userDocRef = doc(db, "users", user.uid);
        await updateDoc(userDocRef, {
          displayName: newName.trim(),
        });

        // Update session
        await AsyncStorage.setItem("@worship_team_session", JSON.stringify(updatedUser));
      }

      if (onUpdateUser) {
        onUpdateUser(updatedUser);
      }

      setEditModalVisible(false);
      Alert.alert("Success", "Name updated successfully!");
    } catch (err) {
      console.error("Failed to update name:", err);
      Alert.alert("Error", "Failed to update name: " + err.message);
    } finally {
      setSavingName(false);
    }
  };

  const handleSavePassword = async () => {
    if (!newPass) {
      Alert.alert("Error", "Password cannot be empty.");
      return;
    }
    if (newPass.length < 6) {
      Alert.alert("Error", "Password must be at least 6 characters.");
      return;
    }
    if (newPass !== confirmPass) {
      Alert.alert("Error", "Passwords do not match.");
      return;
    }

    setSavingPass(true);
    try {
      if (USE_DEMO_MODE) {
        // Update password in demo database
        const storedUsers = await AsyncStorage.getItem("@worship_team_users");
        if (storedUsers) {
          const users = JSON.parse(storedUsers);
          if (users[phone]) {
            users[phone].password = newPass;
            await AsyncStorage.setItem("@worship_team_users", JSON.stringify(users));
          }
        }
        
        // Update session
        const updatedUser = { ...user, password: newPass };
        await AsyncStorage.setItem("@worship_team_session", JSON.stringify(updatedUser));
        if (onUpdateUser) {
          onUpdateUser(updatedUser);
        }
      } else {
        // Real Live Firebase Mode
        if (auth.currentUser) {
          await updatePassword(auth.currentUser, newPass);
        } else {
          throw new Error("No active authenticated Firebase session. Please log in first.");
        }

        const userDocRef = doc(db, "users", user.uid);
        await updateDoc(userDocRef, {
          password: newPass,
        });

        // Update session
        const updatedUser = { ...user, password: newPass };
        await AsyncStorage.setItem("@worship_team_session", JSON.stringify(updatedUser));
        if (onUpdateUser) {
          onUpdateUser(updatedUser);
        }
      }

      setPassModalVisible(false);
      setNewPass("");
      setConfirmPass("");
      Alert.alert("Success", "Password updated successfully!");
    } catch (err) {
      console.error("Failed to update password:", err);
      if (err.code === "auth/requires-recent-login") {
        Alert.alert(
          "Security Re-authentication Required",
          "For security reasons, changing your password requires a recent login. Please log out, log back in, and try again."
        );
      } else {
        Alert.alert("Error", "Failed to update password: " + err.message);
      }
    } finally {
      setSavingPass(false);
    }
  };

  React.useEffect(() => {
    async function loadNotificationSettings() {
      try {
        if (USE_DEMO_MODE) {
          const storedToken = await AsyncStorage.getItem(`@pushToken_${user.uid}`);
          const storedEnabled = await AsyncStorage.getItem(`@notificationsEnabled_${user.uid}`);
          if (storedToken) setPushToken(storedToken);
          if (storedEnabled !== null) {
            setNotificationsEnabled(storedEnabled === "true");
          }
        } else {
          // Read from Firestore under /users/{uid}
          const userDocRef = doc(db, "users", user.uid);
          const docSnap = await getDoc(userDocRef);
          if (docSnap.exists()) {
            const data = docSnap.data();
            if (data.pushToken) setPushToken(data.pushToken);
            if (data.notificationsEnabled !== undefined) {
              setNotificationsEnabled(data.notificationsEnabled);
            }
          }
        }
      } catch (err) {
        console.warn("Failed to load profile notification settings:", err);
      }
    }
    loadNotificationSettings();
  }, [user.uid]);

  React.useEffect(() => {
    async function loadAiDetectionConfig() {
      if (role !== "super_admin") return;
      try {
        if (USE_DEMO_MODE) {
          const stored = await AsyncStorage.getItem("@worship_team_enable_ai_detection");
          if (stored !== null) {
            setEnableAiDetection(stored === "true");
          }
        } else {
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
        }
      } catch (err) {
        console.warn("Failed to load AI detection config:", err);
      }
    }
    loadAiDetectionConfig();
  }, [role]);

  const handleToggleAiDetection = async (value) => {
    setEnableAiDetection(value);
    setLoadingAiToggle(true);
    try {
      if (USE_DEMO_MODE) {
        await AsyncStorage.setItem("@worship_team_enable_ai_detection", value ? "true" : "false");
      } else {
        if (db) {
          const docRef = doc(db, "config", "features");
          await setDoc(docRef, { enableAiDetection: value }, { merge: true });
        }
      }
    } catch (err) {
      console.error("Failed to toggle AI detection config:", err);
      Alert.alert("Error", "Could not save AI toggle setting: " + err.message);
      setEnableAiDetection(!value);
    } finally {
      setLoadingAiToggle(false);
    }
  };

  const handleToggleNotifications = async () => {
    const nextVal = !notificationsEnabled;
    setNotificationsEnabled(nextVal);
    setSavingSettings(true);
    try {
      if (USE_DEMO_MODE) {
        await AsyncStorage.setItem(`@notificationsEnabled_${user.uid}`, nextVal ? "true" : "false");
        
        const storedUsers = await AsyncStorage.getItem("@worship_team_users");
        if (storedUsers) {
          const users = JSON.parse(storedUsers);
          if (users[user.uid]) {
            users[user.uid].notificationsEnabled = nextVal;
            await AsyncStorage.setItem("@worship_team_users", JSON.stringify(users));
          }
        }
      } else {
        const userDocRef = doc(db, "users", user.uid);
        await updateDoc(userDocRef, {
          notificationsEnabled: nextVal,
        });
      }
    } catch (err) {
      console.warn("Failed to update notification settings:", err);
      // Rollback UI state on failure
      setNotificationsEnabled(!nextVal);
    } finally {
      setSavingSettings(false);
    }
  };

  const getRoleConfig = (userRole) => {
    switch (userRole) {
      case "super_admin":
        return {
          primaryColor: "#EF4444", // Crimson
          accentBg: "rgba(239, 68, 68, 0.1)",
          roleLabel: "Super Admin",
          emoji: "👑",
        };
      case "worship_leader":
        return {
          primaryColor: "#F59E0B", // Gold
          accentBg: "rgba(245, 158, 11, 0.1)",
          roleLabel: "Worship Leader",
          emoji: "👑",
        };
      case "musician":
        return {
          primaryColor: "#A855F7", // Purple
          accentBg: "rgba(168, 85, 247, 0.1)",
          roleLabel: "Band Musician",
          emoji: "🎸",
        };
      case "choir_member":
        return {
          primaryColor: "#0D9488", // Teal
          accentBg: "rgba(13, 148, 136, 0.1)",
          roleLabel: "Choir Vocalist",
          emoji: "🎤",
        };
      case "member":
      default:
        return {
          primaryColor: "#3B82F6", // Blue
          accentBg: "rgba(59, 130, 246, 0.1)",
          roleLabel: "Team Member",
          emoji: "⛪",
        };
    }
  };

  const config = getRoleConfig(role);

  return (
    <View style={styles.container}>
      {/* Role-based ambient background glow */}
      <View style={[styles.roleGlow, { backgroundColor: config.primaryColor }]} />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.profileHeader}>
          <TouchableOpacity 
            style={[styles.avatar, { borderColor: config.primaryColor }]}
            onPress={handleSelectProfilePhoto}
            activeOpacity={0.8}
          >
            {user.photoBase64 ? (
              <Image 
                source={{ uri: `data:image/jpeg;base64,${user.photoBase64}` }} 
                style={styles.avatarImage} 
              />
            ) : (
              <Text style={styles.avatarText}>
                {displayName ? displayName.substring(0, 2).toUpperCase() : "??"}
              </Text>
            )}
            <View style={[styles.avatarEditOverlay, { backgroundColor: config.primaryColor }]}>
              <Text style={styles.avatarEditOverlayText}>📷</Text>
            </View>
          </TouchableOpacity>
          <Text style={styles.userName}>{displayName}</Text>
          <View style={[styles.roleBadge, { backgroundColor: config.accentBg }]}>
            <Text style={[styles.roleBadgeText, { color: config.primaryColor }]}>
              {config.emoji} {config.roleLabel}
            </Text>
          </View>
        </View>

        <View style={styles.infoCard}>
          <Text style={styles.cardTitle}>Account Details</Text>
          
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Full Name</Text>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Text style={styles.infoValue}>{displayName}</Text>
              <TouchableOpacity
                onPress={() => setEditModalVisible(true)}
                style={{ marginLeft: 8, padding: 4 }}
                activeOpacity={0.7}
              >
                <Text style={{ color: config.primaryColor, fontSize: 16 }}>✏️</Text>
              </TouchableOpacity>
            </View>
          </View>
          
          <View style={styles.divider} />
          
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Verified Mobile</Text>
            <Text style={styles.infoValue}>
              {phone && phone.startsWith("+91") && phone.length === 13
                ? `+91 ${phone.substring(3, 8)}-${phone.substring(8)}`
                : (phone && phone.startsWith("+1") && phone.length === 12
                  ? `+1 (${phone.substring(2, 5)}) ${phone.substring(5, 8)}-${phone.substring(8)}`
                  : (phone && phone.startsWith("+") ? phone : `+${phone}`))}
            </Text>
          </View>
          
          <View style={styles.divider} />
          
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Ministry Role</Text>
            <Text style={[styles.infoValue, { color: config.primaryColor, fontWeight: "800" }]}>
              {config.roleLabel}
            </Text>
          </View>

          <View style={styles.divider} />
          
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Account Security</Text>
            <TouchableOpacity
              onPress={() => setPassModalVisible(true)}
              style={[styles.changePassBtn, { borderColor: config.primaryColor + "40" }]}
              activeOpacity={0.7}
            >
              <Text style={[styles.changePassBtnText, { color: config.primaryColor }]}>🔑 Change Password</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.settingsCard}>
          <Text style={styles.cardTitle}>Preferences</Text>
          
          <View style={styles.preferenceRow}>
            <Text style={styles.preferenceLabel}>Enable Notifications</Text>
            <View style={[styles.mockSwitch, styles.activeSwitch, { borderColor: config.primaryColor + "50" }]}>
              <Text style={[styles.activeSwitchText, { color: config.primaryColor }]}>Always On</Text>
            </View>
          </View>

          <View style={styles.divider} />
          
          <View style={styles.preferenceRow}>
            <Text style={styles.preferenceLabel}>Dark Mode</Text>
            <View style={[styles.mockSwitch, styles.activeSwitch]}>
              <Text style={styles.activeSwitchText}>Always On</Text>
            </View>
          </View>

          {role === "super_admin" && (
            <>
              <View style={styles.divider} />
              <View style={styles.preferenceRow}>
                <Text style={styles.preferenceLabel}>AI Chord/Link Detection</Text>
                {loadingAiToggle ? (
                  <ActivityIndicator size="small" color={config.primaryColor} />
                ) : (
                  <Switch
                    trackColor={{ false: "#334155", true: config.primaryColor + "50" }}
                    thumbColor={enableAiDetection ? config.primaryColor : "#94A3B8"}
                    ios_backgroundColor="#334155"
                    onValueChange={handleToggleAiDetection}
                    value={enableAiDetection}
                  />
                )}
              </View>
            </>
          )}
        </View>

        <TouchableOpacity 
          style={styles.logoutButton} 
          onPress={onLogout} 
          activeOpacity={0.8}
        >
          <Text style={styles.logoutButtonText}>Log Out of Account</Text>
        </TouchableOpacity>

        <Text style={styles.versionText}>Worship Team App v1.0.0 • Phase 1</Text>
      </ScrollView>

      {/* Edit Name Modal */}
      <Modal visible={editModalVisible} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.editCard}>
            <Text style={styles.modalTitle}>Update Full Name</Text>
            
            <TextInput
              style={styles.modalInput}
              placeholder="Enter your name"
              placeholderTextColor="#94A3B8"
              value={newName}
              onChangeText={setNewName}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.cancelBtn]}
                onPress={() => setEditModalVisible(false)}
                disabled={savingName}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalBtn, styles.saveBtn, { backgroundColor: config.primaryColor }]}
                onPress={handleSaveName}
                disabled={savingName}
              >
                {savingName ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.saveBtnText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Change Password Modal */}
      <Modal visible={passModalVisible} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.editCard}>
            <Text style={styles.modalTitle}>Change Password</Text>
            
            <TextInput
              style={styles.modalInput}
              placeholder="New Password (min 6 chars)"
              placeholderTextColor="#94A3B8"
              secureTextEntry
              value={newPass}
              onChangeText={setNewPass}
            />

            <TextInput
              style={styles.modalInput}
              placeholder="Confirm New Password"
              placeholderTextColor="#94A3B8"
              secureTextEntry
              value={confirmPass}
              onChangeText={setConfirmPass}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.cancelBtn]}
                onPress={() => {
                  setPassModalVisible(false);
                  setNewPass("");
                  setConfirmPass("");
                }}
                disabled={savingPass}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalBtn, styles.saveBtn, { backgroundColor: config.primaryColor }]}
                onPress={handleSavePassword}
                disabled={savingPass}
              >
                {savingPass ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.saveBtnText}>Update</Text>
                )}
              </TouchableOpacity>
            </View>
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
    top: -100,
    alignSelf: "center",
    width: 260,
    height: 260,
    borderRadius: 130,
    opacity: 0.1,
    blurRadius: 80,
  },
  scrollContent: {
    padding: 24,
    paddingTop: 60,
    paddingBottom: 100,
    alignItems: "center",
  },
  profileHeader: {
    alignItems: "center",
    marginBottom: 32,
  },
  avatar: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: "#1E293B",
    borderWidth: 3,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 6,
  },
  changePassBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: "rgba(255, 255, 255, 0.02)",
  },
  changePassBtnText: {
    fontSize: 13,
    fontWeight: "700",
  },
  avatarText: {
    color: "#FFFFFF",
    fontSize: 32,
    fontWeight: "800",
    letterSpacing: 1,
  },
  userName: {
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "800",
    marginBottom: 8,
  },
  roleBadge: {
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  roleBadgeText: {
    fontSize: 13,
    fontWeight: "800",
  },
  infoCard: {
    backgroundColor: "#1E293B",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#334155",
    padding: 20,
    width: "100%",
    marginBottom: 20,
  },
  settingsCard: {
    backgroundColor: "#1E293B",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#334155",
    padding: 20,
    width: "100%",
    marginBottom: 32,
  },
  cardTitle: {
    color: "#94A3B8",
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 16,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
  },
  infoLabel: {
    color: "#64748B",
    fontSize: 14,
    fontWeight: "500",
  },
  infoValue: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
  },
  divider: {
    height: 1,
    backgroundColor: "#334155",
    marginVertical: 8,
  },
  preferenceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
  },
  preferenceLabel: {
    color: "#E2E8F0",
    fontSize: 14,
    fontWeight: "600",
  },
  mockSwitch: {
    backgroundColor: "#334155",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  mockSwitchText: {
    color: "#94A3B8",
    fontSize: 12,
    fontWeight: "700",
  },
  activeSwitch: {
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.3)",
  },
  activeSwitchText: {
    color: "#10B981",
    fontSize: 12,
    fontWeight: "700",
  },
  logoutButton: {
    width: "100%",
    backgroundColor: "rgba(239, 68, 68, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.25)",
    borderRadius: 12,
    height: 52,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 24,
  },
  logoutButtonText: {
    color: "#EF4444",
    fontSize: 16,
    fontWeight: "700",
  },
  versionText: {
    color: "#475569",
    fontSize: 11,
    fontWeight: "600",
    marginTop: 8,
  },
  tokenDebugContainer: {
    marginTop: 10,
    backgroundColor: "rgba(0, 0, 0, 0.2)",
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.05)",
    width: "100%",
  },
  tokenDebugLabel: {
    color: "#64748B",
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  tokenDebugValue: {
    color: "#475569",
    fontSize: 11,
    fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
  },
  testNotifBtn: {
    marginTop: 14,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    width: "100%",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.02)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  testNotifBtnText: {
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(11, 15, 25, 0.85)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  editCard: {
    backgroundColor: "#1E293B",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#334155",
    padding: 24,
    width: "100%",
    maxWidth: 400,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 15,
    elevation: 10,
  },
  modalTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 20,
  },
  modalInput: {
    backgroundColor: "#0B0F19",
    borderWidth: 1.2,
    borderColor: "#334155",
    borderRadius: 10,
    height: 48,
    color: "#FFFFFF",
    paddingHorizontal: 16,
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 24,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
  },
  modalBtn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
    minWidth: 90,
    justifyContent: "center",
    alignItems: "center",
  },
  cancelBtn: {
    backgroundColor: "transparent",
    marginRight: 12,
  },
  saveBtn: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  cancelBtnText: {
    color: "#94A3B8",
    fontSize: 15,
    fontWeight: "700",
  },
  saveBtnText: {
    color: "#0B0F19",
    fontSize: 15,
    fontWeight: "800",
  },
  avatarImage: {
    width: "100%",
    height: "100%",
    borderRadius: 42,
  },
  avatarEditOverlay: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#0B0F19",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 3,
  },
  avatarEditOverlayText: {
    fontSize: 12,
  },
});
