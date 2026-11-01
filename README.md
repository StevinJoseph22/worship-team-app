<div align="center">

<img src="assets/logo.png" alt="Elim Worship Team App Logo" width="150"/>

# Elim Worship Team App

### A full-featured, cross-platform React Native application for church worship team coordination

[![Built with Expo](https://img.shields.io/badge/Built%20with-Expo%20SDK%2054-000020?style=for-the-badge&logo=expo)](https://expo.dev)
[![Firebase](https://img.shields.io/badge/Backend-Firebase-FFCA28?style=for-the-badge&logo=firebase)](https://firebase.google.com)
[![React Native](https://img.shields.io/badge/React%20Native-0.81.5-61DAFB?style=for-the-badge&logo=react)](https://reactnative.dev)
[![Platform](https://img.shields.io/badge/Platform-Android%20%7C%20iOS%20%7C%20Web-green?style=for-the-badge)](https://worshipteamapp-c84e2.web.app)

**Live Web App:** [https://worshipteamapp-c84e2.web.app](https://worshipteamapp-c84e2.web.app)  
**Admin Portal:** [https://worshipteamapp-c84e2.web.app/admin.html](https://worshipteamapp-c84e2.web.app/admin.html)

</div>

---

## 📖 Table of Contents
1. [Project Overview](#-project-overview)
2. [Features](#-features)
3. [Technology Stack](#-technology-stack)
4. [App Screens & Navigation](#-app-screens--navigation)
5. [Role-Based Access Control](#-role-based-access-control)
6. [Song Sheet Formatting Guide](#-song-sheet-formatting-guide)
7. [Installation & Local Setup](#-installation--local-setup)
8. [Environment & Firebase Configuration](#-environment--firebase-configuration)
9. [Building the App (Android APK / iOS IPA)](#-building-the-app-android-apk--ios-ipa)
10. [Deploying the Web App](#-deploying-the-web-app)
11. [Database Schema](#-database-schema)
12. [Super Admin Bulk Song Uploader](#-super-admin-bulk-song-uploader)
13. [Project Structure](#-project-structure)
14. [Troubleshooting](#-troubleshooting)
15. [Contributing](#-contributing)

---

## 🎯 Project Overview

The **Elim Worship Team App** is a production-grade, cross-platform mobile and web application built for the **Elim Church** worship ministry team. It provides a unified, real-time platform for worship leaders, musicians, vocalists, and administrators to:

- Coordinate and schedule services with full setlist management.
- Practice songs with real-time chord transposition, bilingual (English/Tamil) lyric display, and an integrated metronome.
- Delegate preparation tasks and track readiness across the entire team.
- Send automated WhatsApp alerts with personalized schedule details for each team member.
- Manage team member roles and permissions through a protected admin panel.

The application runs natively on **Android** (via APK), **iOS** (via TestFlight/App Store), and as a full **Progressive Web App** accessible via a link — specifically designed so iOS users can access it through a simple WhatsApp link share without needing to download anything.

---

## ✨ Features

### 🎵 Song Library & Practice Tools
- **Bilingual Song Database**: Full chord charts with both English and Tamil lyrics stored side-by-side.
- **Real-Time Chord Transposition**: Shift keys by semitone (`+`/`-`) with instant chord recalculation across both language views.
- **Nashville Number System (NNS)**: Toggle to display chords as scale degree numbers (e.g., G → 1, C → 4, D → 5) for any key.
- **Accidental Spelling Control**: Force **Sharp** (`C#`) or **Flat** (`Db`) notation to match each musician's preference.
- **Collapsible Section View**: Organize and collapse Intro, Verse, Chorus, Bridge, Outro sections for clean reading during rehearsal.
- **Audio Play-Along Player**: Embedded audio guide player linked to Firebase Storage for vocal/instrument reference tracks.
- **Integrated Metronome**: Click track with tap-tempo, BPM slider, and visual beat flash indicator.
- **ChordPro Bracket Format**: Full support for inline bracket chord formatting (`[G]Bless the [D]Lord`).

### 📅 Service Planning & Scheduling
- **Roster Management**: Create, edit, and publish service rosters with date, theme, and song setlists.
- **Song Ordering**: Drag-and-drop song reordering within a setlist.
- **Team Assignments**: Assign specific team members (Keyboard, Guitar, Bass, Drums, Vocals) to each service.
- **New Song Highlighting**: Songs added that don't exist in the database are automatically flagged as "NEW" in the roster view.
- **WhatsApp Message Generator**: One-tap copy of a fully formatted team notification message, with role-specific details:
  - **Musicians**: Service date, songs, keys, BPM, and practice date.
  - **Choir Vocalists**: Songs, YouTube/Spotify reference links, and practice date.
  - **Footer link**: Direct link to the web app (`https://worshipteamapp-c84e2.web.app`).

### 📋 Smart Task Delegation
- **Task Creation**: Create preparation tasks with a description, due date, and assignees.
- **Multi-Assignee Support**: Assign tasks to multiple team members simultaneously.
- **Calendar Due Date Picker**: Visual calendar pop-up for due date selection.
- **Status Badges**: Color-coded task status — ⚠️ Due Soon, 🔴 Overdue, ✅ Completed.
- **Task Completion**: When any assigned member marks a task complete, it updates globally for all assignees.
- **Notifications**: Push notification reminders when tasks are approaching their due date.

### 📊 Analytics Dashboard
- **Service Readiness Chart**: Visual chart showing what percentage of vocalists and musicians have confirmed they are "Ready" for the upcoming service.
- **Practice Completion Reports**: Track how many assigned team members have practiced each song.
- **Top Song Statistics**: See which songs appear most frequently across your setlists.
- **Team Activity Logs**: Roster creation dates, team role distribution, and recent sign-up activity.

### 🛡️ Admin Panel & User Management
- **User Directory**: Full list of all registered team members with role badges and registration dates.
- **Role Promotion Flow**:
  - Worship Leaders can **propose** role upgrades.
  - Super Admins **approve** proposed changes before they take effect.
- **Pending Approval Queue**: A dedicated section for review and approval/rejection of pending role change requests.
- **Bulk Song Uploader Link**: Super Admins can navigate directly to the web-based `/admin.html` uploader from within the app.

### 🤖 AI-Powered Smart Song Import
- **In-App Browser Search**: Opens a Google lyrics search directly inside the app (`react-native-webview`).
- **Text Selection & Import**: Long-press any text on a webpage to select and import lyrics directly into the song editor.
- **Auto Language Detection**: Automatically separates Tamil and English lines using Unicode character range detection.
- **AI Section Organization**: Uses **Google Gemini 1.5 Flash** to detect and inject section labels (Verse 1, Chorus, Bridge) into the imported lyrics.
- **Key & Chord Detection**: AI detects the original key and chord chart from the imported text.
- **Smart Section Merge**: Merges the AI-organized chord chart with the AI-organized lyrics.

### 🔔 Push Notifications
- **Background Notifications**: Real system-tray push notifications using `expo-notifications` with native plugin configuration.
- **Notification Triggers**: Notifications fire when a new roster is published, a task is assigned, or a readiness deadline approaches.
- **iOS & Android Support**: Configured with `UIBackgroundModes: remote-notification` (iOS) and native Android receivers (Android).

---

## 🛠️ Technology Stack

| Layer | Technology |
|:---|:---|
| **Framework** | React Native 0.81.5 (via Expo SDK 54) |
| **Web Support** | React Native Web 0.21+ |
| **Build System** | Expo Application Services (EAS Build) |
| **Database** | Firebase Firestore (real-time NoSQL) |
| **Authentication** | Firebase Auth (phone-based with synthetic email mapping) |
| **Storage** | Firebase Storage (audio guides) |
| **Cloud Functions** | Firebase Functions (WhatsApp dispatch) |
| **Hosting** | Firebase Hosting (web app at `worshipteamapp-c84e2.web.app`) |
| **Notifications** | Expo Notifications (background push) |
| **AI / ML** | Google Gemini 1.5 Flash API (lyrics & chord detection) |
| **SMS / OTP** | Twilio SMS API (via Firebase Functions) |
| **Navigation** | Custom state-driven screen stack |
| **Audio** | `expo-av` + `expo-audio` |
| **File Parsing** | `Mammoth.js` (Word `.docx` → plain text in browser) |

---

## 📱 App Screens & Navigation

### Public Screens
| Screen | Component | Description |
|:---|:---|:---|
| Splash | `SplashScreen.js` | Animated intro splash with logo |
| Onboarding | `OnboardingScreen.js` | 4-slide feature intro carousel |
| Login | `LoginScreen.js` | Password or OTP (SMS) authentication |
| Register | `RegisterScreen.js` | New user phone + password registration |
| Phone Input | `PhoneInputScreen.js` | OTP initiation step |
| OTP Verify | `OtpVerifyScreen.js` | 6-digit SMS code verification |

### Authenticated Screens (Bottom Navigation)
| Screen | Component | Role Access | Description |
|:---|:---|:---|:---|
| Dashboard | `Dashboards.js` | All | Home hub with upcoming service & readiness check-in |
| Song Search | `SongSearchScreen.js` | All | Song library search |
| Song Detail | `SongDetailScreen.js` | All | Chord/lyric viewer with transposition & practice tools |
| Add/Edit Song | `AddSongScreen.js` | Worship Leader, Super Admin | Song creation with AI import |
| Roster | `RosterScreen.js` | Worship Leader, Super Admin | Service scheduling & setlist builder |
| Tasks | `TasksScreen.js` | All | Task delegation and completion tracking |
| Analytics | `AnalyticsScreen.js` | Worship Leader, Super Admin | Team stats & readiness dashboard |
| Admin Panel | `AdminPanelScreen.js` | Worship Leader, Super Admin | User directory & role management |
| Profile | `ProfileScreen.js` | All | User profile, name editing, logout |
| Metronome | `MetronomeScreen.js` | All | Standalone click track tool |

---

## 👥 Role-Based Access Control

The app implements a strict **Role-Based Access Control (RBAC)** system stored in Firebase Firestore:

| Role | Key | Capabilities |
|:---|:---|:---|
| **Super Admin** | `super_admin` | All access. Approves role changes. Manages bulk song uploads. Can delete any song, roster, or user. |
| **Worship Leader** | `worship_leader` | Creates rosters, manages setlists, delegates tasks, proposes role changes, views analytics. |
| **Band Musician** | `musician` | Views/practises songs, transposes chords, uses metronome/audio, marks tasks complete. |
| **Choir Vocalist** | `choir_member` | Views lyrics, uses audio play-alongs, checks in readiness. |
| **Team Member** | `member` | Default after registration. View-only access to rosters and song library. |

### Promotion Workflow
```
New Signup (member)
        ↓
Worship Leader proposes role change
        ↓
Super Admin sees pending request → Approves / Rejects
        ↓
Role committed to Firestore → Access granted instantly
```

---

## 🎼 Song Sheet Formatting Guide

The app uses a **ChordPro-style bracket format** to store and render songs. This allows chords to be aligned precisely over specific syllables.

### Correct Format (Inline Bracket Chords)
```
[Verse 1]
[G]Bless the [D]Lord O my [Em]soul
O my [C]soul
[G]Worship His [D]holy [C]name

[Chorus]
[G]Sing like [D]never before
O my [Em]soul [C]
I'll worship Your [G]holy [D]name
```

### Section Tags (must be on their own line)
```
[Intro]      [Verse 1]    [Verse 2]    [Verse 3]
[Pre-Chorus] [Chorus]     [Bridge]     [Outro]     [Tag]
```

### Tamil Format (same syntax)
```
[Verse 1]
[G]என் ஆத்துமாவே [D]கர்த்தரை [Em]ஸ்தோத்திரி
[C]அவரது பரிசுத்த [G]நாமத்தை [D]துதி
```

> ⚠️ **Important**: If chords are placed on a separate line ABOVE lyrics (the traditional "text tab" format), the parser will treat the chord line as plain text lyrics. Always use the inline `[Chord]` bracket format.

---

## 🚀 Installation & Local Setup

### Prerequisites
- **Node.js** v18 or higher
- **npm** v9 or higher
- **Expo CLI**: `npm install -g expo-cli`
- **EAS CLI**: `npm install -g eas-cli`
- **Firebase CLI**: `npm install -g firebase-tools`
- An active **Firebase project** (see Configuration section below)

### Steps

```bash
# 1. Clone the repository
git clone https://github.com/StevinJoseph22/worship-team-app.git
cd worship-team-app

# 2. Install dependencies
npm install

# 3. Install functions dependencies
cd functions && npm install && cd ..

# 4. Start the Expo development server
npx expo start

# 5. Run on a device or emulator:
# Android: press 'a'
# iOS: press 'i'
# Web: press 'w'
```

---

## 🔧 Environment & Firebase Configuration

### 1. Firebase Project Setup
1. Go to [Firebase Console](https://console.firebase.google.com) and create a new project.
2. Enable **Firestore Database**.
3. Enable **Firebase Authentication** → Email/Password provider.
4. Enable **Firebase Storage**.
5. Enable **Firebase Hosting**.
6. Go to **Project Settings** → Add a **Web App** and copy the config values.

### 2. Update `firebaseConfig.js`
```js
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

### 3. Android Google Services
- Download `google-services.json` from Firebase Console → Project Settings → Android App.
- Place it in the root directory of this project.

### 4. Deploy Firestore Security Rules
```bash
firebase deploy --only firestore:rules
```

### 5. Deploy Cloud Functions (WhatsApp / Twilio)
Set your Twilio credentials in Firebase:
```bash
firebase functions:config:set twilio.account_sid="YOUR_TWILIO_SID" twilio.auth_token="YOUR_TWILIO_TOKEN" twilio.from_number="whatsapp:+14155238886"
firebase deploy --only functions
```

### 6. Gemini AI API Key (Optional)
For the smart song import AI feature, add your Gemini API key to Firestore:
- Collection: `config` → Document: `ai_keys`
- Field: `gemini` → Value: `YOUR_GEMINI_API_KEY`

---

## 📦 Building the App (Android APK / iOS IPA)

This project uses **EAS Build** (Expo Application Services) for native builds.

### Login to EAS
```bash
eas login
```

### Configure EAS (first time)
```bash
eas build:configure
```

### Build Android APK (standalone, no Play Store required)
```bash
eas build --platform android --profile preview
```
> The `preview` profile in `eas.json` is configured to produce a standalone APK file.

### Build Android AAB (for Play Store)
```bash
eas build --platform android --profile production
```

### Build iOS IPA (for TestFlight / App Store)
```bash
eas build --platform ios --profile production
```

> **iOS Note**: You will need an Apple Developer account. When prompted about encryption, the app uses standard/exempt encryption (`ITSAppUsesNonExemptEncryption: false`).

---

## 🌐 Deploying the Web App

The web app is compiled from the React Native codebase using Expo's web export and hosted on **Firebase Hosting**.

```bash
# 1. Build the web bundle
npx expo export --platform web

# 2. Deploy to Firebase Hosting
firebase deploy --only hosting
```

Live URL: [https://worshipteamapp-c84e2.web.app](https://worshipteamapp-c84e2.web.app)  
Admin Portal: [https://worshipteamapp-c84e2.web.app/admin.html](https://worshipteamapp-c84e2.web.app/admin.html)

> The `firebase.json` file is configured to serve from the `dist/` folder which Expo generates. The `public/admin.html` file is automatically copied to `dist/admin.html` during the export step.

---

## 🗄️ Database Schema

### `/users/{uid}`
```json
{
  "uid": "string",
  "displayName": "string",
  "phone": "+91XXXXXXXXXX",
  "role": "super_admin | worship_leader | musician | choir_member | member",
  "pendingRole": "string | null",
  "pendingRoleRequestedBy": "string | null",
  "pushToken": "ExpoToken[...]",
  "createdAt": 1700000000000
}
```

### `/songs/{songId}`
```json
{
  "title": "string",
  "artist": "string",
  "originalKey": "G",
  "tempo": "78",
  "lyricsEnglish": "[Verse 1]\n[G]Bless the...",
  "lyricsTamil": "[Verse 1]\n[G]என்...",
  "audioUrl": "https://firebasestorage.googleapis.com/...",
  "youtubeLink": "https://youtube.com/...",
  "spotifyLink": "https://open.spotify.com/...",
  "tags": ["praise", "worship"],
  "createdBy": "uid",
  "createdAt": 1700000000000
}
```

### `/rosters/{rosterId}`
```json
{
  "eventName": "Sunday Morning Service",
  "eventType": "Sunday Morning",
  "eventDate": "June 15, 2026, 7:00 AM",
  "rehearsalDate": "June 13, 2026, 6:30 PM",
  "worshipLeader": "string (displayName)",
  "status": "draft | published",
  "setlist": [
    {
      "songId": "string",
      "title": "string",
      "key": "G",
      "tempo": "78",
      "isNewSong": false,
      "assignedChoir": ["uid1", "uid2"],
      "assignedMusicians": ["uid3"]
    }
  ],
  "teamAssignments": {
    "Keyboard": "Member Name",
    "Guitar": "Member Name"
  },
  "createdBy": "uid",
  "createdAt": 1700000000000
}
```

### `/tasks/{taskId}`
```json
{
  "description": "Learn the keyboard intro solo",
  "dueDate": "2026-06-14",
  "assignedTo": ["uid1", "uid2"],
  "assignedBy": "uid",
  "completedBy": ["uid1"],
  "rosterId": "string | null",
  "createdAt": 1700000000000
}
```

### `/notifications/{notifId}`
```json
{
  "type": "roster_published | task_assigned | role_update",
  "title": "New Roster Published",
  "body": "Sunday Morning service for June 15 has been published.",
  "rosterId": "string | null",
  "readBy": ["uid1"],
  "createdAt": 1700000000000
}
```

---

## 📥 Super Admin Bulk Song Uploader

The bulk uploader is available at `/admin.html` and is intended for Super Admins only.

### Access
1. Navigate to [https://worshipteamapp-c84e2.web.app/admin.html](https://worshipteamapp-c84e2.web.app/admin.html)
2. Log in with your Super Admin phone number and password.

### Features
- **Drag & Drop `.docx` files**: Uses `Mammoth.js` to parse Word documents client-side. Filename becomes the song title.
- **Clipboard Paste**: Paste raw lyrics text and the system parses them.
- **Auto Language Detection**: Splits Tamil and English lines using Unicode range `/[\u0B80-\u0BFF]/`.
- **Preview Table**: Editable preview before committing to Firestore.
- **Batch Publish**: Uploads all songs to Firestore `/songs` collection in one click.

### `.docx` File Naming Convention
Name each `.docx` file exactly as the song title:
```
Amazing Grace.docx
Bless the Lord.docx
Hosanna.docx
```

---

## 📁 Project Structure

```
worship-team-app/
├── App.js                        # Root app component & navigation controller
├── app.json                      # Expo app configuration (plugins, permissions)
├── eas.json                      # EAS Build profiles (preview APK, production AAB/IPA)
├── firebase.json                 # Firebase CLI config (hosting: dist/, firestore rules)
├── firebaseConfig.js             # Firebase SDK initialization
├── firestore.rules               # Firestore Security Rules
├── metro.config.js               # Metro bundler config for web support
├── package.json                  # NPM dependencies
│
├── assets/                       # Static images
│   ├── logo.png
│   ├── icon.png
│   └── adaptive-icon.png
│
├── components/                   # React Native screen components
│   ├── AddSongScreen.js          # Song creation & AI import
│   ├── AdminPanelScreen.js       # User management & role approvals
│   ├── AnalyticsScreen.js        # Service & practice analytics
│   ├── BottomNavBar.js           # Tab navigation bar
│   ├── Dashboards.js             # Home dashboard & setlist view
│   ├── LoginScreen.js            # Password/OTP login
│   ├── MetronomeScreen.js        # Standalone metronome
│   ├── OnboardingScreen.js       # Onboarding carousel
│   ├── OtpVerifyScreen.js        # SMS OTP verification
│   ├── PhoneInputScreen.js       # Phone number input for OTP
│   ├── ProfileScreen.js          # User profile & settings
│   ├── RegisterScreen.js         # New user registration
│   ├── ResetPasswordModal.js     # Password reset flow
│   ├── RosterScreen.js           # Service planning & setlist builder
│   ├── SongDetailScreen.js       # Song view + transposition + practice tools
│   ├── SongSearchScreen.js       # Song library search
│   ├── SplashScreen.js           # Animated intro splash
│   └── TasksScreen.js            # Task delegation & tracking
│
├── services/                     # Business logic services
│   ├── aiService.js              # Gemini API calls (lyrics & chord detection)
│   ├── notificationService.js    # Expo push notification helpers
│   └── whatsappService.js        # WhatsApp message template generator
│
├── functions/                    # Firebase Cloud Functions
│   ├── index.js                  # Twilio WhatsApp dispatch function
│   └── package.json              # Functions dependencies
│
└── public/                       # Static web assets (copied to dist/ on export)
    └── admin.html                # Super Admin Bulk Song Uploader web portal
```

---

## 🛠️ Troubleshooting

### App says "Awaiting Administrator Approval" after registration
This is expected. Your account starts with the default `member` role. A Super Admin or Worship Leader must promote your role via the **Admin Panel** before you gain full access.

### OTP / SMS not arriving
- Verify your country dial code is correct (e.g., `+91` for India).
- Check if the Twilio account is in sandbox mode (only approved numbers receive SMS in sandbox).
- Contact your admin to check Twilio logs in Firebase Functions.

### "Missing or insufficient permissions" Firestore error
- Your user role may not have been promoted yet.
- If recently promoted, try signing out and signing back in to refresh your auth claims.

### Metronome audio not playing (Web)
- Browsers block audio until a user interaction. Tap anywhere on the page first, then start the metronome.

### AI Song Import not detecting sections correctly
- The Gemini API requires a valid API key stored in Firestore (`/config/ai_keys → gemini`).
- If no key is present, the system falls back to mock mode (no AI organization).

### Build fails: `expo-notifications` plugin error
- Ensure `app.json` includes the `expo-notifications` plugin:
  ```json
  "plugins": [
    "expo-asset",
    "expo-audio",
    ["expo-notifications", { "icon": "./assets/icon.png", "color": "#0B0F19" }]
  ]
  ```

---

## 🤝 Contributing

This project is currently maintained for internal use by **Elim Church**. If you are a developer on the team:

1. Create a feature branch: `git checkout -b feature/my-feature`
2. Commit your changes: `git commit -m "Add my feature"`
3. Push the branch: `git push origin feature/my-feature`
4. Open a Pull Request on GitHub.

---

## 📄 License

This project is proprietary software developed for **Elim Church**. All rights reserved.

---

<div align="center">

Built with ❤️ for the **Elim Worship Team**

</div>
