import React, { useState, useRef } from "react";
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  FlatList,
  Dimensions,
} from "react-native";
import { StatusBar } from "expo-status-bar";

const { width } = Dimensions.get("window");

export default function SongSearchScreen({ songs, onSelectSong, onAddSong, user }) {
  const [searchQuery, setSearchQuery] = useState("");
  const flatListRef = useRef(null);

  // Check if role is allowed to write to database
  const canAddSongs = ["worship_leader", "super_admin", "musician", "choir_member"].includes(user?.role);

  // Filter songs based on Title, Artist, or Key and sort them alphabetically
  const filteredSongs = songs
    .filter((song) => {
      const query = searchQuery.toLowerCase().trim();
      if (!query) return true;
      
      const originalKeyMatch = song.originalKey?.toLowerCase() === query || song.originalKey?.toLowerCase().includes(query);
      const currentKeyMatch = song.currentKey && (song.currentKey.toLowerCase() === query || song.currentKey.toLowerCase().includes(query));
      
      return (
        song.title?.toLowerCase().includes(query) ||
        song.artist?.toLowerCase().includes(query) ||
        originalKeyMatch ||
        currentKeyMatch ||
        (song.tags && song.tags.some(tag => tag.toLowerCase().includes(query)))
      );
    })
    .sort((a, b) => {
      const titleA = (a.title || "").trim().toLowerCase();
      const titleB = (b.title || "").trim().toLowerCase();
      return titleA.localeCompare(titleB);
    });

  // Extract unique alphabetical characters present in the sorted list
  const alphabet = Array.from(
    new Set(
      filteredSongs
        .map(song => (song.title || "").trim().charAt(0).toUpperCase())
        .filter(char => /[A-Z]/.test(char))
    )
  ).sort();

  const scrollToLetter = (letter) => {
    const idx = filteredSongs.findIndex(song => 
      (song.title || "").trim().toUpperCase().startsWith(letter)
    );
    if (idx !== -1 && flatListRef.current) {
      flatListRef.current.scrollToIndex({
        index: idx,
        animated: true,
        viewPosition: 0
      });
    }
  };

  const handleScrollToIndexFailed = (error) => {
    if (flatListRef.current) {
      flatListRef.current.scrollToOffset({
        offset: error.averageItemLength * error.index,
        animated: true
      });
    }
  };

  const getRoleColor = (role) => {
    switch (role) {
      case "super_admin":
        return "#EF4444";
      case "worship_leader":
        return "#F59E0B";
      case "musician":
        return "#A855F7";
      case "choir_member":
        return "#0D9488";
      default:
        return "#3B82F6";
    }
  };

  const themeColor = getRoleColor(user?.role);

  const renderSongCard = ({ item }) => {
    const activeKey = item.currentKey || item.originalKey || "";
    return (
      <TouchableOpacity
        style={styles.songCard}
        activeOpacity={0.7}
        onPress={() => onSelectSong(item)}
      >
        <View style={styles.cardHeader}>
          <View style={styles.titleContainer}>
            <Text style={styles.songTitle} numberOfLines={1}>{item.title}</Text>
            <Text style={styles.songArtist} numberOfLines={1}>{item.artist}</Text>
          </View>
          <View style={[styles.keyBadge, { borderColor: themeColor + "40" }]}>
            <Text 
              style={[
                styles.keyText, 
                { 
                  color: themeColor,
                  fontSize: activeKey.length > 5 ? 10 : (activeKey.length > 3 ? 12 : 15)
                }
              ]}
              numberOfLines={1}
            >
              {activeKey}
            </Text>
          </View>
        </View>

        <View style={styles.cardFooter}>
          <View style={styles.metaInfo}>
            <Text style={styles.metaItem}>⏱️ {item.bpm} BPM</Text>
            <Text style={styles.metaItem}>📊 {item.timeSignature || "4/4"}</Text>
          </View>
          {!!item.tags && item.tags.length > 0 && (
            <View style={styles.tagsContainer}>
              {item.tags.slice(0, 2).map((tag, idx) => (
                <View key={idx} style={styles.tagBadge}>
                  <Text style={styles.tagText}>{tag}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Song Database</Text>
        {canAddSongs && (
          <TouchableOpacity
            style={[styles.addButton, { backgroundColor: themeColor }]}
            activeOpacity={0.8}
            onPress={onAddSong}
          >
            <Text style={styles.addButtonText}>+ Add Song</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Search Input */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by title, artist, key (e.g. G)..."
          placeholderTextColor="#64748B"
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity 
            style={styles.clearButton} 
            onPress={() => setSearchQuery("")}
          >
            <Text style={styles.clearButtonText}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Song List */}
      <FlatList
        ref={flatListRef}
        data={filteredSongs}
        renderItem={renderSongCard}
        keyExtractor={(item) => item.songId || item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        onScrollToIndexFailed={handleScrollToIndexFailed}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyEmoji}>🎵</Text>
            <Text style={styles.emptyText}>No songs found matching your search</Text>
            {canAddSongs ? (
              <TouchableOpacity
                style={[styles.emptyAddButton, { borderColor: themeColor }]}
                activeOpacity={0.8}
                onPress={onAddSong}
              >
                <Text style={[styles.emptyAddButtonText, { color: themeColor }]}>
                  Add "{searchQuery}" to Database
                </Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.emptySubtext}>
                Ask a Worship Leader or Musician to add this song.
              </Text>
            )}
          </View>
        }
      />

      {/* Alphabet scroll bar */}
      {alphabet.length > 0 && (
        <View style={styles.alphabetSidebar}>
          {alphabet.map((letter) => (
            <TouchableOpacity 
              key={letter} 
              onPress={() => scrollToLetter(letter)}
              style={styles.alphabetLetterContainer}
              activeOpacity={0.6}
            >
              <Text style={[styles.alphabetLetterText, { color: themeColor }]}>{letter}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0B0F19",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderColor: "#1E293B",
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  addButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 4,
  },
  addButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  searchContainer: {
    flexDirection: "row",
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: "#0B0F19",
    position: "relative",
  },
  searchInput: {
    flex: 1,
    backgroundColor: "#1E293B",
    borderRadius: 12,
    height: 48,
    paddingHorizontal: 16,
    color: "#FFFFFF",
    fontSize: 15,
    borderWidth: 1,
    borderColor: "#334155",
  },
  clearButton: {
    position: "absolute",
    right: 32,
    top: 24,
    justifyContent: "center",
    alignItems: "center",
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#334155",
  },
  clearButtonText: {
    color: "#94A3B8",
    fontSize: 10,
    fontWeight: "bold",
  },
  listContent: {
    paddingLeft: 20,
    paddingRight: 32,
    paddingTop: 20,
    paddingBottom: 100, // Safe padding for bottom tab navigation
  },
  songCard: {
    backgroundColor: "#1E293B",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#334155",
    padding: 16,
    marginBottom: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  titleContainer: {
    flex: 1,
    paddingRight: 10,
  },
  songTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 4,
  },
  songArtist: {
    color: "#94A3B8",
    fontSize: 14,
    fontWeight: "500",
  },
  keyBadge: {
    borderWidth: 2,
    borderRadius: 10,
    minWidth: 42,
    paddingHorizontal: 6,
    height: 42,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  keyText: {
    fontWeight: "800",
  },
  cardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    borderColor: "#334155",
    paddingTop: 12,
  },
  metaInfo: {
    flexDirection: "row",
    alignItems: "center",
  },
  metaItem: {
    color: "#64748B",
    fontSize: 12,
    fontWeight: "600",
    marginRight: 14,
  },
  tagsContainer: {
    flexDirection: "row",
  },
  tagBadge: {
    backgroundColor: "#111827",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginLeft: 6,
    borderWidth: 1,
    borderColor: "#1E293B",
  },
  tagText: {
    color: "#94A3B8",
    fontSize: 10,
    fontWeight: "700",
  },
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
  },
  emptyEmoji: {
    fontSize: 48,
    marginBottom: 16,
    opacity: 0.6,
  },
  emptyText: {
    color: "#94A3B8",
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 16,
  },
  emptyAddButton: {
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginTop: 8,
  },
  emptyAddButtonText: {
    fontSize: 14,
    fontWeight: "700",
  },
  emptySubtext: {
    color: "#475569",
    fontSize: 13,
    fontWeight: "500",
    textAlign: "center",
  },
  alphabetSidebar: {
    position: "absolute",
    right: 6,
    top: 140,
    bottom: 100,
    justifyContent: "center",
    alignItems: "center",
    width: 24,
    backgroundColor: "rgba(15, 23, 42, 0.6)",
    borderRadius: 12,
    paddingVertical: 10,
    zIndex: 10,
  },
  alphabetLetterContainer: {
    paddingVertical: 3,
    width: "100%",
    alignItems: "center",
  },
  alphabetLetterText: {
    fontSize: 11,
    fontWeight: "800",
  },
});
