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
  Modal,
  FlatList,
  Dimensions,
  Alert,
  Image,
} from "react-native";
import { StatusBar } from "expo-status-bar";

const { height } = Dimensions.get("window");

const COUNTRIES = [
  { code: "+91", flag: "🇮🇳", name: "India" },
  { code: "+1", flag: "🇺🇸", name: "United States" },
  { code: "+44", flag: "🇬🇧", name: "United Kingdom" },
  { code: "+1", flag: "🇨🇦", name: "Canada" },
  { code: "+61", flag: "🇦🇺", name: "Australia" },
  { code: "+65", flag: "🇸🇬", name: "Singapore" },
  { code: "+971", flag: "🇦🇪", name: "UAE" },
  { code: "+27", flag: "🇿🇦", name: "South Africa" },
  { code: "+49", flag: "🇩🇪", name: "Germany" },
  { code: "+33", flag: "🇫🇷", name: "France" },
  { code: "+81", flag: "🇯🇵", name: "Japan" },
];

const getDefaultCountry = () => {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && (tz.includes("Calcutta") || tz.includes("Kolkata") || tz.includes("India"))) {
      return { code: "+91", flag: "🇮🇳", name: "India" };
    }
    if (tz && (tz.includes("London") || tz.includes("Europe"))) {
      return { code: "+44", flag: "🇬🇧", name: "United Kingdom" };
    }
    if (tz && tz.includes("Australia")) {
      return { code: "+61", flag: "🇦🇺", name: "Australia" };
    }
  } catch (e) {
    // ignore
  }
  return { code: "+1", flag: "🇺🇸", name: "United States" };
};

