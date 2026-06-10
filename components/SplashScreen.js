import React, { useEffect, useRef } from "react";
import { StyleSheet, Text, View, Animated, TouchableOpacity, Dimensions, Image } from "react-native";
import { StatusBar } from "expo-status-bar";

const { width } = Dimensions.get("window");

export default function SplashScreen({ onGetStarted }) {
  // Animation drivers
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Sequence of animations for fade-in and slide-up of text
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 1200,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 1000,
        useNativeDriver: true,
      }),
    ]).start();

    // Subtle breathing animation for background glow
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.08,
          duration: 3000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 3000,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      
      {/* Background Ambient Glows */}
      <Animated.View style={[styles.glowCircle, { transform: [{ scale: pulseAnim }] }]} />
      <View style={styles.glowCircle2} />

      <View style={styles.contentContainer}>
        {/* Animated Brand Section */}
        <Animated.View
          style={[
            styles.brandContainer,
            {
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          <Image
            source={require("../assets/logo.png")}
            style={styles.logoImage}
            resizeMode="contain"
          />

          <Text style={styles.title}>Worship Team</Text>
          <Text style={styles.appWord}>APP</Text>
          
          <View style={styles.divider} />
          
          <Text style={styles.subtitle}>One App. Every Role. Every Sunday.</Text>
        </Animated.View>

        {/* Animated Button Section */}
        <Animated.View
          style={[
            styles.buttonContainer,
            {
              opacity: fadeAnim,
            },
          ]}
        >
          <TouchableOpacity style={styles.button} activeOpacity={0.8} onPress={onGetStarted}>
            <Text style={styles.buttonText}>Get Started</Text>
          </TouchableOpacity>
          <Text style={styles.footerText}>Church Ministry Portal • v1.0.0</Text>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0B0F19", // Ultra dark slate
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 60,
  },
  contentContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
  },
  glowCircle: {
    position: "absolute",
    top: "15%",
    left: "5%",
    width: width * 0.9,
    height: width * 0.9,
    borderRadius: (width * 0.9) / 2,
    backgroundColor: "rgba(37, 99, 235, 0.12)", // Soft blue glow
    shadowColor: "#2563EB",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 100,
    elevation: 10,
  },
  glowCircle2: {
    position: "absolute",
    bottom: "20%",
    right: "-10%",
    width: width * 0.7,
    height: width * 0.7,
    borderRadius: (width * 0.7) / 2,
    backgroundColor: "rgba(245, 158, 11, 0.08)", // Soft gold/amber glow
    shadowColor: "#F59E0B",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 100,
    elevation: 8,
  },
  brandContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 30,
    marginTop: 60,
  },
  logoImage: {
    width: 140,
    height: 140,
    marginBottom: 20,
  },
  title: {
    fontSize: 38,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: -0.5,
    textAlign: "center",
  },
  appWord: {
    fontSize: 16,
    fontWeight: "900",
    color: "#3B82F6", // Primary blue accent
    letterSpacing: 8,
    marginTop: 4,
    textTransform: "uppercase",
  },
  divider: {
    width: 60,
    height: 3,
    backgroundColor: "#F59E0B", // Gold divider
    borderRadius: 2,
    marginVertical: 24,
  },
  subtitle: {
    fontSize: 18,
    fontWeight: "500",
    color: "#94A3B8", // Cool gray
    textAlign: "center",
    lineHeight: 26,
    paddingHorizontal: 20,
  },
  buttonContainer: {
    width: "100%",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  button: {
    width: "100%",
    backgroundColor: "#2563EB", // Vibrant blue
    height: 58,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#2563EB",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
    marginBottom: 20,
  },
  buttonText: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  footerText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#475569",
    letterSpacing: 1,
  },
});
