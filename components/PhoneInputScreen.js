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

export default function PhoneInputScreen({ onSendOtpCode, onNavigateToLogin }) {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [selectedCountry, setSelectedCountry] = useState(getDefaultCountry());
  const [showPicker, setShowPicker] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const handleSendCode = async () => {
    setErrorMsg("");
    if (!phoneNumber || phoneNumber.trim() === "") {
      setErrorMsg("Please enter a valid phone number.");
      return;
    }

    const fullPhoneNumber = `${selectedCountry.code}${phoneNumber}`;

    setLoading(true);
    try {
      await onSendOtpCode(fullPhoneNumber);
      setLoading(false);
    } catch (err) {
      setLoading(false);
      setErrorMsg(err.message || "Failed to send code. Please try again.");
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.container}
    >
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
        
        {/* Top Glow Ambient */}
        <View style={styles.topGlow} />

        {/* Back Button */}
        <TouchableOpacity style={styles.backButton} onPress={onNavigateToLogin}>
          <Text style={styles.backButtonText}>← Back to Login</Text>
        </TouchableOpacity>

        {/* Heading */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Register Account</Text>
          <Text style={styles.headerSubtitle}>
            Enter your mobile number. We will send you a 6-digit confirmation code.
          </Text>
        </View>

        {/* Input Form */}
        <View style={styles.form}>
          {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}

          <Text style={styles.inputLabel}>Mobile Phone Number</Text>
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
              autoFocus
            />
          </View>

          {/* Action Button */}
          <TouchableOpacity
            style={[styles.submitButton, loading && styles.disabledButton]}
            activeOpacity={0.8}
            onPress={handleSendCode}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.submitButtonText}>Send OTP Code</Text>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.disclaimerContainer}>
          <Text style={styles.disclaimerText}>
            By continuing, you agree to receive a one-time SMS code. Standard carrier text and data rates may apply.
          </Text>
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
    backgroundColor: "#0B0F19",
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
    backgroundColor: "rgba(245, 158, 11, 0.1)",
    shadowColor: "#F59E0B",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 80,
  },
  backButton: {
    position: "absolute",
    top: 50,
    left: 24,
    padding: 10,
  },
  backButtonText: {
    color: "#3B82F6",
    fontSize: 15,
    fontWeight: "700",
  },
  header: {
    alignItems: "center",
    marginBottom: 40,
    marginTop: 40,
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
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1E293B",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#334155",
    paddingHorizontal: 16,
    height: 56,
    marginBottom: 24,
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
  submitButton: {
    backgroundColor: "#F59E0B",
    height: 56,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#F59E0B",
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
  disclaimerContainer: {
    marginTop: 30,
    paddingHorizontal: 12,
  },
  disclaimerText: {
    color: "#475569",
    fontSize: 11,
    textAlign: "center",
    lineHeight: 16,
    fontWeight: "500",
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
    color: "#F59E0B",
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
});
