import React, { useState } from "react";
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Dimensions,
  Platform,
  SafeAreaView,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { StatusBar } from "expo-status-bar";

const { width } = Dimensions.get("window");

const SLIDES = [
  {
    title: "📅 Service Planning & Setlists",
    subtitle: "Coordinate Effortlessly",
    description: "Worship leaders create service plans, compile song sets, and assign vocalists/musicians. Keep everyone aligned with keys and performance notes.",
    accent: "#3B82F6", // Blue
  },
  {
    title: "🎵 Transposition & Notation",
    subtitle: "Chords to Fit Your Team",
    description: "Instantly transpose song sheets, force sharp/flat accidentals for easier reading, or toggle the Nashville Number System on the fly.",
    accent: "#F59E0B", // Amber/Gold
  },
  {
    title: "📋 Smart Task Delegation",
    subtitle: "Track Assignments in Real-Time",
    description: "Assign prep tasks to specific musicians and choir members. Stay on top of deadlines with automatic due-soon alerts and push notifications.",
    accent: "#A855F7", // Purple
  },
  {
    title: "📊 Worship Analytics Hub",
    subtitle: "Insights at a Glance",
    description: "Worship leaders get client-side compiled reports on practice completions, registered team roles, roster plans, and top-used songs.",
    accent: "#0D9488", // Teal
  },
];

export default function OnboardingScreen({ onFinish }) {
  const [currentIndex, setCurrentIndex] = useState(0);

  const handleNext = () => {
    if (currentIndex < SLIDES.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else {
      handleComplete();
    }
  };

  const handleComplete = async () => {
    try {
      await AsyncStorage.setItem("@hasCompletedOnboarding", "true");
    } catch (e) {
      console.warn("Onboarding storage error:", e);
    }
    if (onFinish) {
      onFinish();
    }
  };

  const slide = SLIDES[currentIndex];

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />

      {/* Decorative Ambient Background Glows */}
      <View style={[styles.glowCircle, { backgroundColor: slide.accent }]} />
      <View style={styles.glowCircle2} />

      <View style={styles.contentContainer}>
        {/* Skip Button */}
        <View style={styles.header}>
          {currentIndex < SLIDES.length - 1 ? (
            <TouchableOpacity onPress={handleComplete} activeOpacity={0.7}>
              <Text style={styles.skipText}>Skip</Text>
            </TouchableOpacity>
          ) : (
            <View style={{ height: 20 }} />
          )}
        </View>

        {/* Feature Display Card */}
        <View style={styles.cardContainer}>
          <View style={styles.card}>
            <Text style={[styles.cardSubtitle, { color: slide.accent }]}>
              {slide.subtitle.toUpperCase()}
            </Text>
            <Text style={styles.cardTitle}>{slide.title}</Text>
            <Text style={styles.cardDescription}>{slide.description}</Text>
          </View>
        </View>

        {/* Bottom Navigation Controls */}
        <View style={styles.footer}>
          {/* Progress Indicators (Dots) */}
          <View style={styles.dotsContainer}>
            {SLIDES.map((_, index) => (
              <View
                key={index}
                style={[
                  styles.dot,
                  index === currentIndex
                    ? [styles.activeDot, { backgroundColor: slide.accent }]
                    : styles.inactiveDot,
                ]}
              />
            ))}
          </View>

          {/* Action Button */}
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: slide.accent }]}
            activeOpacity={0.8}
            onPress={handleNext}
          >
            <Text style={styles.actionButtonText}>
              {currentIndex === SLIDES.length - 1 ? "Get Started" : "Next"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0B0F19", // Ultra dark theme matching app style
  },
  contentContainer: {
    flex: 1,
    justifyContent: "space-between",
    paddingHorizontal: 28,
    paddingVertical: 20,
  },
  glowCircle: {
    position: "absolute",
    top: "-5%",
    left: "-10%",
    width: width * 0.9,
    height: width * 0.9,
    borderRadius: (width * 0.9) / 2,
    opacity: 0.1, // Ambient glow
    shadowRadius: 100,
    elevation: 8,
  },
  glowCircle2: {
    position: "absolute",
    bottom: "-10%",
    right: "-10%",
    width: width * 0.8,
    height: width * 0.8,
    borderRadius: (width * 0.8) / 2,
    backgroundColor: "rgba(245, 158, 11, 0.04)",
    shadowRadius: 100,
    elevation: 8,
  },
  header: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    height: 40,
    marginTop: Platform.OS === "android" ? 20 : 0,
  },
  skipText: {
    color: "#64748B",
    fontSize: 16,
    fontWeight: "700",
  },
  cardContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  card: {
    width: "100%",
    backgroundColor: "rgba(30, 41, 59, 0.5)", // Glassmorphic translucent dark slate
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(51, 65, 85, 0.4)",
    padding: 32,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 15,
    elevation: 5,
  },
  cardSubtitle: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 2,
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 26,
    fontWeight: "800",
    color: "#FFFFFF",
    lineHeight: 34,
    marginBottom: 20,
  },
  cardDescription: {
    fontSize: 16,
    color: "#94A3B8",
    lineHeight: 26,
    fontWeight: "500",
  },
  footer: {
    alignItems: "center",
    marginBottom: 30,
    width: "100%",
  },
  dotsContainer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 30,
  },
  dot: {
    height: 8,
    borderRadius: 4,
    marginHorizontal: 5,
  },
  activeDot: {
    width: 24,
  },
  inactiveDot: {
    width: 8,
    backgroundColor: "#334155",
  },
  actionButton: {
    width: "100%",
    height: 58,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 4,
  },
  actionButtonText: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
});
