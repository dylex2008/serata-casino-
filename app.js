import {
  CHIP_GAMES,
  createRoom,
  DEFAULT_CHIPS_PER_EURO,
  endRoom,
  endSubGame,
  GAME_KEYS,
  getChipBreakdown,
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
  currentGamePage: document.body.dataset.gamePage || null,
};

document.addEventListener("DOMContentLoaded", () => {
  if (document.querySelector("#create-room-form")) {
    initHomePage();
  }

  if (document.querySelector("#dashboard-leaderboard")) {
    initDashboardPage();
  }

  if (document.querySelector("#leaderboard-list")) {
    initLeaderboardPage();
  }

  if (document.querySelector("#game-form")) {
    initGamePage();
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
      window.location.href = "input.html";
    } catch (error) {
      setStatus(joinStatus, `Errore ingresso stanza: ${error.message}`, true);
    } finally {
      submitButton.disabled = false;
    }
  });
}

async function initDashboardPage() {
  const statusNode = document.querySelector("#dashboard-status");
  const roomStateNode = document.querySelector("#room-state");
  const currentRoomNode = document.querySelector("#current-room-code");
  const playersListNode = document.querySelector("#room-players-list");
  const activeGameNode = document.querySelector("#room-active-game");
  const leaderboardNode = document.querySelector("#dashboard-leaderboard");
  const miniBoardsRoot = document.querySelector("#mini-leaderboards");
  const createButton = document.querySelector("#create-room-again");
  const endButton = document.querySelector("#end-room");
  const resetButton = document.querySelector("#reset-room");

  if (hasPlaceholderConfig) {
    setStatus(statusNode, "Configurazione Firebase mancante.", true);
    return;
  }

  bindRoomActions({ createButton, endButton, resetButton, statusNode });

  const roomCode = await resolveCurrentRoom();
  if (!roomCode) {
    window.location.href = "index.html";
    return;
  }

  attachRoomWatcher(roomCode, (room) => {
    currentRoomNode.textContent = roomCode;
    playersListNode.textContent = room.playersList.length
      ? room.playersList.join(", ")
      : "Nessun giocatore definito";
    activeGameNode.textContent = room.activeGame ? GAME_LABELS[room.activeGame] : "Nessuno";
    setRoomBadge(
      roomStateNode,
      room.status === "ended" ? "TERMINATA" : "ATTIVA",
      room.status
    );
    updateGameMenuCards(room);
    renderLeaderboard(leaderboardNode, buildMainLeaderboard(room.players), true);
    renderMiniBoards(miniBoardsRoot, room.players);
  }, statusNode);
}

async function initLeaderboardPage() {
  const liveIndicatorNode = document.querySelector("#live-indicator");
  const movementCountNode = document.querySelector("#movement-count");
  const roomStateNode = document.querySelector("#leaderboard-game-state");
  const currentRoomNode = document.querySelector("#leaderboard-game-id");
  const playersListNode = document.querySelector("#leaderboard-players-list");
  const activeGamesNode = document.querySelector("#leaderboard-active-games");
  const listNode = document.querySelector("#leaderboard-list");

  if (hasPlaceholderConfig) {
    liveIndicatorNode.textContent = "Config Firebase mancante";
    return;
  }

  const roomCode = await resolveCurrentRoom();
  if (!roomCode) {
    window.location.href = "index.html";
    return;
  }

  liveIndicatorNode.textContent = "Connesso in tempo reale";

  attachRoomWatcher(roomCode, (room) => {
    currentRoomNode.textContent = roomCode;
    playersListNode.textContent = room.playersList.length
      ? room.playersList.join(", ")
      : "Nessun giocatore definito";
    activeGamesNode.textContent = room.activeGame ? GAME_LABELS[room.activeGame] : "Nessuno";
    movementCountNode.textContent = String(Object.keys(room.players).length);
    setRoomBadge(
      roomStateNode,
      room.status === "ended" ? "TERMINATA" : "ATTIVA",
      room.status
    );
    renderLeaderboard(listNode, buildMainLeaderboard(room.players), true);
  });
}

