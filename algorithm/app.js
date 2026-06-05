const svgNS = "http://www.w3.org/2000/svg";

const state = {
  participants: [],
  operators: {},
  bracket: null,
};

const elements = {
  form: document.querySelector("#bracketForm"),
  playerCount: document.querySelector("#playerCount"),
  participantList: document.querySelector("#participantList"),
  resetNames: document.querySelector("#resetNames"),
  downloadSvg: document.querySelector("#downloadSvg"),
  downloadJson: document.querySelector("#downloadJson"),
  statPlayers: document.querySelector("#statPlayers"),
  statSize: document.querySelector("#statSize"),
  statByes: document.querySelector("#statByes"),
  svg: document.querySelector("#bracketSvg"),
  roundSummary: document.querySelector("#roundSummary"),
};

const layout = {
  leafWidth: 176,
  leafHeight: 42,
  opSize: 42,
  rowGap: 22,
  columnGap: 116,
  marginX: 34,
  marginY: 94,
  titleY: 30,
  joinGap: 22,
};

let rebuildTimer = 0;

function nextPowerOfTwo(value) {
  if (value < 1) {
    throw new Error("참가자 수는 1명 이상이어야 합니다.");
  }
  return 2 ** Math.ceil(Math.log2(value));
}

function standardSeedOrder(size) {
  if (size < 1 || (size & (size - 1)) !== 0) {
    throw new Error("브라켓 크기는 2의 거듭제곱이어야 합니다.");
  }

  let order = [1];
  let currentSize = 1;

  while (currentSize < size) {
    currentSize *= 2;
    order = order.flatMap((seed) => [seed, currentSize + 1 - seed]);
  }

  return order;
}

function clampPlayerCount(value) {
  const parsed = Number.parseInt(value, 10);

  if (Number.isNaN(parsed)) {
    return 1;
  }

  return Math.min(64, Math.max(1, parsed));
}

function makeDefaultParticipant(seed) {
  return {
    id: `seed-${seed}`,
    seed,
    name: `Seed ${seed}`,
    bye: false,
  };
}

function ensureParticipants(count) {
  const next = [];

  for (let index = 0; index < count; index += 1) {
    next.push(state.participants[index] || makeDefaultParticipant(index + 1));
  }

  state.participants = next.map((participant, index) => ({
    ...participant,
    id: `seed-${index + 1}`,
    seed: index + 1,
  }));
}

function resetParticipants() {
  state.participants = Array.from({ length: clampPlayerCount(elements.playerCount.value) }, (_, index) =>
    makeDefaultParticipant(index + 1),
  );
}

function operatorFor(nodeId) {
  return state.operators[nodeId] || "AND";
}

function toggleOperator(nodeId) {
  state.operators[nodeId] = operatorFor(nodeId) === "AND" ? "OR" : "AND";
  rebuild();
}

function renderParticipantList() {
  elements.participantList.replaceChildren();

  state.participants.forEach((participant, index) => {
    const row = document.createElement("div");
    const seed = document.createElement("span");
    const input = document.createElement("input");
    const button = document.createElement("button");

    row.className = `participant-row${participant.bye ? " is-bye" : ""}`;
    seed.className = "participant-seed";
    seed.textContent = `#${index + 1}`;

    input.type = "text";
    input.value = participant.name;
    input.setAttribute("aria-label", `${index + 1}번 참가자 이름`);
    input.addEventListener("input", () => {
      participant.name = input.value.trim() || `Seed ${index + 1}`;
      window.clearTimeout(rebuildTimer);
      rebuildTimer = window.setTimeout(rebuild, 120);
    });

    button.className = "bye-toggle";
    button.type = "button";
    button.textContent = "BYE";
    button.setAttribute("aria-pressed", String(participant.bye));
    button.setAttribute("aria-label", `${participant.name} BYE 토글`);
    button.addEventListener("click", () => {
      participant.bye = !participant.bye;
      renderParticipantList();
      rebuild();
    });

    row.append(seed, input, button);
    elements.participantList.appendChild(row);
  });
}

