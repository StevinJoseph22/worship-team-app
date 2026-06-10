import { Alert } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { httpsCallable } from "firebase/functions";
import { USE_DEMO_MODE, functions, auth } from "../firebaseConfig";

/**
 * Clean and standardize phone number to E.164 format.
 * - Removes spaces, dashes, parentheses.
 * - Adds +91 (India) prefix if no leading '+' is present.
 */
export function formatE164PhoneNumber(phoneNumber) {
  if (!phoneNumber) return "";
  
  // Strip all whitespace, dashes, and parentheses
  let cleaned = phoneNumber.replace(/[\s\-\(\)]/g, "");
  
  // If the number doesn't start with a plus sign, default to +91 (India)
  if (!cleaned.startsWith("+")) {
    cleaned = `+91${cleaned}`;
  }
  
  return cleaned;
}

/**
 * Returns a formatted message string according to the requested notification type and parameters.
 * 
 * Types and parameters:
 * - roster_published: { eventName, date }
 * - song_assigned: { songTitle, eventName }
 * - task_assigned: { delegatorName, taskDescription, date }
 * - general: { message }
 */
export function getWhatsAppMessageTemplate(type, params = {}) {
  const appLink = "\n\n🔗 *Click here to open the app*: https://worshipteamapp-c84e2.web.app";
  switch (type) {
    case "roster_published":
      return `🎵 *Elim Worship* — New roster published for ${params.eventName || "[Event Name]"} on ${params.date || "[Date]"}. Open the Worship Team App to view your assignments.${appLink}`;
      
    case "song_assigned":
      return `🎸 *Elim Worship* — You have been assigned to *${params.songTitle || "[Song Title]"}* in ${params.eventName || "[Event Name]"}. Open the app to see chord charts and lyrics.${appLink}`;
      
    case "task_assigned":
      return `✅ *Elim Worship* — *${params.delegatorName || "A Leader"}* has assigned you a task: ${params.taskDescription || "[Task Description]"}. Due: ${params.date || "[Date]"}.${appLink}`;
      
    case "general":
    default:
      return `🙏 *Elim Worship* — ${params.message || ""}${appLink}`;
  }
}

/**
 * Core WhatsApp notification dispatcher.
 * Automatically handles offline/demo simulation vs real production Cloud Function dispatch.
 * 
 * @param {string} phoneNumber - Recipient's phone number
 * @param {string} message - Message text to send
 * @param {string} type - Notification type string (roster_published / song_assigned / task_assigned / general)
 * @returns {Promise<{success: boolean, error?: string, messageId?: string}>}
 */
export async function sendWhatsApp(phoneNumber, message, type) {
  if (!phoneNumber) {
    console.warn("WhatsApp Service: Recipient phone number is empty.");
    return { success: false, error: "Phone number is required." };
  }

  // 1. Sanitize the phone number
  const cleanPhone = formatE164PhoneNumber(phoneNumber);
  console.log(`WhatsApp Service: Dispatching to ${cleanPhone} (Type: ${type})`);

  // 2. Demo Mode Simulation
  if (USE_DEMO_MODE) {
    console.log(`[DEMO MODE WHATSAPP SIMULATOR]`);
    console.log(`To: ${cleanPhone}`);
    console.log(`Message: "${message}"`);
    console.log(`Type: ${type}`);

    try {
      // Mock logging into AsyncStorage under @worship_team_notifications_log
      const storedLogs = await AsyncStorage.getItem("@worship_team_notifications_log");
      const currentLogs = storedLogs ? JSON.parse(storedLogs) : [];
      
      const newLog = {
        docId: "mock-log-" + Math.floor(Math.random() * 1000000),
        to: cleanPhone,
        message: message,
        type: type,
        status: "sent",
        sentAt: new Date().toISOString(),
        sentBy: auth?.currentUser?.uid || "demo-leader-111",
      };

      await AsyncStorage.setItem(
        "@worship_team_notifications_log",
        JSON.stringify([newLog, ...currentLogs])
      );

      console.log("WhatsApp Audit Log synchronized locally in AsyncStorage.");
      return { success: true, messageId: newLog.docId };
    } catch (err) {
      console.error("WhatsApp local logging failed:", err);
      return { success: false, error: err.message };
    }
  }

  // 3. Real Live Firebase Cloud Function Mode
  try {
    if (!functions) {
      throw new Error("Firebase Functions SDK is not initialized.");
    }

    const sendWhatsAppNotificationFn = httpsCallable(functions, "sendWhatsAppNotification");
    const response = await sendWhatsAppNotificationFn({
      to: cleanPhone,
      message: message,
      type: type,
    });

    if (response.data && response.data.success) {
      return { success: true, messageId: response.data.messageSid };
    } else {
      throw new Error(response.data?.error || "Unknown server response error");
    }
  } catch (error) {
    console.error("WhatsApp Live Dispatch Error:", error);
    return { success: false, error: error.message || String(error) };
  }
}
