const functions = require("firebase-functions");
const admin = require("firebase-admin");

// Initialize Firebase Admin SDK
if (admin.apps.length === 0) {
  admin.initializeApp();
}

/**
 * Cloud Function to send WhatsApp notifications via Twilio Sandbox.
 * Triggered as an HTTPS Callable function.
 * 
 * Parameters (data):
 * - to: Phone number string (e.g. '+919876543210')
 * - message: Message body string
 * - type: String (roster_published / song_assigned / task_assigned / general)
 */
exports.sendWhatsAppNotification = functions.https.onCall(async (data, context) => {
  // 1. Enforce Authentication Clearance
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Authentication required. Only registered members can trigger notifications."
    );
  }

  const { to, message, type } = data;

  // 2. Validate Input Parameters
  if (!to || !message || !type) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Missing required arguments. Parameter 'to', 'message', and 'type' are mandatory."
    );
  }

  // 3. Retrieve Secure twilio Environment Configs (supporting Env variables & Firebase Config fallback)
  let twilioSid = process.env.TWILIO_SID;
  let twilioToken = process.env.TWILIO_TOKEN;
  let twilioFrom = process.env.TWILIO_FROM || "whatsapp:+14155238886";

  // Fallback to legacy Firebase functions:config:set structures
  const config = functions.config();
  if (config.twilio) {
    twilioSid = twilioSid || config.twilio.sid;
    twilioToken = twilioToken || config.twilio.token;
    twilioFrom = twilioFrom || config.twilio.from;
  }

  if (!twilioSid || !twilioToken) {
    console.error("Twilio credentials configuration not found in environment.");
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Twilio credentials (sid/token) are not configured on the server."
    );
  }

  // 4. Initialize Twilio client
  const client = require("twilio")(twilioSid, twilioToken);

  // 5. Standardize phone numbers to Twilio E.164 WhatsApp syntax
  let formattedTo = to.replace(/[\s\-\(\)]/g, "");
  if (!formattedTo.startsWith("whatsapp:")) {
    formattedTo = `whatsapp:${formattedTo}`;
  }

  let formattedFrom = twilioFrom;
  if (!formattedFrom.startsWith("whatsapp:")) {
    formattedFrom = `whatsapp:${formattedFrom}`;
  }

  let status = "sent";
  let errorDetail = "";
  let twilioMessageSid = "";

  try {
    // 6. Deliver WhatsApp message via Twilio SDK
    const response = await client.messages.create({
      body: message,
      from: formattedFrom,
      to: formattedTo,
    });
    twilioMessageSid = response.sid;
    console.log(`WhatsApp notification successfully sent! SID: ${twilioMessageSid}`);
  } catch (error) {
    console.error("Twilio WhatsApp dispatch failed:", error);
    status = "failed";
    errorDetail = error.message || String(error);
  }

  // 7. Write notification audit logs in Firestore under /notifications_log/{docId}
  try {
    const db = admin.firestore();
    const logDoc = {
      to: to,
      message: message,
      type: type,
      status: status,
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      sentBy: context.auth.uid,
    };

    if (twilioMessageSid) {
      logDoc.twilioSid = twilioMessageSid;
    }
    if (status === "failed") {
      logDoc.error = errorDetail;
    }

    await db.collection("notifications_log").add(logDoc);
    console.log("Audit log saved successfully under /notifications_log");
  } catch (logError) {
    console.error("Failed to write audit logs to Firestore:", logError);
  }

  // 8. Return final operational outcome
  if (status === "failed") {
    throw new functions.https.HttpsError(
      "internal",
      `Twilio operation failed: ${errorDetail}`
    );
  }

  return { success: true, messageSid: twilioMessageSid };
});