function makeLeaf(slotIndex, seed, participant) {
  const active = Boolean(participant && !participant.bye);
  const centerY =
    layout.marginY +
    slotIndex * (layout.leafHeight + layout.rowGap) +
    layout.leafHeight / 2;

  return {
    type: "leaf",
    id: `leaf-${slotIndex + 1}`,
    roundNo: 1,
    index: slotIndex + 1,
    seed,
    participant: active ? participant : null,
    activeCount: active ? 1 : 0,
    visible: active,
    x: layout.marginX,
    y: centerY - layout.leafHeight / 2,
    centerX: layout.marginX + layout.leafWidth / 2,
    centerY,
    rep: active
      ? {
          x: layout.marginX + layout.leafWidth,
          y: centerY,
          sourceId: participant.id,
        }
      : null,
  };
}

function makeInternalNode(roundNo, index, left, right) {
  return {
    type: "operator",
    id: `r${roundNo}-m${index}`,
    roundNo,
    index,
    left,
    right,
    activeCount: left.activeCount + right.activeCount,
    visible: false,
    x: 0,
    y: 0,
    centerX: 0,
    centerY: 0,
    rep: null,
  };
}

function buildBracket() {
  const bracketSize = nextPowerOfTwo(state.participants.length);
  const seedOrder = standardSeedOrder(bracketSize);
  const participantsBySeed = new Map(
    state.participants.map((participant) => [participant.seed, participant]),
  );
  const leaves = seedOrder.map((seed, index) =>
    makeLeaf(index, seed, participantsBySeed.get(seed) || null),
  );
  const rounds = [leaves];
  let currentRound = leaves;
  let roundNo = 2;

  while (currentRound.length > 1) {
    const nextRound = [];

    for (let index = 0; index < currentRound.length; index += 2) {
      nextRound.push(
        makeInternalNode(roundNo, index / 2 + 1, currentRound[index], currentRound[index + 1]),
      );
    }

    rounds.push(nextRound);
    currentRound = nextRound;
    roundNo += 1;
  }

  const bracket = {
    totalParticipants: state.participants.length,
    activeParticipants: state.participants.filter((participant) => !participant.bye).length,
    bracketSize,
    byeCount:
      bracketSize - state.participants.filter((participant) => !participant.bye).length,
    seedOrder,
    rounds,
  };

  layoutBracket(bracket);
  return bracket;
}

function layoutBracket(bracket) {
  for (let roundIndex = 1; roundIndex < bracket.rounds.length; roundIndex += 1) {
    const round = bracket.rounds[roundIndex];
    const x =
      layout.marginX +
      layout.leafWidth +
      layout.columnGap +
      (roundIndex - 1) * (layout.opSize + layout.columnGap);

    round.forEach((node) => {
      node.centerY = (node.left.centerY + node.right.centerY) / 2;
      node.centerX = x + layout.opSize / 2;
      node.x = x;
      node.y = node.centerY - layout.opSize / 2;
      node.visible = node.left.activeCount > 0 && node.right.activeCount > 0;
      node.rep = node.visible
        ? { x: node.centerX, y: node.centerY, sourceId: node.id }
        : node.left.rep || node.right.rep;
    });
  }

  const width =
    layout.marginX * 2 +
    layout.leafWidth +
    Math.max(0, bracket.rounds.length - 1) * (layout.opSize + layout.columnGap) +
    layout.columnGap;
  const height =
    layout.marginY * 2 +
    bracket.bracketSize * layout.leafHeight +
    Math.max(0, bracket.bracketSize - 1) * layout.rowGap;

  bracket.width = width;
  bracket.height = height;
}

function createSvgElement(name, attributes = {}) {
  const element = document.createElementNS(svgNS, name);

  Object.entries(attributes).forEach(([key, value]) => {
    element.setAttribute(key, String(value));
  });

  return element;
}

function createSvgText(text, attributes = {}) {
  const element = createSvgElement("text", attributes);
  element.textContent = text;
  return element;
}

function shortLabel(value, maxLength = 19) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}

