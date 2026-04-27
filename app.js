import {
  createRoom,
  endRoom,
  getRoom,
  hasPlaceholderConfig,
  joinRoom,
  listenRoom,
  normalizePlayersList,
  normalizeRoomCode,
  resolveCurrentRoom,
  resetRoom,
  subscribeToCurrentRoom,
  updatePlayer,
} from "./firebase.js";

const currencyFormatter = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 2,
});

const pageState = {
  currentRoomCode: null,
  currentRoom: null,
  roomUnsubscribe: null,
};

document.addEventListener("DOMContentLoaded", () => {
  if (document.querySelector("#create-room-form")) {
    initHomePage();
  }

  if (document.querySelector("#results-form")) {
    initInputPage();
  }

  if (document.querySelector("#leaderboard-list")) {
    initLeaderboardPage();
  }
});

function initHomePage() {
  const createForm = document.querySelector("#create-room-form");
  const joinForm = document.querySelector("#join-room-form");
  const createStatus = document.querySelector("#create-room-status");
  const joinStatus = document.querySelector("#join-room-status");
  const createdRoomNode = document.querySelector("#created-room-code");

  if (hasPlaceholderConfig) {
    setStatus(
      createStatus,
      "Completa prima la configurazione Firebase in firebase.js per creare una stanza.",
      true
    );
    setStatus(
      joinStatus,
      "Completa prima la configurazione Firebase in firebase.js per entrare in una stanza.",
      true
    );
    return;
  }

  createForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = createForm.querySelector('button[type="submit"]');
    const playersValue = createForm.querySelector("#players-list")?.value || "";
    const playersList = normalizePlayersList(playersValue.split(","));

    submitButton.disabled = true;
    setStatus(createStatus, "", false);

    try {
      const roomCode = await createRoom(playersList);
      createdRoomNode.textContent = roomCode;
      setStatus(createStatus, `Stanza creata: ${roomCode}. Reindirizzamento in corso...`, false);
      window.location.href = "input.html";
    } catch (error) {
      setStatus(createStatus, `Errore creazione stanza: ${error.message}`, true);
    } finally {
      submitButton.disabled = false;
    }
  });

  joinForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = joinForm.querySelector('button[type="submit"]');
    const roomCodeValue = joinForm.querySelector("#room-code-input")?.value || "";
    const roomCode = normalizeRoomCode(roomCodeValue);

    submitButton.disabled = true;
    setStatus(joinStatus, "", false);

    try {
      await joinRoom(roomCode);
      setStatus(joinStatus, `Ingresso effettuato nella stanza ${roomCode}.`, false);
      window.location.href = "leaderboard.html";
    } catch (error) {
      setStatus(joinStatus, `Errore ingresso stanza: ${error.message}`, true);
    } finally {
      submitButton.disabled = false;
    }
  });
}

