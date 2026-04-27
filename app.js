import {
  createRoom,
  DEFAULT_CHIPS_PER_EURO,
  endRoom,
  endSubGame,
  GAME_KEYS,
  getRoom,
  hasPlaceholderConfig,
  joinRoom,
  listenRoom,
  normalizePlayersList,
  normalizeRoomCode,
  resolveCurrentRoom,
  resetRoom,
  startGame,
  subscribeToCurrentRoom,
  updateGameChips,
} from "./firebase.js";

const currencyFormatter = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 2,
});

const integerFormatter = new Intl.NumberFormat("it-IT", {
  maximumFractionDigits: 0,
});

const GAME_LABELS = {
  poker: "Poker",
  blackjack: "Blackjack",
  roulette: "Roulette",
  horse_racing: "Horse Racing",
};

const pageState = {
  currentRoomCode: null,
  currentRoom: null,
  roomUnsubscribe: null,
  selectedGame: "poker",
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
  const form = document.querySelector("#results-form");
  const statusNode = document.querySelector("#form-status");
  const roomStateNode = document.querySelector("#game-state");
  const currentRoomNode = document.querySelector("#current-game-id");
  const playersListNode = document.querySelector("#room-players-list");
  const createButton = document.querySelector("#create-game");
  const endButton = document.querySelector("#end-game");
  const resetButton = document.querySelector("#reset-game");
  const startButton = document.querySelector("#start-subgame");
  const chipsButton = document.querySelector("#update-chips");
  const endSubGameButton = document.querySelector("#finish-subgame");
  const gameButtons = document.querySelectorAll("[data-select-game]");
  const selectedGameNode = document.querySelector("#selected-game-name");
  const selectedGameStatusNode = document.querySelector("#selected-game-status");
  const selectedGamePlayersNode = document.querySelector("#selected-game-players");
  const selectedGameLockedNode = document.querySelector("#selected-game-locked");
  const selectedGameRateNode = document.querySelector("#selected-game-rate");
  const chipsRateInput = document.querySelector("#chips-rate");

  if (hasPlaceholderConfig) {
    setStatus(
      statusNode,
      "Completa prima la configurazione Firebase in firebase.js per attivare le stanze online.",
      true
    );
    setRoomBadge(roomStateNode, "Config Firebase mancante", "ended");
    toggleForm(form, [startButton, chipsButton, endSubGameButton], true);
    return;
  }

  bindRoomActions({ createButton, endButton, resetButton, statusNode, form });
  bindGameSelection(gameButtons, {
    selectedGameNode,
    selectedGameStatusNode,
    selectedGamePlayersNode,
    selectedGameLockedNode,
    selectedGameRateNode,
    chipsRateInput,
    form,
  });

  const roomCode = await resolveCurrentRoom();
  if (!roomCode) {
    window.location.href = "index.html";
    return;
  }

  attachRoomWatcher({
    roomCode,
    form,
    statusNode,
    roomStateNode,
    currentRoomNode,
    playersListNode,
    selectedGameNode,
    selectedGameStatusNode,
    selectedGamePlayersNode,
    selectedGameLockedNode,
    selectedGameRateNode,
    chipsRateInput,
  });

  subscribeToCurrentRoom(async (firebaseCurrentRoom) => {
    const normalizedCode = normalizeRoomCode(firebaseCurrentRoom);
    if (normalizedCode && normalizedCode !== pageState.currentRoomCode) {
      const existingRoom = await getRoom(pageState.currentRoomCode);
      if (!existingRoom) {
        attachRoomWatcher({
          roomCode: normalizedCode,
          form,
          statusNode,
          roomStateNode,
          currentRoomNode,
          playersListNode,
          selectedGameNode,
          selectedGameStatusNode,
          selectedGamePlayersNode,
          selectedGameLockedNode,
          selectedGameRateNode,
          chipsRateInput,
        });
      }
    }
  });

  startButton?.addEventListener("click", async () => {
    if (!pageState.currentRoom) {
      return;
    }

    startButton.disabled = true;

    try {
      const entries = collectGameEntries(form, "investment");
      const rate = Number(chipsRateInput?.value || DEFAULT_CHIPS_PER_EURO);
      await startGame(pageState.currentRoomCode, pageState.selectedGame, entries, rate);
      setStatus(
        statusNode,
        `${GAME_LABELS[pageState.selectedGame]} avviato. Fondi bloccati e chips assegnate.`,
        false
      );
    } catch (error) {
      setStatus(statusNode, `Errore avvio gioco: ${error.message}`, true);
    } finally {
      startButton.disabled = false;
    }
  });

  chipsButton?.addEventListener("click", async () => {
    chipsButton.disabled = true;

    try {
      const chipUpdates = collectGameEntries(form, "chips");
      await updateGameChips(pageState.currentRoomCode, pageState.selectedGame, chipUpdates);
      setStatus(
        statusNode,
        `Chips aggiornate in tempo reale per ${GAME_LABELS[pageState.selectedGame]}.`,
        false
      );
    } catch (error) {
      setStatus(statusNode, `Errore aggiornamento chips: ${error.message}`, true);
    } finally {
      chipsButton.disabled = false;
    }
  });

  endSubGameButton?.addEventListener("click", async () => {
    endSubGameButton.disabled = true;

    try {
      const results = collectSettlementMap(form);
      await endSubGame(pageState.currentRoomCode, pageState.selectedGame, results);
      form.reset();
      populatePlayersDropdowns(form, pageState.currentRoom?.playersList || []);
      setStatus(
        statusNode,
        `${GAME_LABELS[pageState.selectedGame]} chiuso con settlement finale applicato.`,
        false
      );
    } catch (error) {
      setStatus(statusNode, `Errore chiusura gioco: ${error.message}`, true);
    } finally {
      endSubGameButton.disabled = false;
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
  const activeGamesNode = document.querySelector("#leaderboard-active-games");

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
    statusNode: null,
    roomStateNode,
    currentRoomNode,
    playersListNode,
    listNode,
    summaryNode: movementCountNode,
    activeGamesNode,
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
      setStatus(statusNode, "Partita terminata. I tavoli restano in sola lettura.", false);
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

function bindGameSelection(gameButtons, nodes) {
  gameButtons.forEach((button) => {
    button.addEventListener("click", () => {
      pageState.selectedGame = button.dataset.selectGame;
      updateGameSelectionUi(gameButtons);
      renderSelectedGameSummary(nodes);
      syncGameCards(nodes.form);
    });
  });

  updateGameSelectionUi(gameButtons);
  renderSelectedGameSummary(nodes);
}

function updateGameSelectionUi(gameButtons) {
  gameButtons.forEach((button) => {
    button.dataset.active = String(button.dataset.selectGame === pageState.selectedGame);
  });
}

function attachRoomWatcher({
  roomCode,
  form,
  statusNode,
  roomStateNode,
  currentRoomNode,
  playersListNode,
  selectedGameNode,
  selectedGameStatusNode,
  selectedGamePlayersNode,
  selectedGameLockedNode,
  selectedGameRateNode,
  chipsRateInput,
  listNode,
  summaryNode,
  activeGamesNode,
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

      if (playersListNode) {
        playersListNode.textContent = room.playersList.length
          ? room.playersList.join(", ")
          : "Nessun giocatore definito";
      }

      if (summaryNode) {
        summaryNode.textContent = String(Object.keys(room.players || {}).length);
      }

      if (activeGamesNode) {
        activeGamesNode.textContent = getActiveGamesSummary(room);
      }

      if (form) {
        populatePlayersDropdowns(form, room.playersList || []);
        renderSelectedGameSummary({
          selectedGameNode,
          selectedGameStatusNode,
          selectedGamePlayersNode,
          selectedGameLockedNode,
          selectedGameRateNode,
          chipsRateInput,
        });
        syncGameCards(form);
      }

      if (listNode) {
        renderLeaderboard(listNode, buildLeaderboard(room.players || {}));
      }
    },
    (error) => {
      if (statusNode) {
        setStatus(statusNode, `Errore sincronizzazione stanza: ${error.message}`, true);
      }
    }
  );
}

function renderSelectedGameSummary({
  selectedGameNode,
  selectedGameStatusNode,
  selectedGamePlayersNode,
  selectedGameLockedNode,
  selectedGameRateNode,
  chipsRateInput,
}) {
  const room = pageState.currentRoom;
  const game = room?.games?.[pageState.selectedGame];
  const sessionParticipants = game?.session?.participants || {};
  const invested = Object.values(sessionParticipants).reduce(
    (sum, participant) => sum + Number(participant.investedEuro || 0),
    0
  );

  if (selectedGameNode) {
    selectedGameNode.textContent = GAME_LABELS[pageState.selectedGame];
  }

  if (selectedGameStatusNode) {
    selectedGameStatusNode.textContent = game?.status === "active" ? "IN CORSO" : "PRONTO";
    selectedGameStatusNode.dataset.state = game?.status === "active" ? "active" : "idle";
  }

  if (selectedGamePlayersNode) {
    selectedGamePlayersNode.textContent = String(Object.keys(sessionParticipants).length);
  }

  if (selectedGameLockedNode) {
    selectedGameLockedNode.textContent = currencyFormatter.format(invested);
  }

  if (selectedGameRateNode) {
    const rate = game?.session?.chipsPerEuro || game?.chipsPerEuro || DEFAULT_CHIPS_PER_EURO;
    selectedGameRateNode.textContent = `${integerFormatter.format(rate)} chips / €1`;
  }

  if (chipsRateInput) {
    const rate = game?.session?.chipsPerEuro || game?.chipsPerEuro || DEFAULT_CHIPS_PER_EURO;
    chipsRateInput.value = String(rate);
  }
}

function syncGameCards(form) {
  if (!form || !pageState.currentRoom) {
    return;
  }

  const game = pageState.currentRoom.games?.[pageState.selectedGame];
  const rows = [...form.querySelectorAll(".player-card")];
  const sessionEntries = Object.entries(game?.session?.participants || {});

  rows.forEach((row, index) => {
    const playerSelect = row.querySelector('select[name="player"]');
    const investmentInput = row.querySelector('input[name="investment"]');
    const chipsInput = row.querySelector('input[name="chips"]');
    const finalInput = row.querySelector('input[name="final"]');
    const sessionEntry = sessionEntries[index];

    if (sessionEntry) {
      const [playerName, participant] = sessionEntry;
      playerSelect.value = playerName;
      investmentInput.value = participant.investedEuro;
      chipsInput.value = participant.currentChips;
      if (!finalInput.value) {
        finalInput.value = "";
      }
    } else if (game?.status === "active") {
      playerSelect.value = "";
      investmentInput.value = "";
      chipsInput.value = "";
      finalInput.value = "";
    } else {
      chipsInput.value = "";
      finalInput.value = "";
    }

    const isGameActive = game?.status === "active";
    playerSelect.disabled = pageState.currentRoom.status === "ended" || isGameActive;
    investmentInput.disabled = pageState.currentRoom.status === "ended" || isGameActive;
    chipsInput.disabled = pageState.currentRoom.status === "ended" || !isGameActive;
    finalInput.disabled = pageState.currentRoom.status === "ended" || !isGameActive;
  });

  const startButton = document.querySelector("#start-subgame");
  const chipsButton = document.querySelector("#update-chips");
  const endSubGameButton = document.querySelector("#finish-subgame");
  const isRoomEnded = pageState.currentRoom.status === "ended";
  const isGameActive = game?.status === "active";

  if (startButton) {
    startButton.disabled = isRoomEnded || isGameActive;
  }

  if (chipsButton) {
    chipsButton.disabled = isRoomEnded || !isGameActive;
  }

  if (endSubGameButton) {
    endSubGameButton.disabled = isRoomEnded || !isGameActive;
  }
}

function collectGameEntries(form, mode) {
  return [...form.querySelectorAll(".player-card")]
    .map((card) => {
      const playerName = card.querySelector('select[name="player"]')?.value || "";
      const valueField =
        mode === "chips"
          ? card.querySelector('input[name="chips"]')
          : card.querySelector('input[name="investment"]');

      return {
        playerName,
        [mode === "chips" ? "currentChips" : "investedEuro"]: parseNumber(valueField?.value),
      };
    })
    .filter((entry) => {
      if (!entry.playerName) {
        return false;
      }

      if (mode === "chips") {
        return Number.isFinite(entry.currentChips);
      }

      return Number.isFinite(entry.investedEuro) && entry.investedEuro > 0;
    });
}

function collectSettlementMap(form) {
  return [...form.querySelectorAll(".player-card")].reduce((accumulator, card) => {
    const playerName = card.querySelector('select[name="player"]')?.value || "";
    const finalValue = parseNumber(card.querySelector('input[name="final"]')?.value);

    if (playerName && Number.isFinite(finalValue)) {
      accumulator[playerName] = finalValue;
    }

    return accumulator;
  }, {});
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

function toggleForm(form, buttons, disabled) {
  const fields = form?.querySelectorAll("input, select") || [];
  fields.forEach((field) => {
    field.disabled = disabled;
  });

  (buttons || []).forEach((button) => {
    if (button) {
      button.disabled = disabled;
    }
  });
}

function buildLeaderboard(playersMap) {
  return Object.entries(playersMap)
    .map(([name, ledger]) => ({
      name,
      total: Number(ledger?.total || 0),
      locked: Number(ledger?.locked || 0),
      available: Number(ledger?.available || 0),
    }))
    .sort((first, second) => second.total - first.total);
}

function renderLeaderboard(container, leaderboard) {
  if (leaderboard.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <h2>Nessun saldo registrato</h2>
        <p>I giocatori compariranno qui con totale, denaro bloccato e saldo disponibile.</p>
      </div>
    `;
    return;
  }

  const maxAbsValue = Math.max(...leaderboard.map((player) => Math.abs(player.total)), 1);

  container.innerHTML = leaderboard
    .map((player, index) => {
      const width = `${Math.max((Math.abs(player.total) / maxAbsValue) * 100, 8)}%`;
      const saldoClass = player.total >= 0 ? "positive" : "negative";
      const topClass = index === 0 ? "top" : "";

      return `
        <article class="leaderboard-row ${topClass}">
          <div class="leaderboard-bar" style="width: ${width}"></div>
          <div class="leaderboard-content leaderboard-finance">
            <div class="rank-pill">#${index + 1}</div>
            <div>
              <h2 class="player-name">${escapeHtml(player.name)}</h2>
              <p class="player-detail">
                Totale: ${currencyFormatter.format(player.total)}
              </p>
            </div>
            <div class="finance-stack">
              <span class="saldo ${saldoClass}">${currencyFormatter.format(player.total)}</span>
              <span class="finance-chip locked">Locked ${currencyFormatter.format(player.locked)}</span>
              <span class="finance-chip available">Available ${currencyFormatter.format(
                player.available
              )}</span>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

function getActiveGamesSummary(room) {
  const activeGames = GAME_KEYS.filter((gameKey) => room.games?.[gameKey]?.status === "active");

  if (activeGames.length === 0) {
    return "Nessun tavolo attivo";
  }

  return activeGames.map((gameKey) => GAME_LABELS[gameKey]).join(" · ");
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
