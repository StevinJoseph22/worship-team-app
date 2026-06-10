import React from "react";
import { StyleSheet, Text, View, TouchableOpacity, Dimensions } from "react-native";

const { width } = Dimensions.get("window");

export default function BottomNavBar({ activeTab, onTabSelect, user }) {
  // Determine active highlight color based on user role
  const getRoleColor = (role) => {
    switch (role) {
      case "super_admin":
        return "#EF4444"; // Crimson Red
      case "worship_leader":
        return "#F59E0B"; // Gold
      case "musician":
        return "#A855F7"; // Purple
      case "choir_member":
        return "#0D9488"; // Teal
      case "member":
      default:
        return "#3B82F6"; // Blue
    }
  };

  const activeColor = getRoleColor(user?.role);

  const tabs = [
    { id: "Home", label: "Home", emoji: "🏠" },
    { id: "Songs", label: "Songs", emoji: "🎵" },
    { id: "Roster", label: "Roster", emoji: "📅" },
    { id: "Tasks", label: "Tasks", emoji: "📋" },
  ];

  if (user?.role === "worship_leader" || user?.role === "super_admin") {
    tabs.push({ id: "Admin", label: "Admin", emoji: "🛡️" });
  }

  tabs.push({ id: "Profile", label: "Profile", emoji: "👤" });

  return (
    <View style={styles.navBarContainer}>
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <TouchableOpacity
            key={tab.id}
            style={styles.tabButton}
            activeOpacity={0.7}
            onPress={() => onTabSelect(tab.id)}
          >
            <View style={styles.iconContainer}>
              <Text style={[styles.tabEmoji, isActive && styles.activeEmoji]}>
                {tab.emoji}
              </Text>
              {isActive && (
                <View style={[styles.activeDot, { backgroundColor: activeColor }]} />
              )}
            </View>
            <Text
              style={[
                styles.tabLabel,
                isActive ? { color: activeColor, fontWeight: "800" } : null,
              ]}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  navBarContainer: {
    flexDirection: "row",
    height: 76,
    backgroundColor: "#1E293B", // Dark slate bottom bar
    borderTopWidth: 1,
    borderColor: "#334155",
    justifyContent: "space-around",
    alignItems: "center",
    paddingBottom: 14,
    paddingHorizontal: 10,
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
  },
  tabButton: {
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
    height: "100%",
    paddingTop: 8,
  },
  iconContainer: {
    height: 32,
    justifyContent: "center",
    alignItems: "center",
  },
  tabEmoji: {
    fontSize: 20,
    opacity: 0.5,
  },
  activeEmoji: {
    fontSize: 22,
    opacity: 1,
    transform: [{ scale: 1.1 }],
  },
  activeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    position: "absolute",
    bottom: -6,
  },
  tabLabel: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 4,
    fontWeight: "600",
  },
});
