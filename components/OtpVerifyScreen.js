import React, { useState, useRef, useEffect } from "react";
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

export default function OtpVerifyScreen({ phoneNumber, onVerifyOtp, onResendCode, onNavigateBack, isDemoMode = false }) {
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [timer, setTimer] = useState(30);

  // Refs for the 6 input boxes
  const inputRefs = [
    useRef(null),
    useRef(null),
    useRef(null),
    useRef(null),
    useRef(null),
    useRef(null),
  ];

  // Countdown timer effect
  useEffect(() => {
    let interval = null;
    if (timer > 0) {
      interval = setInterval(() => {
        setTimer((prev) => prev - 1);
      }, 1000);
    } else {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [timer]);

  const handleChangeText = (text, index) => {
    setErrorMsg("");
    const newCode = [...code];
    // Take only the last digit typed
    const cleanText = text.replace(/[^0-9]/g, "");
    newCode[index] = cleanText.substring(cleanText.length - 1);
    setCode(newCode);

    // Auto-focus next input box if typed
    if (cleanText && index < 5) {
      inputRefs[index + 1].current.focus();
    }

    // Trigger auto-submit when all 6 digits are filled
    const fullCode = newCode.join("");
    if (fullCode.length === 6) {
      handleVerify(fullCode);
    }
  };

  const handleKeyPress = (e, index) => {
    // Backspace logic to focus previous box
    if (e.nativeEvent.key === "Backspace" && !code[index] && index > 0) {
      const newCode = [...code];
      newCode[index - 1] = "";
      setCode(newCode);
      inputRefs[index - 1].current.focus();
    }
  };

  const handleVerify = async (fullCodeString) => {
    const codeToSubmit = fullCodeString || code.join("");
    if (codeToSubmit.length < 6) {
      setErrorMsg("Please enter the complete 6-digit code.");
      return;
    }

    setLoading(true);
    setErrorMsg("");
    try {
      await onVerifyOtp(codeToSubmit);
    } catch (err) {
      setLoading(false);
      setErrorMsg(err.message || "Invalid validation code. Try again.");
      // Clear inputs on failure to let them retry
      setCode(["", "", "", "", "", ""]);
      inputRefs[0].current.focus();
    }
  };

  const handleResend = async () => {
    if (timer > 0) return;
    setErrorMsg("");
    setTimer(30);
    try {
      await onResendCode(phoneNumber);
    } catch (err) {
      setErrorMsg(err.message || "Failed to resend code.");
    }
  };

  // Format phone number for pretty display
  const formatPhone = (num) => {
    if (!num) return "";
    
    const clean = ("" + num).replace(/\D/g, "");
    
    // Check if the original number starts with +91 (India)
    if (num.startsWith("+91")) {
      const remaining = clean.substring(2);
      if (remaining.length === 10) {
        return `+91 ${remaining.substring(0, 5)}-${remaining.substring(5)}`;
      }
      return num;
    }
    
    // US/Canada numbers (10 digits, or 11 digits starting with 1)
    if (clean.length === 10) {
      return `+1 (${clean.substring(0, 3)}) ${clean.substring(3, 6)}-${clean.substring(6)}`;
    } else if (clean.length === 11 && clean.startsWith("1")) {
      const rest = clean.substring(1);
      return `+1 (${rest.substring(0, 3)}) ${rest.substring(3, 6)}-${rest.substring(6)}`;
    }
    
    // Otherwise, return num as is, ensuring we have a leading '+'
    if (num.startsWith("+")) {
      return num;
    }
    return `+${num}`;
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

        {/* Back Arrow */}
        <TouchableOpacity style={styles.backButton} onPress={onNavigateBack}>
          <Text style={styles.backButtonText}>← Edit Number</Text>
        </TouchableOpacity>

        {/* Heading */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Verify OTP</Text>
          <Text style={styles.headerSubtitle}>
            We've sent a 6-digit confirmation code to{"\n"}
            <Text style={styles.boldPhone}>{formatPhone(phoneNumber)}</Text>
            {isDemoMode && (
              <>
                {"\n\n"}
                <Text style={styles.bypassHint}>⚡ Developer Bypass Mode Active ⚡{"\n"}Enter ANY 6-digit code to log in or register.</Text>
              </>
            )}
          </Text>
        </View>

        {/* OTP Input Grid */}
        <View style={styles.form}>
          {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}

          <View style={styles.otpGrid}>
            {code.map((digit, idx) => (
              <TextInput
                key={idx}
                ref={inputRefs[idx]}
                style={[
                  styles.otpInput,
                  digit ? styles.activeOtpInput : null,
                  errorMsg ? styles.errorOtpInput : null,
                ]}
                keyboardType="number-pad"
                maxLength={1}
                value={digit}
                onChangeText={(text) => handleChangeText(text, idx)}
                onKeyPress={(e) => handleKeyPress(e, idx)}
                selectTextOnFocus
              />
            ))}
          </View>

          {/* Resend Section */}
          <View style={styles.resendContainer}>
            <Text style={styles.resendText}>Didn't receive the code? </Text>
            {timer > 0 ? (
              <Text style={styles.timerText}>Resend in {timer}s</Text>
            ) : (
              <TouchableOpacity onPress={handleResend}>
                <Text style={styles.resendLink}>Resend SMS</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Submit/Verify Button */}
          <TouchableOpacity
            style={[styles.submitButton, loading && styles.disabledButton]}
            activeOpacity={0.8}
            onPress={() => handleVerify()}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.submitButtonText}>Verify & Continue</Text>
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
    paddingHorizontal: 24,
    paddingVertical: 40,
  },
  topGlow: {
    position: "absolute",
    top: -100,
    alignSelf: "center",
    width: 250,
    height: 250,
    borderRadius: 125,
    backgroundColor: "rgba(59, 130, 246, 0.12)",
    shadowColor: "#3B82F6",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 80,
  },
  backButton: {
    position: "absolute",
    top: 50,
    left: 20,
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
  },
  boldPhone: {
    fontWeight: "800",
    color: "#FFFFFF",
    fontSize: 16,
  },
  bypassHint: {
    fontSize: 13,
    fontWeight: "700",
    color: "#F59E0B",
    textAlign: "center",
    lineHeight: 18,
    backgroundColor: "rgba(245, 158, 11, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.25)",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginTop: 12,
    alignSelf: "center",
    overflow: "hidden",
  },
  form: {
    width: "100%",
    alignItems: "center",
  },
  errorText: {
    color: "#EF4444",
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 20,
    textAlign: "center",
    backgroundColor: "rgba(239, 68, 68, 0.1)",
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.2)",
    width: "100%",
  },
  otpGrid: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: "100%",
    marginBottom: 30,
  },
  otpInput: {
    width: 48,
    height: 56,
    backgroundColor: "#1E293B",
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#334155",
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "800",
    textAlign: "center",
  },
  activeOtpInput: {
    borderColor: "#3B82F6",
    backgroundColor: "#0F172A",
    shadowColor: "#3B82F6",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
  },
  errorOtpInput: {
    borderColor: "#EF4444",
  },
  resendContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 35,
  },
  resendText: {
    color: "#64748B",
    fontSize: 14,
  },
  timerText: {
    color: "#F59E0B",
    fontWeight: "700",
    fontSize: 14,
  },
  resendLink: {
    color: "#3B82F6",
    fontWeight: "700",
    fontSize: 14,
  },
  submitButton: {
    backgroundColor: "#2563EB",
    height: 56,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
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
});
