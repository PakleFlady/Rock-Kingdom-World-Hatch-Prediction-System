const state = {
  samples: [],
  stats: null,
  sampleSuggestTimer: null,
  sampleSuggestRequestId: 0,
  currentPredictionPoint: null,
  chartPoints: new Map(),
};

const palette = [
  "#2d6a62",
  "#c94f2d",
  "#5b5f97",
  "#b08900",
  "#7b3f61",
  "#2878a6",
  "#6f8f2f",
  "#a04747",
  "#4b6f86",
  "#8a5a32",
  "#5c6b73",
  "#9b5de5",
  "#008f7a",
  "#d65a31",
  "#4d908e",
  "#577590",
];

const $ = (selector) => document.querySelector(selector);

async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "请求失败");
  }
  return payload;
}

async function refreshAll() {
  const [samplePayload, statsPayload] = await Promise.all([
    request("/api/samples"),
    request("/api/stats"),
  ]);
  state.samples = samplePayload.samples;
  state.stats = statsPayload;
  renderSamples();
  renderStatus();
  renderAllCharts();
}

function renderStatus() {
  const stats = state.stats || {};
  $("#modelStatus").textContent = `样本 ${stats.sample_count || 0} 条，精灵 ${stats.class_count || 0} 种`;
}

function renderSamples() {
  $("#sampleCount").textContent = `${state.samples.length} 条`;
  const tbody = $("#sampleTable");
  tbody.innerHTML = "";

  if (state.samples.length === 0) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="4">还没有数据。</td>`;
    tbody.append(row);
    return;
  }

  for (const sample of [...state.samples].reverse()) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${formatNumber(sample.size)}</td>
      <td>${formatNumber(sample.weight)}</td>
      <td>${escapeHtml(sample.creature)}</td>
      <td><button class="deleteButton" type="button" data-id="${sample.id}">删除</button></td>
    `;
    tbody.append(row);
  }
}

function renderPrediction(results) {
  const container = $("#predictionResults");
  container.classList.remove("empty");
  container.innerHTML = "";

  if (!results.length) {
    container.classList.add("empty");
    container.textContent = "没有概率大于 1% 的结果，或数据集还为空。";
    return;
  }

  for (const result of results) {
    const item = document.createElement("div");
    item.className = "resultItem";
    const percent = Math.max(0, Math.min(100, result.probability * 100));
    item.innerHTML = `
      <strong>${escapeHtml(result.creature)}</strong>
      <div class="bar" aria-label="${result.percent}"><span style="width: ${percent}%"></span></div>
      <span>${result.percent}</span>
    `;
    container.append(item);
  }
}

function renderSampleSuggestions(results) {
  const container = $("#sampleSuggestions");
  container.classList.remove("empty");
  container.innerHTML = "";

  if (!results.length) {
    container.classList.add("empty");
    container.textContent = "没有概率大于 1% 的候选；可以直接填写正确精灵后添加。";
    return;
  }

  for (const result of results) {
    const button = document.createElement("button");
    button.className = "suggestButton";
    button.type = "button";
    button.dataset.creature = result.creature;
    button.innerHTML = `
      <span>${escapeHtml(result.creature)}</span>
      <strong>${result.percent}</strong>
    `;
    container.append(button);
  }
}

function renderAllCharts() {
  renderScatterChart("predictChart", "predictChartLegend", state.currentPredictionPoint);
  renderScatterChart("dataChart", "dataChartLegend", null);
}