function svgStyles() {
  return `
    #bracketSvg { background: #f4f1ea; }
    .svg-title { font-size: 17px; font-weight: 800; fill: #24221e; }
    .svg-desc { font-size: 12px; fill: #6f6a60; }
    .svg-round { font-size: 12px; font-weight: 800; fill: #5f584f; }
    .svg-leaf { fill: #fffdf8; stroke: #82796d; stroke-width: 1.2; }
    .svg-leaf-seed { font-size: 10px; fill: #8c8376; font-weight: 850; }
    .svg-leaf-name { font-size: 13px; fill: #24221e; font-weight: 750; }
    .svg-connector { fill: none; stroke: #a89d8b; stroke-width: 1.5; }
    .svg-boundary { fill: none; stroke: #71685b; stroke-width: 2; }
    .svg-line-or { stroke-dasharray: 5 5; }
    .svg-op-hit { fill: #ffffff; stroke: #1f766d; stroke-width: 1.5; cursor: pointer; }
    .svg-op-hit:hover { fill: #dcefeb; }
    .svg-op-text { fill: #15594f; font-size: 11px; font-weight: 900; pointer-events: none; }
    .svg-op-sub { fill: #6f6a60; font-size: 9px; font-weight: 800; pointer-events: none; }
  `;
}

function renderBracket(bracket) {
  const svg = elements.svg;
  const style = createSvgElement("style");

  svg.replaceChildren();
  svg.setAttribute("width", bracket.width);
  svg.setAttribute("height", bracket.height);
  svg.setAttribute("viewBox", `0 0 ${bracket.width} ${bracket.height}`);

  style.appendChild(document.createTextNode(svgStyles()));
  svg.appendChild(style);

  svg.appendChild(
    createSvgText("BYE 대진표", {
      id: "bracketTitle",
      class: "svg-title",
      x: layout.marginX,
      y: layout.titleY,
    }),
  );
  svg.appendChild(
    createSvgText(
      `${bracket.activeParticipants}명 표시, ${bracket.bracketSize} 슬롯, 숨김 BYE ${bracket.byeCount}개`,
      {
        id: "bracketDesc",
        class: "svg-desc",
        x: layout.marginX,
        y: layout.titleY + 22,
      },
    ),
  );

  renderRoundLabels(svg, bracket);
  renderConnectors(svg, bracket);
  renderLeaves(svg, bracket.rounds[0]);
  renderOperators(svg, bracket);
}

function renderRoundLabels(svg, bracket) {
  svg.appendChild(
    createSvgText("Round 1", {
      class: "svg-round",
      x: layout.marginX,
      y: layout.marginY - 16,
    }),
  );

  bracket.rounds.slice(1).forEach((round) => {
    if (!round.some((node) => node.visible)) {
      return;
    }

    svg.appendChild(
      createSvgText(`Round ${round[0].roundNo}`, {
        class: "svg-round",
        x: round[0].x,
        y: layout.marginY - 16,
      }),
    );
  });
}

function renderConnectors(svg, bracket) {
  bracket.rounds.slice(1).flat().forEach((node) => {
    if (!node.visible) {
      return;
    }

    const leftRep = node.left.rep;
    const rightRep = node.right.rep;

    if (!leftRep || !rightRep) {
      return;
    }

    const joinX = node.x - layout.joinGap;
    const operator = operatorFor(node.id);
    const lineClass = operator === "OR" ? " svg-line-or" : "";
    const connectorClass = `svg-connector${lineClass}`;
    const boundaryClass = `svg-boundary${lineClass}`;

    svg.appendChild(
      createSvgElement("path", {
        class: connectorClass,
        d: `M ${leftRep.x} ${leftRep.y} H ${joinX}`,
      }),
    );
    svg.appendChild(
      createSvgElement("path", {
        class: connectorClass,
        d: `M ${rightRep.x} ${rightRep.y} H ${joinX}`,
      }),
    );
    svg.appendChild(
      createSvgElement("path", {
        class: boundaryClass,
        d: `M ${joinX} ${leftRep.y} V ${rightRep.y}`,
      }),
    );
    svg.appendChild(
      createSvgElement("path", {
        class: connectorClass,
        d: `M ${joinX} ${node.centerY} H ${node.x}`,
      }),
    );
  });
}

function renderLeaves(svg, leaves) {
  leaves.forEach((leaf) => {
    if (!leaf.visible) {
      return;
    }

    const group = createSvgElement("g");
    const title = createSvgElement("title");

    group.appendChild(
      createSvgElement("rect", {
        class: "svg-leaf",
        x: leaf.x,
        y: leaf.y,
        width: layout.leafWidth,
        height: layout.leafHeight,
        rx: 7,
      }),
    );
    group.appendChild(
      createSvgText(`#${leaf.participant.seed}`, {
        class: "svg-leaf-seed",
        x: leaf.x + 10,
        y: leaf.y + 16,
      }),
    );
    group.appendChild(
      createSvgText(shortLabel(leaf.participant.name), {
        class: "svg-leaf-name",
        x: leaf.x + 10,
        y: leaf.y + 32,
      }),
    );

    title.textContent = `Round 1: ${leaf.participant.name}`;
    group.appendChild(title);
    svg.appendChild(group);
  });
}

