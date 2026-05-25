const state = {
  samples: [],
  stats: null,
};

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

$("#sampleForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = $("#sampleMessage");
  message.textContent = "训练中...";
  try {
    const payload = await request("/api/samples", {
      method: "POST",
      body: JSON.stringify(formPayload(form)),
    });
    message.textContent = payload.message;
    form.reset();
    await refreshAll();
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
  const container = $("#predictionResults");
  container.classList.add("empty");
  container.textContent = "预测中...";
  try {
    const payload = await request("/api/predict", {
      method: "POST",
      body: JSON.stringify(formPayload(form)),
    });
    renderPrediction(payload.results);
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

refreshAll().catch((error) => {
  $("#modelStatus").textContent = error.message;
});