function renderScatterChart(canvasId, legendId, marker) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(320, Math.floor(rect.width));
  const height = Math.max(260, Math.floor(rect.height));
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const chartPoints = [];
  state.chartPoints.set(canvasId, chartPoints);

  if (!state.samples.length) {
    drawEmptyChart(ctx, width, height, "暂无数据");
    renderLegend(legendId, []);
    return;
  }

  const classes = [...new Set(state.samples.map((sample) => sample.creature))].sort();
  const colorMap = Object.fromEntries(classes.map((name, index) => [name, palette[index % palette.length]]));
  const allSizes = state.samples.map((sample) => Number(sample.size));
  const allWeights = state.samples.map((sample) => Number(sample.weight));
  if (marker) {
    allSizes.push(Number(marker.size));
    allWeights.push(Number(marker.weight));
  }

  const bounds = paddedBounds(allSizes, allWeights);
  const padding = { top: 22, right: 22, bottom: 48, left: 62 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const toX = (size) => padding.left + ((size - bounds.minSize) / (bounds.maxSize - bounds.minSize)) * plotWidth;
  const toY = (weight) => padding.top + plotHeight - ((weight - bounds.minWeight) / (bounds.maxWeight - bounds.minWeight)) * plotHeight;

  drawAxes(ctx, width, height, padding, bounds);

  for (const sample of state.samples) {
    const x = toX(Number(sample.size));
    const y = toY(Number(sample.weight));
    ctx.beginPath();
    ctx.arc(x, y, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = colorMap[sample.creature] || palette[0];
    ctx.globalAlpha = 0.82;
    ctx.fill();
    ctx.globalAlpha = 1;
    chartPoints.push({ x, y, radius: 8, sample, type: "sample" });
  }

  if (marker) {
    const x = toX(Number(marker.size));
    const y = toY(Number(marker.weight));
    ctx.save();
    ctx.strokeStyle = "#111827";
    ctx.fillStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y - 9);
    ctx.lineTo(x + 9, y);
    ctx.lineTo(x, y + 9);
    ctx.lineTo(x - 9, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    chartPoints.push({ x, y, radius: 12, sample: marker, type: "marker" });
  }

  renderLegend(legendId, classes.map((name) => ({ name, color: colorMap[name] })));
}

function paddedBounds(sizes, weights) {
  const minSize = Math.min(...sizes);
  const maxSize = Math.max(...sizes);
  const minWeight = Math.min(...weights);
  const maxWeight = Math.max(...weights);
  const sizePad = Math.max((maxSize - minSize) * 0.08, 0.01);
  const weightPad = Math.max((maxWeight - minWeight) * 0.08, 0.1);
  return {
    minSize: Math.max(0, minSize - sizePad),
    maxSize: maxSize + sizePad,
    minWeight: Math.max(0, minWeight - weightPad),
    maxWeight: maxWeight + weightPad,
  };
}

function drawAxes(ctx, width, height, padding, bounds) {
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  ctx.fillStyle = "#fffdfa";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#ded7cb";
  ctx.lineWidth = 1;
  ctx.font = "12px Microsoft YaHei, sans-serif";
  ctx.fillStyle = "#637083";

  for (let i = 0; i <= 4; i += 1) {
    const x = padding.left + (plotWidth / 4) * i;
    const y = padding.top + (plotHeight / 4) * i;
    ctx.beginPath();
    ctx.moveTo(x, padding.top);
    ctx.lineTo(x, padding.top + plotHeight);
    ctx.moveTo(padding.left, y);
    ctx.lineTo(padding.left + plotWidth, y);
    ctx.stroke();

    const sizeLabel = bounds.minSize + ((bounds.maxSize - bounds.minSize) / 4) * i;
    const weightLabel = bounds.maxWeight - ((bounds.maxWeight - bounds.minWeight) / 4) * i;
    ctx.fillText(formatAxis(sizeLabel), x - 12, padding.top + plotHeight + 22);
    ctx.fillText(formatAxis(weightLabel), 10, y + 4);
  }

  ctx.strokeStyle = "#637083";
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top);
  ctx.lineTo(padding.left, padding.top + plotHeight);
  ctx.lineTo(padding.left + plotWidth, padding.top + plotHeight);
  ctx.stroke();
  ctx.fillStyle = "#1f2933";
  ctx.fillText("尺寸", padding.left + plotWidth - 22, height - 12);
  ctx.save();
  ctx.translate(18, padding.top + 24);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("重量", 0, 0);
  ctx.restore();
}

function drawEmptyChart(ctx, width, height, text) {
  ctx.fillStyle = "#fffdfa";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#637083";
  ctx.font = "14px Microsoft YaHei, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(text, width / 2, height / 2);
  ctx.textAlign = "left";
}

function renderLegend(legendId, items) {
  const legend = document.getElementById(legendId);
  if (!legend) return;
  const visibleItems = items.slice(0, 18);
  legend.innerHTML = visibleItems
    .map(
      (item) => `
        <span class="legendItem">
          <span class="legendSwatch" style="background:${item.color}"></span>
          ${escapeHtml(item.name)}
        </span>
      `,
    )
    .join("");
  if (items.length > visibleItems.length) {
    legend.insertAdjacentHTML("beforeend", `<span class="legendItem">+${items.length - visibleItems.length} 种</span>`);
  }
}

function formatAxis(value) {
  return Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

function handleChartHover(event, canvasId, tooltipId) {
  const canvas = document.getElementById(canvasId);
  const tooltip = document.getElementById(tooltipId);
  if (!canvas || !tooltip) return;
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const hit = [...(state.chartPoints.get(canvasId) || [])]
    .reverse()
    .find((point) => Math.hypot(point.x - x, point.y - y) <= point.radius);

  if (!hit) {
    tooltip.style.display = "none";
    return;
  }

  const label = hit.type === "marker" ? "当前输入" : hit.sample.creature;
  tooltip.innerHTML = `
    <strong>${escapeHtml(label)}</strong><br />
    尺寸：${formatNumber(hit.sample.size)}<br />
    重量：${formatNumber(hit.sample.weight)}
  `;
  tooltip.style.left = `${Math.min(x + 12, rect.width - 170)}px`;
  tooltip.style.top = `${Math.max(8, y - 10)}px`;
  tooltip.style.display = "block";
}

function formatNumber(value) {
  return Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 4 });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formPayload(form) {
  const data = new FormData(form);
  return Object.fromEntries(data.entries());
}

