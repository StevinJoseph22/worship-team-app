import React, { useState } from "react";
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { StatusBar } from "expo-status-bar";

const formatPhone = (num) => {
  if (!num) return "";
  const clean = ("" + num).replace(/\D/g, "");
  if (num.startsWith("+91")) {
    const remaining = clean.substring(2);
    if (remaining.length === 10) {
      return `+91 ${remaining.substring(0, 5)}-${remaining.substring(5)}`;
    }
    return num;
  }
  if (clean.length === 10) {
    return `+1 (${clean.substring(0, 3)}) ${clean.substring(3, 6)}-${clean.substring(6)}`;
  } else if (clean.length === 11 && clean.startsWith("1")) {
    const rest = clean.substring(1);
    return `+1 (${rest.substring(0, 3)}) ${rest.substring(3, 6)}-${rest.substring(6)}`;
  }
  return num.startsWith("+") ? num : `+${num}`;
};

export default function RegisterScreen({ phoneNumber, onCompleteRegistration }) {

  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const handleRegister = async () => {
    setErrorMsg("");

    if (!fullName || fullName.trim() === "") {
      setErrorMsg("Please enter your full name.");
      return;
    }

    if (!password) {
      setErrorMsg("Please set a password.");
      return;
    }

    if (password.length < 6) {
      setErrorMsg("Password must be at least 6 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setErrorMsg("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      await onCompleteRegistration({
        displayName: fullName.trim(),
        password: password,
        phone: phoneNumber,
      });
      setLoading(false);
    } catch (err) {
      setLoading(false);
      setErrorMsg(err.message || "Failed to complete registration. Try again.");
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.container}
    >
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
        
        {/* Ambient Top Glow */}
        <View style={styles.topGlow} />

        {/* Heading */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Complete Profile</Text>
          <Text style={styles.headerSubtitle}>
            Welcome to the team! Tell us your name and set a secure login password.
          </Text>
        </View>

        {/* Mobile Verified Badge */}
        <View style={styles.verifiedBadge}>
          <Text style={styles.verifiedBadgeText}>💚 Mobile Verified: {formatPhone(phoneNumber)}</Text>
        </View>

        {/* Registration Form */}
        <View style={styles.form}>

          {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}

          {/* Full Name */}
          <Text style={styles.inputLabel}>Full Name</Text>
          <TextInput
            style={styles.input}
            placeholder="John Doe"
            placeholderTextColor="#475569"
            value={fullName}
            onChangeText={setFullName}
            autoFocus
          />

          {/* Password */}
          <Text style={styles.inputLabel}>Password</Text>
          <TextInput
            style={styles.input}
            placeholder="Minimum 6 characters"
            placeholderTextColor="#475569"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          {/* Confirm Password */}
          <Text style={styles.inputLabel}>Confirm Password</Text>
          <TextInput
            style={styles.input}
            placeholder="Repeat your password"
            placeholderTextColor="#475569"
            secureTextEntry
            value={confirmPassword}
            onChangeText={setConfirmPassword}
          />

          {/* Note Info */}
          <View style={styles.infoCard}>
            <Text style={styles.infoText}>
              💡 Your default role is set to <Text style={styles.boldText}>Member</Text>. 
              Your worship leader can elevate your role to Musician or Choir Member inside the admin panel later!
            </Text>
          </View>

          {/* Finish Button */}
          <TouchableOpacity
            style={[styles.submitButton, loading && styles.disabledButton]}
            activeOpacity={0.8}
            onPress={handleRegister}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#0B0F19" />
            ) : (
              <Text style={styles.submitButtonText}>Create Account & Enter</Text>
            )}
          </TouchableOpacity>
        </View>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0B0F19",
  },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 28,
    paddingVertical: 40,
  },
  verifiedBadge: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(16, 185, 129, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.2)",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 24,
    alignSelf: "center",
    width: "100%",
  },
  verifiedBadgeText: {
    color: "#10B981",
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
  },

  topGlow: {
    position: "absolute",
    top: -100,
    alignSelf: "center",
    width: 250,
    height: 250,
    borderRadius: 125,
    backgroundColor: "rgba(16, 185, 129, 0.08)", // Soft emerald glow for success/complete
    shadowColor: "#10B981",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 80,
  },
  header: {
    alignItems: "center",
    marginBottom: 35,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  headerSubtitle: {
    fontSize: 15,
    color: "#94A3B8",
    marginTop: 10,
    textAlign: "center",
    lineHeight: 22,
    paddingHorizontal: 10,
  },
  form: {
    width: "100%",
  },
  errorText: {
    color: "#EF4444",
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 16,
    textAlign: "center",
    backgroundColor: "rgba(239, 68, 68, 0.1)",
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.2)",
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#94A3B8",
    marginBottom: 8,
    marginLeft: 4,
  },
  input: {
    backgroundColor: "#1E293B",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#334155",
    paddingHorizontal: 16,
    height: 56,
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 20,
  },
  infoCard: {
    backgroundColor: "rgba(59, 130, 246, 0.08)",
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(59, 130, 246, 0.15)",
    marginBottom: 28,
  },
  infoText: {
    color: "#94A3B8",
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
  },
  boldText: {
    color: "#3B82F6",
    fontWeight: "800",
  },
  submitButton: {
    backgroundColor: "#10B981", // Vibrant Emerald for completion
    height: 56,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#10B981",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 4,
  },
  disabledButton: {
    backgroundColor: "#1E293B",
    borderColor: "#334155",
    borderWidth: 1,
  },
  submitButtonText: {
    color: "#0B0F19",
    fontSize: 16,
    fontWeight: "700",
  },
});