export default function LoginScreen({ onLoginSuccess, onNavigateToRegister, onSendOtpCode, isDemoMode, onForgotPasswordTriggered }) {
  const [loginMethod, setLoginMethod] = useState("password"); // 'password' or 'otp'
  const [phoneNumber, setPhoneNumber] = useState("");
  const [selectedCountry, setSelectedCountry] = useState(getDefaultCountry());
  const [showPicker, setShowPicker] = useState(false);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const handleForgotPassword = () => {
    setErrorMsg("");
    if (!phoneNumber || phoneNumber.trim() === "") {
      setErrorMsg("Please enter your phone number first.");
      return;
    }

    Alert.alert(
      "Reset Password?",
      "To reset your password, we will verify your phone number via SMS OTP. Once verified, you will be prompted to set a new password.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Verify via SMS",
          onPress: async () => {
            try {
              setLoginMethod("otp");
              if (onForgotPasswordTriggered) {
                onForgotPasswordTriggered();
              }
              
              // Automatically send OTP code
              const fullPhoneNumber = `${selectedCountry.code}${phoneNumber}`;
              setLoading(true);
              await onSendOtpCode(fullPhoneNumber);
              setLoading(false);
            } catch (err) {
              setLoading(false);
              setErrorMsg(err.message || "Failed to send OTP code.");
            }
          }
        }
      ]
    );
  };

  const handleLogin = async () => {
    setErrorMsg("");
    if (!phoneNumber || phoneNumber.trim() === "") {
      setErrorMsg("Please enter your phone number.");
      return;
    }

    const fullPhoneNumber = `${selectedCountry.code}${phoneNumber}`;

    if (loginMethod === "password") {
      if (!password) {
        setErrorMsg("Please enter your password.");
        return;
      }

      setLoading(true);
      try {
        await onLoginSuccess({ method: "password", phone: fullPhoneNumber, password });
        setLoading(false);
      } catch (err) {
        setLoading(false);
        setErrorMsg(err.message || "Invalid credentials.");
      }
    } else {
      // OTP Login flow
      setLoading(true);
      try {
        // Triggers OTP code generation and navigation to OTP entry screen
        await onSendOtpCode(fullPhoneNumber);
        setLoading(false);
      } catch (err) {
        setLoading(false);
        setErrorMsg(err.message || "Failed to send OTP. Try again.");
      }
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.container}
    >
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
        
        {/* Decorative Top Glows */}
        <View style={styles.topGlow} />

        {/* Brand Header */}
        <View style={styles.header}>
          <Image
            source={require("../assets/logo.png")}
            style={styles.loginLogo}
            resizeMode="contain"
          />
          <Text style={styles.headerTitle}>Welcome Back</Text>
          <Text style={styles.headerSubtitle}>Sign in to your worship team dashboard</Text>
        </View>

        {/* Toggle Selector */}
        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tabButton, loginMethod === "password" && styles.activeTab]}
            activeOpacity={0.8}
            onPress={() => {
              setLoginMethod("password");
              setErrorMsg("");
            }}
          >
            <Text style={[styles.tabText, loginMethod === "password" && styles.activeTabText]}>
              Password
            </Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.tabButton, loginMethod === "otp" && styles.activeTab]}
            activeOpacity={0.8}
            onPress={() => {
              setLoginMethod("otp");
              setErrorMsg("");
            }}
          >
            <Text style={[styles.tabText, loginMethod === "otp" && styles.activeTabText]}>
              OTP (SMS)
            </Text>
          </TouchableOpacity>
        </View>

        {/* Form Fields */}
        <View style={styles.form}>
          {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}

          {/* Phone Input */}
          <Text style={styles.inputLabel}>Phone Number</Text>
          <View style={styles.inputWrapper}>
            <TouchableOpacity style={styles.countryCodeContainer} onPress={() => setShowPicker(true)}>
              <Text style={styles.countryCodeText}>
                {selectedCountry.flag} {selectedCountry.code}  ▼
              </Text>
            </TouchableOpacity>
            <TextInput
              style={styles.input}
              placeholder="e.g. (555) 019-2834"
              placeholderTextColor="#475569"
              keyboardType="phone-pad"
              value={phoneNumber}
              onChangeText={(text) => setPhoneNumber(text.replace(/[^0-9]/g, ""))}
            />
          </View>

          {/* Password Input (Only for password login) */}
          {loginMethod === "password" && (
            <>
              <Text style={styles.inputLabel}>Password</Text>
              <TextInput
                style={[styles.input, styles.singleInput]}
                placeholder="Enter your password"
                placeholderTextColor="#475569"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />
              <TouchableOpacity
                onPress={handleForgotPassword}
                activeOpacity={0.7}
                style={styles.forgotPasswordContainer}
              >
                <Text style={styles.forgotPasswordText}>Forgot Password?</Text>
              </TouchableOpacity>
            </>
          )}

          {/* Submit Button */}
          <TouchableOpacity
            style={[styles.submitButton, loading && styles.disabledButton]}
            activeOpacity={0.8}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.submitButtonText}>
                {loginMethod === "password" ? "Sign In" : "Send Verification Code"}
              </Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Navigation to Registration */}
        <View style={styles.footer}>
          <Text style={styles.footerLabel}>New to the team?</Text>
          <TouchableOpacity onPress={onNavigateToRegister}>
            <Text style={styles.footerLink}>Register Here</Text>
          </TouchableOpacity>
        </View>
        
      </ScrollView>

      {/* Country Picker Modal */}
      <Modal visible={showPicker} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.pickerContainer}>
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>Select Country Code</Text>
              <TouchableOpacity onPress={() => setShowPicker(false)}>
                <Text style={styles.pickerCloseButton}>Done</Text>
              </TouchableOpacity>
            </View>
            <FlatList
              data={COUNTRIES}
              keyExtractor={(item) => item.code + item.name}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.countryRow}
                  onPress={() => {
                    setSelectedCountry(item);
                    setShowPicker(false);
                  }}
                >
                  <Text style={styles.countryFlag}>{item.flag}</Text>
                  <Text style={styles.countryName}>{item.name}</Text>
                  <Text style={styles.countryDialCode}>{item.code}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>

    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0B0F19", // Dark Theme
  },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 28,
    paddingVertical: 40,
  },
  topGlow: {
    position: "absolute",
    top: -100,
    alignSelf: "center",
    width: 250,
    height: 250,
    borderRadius: 125,
    backgroundColor: "rgba(37, 99, 235, 0.15)",
    blurRadius: 50,
    shadowColor: "#2563EB",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 80,
  },
  header: {
    alignItems: "center",
    marginBottom: 40,
  },
  loginLogo: {
    width: 120,
    height: 120,
    marginBottom: 15,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  headerSubtitle: {
    fontSize: 15,
    color: "#94A3B8",
    marginTop: 6,
    textAlign: "center",
  },
  tabContainer: {
    flexDirection: "row",
    backgroundColor: "#1E293B",
    borderRadius: 14,
    padding: 4,
    marginBottom: 30,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
    borderRadius: 10,
  },
  activeTab: {
    backgroundColor: "#2563EB",
  },
  tabText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#64748B",
  },
  activeTabText: {
    color: "#FFFFFF",
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
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1E293B",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#334155",
    paddingHorizontal: 16,
    height: 56,
    marginBottom: 20,
  },
  countryCodeContainer: {
    marginRight: 10,
    borderRightWidth: 1,
    borderRightColor: "#334155",
    paddingRight: 10,
    justifyContent: "center",
    height: "100%",
  },
  countryCodeText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  input: {
    flex: 1,
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
  singleInput: {
    backgroundColor: "#1E293B",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#334155",
    paddingHorizontal: 16,
    height: 56,
    marginBottom: 24,
  },
  submitButton: {
    backgroundColor: "#2563EB",
    height: 56,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 10,
    shadowColor: "#2563EB",
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
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  footer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 35,
  },
  footerLabel: {
    color: "#64748B",
    fontSize: 14,
    marginRight: 6,
  },
  footerLink: {
    color: "#3B82F6",
    fontWeight: "700",
    fontSize: 14,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(11, 15, 25, 0.8)",
    justifyContent: "flex-end",
  },
  pickerContainer: {
    backgroundColor: "#1E293B",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 20,
    paddingHorizontal: 20,
    maxHeight: height * 0.7,
    borderWidth: 1,
    borderColor: "#334155",
  },
  pickerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderColor: "#334155",
  },
  pickerTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  pickerCloseButton: {
    fontSize: 16,
    fontWeight: "700",
    color: "#2563EB",
  },
  countryRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderColor: "rgba(51, 65, 85, 0.3)",
  },
  countryFlag: {
    fontSize: 24,
    marginRight: 14,
  },
  countryName: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
    color: "#E2E8F0",
  },
  countryDialCode: {
    fontSize: 16,
    fontWeight: "700",
    color: "#64748B",
  },
  forgotPasswordContainer: {
    alignSelf: "flex-end",
    marginTop: -16,
    marginBottom: 24,
    paddingVertical: 4,
  },
  forgotPasswordText: {
    color: "#3B82F6",
    fontSize: 14,
    fontWeight: "700",
  },
});
