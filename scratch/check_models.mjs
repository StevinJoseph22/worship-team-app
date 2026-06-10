import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc } from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth";

const firebaseConfig = {
    apiKey: "AIzaSyAn2P7lSkrM_9iaYZCR06Bc9TOKH36LIFo",
    authDomain: "worshipteamapp-c84e2.firebaseapp.com",
    projectId: "worshipteamapp-c84e2",
    storageBucket: "worshipteamapp-c84e2.firebasestorage.app",
    messagingSenderId: "750751907893",
    appId: "1:750751907893:web:16e54b01b61154c3f0f17c"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

async function run() {
  try {
    console.log("🔐 Authenticating anonymously...");
    await signInAnonymously(auth);
    console.log("✅ Authenticated successfully.");

    const docRef = doc(db, "config", "gemini");
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists()) {
      console.log("❌ config/gemini document not found in Firestore.");
      process.exit(1);
    }
    const data = docSnap.data();
    if (!data || !data.apiKey) {
      console.log("❌ apiKey field not found in config/gemini document.");
      process.exit(1);
    }
    const key = data.apiKey.trim();
    console.log("🔑 Retrieved Gemini Key. Querying models list...");
    
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
    const response = await fetch(url);
    const result = await response.json();
    
    console.log("📋 Gemini API Response:");
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (e) {
    console.error("❌ Execution failed:", e);
    process.exit(1);
  }
}

run();
