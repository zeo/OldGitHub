export function bindContributionTooltips(root: HTMLElement): void {
  const graph = root.querySelector<HTMLElement>(".oldgh-profile__contribs-graph");
  if (!graph) return;
  if (graph.dataset["oldghTipBound"] === "1") return;
  graph.dataset["oldghTipBound"] = "1";

  let tip = document.querySelector<HTMLDivElement>(".oldgh-contrib-tip");
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "oldgh-contrib-tip";
    tip.setAttribute("hidden", "");
    document.body.appendChild(tip);
  }

  const show = (cell: HTMLElement): void => {
    const text = cell.getAttribute("title") || cell.getAttribute("aria-label") || "";
    if (!text) return;
    cell.dataset["oldghTitle"] = text;
    cell.removeAttribute("title");
    if (!tip) return;
    tip.textContent = text;
    tip.removeAttribute("hidden");
    const r = cell.getBoundingClientRect();
    const tw = tip.offsetWidth;
    const left = Math.max(8, Math.min(window.innerWidth - tw - 8, r.left + r.width / 2 - tw / 2));
    const top = window.scrollY + r.top - tip.offsetHeight - 6;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  };
  const hide = (cell: HTMLElement): void => {
    if (cell.dataset["oldghTitle"]) {
      cell.setAttribute("title", cell.dataset["oldghTitle"] || "");
    }
    if (tip) tip.setAttribute("hidden", "");
  };
  graph.addEventListener("mouseover", (e) => {
    const t = e.target as HTMLElement | null;
    if (!t) return;
    const cell = t.closest<HTMLElement>(".ContributionCalendar-day, td.day");
    if (cell) show(cell);
  });
  graph.addEventListener("mouseout", (e) => {
    const t = e.target as HTMLElement | null;
    if (!t) return;
    const cell = t.closest<HTMLElement>(".ContributionCalendar-day, td.day");
    if (cell) hide(cell);
  });
}

export function renderContributionStreaks(root: HTMLElement): void {
  const graph = root.querySelector<HTMLElement>(".oldgh-profile__contribs-graph");
  if (!graph) return;
  const cells = Array.from(graph.querySelectorAll<HTMLElement>(".ContributionCalendar-day[data-date], td.day[data-date]"));
  if (cells.length === 0) return;
  const days = cells
    .map((c) => ({
      date: c.getAttribute("data-date") || "",
      active: parseInt(c.getAttribute("data-level") || "0", 10) > 0,
    }))
    .filter((d) => d.date)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (days.length === 0) return;

  let longest = 0;
  let longestStart: string | null = null;
  let longestEnd: string | null = null;
  let runStart: string | null = null;
  let runLen = 0;
  for (let i = 0; i < days.length; i++) {
    const d = days[i]!;
    if (d.active) {
      if (runLen === 0) runStart = d.date;
      runLen++;
      if (runLen > longest) {
        longest = runLen;
        longestStart = runStart;
        longestEnd = d.date;
      }
    } else {
      runLen = 0;
      runStart = null;
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const latestDay = days[days.length - 1]!.date;
  const endRef = latestDay < today ? latestDay : today;
  const isPastYear = latestDay < today;
  let current = 0;
  let currentStart: string | null = null;
  for (let i = days.length - 1; i >= 0; i--) {
    const d = days[i]!;
    if (d.date > endRef) continue;
    if (d.active) {
      current++;
      currentStart = d.date;
    } else {
      if (current > 0) break;
      // only skip an inactive today on a live chart; past years stop at year-end
      if (isPastYear || d.date < today) break;
    }
  }

  const totalActive = days.filter((d) => d.active).length;

  const wrapper = document.createElement("div");
  wrapper.className = "oldgh-profile__contribs-stats";
  wrapper.innerHTML = `
    <div class="oldgh-profile__streak">
      <span class="oldgh-profile__streak-num">${totalActive}</span>
      <span class="oldgh-profile__streak-label">total days with contributions</span>
    </div>
    <div class="oldgh-profile__streak">
      <span class="oldgh-profile__streak-num">${longest}</span>
      <span class="oldgh-profile__streak-label">longest streak${longest > 0 && longestStart && longestEnd ? ` <small>${formatRange(longestStart, longestEnd)}</small>` : ""}</span>
    </div>
    <div class="oldgh-profile__streak">
      <span class="oldgh-profile__streak-num">${current}</span>
      <span class="oldgh-profile__streak-label">${isPastYear ? "year-end streak" : "current streak"}${current > 0 && currentStart ? ` <small>${formatRange(currentStart, endRef)}</small>` : ""}</span>
    </div>
  `;
  const contribsSection = root.querySelector<HTMLElement>(".oldgh-profile__contribs");
  contribsSection?.appendChild(wrapper);
}

function formatRange(startIso: string, endIso: string): string {
  const start = new Date(startIso + "T00:00:00Z");
  const end = new Date(endIso + "T00:00:00Z");
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "";
  const fmt = (d: Date): string => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (startIso === endIso) return fmt(start);
  return `${fmt(start)} – ${fmt(end)}`;
}

export function decorateContributionCells(root: HTMLElement): void {
  if (!root.isConnected) return;
  const graph = root.querySelector<HTMLElement>(".oldgh-profile__contribs-graph");
  if (!graph) return;
  // github relocates tool-tip elements into document.body asynchronously
  const tipMap = new Map<string, string>();
  for (const tip of Array.from(document.querySelectorAll<HTMLElement>("tool-tip[for]"))) {
    const forId = tip.getAttribute("for");
    if (!forId) continue;
    const text = tip.textContent?.replace(/\s+/g, " ").trim();
    if (text) tipMap.set(forId, text);
  }
  for (const cell of Array.from(graph.querySelectorAll<HTMLElement>(".ContributionCalendar-day, td.day"))) {
    const existing = cell.getAttribute("title");
    if (existing && /contributions? on/i.test(existing)) continue;
    let label: string | null = null;
    const cellId = cell.getAttribute("id");
    if (cellId && tipMap.has(cellId)) {
      label = tipMap.get(cellId) || null;
    }
    if (!label) {
      const labelId = cell.getAttribute("aria-labelledby");
      if (labelId) {
        label = document.getElementById(labelId)?.textContent?.replace(/\s+/g, " ").trim() || null;
      }
    }
    if (!label) {
      const tipNeighbor = cell.querySelector<HTMLElement>("tool-tip, .sr-only, span");
      if (tipNeighbor) label = tipNeighbor.textContent?.replace(/\s+/g, " ").trim() || null;
    }
    if (!label) {
      const date = cell.getAttribute("data-date");
      const level = cell.getAttribute("data-level");
      if (date) {
        const human = formatGraphDate(date);
        if (level === "0" || !level) label = `No contributions on ${human}`;
        else if (level === "1") label = `1–3 contributions on ${human}`;
        else if (level === "2") label = `4–6 contributions on ${human}`;
        else if (level === "3") label = `7–9 contributions on ${human}`;
        else label = `10+ contributions on ${human}`;
      }
    }
    if (label) cell.setAttribute("title", label);
  }
}

function formatGraphDate(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}
