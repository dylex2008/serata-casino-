import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getDatabase,
  onValue,
  push,
  ref,
  serverTimestamp,
  set,
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "INSERISCI_API_KEY",
  authDomain: "INSERISCI_AUTH_DOMAIN",
  databaseURL: "INSERISCI_DATABASE_URL",
  projectId: "INSERISCI_PROJECT_ID",
  storageBucket: "INSERISCI_STORAGE_BUCKET",
  messagingSenderId: "INSERISCI_MESSAGING_SENDER_ID",
  appId: "INSERISCI_APP_ID",
};

const hasPlaceholderConfig = Object.values(firebaseConfig).some((value) =>
  String(value).startsWith("INSERISCI_")
);

let app;
let database;

if (!hasPlaceholderConfig) {
  app = initializeApp(firebaseConfig);
  database = getDatabase(app);
}

function ensureDatabase() {
  if (!database) {
    throw new Error(
      "Config Firebase mancante. Apri firebase.js e incolla i dati del tuo progetto."
    );
  }

  return database;
}

export function subscribeToMovements(callback, errorCallback) {
  const db = ensureDatabase();
  const movementsRef = ref(db, "movimenti");

  return onValue(
    movementsRef,
    (snapshot) => callback(snapshot.val() || {}),
    (error) => {
      if (typeof errorCallback === "function") {
        errorCallback(error);
      }
    }
  );
}

export async function addMovement(movement) {
  const db = ensureDatabase();
  const movementsRef = ref(db, "movimenti");
  const newMovementRef = push(movementsRef);

  await set(newMovementRef, {
    ...movement,
    createdAt: serverTimestamp(),
  });
}

export { hasPlaceholderConfig };
