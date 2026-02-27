import { FirebaseApp, initializeApp } from "firebase/app";
import { Auth, getAuth, GoogleAuthProvider, setPersistence, browserLocalPersistence } from "firebase/auth";
import { Firestore, getFirestore } from "firebase/firestore";

// Your web app's Firebase configuration
// These should be populated with process.env or import.meta.env
const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID
};

// Initialize Firebase only if the API key is present and seemingly valid
const apiKey = import.meta.env.VITE_FIREBASE_API_KEY;
const isFirebaseConfigured = Boolean(apiKey && apiKey.length > 5 && apiKey !== 'undefined');

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let googleProvider: GoogleAuthProvider | undefined;
let db: Firestore | undefined;

if (isFirebaseConfigured) {
    try {
        app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);

        // Set persistence to Local, so the user stays logged in across reloads
        setPersistence(auth, browserLocalPersistence)
            .catch((error) => console.error("Error setting persistence:", error));

        googleProvider = new GoogleAuthProvider();
    } catch (error) {
        console.error("Firebase initialization error", error);
    }
}

export { auth, googleProvider, db, isFirebaseConfigured };