async function initGamePage() {
  const gameKey = pageState.currentGamePage;
  const form = document.querySelector("#game-form");
  const statusNode = document.querySelector("#game-status-text");
  const roomCodeNode = document.querySelector("#game-room-code");
  const roomStateNode = document.querySelector("#game-room-state");
  const roomPlayersNode = document.querySelector("#game-room-players");
  const gameStatusNode = document.querySelector("#game-selected-status");
  const gamePlayersNode = document.querySelector("#game-selected-players");
  const gameLockedNode = document.querySelector("#game-selected-locked");
  const gameRateNode = document.querySelector("#game-selected-rate");
  const chipsRateInput = document.querySelector("#chips-rate");
  const startButton = document.querySelector("#start-subgame");
  const chipsButton = document.querySelector("#update-chips");
  const finishButton = document.querySelector("#finish-subgame");
  const sideLeaderboardNode = document.querySelector("#game-side-leaderboard");

  if (hasPlaceholderConfig) {
    setStatus(statusNode, "Configurazione Firebase mancante.", true);
    return;
  }

  const roomCode = await resolveCurrentRoom();
  if (!roomCode) {
    window.location.href = "index.html";
    return;
  }

  attachRoomWatcher(roomCode, (room) => {
    roomCodeNode.textContent = roomCode;
    roomPlayersNode.textContent = room.playersList.length
      ? room.playersList.join(", ")
      : "Nessun giocatore definito";
    setRoomBadge(
      roomStateNode,
      room.status === "ended" ? "TERMINATA" : "ATTIVA",
      room.status
    );

    populateGameForm(form, room, gameKey);
    renderGameSummary({
      room,
      gameKey,
      gameStatusNode,
      gamePlayersNode,
      gameLockedNode,
      gameRateNode,
      chipsRateInput,
    });
    renderLeaderboard(sideLeaderboardNode, buildMainLeaderboard(room.players), false);
    syncGameFormControls({ form, room, gameKey, startButton, chipsButton, finishButton });
  }, statusNode);

  startButton?.addEventListener("click", async () => {
    startButton.disabled = true;
    try {
      const entries = collectEntries(form, gameKey, "start");
      const rate = Number(chipsRateInput?.value || DEFAULT_CHIPS_PER_EURO);
      await startGame(roomCode, gameKey, entries, rate);
      setStatus(statusNode, `${GAME_LABELS[gameKey]} avviato con fondi bloccati.`, false);
    } catch (error) {
      setStatus(statusNode, `Errore avvio gioco: ${error.message}`, true);
    } finally {
      startButton.disabled = false;
    }
  });

  chipsButton?.addEventListener("click", async () => {
    chipsButton.disabled = true;
    try {
      const updates = collectEntries(form, gameKey, "chips");
      await updateGameChips(roomCode, gameKey, updates);
      setStatus(statusNode, `Chips aggiornate per ${GAME_LABELS[gameKey]}.`, false);
    } catch (error) {
      setStatus(statusNode, `Errore aggiornamento chips: ${error.message}`, true);
    } finally {
      chipsButton.disabled = false;
    }
  });

  finishButton?.addEventListener("click", async () => {
    finishButton.disabled = true;
    try {
      const results = collectEntries(form, gameKey, "end");
      await endSubGame(roomCode, gameKey, results);
      form.reset();
      setStatus(statusNode, `${GAME_LABELS[gameKey]} chiuso e saldi aggiornati.`, false);
    } catch (error) {
      setStatus(statusNode, `Errore chiusura gioco: ${error.message}`, true);
    } finally {
      finishButton.disabled = false;
    }
  });
}

