import React, { useState } from "react";
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  Alert,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { USE_DEMO_MODE, auth, db } from "../firebaseConfig";
import { updatePassword } from "firebase/auth";
import { doc, updateDoc } from "firebase/firestore";

const SESSION_KEY = "@worship_team_session";
const DEMO_USERS_DB_KEY = "@worship_team_demo_users";

export default function ResetPasswordModal({
  visible,
  currentUser,
  onSuccess,
  onCancel,
}) {
  const [resetPassVal, setResetPassVal] = useState("");
  const [confirmResetPassVal, setConfirmResetPassVal] = useState("");
  const [resettingLoading, setResettingLoading] = useState(false);
  const [resetError, setResetError] = useState("");

  const handleSaveResetPassword = async () => {
    setResetError("");
    if (!resetPassVal) {
      setResetError("Password cannot be empty.");
      return;
    }
    if (resetPassVal.length < 6) {
      setResetError("Password must be at least 6 characters.");
      return;
    }
    if (resetPassVal !== confirmResetPassVal) {
      setResetError("Passwords do not match.");
      return;
    }

    setResettingLoading(true);
    try {
      if (USE_DEMO_MODE) {
        const dbString = await AsyncStorage.getItem(DEMO_USERS_DB_KEY);
        if (dbString) {
          const localDb = JSON.parse(dbString);
          const userPhone = currentUser?.phone;
          if (userPhone && localDb[userPhone]) {
            localDb[userPhone].password = resetPassVal;
            await AsyncStorage.setItem(DEMO_USERS_DB_KEY, JSON.stringify(localDb));
          }
        }
        const updatedUser = { ...currentUser, password: resetPassVal };
        onSuccess(updatedUser);
      } else {
        // Real Firebase Mode
        if (auth.currentUser) {
          await updatePassword(auth.currentUser, resetPassVal);
        } else {
          throw new Error("No active Firebase session.");
        }

        // Update password in Firestore
        const userDocRef = doc(db, "users", currentUser.uid);
        await updateDoc(userDocRef, {
          password: resetPassVal,
        });

        const updatedUser = { ...currentUser, password: resetPassVal };
        onSuccess(updatedUser);
      }
      Alert.alert(
        "Success 🎉",
        "Your password has been reset successfully! You can now use this password for future sign-ins."
      );
    } catch (err) {
      console.error("Password reset update error:", err);
      setResetError(err.message || "Failed to update password.");
    } finally {
      setResettingLoading(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={true}>
      <View style={styles.modalOverlay}>
        <View style={styles.resetCard}>
          <Text style={styles.modalTitle}>Set New Password</Text>
          <Text style={styles.modalSubtitle}>
            Please set a new secure password for your credentials.
          </Text>

          {resetError ? (
            <Text style={styles.modalErrorText}>{resetError}</Text>
          ) : null}

          <TextInput
            style={styles.modalInput}
            placeholder="New Password (min 6 characters)"
            placeholderTextColor="#94A3B8"
            secureTextEntry
            value={resetPassVal}
            onChangeText={setResetPassVal}
            autoFocus
          />

          <TextInput
            style={styles.modalInput}
            placeholder="Confirm New Password"
            placeholderTextColor="#94A3B8"
            secureTextEntry
            value={confirmResetPassVal}
            onChangeText={setConfirmResetPassVal}
          />

          <TouchableOpacity
            style={[
              styles.resetSubmitBtn,
              resettingLoading && styles.disabledBtn,
            ]}
            onPress={handleSaveResetPassword}
            disabled={resettingLoading}
            activeOpacity={0.8}
          >
            {resettingLoading ? (
              <ActivityIndicator size="small" color="#0B0F19" />
            ) : (
              <Text style={styles.resetSubmitBtnText}>
                Reset Password & Login
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.cancelBtn}
            onPress={onCancel}
            disabled={resettingLoading}
            activeOpacity={0.7}
          >
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
  disabledBtn: {
    backgroundColor: "#475569",
    shadowOpacity: 0,
  },
  resetSubmitBtnText: {
    color: "#0B0F19",
    fontSize: 16,
    fontWeight: "800",
  },
  cancelBtn: {
    width: "100%",
    backgroundColor: "transparent",
    height: 52,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 12,
    borderWidth: 1,
    borderColor: "#334155",
  },
  cancelBtnText: {
    color: "#94A3B8",
    fontSize: 15,
    fontWeight: "700",
  },
});