async function initInputPage() {
  const submitButton = document.querySelector("#submit-results");
  const form = document.querySelector("#results-form");
  const statusNode = document.querySelector("#form-status");
  const roomStateNode = document.querySelector("#game-state");
  const currentRoomNode = document.querySelector("#current-game-id");
  const playersListNode = document.querySelector("#room-players-list");
  const createButton = document.querySelector("#create-game");
  const endButton = document.querySelector("#end-game");
  const resetButton = document.querySelector("#reset-game");

  if (hasPlaceholderConfig) {
    setStatus(
      statusNode,
      "Completa prima la configurazione Firebase in firebase.js per attivare le stanze online.",
      true
    );
    setRoomBadge(roomStateNode, "Config Firebase mancante", "ended");
    toggleForm(form, submitButton, true);
    return;
  }

  bindRoomActions({ createButton, endButton, resetButton, statusNode, form });

  const roomCode = await resolveCurrentRoom();
  if (!roomCode) {
    window.location.href = "index.html";
    return;
  }

  attachRoomWatcher({
    roomCode,
    form,
    submitButton,
    statusNode,
    roomStateNode,
    currentRoomNode,
    playersListNode,
    summaryNode: null,
    listNode: null,
  });

  subscribeToCurrentRoom(async (firebaseCurrentRoom) => {
    const normalizedCode = normalizeRoomCode(firebaseCurrentRoom);
    if (normalizedCode && normalizedCode !== pageState.currentRoomCode) {
      const existingRoom = await getRoom(pageState.currentRoomCode);
      if (!existingRoom) {
        attachRoomWatcher({
          roomCode: normalizedCode,
          form,
          submitButton,
          statusNode,
          roomStateNode,
          currentRoomNode,
          playersListNode,
          summaryNode: null,
          listNode: null,
        });
      }
    }
  });

  submitButton?.addEventListener("click", async () => {
    if (!pageState.currentRoomCode || !pageState.currentRoom) {
      setStatus(statusNode, "Stanza non disponibile. Torna al menu iniziale.", true);
      return;
    }

    if (pageState.currentRoom.status === "ended") {
      setStatus(statusNode, "La partita di questa stanza è terminata.", true);
      return;
    }

    const cards = [...form.querySelectorAll(".player-card")];
    const scoreUpdates = cards
      .map((card) => ({
        name: card.querySelector('select[name="player"]')?.value,
        net: parseNumber(card.querySelector('input[name="net"]')?.value),
      }))
      .filter((player) => player.name && Number.isFinite(player.net));

    if (scoreUpdates.length === 0) {
      setStatus(
        statusNode,
        "Seleziona almeno un giocatore valido e inserisci un risultato netto.",
        true
      );
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = "Invio in corso...";

    try {
      await Promise.all(
        scoreUpdates.map((player) =>
          updatePlayer(pageState.currentRoomCode, player.name, player.net)
        )
      );

      form.reset();
      populatePlayersDropdowns(form, pageState.currentRoom.playersList || []);
      setStatus(
        statusNode,
        `${scoreUpdates.length} aggiornamento${scoreUpdates.length > 1 ? "i" : ""} salvato${scoreUpdates.length > 1 ? "i" : ""} nella stanza ${pageState.currentRoomCode}.`,
        false
      );
    } catch (error) {
      setStatus(statusNode, `Errore durante il salvataggio: ${error.message}`, true);
    } finally {
      syncFormAvailability(form, submitButton, pageState.currentRoom);
      if (!submitButton.disabled) {
        submitButton.textContent = "Invia risultati";
      }
    }
  });
}

async function initLeaderboardPage() {
  const listNode = document.querySelector("#leaderboard-list");
  const movementCountNode = document.querySelector("#movement-count");
  const liveIndicatorNode = document.querySelector("#live-indicator");
  const roomStateNode = document.querySelector("#leaderboard-game-state");
  const currentRoomNode = document.querySelector("#leaderboard-game-id");
  const playersListNode = document.querySelector("#leaderboard-players-list");

  if (hasPlaceholderConfig) {
    liveIndicatorNode.textContent = "Config Firebase mancante";
    setRoomBadge(roomStateNode, "Config Firebase mancante", "ended");
    listNode.innerHTML = `
      <div class="empty-state">
        <h2>Config Firebase non trovata</h2>
        <p>Inserisci le credenziali reali nel file firebase.js per attivare le stanze live.</p>
      </div>
    `;
    return;
  }

  const roomCode = await resolveCurrentRoom();
  if (!roomCode) {
    window.location.href = "index.html";
    return;
  }

  liveIndicatorNode.textContent = "Connesso in tempo reale";

  attachRoomWatcher({
    roomCode,
    form: null,
    submitButton: null,
    statusNode: null,
    roomStateNode,
    currentRoomNode,
    playersListNode,
    summaryNode: movementCountNode,
    listNode,
  });
}

function bindRoomActions({ createButton, endButton, resetButton, statusNode, form }) {
  createButton?.addEventListener("click", async () => {
    createButton.disabled = true;

    try {
      const playersList = pageState.currentRoom?.playersList || [];
      const roomCode = await createRoom(playersList);
      if (form) {
        form.reset();
      }
      setStatus(statusNode, `Nuova stanza creata: ${roomCode}`, false);
      window.location.href = "input.html";
    } catch (error) {
      setStatus(statusNode, `Errore creazione stanza: ${error.message}`, true);
    } finally {
      createButton.disabled = false;
    }
  });

  endButton?.addEventListener("click", async () => {
    if (!pageState.currentRoomCode) {
      setStatus(statusNode, "Nessuna stanza corrente da terminare.", true);
      return;
    }

    endButton.disabled = true;

    try {
      await endRoom(pageState.currentRoomCode);
      setStatus(statusNode, "Partita terminata. L'inserimento è stato bloccato.", false);
    } catch (error) {
      setStatus(statusNode, `Errore terminazione partita: ${error.message}`, true);
    } finally {
      endButton.disabled = false;
    }
  });

  resetButton?.addEventListener("click", async () => {
    resetButton.disabled = true;

    try {
      const playersList = pageState.currentRoom?.playersList || [];
      const roomCode = await resetRoom(playersList);
      if (form) {
        form.reset();
      }
      setStatus(statusNode, `Nuova stanza pronta: ${roomCode}`, false);
      window.location.href = "input.html";
    } catch (error) {
      setStatus(statusNode, `Errore nuova stanza: ${error.message}`, true);
    } finally {
      resetButton.disabled = false;
    }
  });
}

function attachRoomWatcher({
  roomCode,
  form,
  submitButton,
  statusNode,
  roomStateNode,
  currentRoomNode,
  playersListNode,
  summaryNode,
  listNode,
}) {
  pageState.currentRoomCode = normalizeRoomCode(roomCode);
  pageState.currentRoom = null;

  if (currentRoomNode) {
    currentRoomNode.textContent = pageState.currentRoomCode;
  }

  if (pageState.roomUnsubscribe) {
    pageState.roomUnsubscribe();
  }

  pageState.roomUnsubscribe = listenRoom(
    pageState.currentRoomCode,
    (room) => {
      if (!room) {
        window.location.href = "index.html";
        return;
      }

      pageState.currentRoom = room;
      setRoomBadge(
        roomStateNode,
        room.status === "ended" ? "TERMINATA" : "ATTIVA",
        room.status
      );

      const playersList = room.playersList || [];

      if (playersListNode) {
        playersListNode.textContent = playersList.length
          ? playersList.join(", ")
          : "Nessun giocatore definito";
      }

      if (form && submitButton) {
        populatePlayersDropdowns(form, playersList);
        syncFormAvailability(form, submitButton, room);
      }

      if (summaryNode) {
        summaryNode.textContent = String(Object.keys(room.players || {}).length);
      }

      if (listNode) {
        const leaderboard = buildLeaderboard(room.players || {});
        renderLeaderboard(listNode, leaderboard);
      }
    },
    (error) => {
      if (statusNode) {
        setStatus(statusNode, `Errore sincronizzazione stanza: ${error.message}`, true);
      }
    }
  );
}

function populatePlayersDropdowns(form, playersList) {
  const selects = form.querySelectorAll('select[name="player"]');

  selects.forEach((select) => {
    const currentValue = select.value;
    select.innerHTML = `
      <option value="">Seleziona giocatore</option>
      ${playersList
        .map(
          (player) =>
            `<option value="${escapeHtml(player)}">${escapeHtml(player)}</option>`
        )
        .join("")}
    `;

    if (playersList.includes(currentValue)) {
      select.value = currentValue;
    }
  });
}

function syncFormAvailability(form, submitButton, room) {
  const noPlayers = !room || !Array.isArray(room.playersList) || room.playersList.length === 0;
  const isEnded = !room || room.status === "ended";
  const shouldDisable = noPlayers || isEnded;
  toggleForm(form, submitButton, shouldDisable);

  if (isEnded) {
    submitButton.textContent = "Partita terminata";
  } else if (noPlayers) {
    submitButton.textContent = "Nessun giocatore";
  } else {
    submitButton.textContent = "Invia risultati";
  }
}

function toggleForm(form, submitButton, disabled) {
  const fields = form?.querySelectorAll("input, select") || [];
  fields.forEach((field) => {
    field.disabled = disabled;
  });

  if (submitButton) {
    submitButton.disabled = disabled;
  }
}

function buildLeaderboard(playersMap) {
  return Object.entries(playersMap)
    .map(([name, score]) => ({
      name,
      totalNet: Number(score || 0),
    }))
    .sort((first, second) => second.totalNet - first.totalNet);
}

function renderLeaderboard(container, leaderboard) {
  if (leaderboard.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <h2>Nessun punteggio registrato</h2>
        <p>Appena qualcuno invia un risultato nella stanza attiva, la classifica apparirà qui.</p>
      </div>
    `;
    return;
  }

  const maxAbsValue = Math.max(...leaderboard.map((player) => Math.abs(player.totalNet)), 1);

  container.innerHTML = leaderboard
    .map((player, index) => {
      const width = `${Math.max((Math.abs(player.totalNet) / maxAbsValue) * 100, 8)}%`;
      const saldoClass = player.totalNet >= 0 ? "positive" : "negative";
      const topClass = index === 0 ? "top" : "";

      return `
        <article class="leaderboard-row ${topClass}">
          <div class="leaderboard-bar" style="width: ${width}"></div>
          <div class="leaderboard-content">
            <div class="rank-pill">#${index + 1}</div>
            <div>
              <h2 class="player-name">${escapeHtml(player.name)}</h2>
              <p class="player-detail">Saldo totale nella stanza corrente</p>
            </div>
            <div class="saldo ${saldoClass}">${currencyFormatter.format(player.totalNet)}</div>
          </div>
        </article>
      `;
    })
    .join("");
}

function parseNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const normalized = String(value).replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function setStatus(node, message, isError) {
  if (!node) {
    return;
  }

  node.textContent = message;
  node.style.color = isError ? "#b44c4c" : "#2d8f57";
}

function setRoomBadge(node, label, status) {
  if (!node) {
    return;
  }

  node.textContent = label;
  node.dataset.state = status || "active";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