function bindRoomActions({ createButton, endButton, resetButton, statusNode }) {
  createButton?.addEventListener("click", async () => {
    createButton.disabled = true;
    try {
      const roomCode = await createRoom(pageState.currentRoom?.playersList || []);
      setStatus(statusNode, `Nuova room creata: ${roomCode}`, false);
      window.location.href = "input.html";
    } catch (error) {
      setStatus(statusNode, `Errore creazione room: ${error.message}`, true);
    } finally {
      createButton.disabled = false;
    }
  });

  endButton?.addEventListener("click", async () => {
    endButton.disabled = true;
    try {
      await endRoom(pageState.currentRoomCode);
      setStatus(statusNode, "Room terminata. I tavoli restano consultabili.", false);
    } catch (error) {
      setStatus(statusNode, `Errore terminazione room: ${error.message}`, true);
    } finally {
      endButton.disabled = false;
    }
  });

  resetButton?.addEventListener("click", async () => {
    resetButton.disabled = true;
    try {
      const roomCode = await resetRoom(pageState.currentRoom?.playersList || []);
      setStatus(statusNode, `Nuova room pronta: ${roomCode}`, false);
      window.location.href = "input.html";
    } catch (error) {
      setStatus(statusNode, `Errore reset room: ${error.message}`, true);
    } finally {
      resetButton.disabled = false;
    }
  });
}

function attachRoomWatcher(roomCode, onRoomUpdate, statusNode) {
  pageState.currentRoomCode = normalizeRoomCode(roomCode);

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
      onRoomUpdate(room);
    },
    (error) => {
      setStatus(statusNode, `Errore sincronizzazione room: ${error.message}`, true);
    }
  );

  subscribeToCurrentRoom(async (firebaseCurrentRoom) => {
    const normalizedCode = normalizeRoomCode(firebaseCurrentRoom);
    if (normalizedCode && normalizedCode !== pageState.currentRoomCode) {
      const currentRoom = await getRoom(pageState.currentRoomCode);
      if (!currentRoom) {
        window.location.href = "index.html";
      }
    }
  });
}

function buildMainLeaderboard(playersMap) {
  return Object.entries(playersMap)
    .map(([name, ledger]) => ({
      name,
      total: Number(ledger.total || 0),
      locked: Number(ledger.locked || 0),
      available: Number(ledger.available || 0),
      activeGame: ledger.activeGame || null,
      games: ledger.games || {},
    }))
    .sort((first, second) => second.total - first.total);
}

function buildMiniLeaderboard(playersMap, gameKey) {
  return Object.entries(playersMap)
    .map(([name, ledger]) => ({
      name,
      score: Number(ledger.games?.[gameKey] || 0),
    }))
    .sort((first, second) => second.score - first.score)
    .slice(0, 3);
}

