const admin = require("firebase-admin");

if (admin.apps.length === 0) {
  admin.initializeApp({ projectId: "worshipteamapp-c84e2" });
}

async function run() {
  try {
    const db = admin.firestore();
    const docSnap = await db.collection("config").doc("gemini").get();
    if (!docSnap.exists) {
      console.log("❌ No Gemini API key found in Firestore config/gemini.");
      process.exit(1);
    }
    
    const key = docSnap.data().apiKey.trim();
    console.log("🔑 Retrieved Gemini Key. Querying models...");
    
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
    const response = await fetch(url);
    const data = await response.json();
    
    console.log("📋 Gemini API Response:");
    console.log(JSON.stringify(data, null, 2));
    process.exit(0);
  } catch (e) {
    console.error("❌ Execution failed:", e);
    process.exit(1);
  }
}

run();
