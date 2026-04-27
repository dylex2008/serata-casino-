import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  get,
  getDatabase,
  onValue,
  ref,
  set,
  update,
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

const STORAGE_KEY = "live-ranking-current-room";

const hasPlaceholderConfig = Object.values(firebaseConfig).some((value) =>
  String(value).startsWith("INSERISCI_")
);

let app;
let db;

if (!hasPlaceholderConfig) {
  app = initializeApp(firebaseConfig);
  db = getDatabase(app);
}

function ensureDatabase() {
  if (!db) {
    throw new Error(
      "Config Firebase mancante. Apri firebase.js e incolla i dati del tuo progetto."
    );
  }

  return db;
}

function normalizeRoomCode(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
}

function buildRoomCode() {
  const timePart = Date.now().toString(36).toUpperCase().slice(-4);
  const randomPart = Math.random().toString(36).slice(2, 6).toUpperCase();
  return normalizeRoomCode(`${timePart}${randomPart}`).slice(0, 8);
}

function normalizePlayersList(playersList) {
  return [...new Set(
    playersList
      .map((player) => String(player || "").trim())
      .filter(Boolean)
  )];
}

export function getStoredCurrentRoom() {
  return localStorage.getItem(STORAGE_KEY);
}

export function setStoredCurrentRoom(roomCode) {
  if (roomCode) {
    localStorage.setItem(STORAGE_KEY, roomCode);
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

export async function getCurrentRoom() {
  const database = ensureDatabase();
  const snapshot = await get(ref(database, "currentRoom"));
  return snapshot.exists() ? snapshot.val() : null;
}

export async function setCurrentRoom(roomCode) {
  const normalizedRoomCode = normalizeRoomCode(roomCode);
  const database = ensureDatabase();
  await set(ref(database, "currentRoom"), normalizedRoomCode);
  setStoredCurrentRoom(normalizedRoomCode);
  return normalizedRoomCode;
}

export async function getRoom(roomCode) {
  const normalizedRoomCode = normalizeRoomCode(roomCode);
  if (!normalizedRoomCode) {
    return null;
  }

  const database = ensureDatabase();
  const snapshot = await get(ref(database, `rooms/${normalizedRoomCode}`));
  return snapshot.exists() ? snapshot.val() : null;
}

export async function createRoom(playersList = []) {
  const database = ensureDatabase();
  const normalizedPlayersList = normalizePlayersList(playersList);

  let roomCode = "";
  let existingRoom = true;

  while (existingRoom) {
    roomCode = buildRoomCode();
    existingRoom = await getRoom(roomCode);
  }

  const players = normalizedPlayersList.reduce((accumulator, playerName) => {
    accumulator[playerName] = 0;
    return accumulator;
  }, {});

  await set(ref(database, `rooms/${roomCode}`), {
    createdAt: Date.now(),
    status: "active",
    playersList: normalizedPlayersList,
    players,
  });

  await setCurrentRoom(roomCode);
  return roomCode;
}

export async function joinRoom(roomCode) {
  const normalizedRoomCode = normalizeRoomCode(roomCode);
  const room = await getRoom(normalizedRoomCode);

  if (!room) {
    throw new Error("Codice stanza non trovato.");
  }

  await setCurrentRoom(normalizedRoomCode);
  return { roomCode: normalizedRoomCode, room };
}

export async function endRoom(roomCode) {
  const normalizedRoomCode = normalizeRoomCode(roomCode);
  if (!normalizedRoomCode) {
    throw new Error("Nessuna stanza corrente da terminare.");
  }

  const database = ensureDatabase();
  await update(ref(database, `rooms/${normalizedRoomCode}`), {
    status: "ended",
  });
}

export async function resetRoom(playersList = []) {
  return createRoom(playersList);
}

export async function resolveCurrentRoom() {
  const storedRoom = normalizeRoomCode(getStoredCurrentRoom());
  if (storedRoom) {
    const room = await getRoom(storedRoom);
    if (room) {
      return storedRoom;
    }
  }

  const firebaseRoom = normalizeRoomCode(await getCurrentRoom());
  if (firebaseRoom) {
    const room = await getRoom(firebaseRoom);
    if (room) {
      setStoredCurrentRoom(firebaseRoom);
      return firebaseRoom;
    }
  }

  return null;
}

export async function updatePlayer(roomCode, playerName, scoreDelta) {
  const normalizedRoomCode = normalizeRoomCode(roomCode);
  const normalizedPlayerName = String(playerName || "").trim();

  if (!normalizedRoomCode) {
    throw new Error("Stanza corrente non trovata.");
  }

  if (!normalizedPlayerName) {
    throw new Error("Giocatore non valido.");
  }

  const database = ensureDatabase();
  const room = await getRoom(normalizedRoomCode);

  if (!room) {
    throw new Error("La stanza selezionata non esiste.");
  }

  if (room.status === "ended") {
    throw new Error("La partita è terminata. Crea una nuova stanza per continuare.");
  }

  if (!Array.isArray(room.playersList) || !room.playersList.includes(normalizedPlayerName)) {
    throw new Error("Il giocatore selezionato non appartiene a questa stanza.");
  }

  const currentScore = Number(room.players?.[normalizedPlayerName] || 0);
  const nextScore = currentScore + Number(scoreDelta || 0);

  await update(ref(database, `rooms/${normalizedRoomCode}/players`), {
    [normalizedPlayerName]: nextScore,
  });
}

export function subscribeToCurrentRoom(callback, errorCallback) {
  const database = ensureDatabase();
  return onValue(
    ref(database, "currentRoom"),
    (snapshot) => callback(snapshot.exists() ? snapshot.val() : null),
    (error) => {
      if (typeof errorCallback === "function") {
        errorCallback(error);
      }
    }
  );
}

export function listenRoom(roomCode, callback, errorCallback) {
  const normalizedRoomCode = normalizeRoomCode(roomCode);
  const database = ensureDatabase();

  if (!normalizedRoomCode) {
    callback(null);
    return () => {};
  }

  return onValue(
    ref(database, `rooms/${normalizedRoomCode}`),
    (snapshot) => callback(snapshot.exists() ? snapshot.val() : null),
    (error) => {
      if (typeof errorCallback === "function") {
        errorCallback(error);
      }
    }
  );
}

export { db, hasPlaceholderConfig, normalizeRoomCode, normalizePlayersList };