function renderLeaderboard(container, leaderboard, showFinance) {
  if (!container) {
    return;
  }

  if (leaderboard.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <h2>Nessun dato disponibile</h2>
        <p>La classifica comparirà qui appena la room riceve i primi aggiornamenti.</p>
      </div>
    `;
    return;
  }

  const maxAbsValue = Math.max(...leaderboard.map((player) => Math.abs(player.total)), 1);

  container.innerHTML = leaderboard
    .map((player, index) => {
      const width = `${Math.max((Math.abs(player.total) / maxAbsValue) * 100, 8)}%`;
      const topClass = index < 3 ? `podium podium-${index + 1}` : "";
      const saldoClass = player.total >= 0 ? "positive" : "negative";
      const activeGame = player.activeGame ? GAME_LABELS[player.activeGame] : "Nessuno";

      return `
        <article class="leaderboard-row ${topClass}">
          <div class="leaderboard-bar" style="width: ${width}"></div>
          <div class="leaderboard-content ${showFinance ? "leaderboard-finance" : ""}">
            <div class="rank-pill">#${index + 1}</div>
            <div>
              <h2 class="player-name">${escapeHtml(player.name)}</h2>
              <p class="player-detail">
                Gioco attivo: ${escapeHtml(activeGame)}
              </p>
            </div>
            ${
              showFinance
                ? `<div class="finance-stack">
                    <span class="saldo ${saldoClass}">${currencyFormatter.format(player.total)}</span>
                    <span class="finance-chip locked">Locked ${currencyFormatter.format(
                      player.locked
                    )}</span>
                    <span class="finance-chip available">Available ${currencyFormatter.format(
                      player.available
                    )}</span>
                  </div>`
                : `<div class="saldo ${saldoClass}">${currencyFormatter.format(player.total)}</div>`
            }
          </div>
        </article>
      `;
    })
    .join("");
}

function renderMiniBoards(root, playersMap) {
  if (!root) {
    return;
  }

  root.querySelectorAll("[data-mini-board]").forEach((board) => {
    const gameKey = board.dataset.miniBoard;
    const leaderboard = buildMiniLeaderboard(playersMap, gameKey);

    board.innerHTML = `
      <div class="mini-board-head">
        <span class="card-badge">${CHIP_GAMES.has(gameKey) ? "Chips" : "Direct"}</span>
        <h3>${escapeHtml(GAME_LABELS[gameKey])}</h3>
      </div>
      ${
        leaderboard.length
          ? leaderboard
              .map(
                (player, index) => `
                  <div class="mini-row">
                    <span class="mini-rank">#${index + 1}</span>
                    <span>${escapeHtml(player.name)}</span>
                    <strong class="${player.score >= 0 ? "gain" : "loss"}">
                      ${currencyFormatter.format(player.score)}
                    </strong>
                  </div>
                `
              )
              .join("")
          : `<p class="mini-empty">Nessun risultato ancora registrato.</p>`
      }
    `;
  });
}

function updateGameMenuCards(room) {
  GAME_KEYS.forEach((gameKey) => {
    const node = document.querySelector(`#game-status-${gameKey}`);
    if (!node) {
      return;
    }

    const game = room.games?.[gameKey];
    node.textContent = game?.status === "active" ? "In corso" : "Pronto";
    node.dataset.state = game?.status === "active" ? "active" : "idle";
  });
}

function renderGameSummary({
  room,
  gameKey,
  gameStatusNode,
  gamePlayersNode,
  gameLockedNode,
  gameRateNode,
  chipsRateInput,
}) {
  const game = room.games?.[gameKey];
  const participants = Object.values(game?.session?.participants || {});
  const locked = participants.reduce(
    (sum, participant) => sum + Number(participant.investedEuro || 0),
    0
  );

  gameStatusNode.textContent = game?.status === "active" ? "IN CORSO" : "PRONTO";
  gameStatusNode.dataset.state = game?.status === "active" ? "active" : "idle";
  gamePlayersNode.textContent = String(participants.length);
  gameLockedNode.textContent = currencyFormatter.format(locked);
  gameRateNode.textContent = CHIP_GAMES.has(gameKey)
    ? `${integerFormatter.format(game?.chipsPerEuro || DEFAULT_CHIPS_PER_EURO)} chips / €1`
    : "Risultato diretto";

  if (chipsRateInput) {
    chipsRateInput.value = String(game?.chipsPerEuro || DEFAULT_CHIPS_PER_EURO);
    chipsRateInput.disabled = !CHIP_GAMES.has(gameKey) || game?.status === "active";
  }
}