function renderOperators(svg, bracket) {
  bracket.rounds.slice(1).flat().forEach((node) => {
    if (!node.visible) {
      return;
    }

    const operator = operatorFor(node.id);
    const group = createSvgElement("g", {
      class: "svg-op",
      role: "button",
      tabindex: "0",
      "aria-label": `${node.id} ${operator} 토글`,
    });
    const title = createSvgElement("title");

    group.appendChild(
      createSvgElement("rect", {
        class: "svg-op-hit",
        x: node.x,
        y: node.y,
        width: layout.opSize,
        height: layout.opSize,
        rx: 6,
      }),
    );
    group.appendChild(
      createSvgText(operator, {
        class: "svg-op-text",
        x: node.centerX,
        y: node.y + 20,
        "text-anchor": "middle",
      }),
    );
    group.appendChild(
      createSvgText(node.id, {
        class: "svg-op-sub",
        x: node.centerX,
        y: node.y + 33,
        "text-anchor": "middle",
      }),
    );

    title.textContent = `${node.id}: 클릭하면 AND/OR이 바뀝니다.`;
    group.appendChild(title);
    group.addEventListener("click", () => toggleOperator(node.id));
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleOperator(node.id);
      }
    });

    svg.appendChild(group);
  });
}

function bracketToJson(bracket) {
  return {
    totalParticipants: bracket.totalParticipants,
    activeParticipants: bracket.activeParticipants,
    bracketSize: bracket.bracketSize,
    byeCount: bracket.byeCount,
    seedOrder: bracket.seedOrder,
    participants: state.participants.map((participant) => ({
      seed: participant.seed,
      name: participant.name,
      bye: participant.bye,
    })),
    operators: Object.fromEntries(
      bracket.rounds
        .slice(1)
        .flat()
        .filter((node) => node.visible)
        .map((node) => [node.id, operatorFor(node.id)]),
    ),
  };
}

function renderSummary(bracket) {
  const rows = bracket.rounds
    .map((round, index) => {
      if (index === 0) {
        return `
          <div class="summary-round">
            <span>Round 1</span>
            <strong>${round.filter((leaf) => leaf.visible).length}노드</strong>
          </div>
        `;
      }

      const visibleNodes = round.filter((node) => node.visible).length;
      return `
        <div class="summary-round">
          <span>Round ${round[0].roundNo}</span>
          <strong>${visibleNodes} AND/OR</strong>
        </div>
      `;
    })
    .join("");

  elements.roundSummary.innerHTML = `<div class="summary-grid">${rows}</div>`;
}

function updateStats(bracket) {
  elements.statPlayers.textContent = bracket.activeParticipants;
  elements.statSize.textContent = bracket.bracketSize;
  elements.statByes.textContent = bracket.byeCount;
}

function rebuild() {
  const bracket = buildBracket();

  state.bracket = bracket;
  updateStats(bracket);
  renderBracket(bracket);
  renderSummary(bracket);
}

function download(filename, mimeType, content) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  URL.revokeObjectURL(url);
}

function serializeSvg() {
  return new XMLSerializer().serializeToString(elements.svg);
}

function setupEvents() {
  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    rebuild();
  });

  elements.playerCount.addEventListener("change", () => {
    const count = clampPlayerCount(elements.playerCount.value);
    elements.playerCount.value = count;
    ensureParticipants(count);
    renderParticipantList();
    rebuild();
  });

  elements.resetNames.addEventListener("click", () => {
    resetParticipants();
    renderParticipantList();
    rebuild();
  });

  elements.downloadSvg.addEventListener("click", () => {
    download("bye-and-or-bracket.svg", "image/svg+xml;charset=utf-8", serializeSvg());
  });

  elements.downloadJson.addEventListener("click", () => {
    download(
      "bye-and-or-bracket.json",
      "application/json;charset=utf-8",
      JSON.stringify(bracketToJson(state.bracket), null, 2),
    );
  });
}

function init() {
  ensureParticipants(clampPlayerCount(elements.playerCount.value));
  renderParticipantList();
  setupEvents();
  rebuild();
}

init();
