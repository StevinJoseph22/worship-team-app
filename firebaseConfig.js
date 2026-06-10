import { initializeApp, getApps, getApp } from "firebase/app";
import { initializeAuth, getReactNativePersistence, getAuth } from "firebase/auth";
import ReactNativeAsyncStorage from "@react-native-async-storage/async-storage";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";

// =========================================================================
// 🔔 DEMO MODE TOGGLE (VERY IMPORTANT!)
// =========================================================================
// Set this to true to run the app in Demo Mode (simulates all Firebase operations).
// Set this to false to connect to your real live Firebase backend!
export const USE_DEMO_MODE = false;

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAn2P7lSkrM_9iaYZCR06Bc9TOKH36LIFo",
  authDomain: "worshipteamapp-c84e2.firebaseapp.com",
  projectId: "worshipteamapp-c84e2",
  storageBucket: "worshipteamapp-c84e2.firebasestorage.app",
  messagingSenderId: "750751907893",
  appId: "1:750751907893:web:16e54b01b61154c3f0f17c"
};

let app;
let auth;
let db;
let functions;

if (!USE_DEMO_MODE) {
  try {
    // 1. Ensure Firebase App is ready/initialized first
    if (getApps().length === 0) {
      app = initializeApp(firebaseConfig);
    } else {
      app = getApp();
    }
    
    // 2. Initialize Auth with AsyncStorage persistence to remember login state
    try {
      auth = initializeAuth(app, {
        persistence: getReactNativePersistence(ReactNativeAsyncStorage)
      });
    } catch (authError) {
      // Fallback if already initialized (hot reloading / fast refresh)
      auth = getAuth(app);
    }
    
    // 3. Initialize Firestore
    db = getFirestore(app);
    
    // 4. Initialize Functions
    functions = getFunctions(app);
    
    console.log("🔥 Firebase initialized successfully!");
  } catch (error) {
    console.error("❌ Firebase initialization error:", error);
  }
}

export { auth, db, functions };