function populateGameForm(form, room, gameKey) {
  const game = room.games?.[gameKey];
  const sessionEntries = Object.entries(game?.session?.participants || {});
  const rows = [...form.querySelectorAll(".player-card")];

  rows.forEach((row, index) => {
    const select = row.querySelector('select[name="player"]');
    const investmentInput = row.querySelector('input[name="investment"]');
    const chipsInput = row.querySelector('input[name="chips"]');
    const finalInput = row.querySelector('input[name="final"]');
    const chipStackNode = row.querySelector("[data-chip-stack]");

    populateSelect(select, room.playersList);

    const sessionEntry = sessionEntries[index];

    if (sessionEntry) {
      const [playerName, participant] = sessionEntry;
      select.value = playerName;
      if (investmentInput) {
        investmentInput.value = participant.investedEuro;
      }
      if (chipsInput) {
        chipsInput.value = participant.currentChips;
      }
      renderChipStack(chipStackNode, participant.chipBreakdown || getChipBreakdown(participant.currentChips));
    } else if (game?.status !== "active") {
      select.value = "";
      if (investmentInput) {
        investmentInput.value = "";
      }
      if (chipsInput) {
        chipsInput.value = "";
      }
      if (chipStackNode) {
        chipStackNode.innerHTML = "";
      }
    }

    if (finalInput && game?.status !== "active") {
      finalInput.value = "";
    }
  });
}

function syncGameFormControls({ form, room, gameKey, startButton, chipsButton, finishButton }) {
  const game = room.games?.[gameKey];
  const isActive = game?.status === "active";
  const isRoomEnded = room.status === "ended";
  const useChips = CHIP_GAMES.has(gameKey);

  [...form.querySelectorAll(".player-card")].forEach((row) => {
    const select = row.querySelector('select[name="player"]');
    const investmentInput = row.querySelector('input[name="investment"]');
    const chipsInput = row.querySelector('input[name="chips"]');
    const finalInput = row.querySelector('input[name="final"]');

    select.disabled = isRoomEnded || isActive;
    investmentInput.disabled = isRoomEnded || isActive;

    if (chipsInput) {
      chipsInput.disabled = isRoomEnded || !isActive || !useChips;
      chipsInput.closest("label").style.display = useChips ? "" : "none";
    }

    finalInput.disabled = isRoomEnded || !isActive;
  });

  if (startButton) {
    startButton.disabled = isRoomEnded || isActive;
  }

  if (chipsButton) {
    chipsButton.disabled = isRoomEnded || !isActive || !useChips;
    chipsButton.style.display = useChips ? "" : "none";
  }

  if (finishButton) {
    finishButton.disabled = isRoomEnded || !isActive;
  }
}

function populateSelect(select, playersList) {
  if (!select) {
    return;
  }

  const currentValue = select.value;
  select.innerHTML = `
    <option value="">Seleziona giocatore</option>
    ${playersList
      .map(
        (player) => `<option value="${escapeHtml(player)}">${escapeHtml(player)}</option>`
      )
      .join("")}
  `;

  if (playersList.includes(currentValue)) {
    select.value = currentValue;
  }
}

function collectEntries(form, gameKey, mode) {
  const rows = [...form.querySelectorAll(".player-card")];

  if (mode === "end") {
    return rows.reduce((accumulator, row) => {
      const playerName = row.querySelector('select[name="player"]')?.value || "";
      const finalValue = parseNumber(row.querySelector('input[name="final"]')?.value);
      if (playerName && Number.isFinite(finalValue)) {
        accumulator[playerName] = finalValue;
      }
      return accumulator;
    }, {});
  }

  return rows
    .map((row) => {
      const playerName = row.querySelector('select[name="player"]')?.value || "";

      if (mode === "chips") {
        return {
          playerName,
          currentChips: parseNumber(row.querySelector('input[name="chips"]')?.value),
        };
      }

      return {
        playerName,
        investedEuro: parseNumber(row.querySelector('input[name="investment"]')?.value),
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

function renderChipStack(container, breakdown) {
  if (!container) {
    return;
  }

  if (!breakdown || !breakdown.length) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = breakdown
    .map(
      (chip) => `
        <div class="chip-group">
          <span class="chip chip-${chip.value}">${chip.value}</span>
          <strong>x${chip.count}</strong>
        </div>
      `
    )
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
