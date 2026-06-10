import React, { useState, forwardRef, useImperativeHandle, useRef } from "react";
import { StyleSheet, Modal, View, TouchableOpacity, Text, ActivityIndicator } from "react-native";
import { WebView } from "react-native-webview";

const FirebaseRecaptchaVerifierModal = forwardRef(({ firebaseConfig, attemptInvisibleVerification = true }, ref) => {
  const [visible, setVisible] = useState(false);
  const [resolvePromise, setResolvePromise] = useState(null);
  const [rejectPromise, setRejectPromise] = useState(null);
  const [loading, setLoading] = useState(true);
  const webViewRef = useRef(null);

  // Conform to the Firebase Web SDK ApplicationVerifier interface
  useImperativeHandle(ref, () => ({
    get type() {
      return "recaptcha";
    },
    verify: () => {
      return new Promise((resolve, reject) => {
        setResolvePromise(() => resolve);
        setRejectPromise(() => reject);
        setLoading(true);
        setVisible(true);
      });
    },
    reset: () => {
      if (webViewRef.current) {
        webViewRef.current.reload();
      }
    },
    _reset: () => {
      if (webViewRef.current) {
        webViewRef.current.reload();
      }
    }
  }));

  const handleMessage = (event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === "token") {
        if (resolvePromise) resolvePromise(data.token);
        setVisible(false);
      } else if (data.type === "error") {
        if (rejectPromise) rejectPromise(new Error(data.error));
        setVisible(false);
      } else if (data.type === "expired") {
        if (rejectPromise) rejectPromise(new Error("reCAPTCHA expired."));
        setVisible(false);
      }
    } catch (err) {
      console.warn("Error parsing WebView message:", err);
    }
  };

  const handleClose = () => {
    if (rejectPromise) {
      rejectPromise(new Error("User cancelled reCAPTCHA verification."));
    }
    setVisible(false);
  };

  // Re-map the project domain as the baseUrl so it acts as an authorized domain
  const projectId = firebaseConfig?.projectId || "";
  const baseUrl = `https://${projectId}.firebaseapp.com`;

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
      <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js"></script>
      <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js"></script>
      <style>
        body {
          margin: 0;
          padding: 0;
          display: flex;
          justify-content: center;
          align-items: center;
          height: 100vh;
          background-color: #0b0f19;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }
        #recaptcha-container {
          transform: scale(0.9);
          transform-origin: center;
        }
      </style>
    </head>
    <body>
      <div id="recaptcha-container"></div>
      <script>
        try {
          const config = ${JSON.stringify(firebaseConfig)};
          firebase.initializeApp(config);
          
          window.recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', {
            'size': '${attemptInvisibleVerification ? "invisible" : "normal"}',
            'callback': function(token) {
              window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'token', token: token }));
            },
            'expired-callback': function() {
              window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'expired' }));
            },
            'error-callback': function(error) {
              window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'error', error: error?.message || 'reCAPTCHA error' }));
            }
          });

          window.recaptchaVerifier.render().then(function(widgetId) {
            return window.recaptchaVerifier.verify();
          }).catch(function(err) {
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'error', error: err.message || 'reCAPTCHA render failed' }));
          });
        } catch (e) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'error', error: e.message || 'Error executing script' }));
        }
      </script>
    </body>
    </html>
  `;

  return (
    <Modal visible={visible} animationType="slide" transparent={true} onRequestClose={handleClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Security Verification</Text>
            <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>✕ Close</Text>
            </TouchableOpacity>
          </View>
          
          <View style={styles.webContainer}>
            <WebView
              ref={webViewRef}
              source={{ html: htmlContent, baseUrl: baseUrl }}
              onMessage={handleMessage}
              javaScriptEnabled={true}
              domStorageEnabled={true}
              onLoadEnd={() => setLoading(false)}
              style={styles.webview}
            />
            {loading && (
              <View style={styles.loadingOverlay}>
                <ActivityIndicator size="large" color="#F59E0B" />
                <Text style={styles.loadingText}>Preparing Verification...</Text>
              </View>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(11, 15, 25, 0.85)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContainer: {
    width: "90%",
    height: "65%",
    backgroundColor: "#1E293B",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#334155",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 15,
    elevation: 8,
  },
  header: {
    height: 56,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    backgroundColor: "#0F172A",
    borderBottomWidth: 1,
    borderBottomColor: "#334155",
  },
  headerTitle: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  closeBtn: {
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  closeBtnText: {
    color: "#EF4444",
    fontSize: 12,
    fontWeight: "700",
  },
  webContainer: {
    flex: 1,
    backgroundColor: "#0b0f19",
    position: "relative",
  },
  webview: {
    flex: 1,
    backgroundColor: "transparent",
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#0B0F19",
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    color: "#94A3B8",
    fontSize: 13,
    fontWeight: "600",
    marginTop: 14,
  },
});

export default FirebaseRecaptchaVerifierModal;