function switchView(viewId) {
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("active", view.id === viewId);
  });
  document.querySelectorAll(".viewTab").forEach((tab) => {
    const active = tab.dataset.viewTarget === viewId;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  renderAllCharts();
}

function readSampleSizeWeight() {
  const size = $("#sampleSize").value.trim();
  const weight = $("#sampleWeight").value.trim();
  if (!isPositiveNumber(size) || !isPositiveNumber(weight)) {
    return null;
  }
  return { size, weight };
}

function isPositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
}

async function addSample(payload) {
  return request("/api/samples", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

function scheduleSampleSuggestion() {
  clearTimeout(state.sampleSuggestTimer);
  const status = $("#sampleSuggestStatus");
  const container = $("#sampleSuggestions");
  const sizeWeight = readSampleSizeWeight();

  if (!sizeWeight) {
    state.sampleSuggestRequestId += 1;
    status.textContent = "输入尺寸和重量后自动显示。";
    container.classList.add("empty");
    container.textContent = "候选只用于快速添加数据。";
    return;
  }

  status.textContent = "正在匹配候选...";
  state.sampleSuggestTimer = setTimeout(() => {
    fetchSampleSuggestion(sizeWeight);
  }, 350);
}

async function fetchSampleSuggestion(sizeWeight) {
  const requestId = ++state.sampleSuggestRequestId;
  try {
    const payload = await request("/api/predict", {
      method: "POST",
      body: JSON.stringify(sizeWeight),
    });
    if (requestId !== state.sampleSuggestRequestId) return;
    $("#sampleSuggestStatus").textContent = `找到 ${payload.results.length} 个候选`;
    renderSampleSuggestions(payload.results);
  } catch (error) {
    if (requestId !== state.sampleSuggestRequestId) return;
    $("#sampleSuggestStatus").textContent = "候选匹配失败";
    const container = $("#sampleSuggestions");
    container.classList.add("empty");
    container.textContent = error.message;
  }
}

$("#sampleForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = $("#sampleMessage");
  message.textContent = "训练中...";
  try {
    const payload = await addSample(formPayload(form));
    message.textContent = payload.message;
    form.reset();
    await refreshAll();
    scheduleSampleSuggestion();
  } catch (error) {
    message.textContent = error.message;
  }
});

$("#sampleSuggestions").addEventListener("click", async (event) => {
  const button = event.target.closest(".suggestButton");
  if (!button) return;

  const sizeWeight = readSampleSizeWeight();
  const message = $("#sampleMessage");
  if (!sizeWeight) {
    message.textContent = "请先输入有效的尺寸和重量。";
    return;
  }

  message.textContent = "正在添加候选...";
  try {
    const payload = await addSample({
      ...sizeWeight,
      creature: button.dataset.creature,
    });
    message.textContent = payload.message;
    $("#sampleForm").reset();
    await refreshAll();
    scheduleSampleSuggestion();
  } catch (error) {
    message.textContent = error.message;
  }
});

$("#bulkButton").addEventListener("click", async () => {
  const message = $("#bulkMessage");
  message.textContent = "训练中...";
  try {
    const payload = await request("/api/samples/bulk", {
      method: "POST",
      body: JSON.stringify({ text: $("#bulkText").value }),
    });
    const errorText = payload.errors.length ? `，错误 ${payload.errors.length} 行` : "";
    message.textContent = `新增 ${payload.added_count} 条，重复 ${payload.duplicate_count} 条${errorText}`;
    if (!payload.errors.length) {
      $("#bulkText").value = "";
    }
    await refreshAll();
  } catch (error) {
    message.textContent = error.message;
  }
});

$("#predictForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = formPayload(form);
  const container = $("#predictionResults");
  container.classList.add("empty");
  container.textContent = "预测中...";
  try {
    const response = await request("/api/predict", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    state.currentPredictionPoint = {
      size: Number(payload.size),
      weight: Number(payload.weight),
    };
    renderPrediction(response.results);
    renderAllCharts();
  } catch (error) {
    container.textContent = error.message;
  }
});

$("#sampleTable").addEventListener("click", async (event) => {
  const button = event.target.closest(".deleteButton");
  if (!button) return;
  await request(`/api/samples?id=${encodeURIComponent(button.dataset.id)}`, {
    method: "DELETE",
  });
  await refreshAll();
});

$("#refreshButton").addEventListener("click", refreshAll);
$("#sampleSize").addEventListener("input", scheduleSampleSuggestion);
$("#sampleWeight").addEventListener("input", scheduleSampleSuggestion);
document.querySelectorAll(".viewTab").forEach((tab) => {
  tab.addEventListener("click", () => switchView(tab.dataset.viewTarget));
});
["predictChart", "dataChart"].forEach((canvasId) => {
  const tooltipId = canvasId === "predictChart" ? "predictChartTooltip" : "dataChartTooltip";
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  canvas.addEventListener("mousemove", (event) => handleChartHover(event, canvasId, tooltipId));
  canvas.addEventListener("mouseleave", () => {
    const tooltip = document.getElementById(tooltipId);
    if (tooltip) tooltip.style.display = "none";
  });
});
window.addEventListener("resize", renderAllCharts);

refreshAll().catch((error) => {
  $("#modelStatus").textContent = error.message;
});
