import { addMovement, hasPlaceholderConfig, subscribeToMovements } from "./firebase.js";

const currencyFormatter = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 2,
});

document.addEventListener("DOMContentLoaded", () => {
  if (document.querySelector("#results-form")) {
    initInputPage();
  }

  if (document.querySelector("#leaderboard-list")) {
    initLeaderboardPage();
  }
});

function initInputPage() {
  const submitButton = document.querySelector("#submit-results");
  const form = document.querySelector("#results-form");
  const statusNode = document.querySelector("#form-status");

  if (hasPlaceholderConfig) {
    setStatus(
      statusNode,
      "Completa prima la configurazione Firebase in firebase.js per salvare online.",
      true
    );
  }

  submitButton?.addEventListener("click", async () => {
    const cards = [...form.querySelectorAll(".player-card")];
    const movements = cards
      .map((card) => ({
        name: card.querySelector('input[name="name"]')?.value.trim(),
        stake: parseNumber(card.querySelector('input[name="stake"]')?.value),
        net: parseNumber(card.querySelector('input[name="net"]')?.value),
      }))
      .filter((movement) => movement.name && Number.isFinite(movement.net));

    if (movements.length === 0) {
      setStatus(
        statusNode,
        "Inserisci almeno un nome e un risultato netto valido prima di inviare.",
        true
      );
      return;
    }

    if (hasPlaceholderConfig) {
      setStatus(
        statusNode,
        "Configurazione Firebase assente: i dati non possono ancora essere inviati.",
        true
      );
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = "Invio in corso...";

    try {
      await Promise.all(
        movements.map((movement) =>
          addMovement({
            name: movement.name,
            stake: movement.stake ?? 0,
            net: movement.net,
          })
        )
      );

      form.reset();
      setStatus(
        statusNode,
        `${movements.length} movimento${movements.length > 1 ? "i" : ""} inviato${movements.length > 1 ? "i" : ""} correttamente.`,
        false
      );
    } catch (error) {
      setStatus(
        statusNode,
        `Errore durante il salvataggio: ${error.message}`,
        true
      );
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Invia risultati";
    }
  });
}

function initLeaderboardPage() {
  const listNode = document.querySelector("#leaderboard-list");
  const movementCountNode = document.querySelector("#movement-count");
  const liveIndicatorNode = document.querySelector("#live-indicator");

  if (hasPlaceholderConfig) {
    liveIndicatorNode.textContent = "Config Firebase mancante";
    listNode.innerHTML = `
      <div class="empty-state">
        <h2>Config Firebase non trovata</h2>
        <p>Inserisci le credenziali reali nel file firebase.js per attivare la classifica live.</p>
      </div>
    `;
    return;
  }

  liveIndicatorNode.textContent = "Connesso in tempo reale";

  subscribeToMovements(
    (movementsMap) => {
      const movements = Object.values(movementsMap);
      movementCountNode.textContent = String(movements.length);

      const leaderboard = buildLeaderboard(movements);
      renderLeaderboard(listNode, leaderboard);
    },
    (error) => {
      liveIndicatorNode.textContent = `Errore: ${error.message}`;
    }
  );
}

function buildLeaderboard(movements) {
  const totals = movements.reduce((accumulator, movement) => {
    const normalizedName = String(movement.name || "").trim();
    if (!normalizedName) {
      return accumulator;
    }

    const net = parseNumber(movement.net) ?? 0;
    const stake = parseNumber(movement.stake) ?? 0;

    if (!accumulator[normalizedName]) {
      accumulator[normalizedName] = {
        name: normalizedName,
        totalNet: 0,
        totalStake: 0,
        rounds: 0,
      };
    }

    accumulator[normalizedName].totalNet += net;
    accumulator[normalizedName].totalStake += stake;
    accumulator[normalizedName].rounds += 1;
    return accumulator;
  }, {});

  return Object.values(totals).sort((first, second) => second.totalNet - first.totalNet);
}

function renderLeaderboard(container, leaderboard) {
  if (leaderboard.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <h2>Nessun movimento registrato</h2>
        <p>Appena qualcuno invia un risultato, la classifica apparirà qui in automatico.</p>
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
              <p class="player-detail">
                ${player.rounds} movimento${player.rounds > 1 ? "i" : ""} · Puntate: ${currencyFormatter.format(player.totalStake)}
              </p>
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
  node.textContent = message;
  node.style.color = isError ? "#b44c4c" : "#2d8f57";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
