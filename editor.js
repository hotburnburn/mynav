const SCHEMA_PATH = "./link_schema.json";

const state = {
    categories: [],
    revision: "",
    csrfToken: "",
    dirty: false,
    saving: false,
    publishing: false,
    draggedCategoryIndex: null,
    draggedLink: null,
};

const elements = {
    loadingView: document.getElementById("loadingView"),
    loadingTitle: document.getElementById("loadingTitle"),
    loadingMessage: document.getElementById("loadingMessage"),
    retryBtn: document.getElementById("retryBtn"),
    editorView: document.getElementById("editorView"),
    reloadBtn: document.getElementById("reloadBtn"),
    saveBtn: document.getElementById("saveBtn"),
    publishBtn: document.getElementById("publishBtn"),
    saveStatus: document.getElementById("saveStatus"),
    categoryBoard: document.getElementById("categoryBoard"),
    emptyState: document.getElementById("emptyState"),
    categoryCount: document.getElementById("categoryCount"),
    linkCount: document.getElementById("linkCount"),
    addCategoryBtn: document.getElementById("addCategoryBtn"),
    emptyAddCategoryBtn: document.getElementById("emptyAddCategoryBtn"),
    linkDialog: document.getElementById("linkDialog"),
    linkForm: document.getElementById("linkForm"),
    linkDialogTitle: document.getElementById("linkDialogTitle"),
    linkCategoryIndex: document.getElementById("linkCategoryIndex"),
    linkIndex: document.getElementById("linkIndex"),
    linkTextInput: document.getElementById("linkTextInput"),
    linkUrlInput: document.getElementById("linkUrlInput"),
    linkColorInput: document.getElementById("linkColorInput"),
    linkColorTextInput: document.getElementById("linkColorTextInput"),
    linkFormError: document.getElementById("linkFormError"),
    categoryDialog: document.getElementById("categoryDialog"),
    categoryForm: document.getElementById("categoryForm"),
    categoryDialogTitle: document.getElementById("categoryDialogTitle"),
    categoryIndex: document.getElementById("categoryIndex"),
    categoryNameInput: document.getElementById("categoryNameInput"),
    categoryFormError: document.getElementById("categoryFormError"),
    publishDialog: document.getElementById("publishDialog"),
    publishForm: document.getElementById("publishForm"),
    commitMessageInput: document.getElementById("commitMessageInput"),
    publishFormError: document.getElementById("publishFormError"),
    confirmPublishBtn: document.getElementById("confirmPublishBtn"),
    toast: document.getElementById("toast"),
};

function setStatus(message, status = "idle") {
    elements.saveStatus.textContent = message;
    elements.saveStatus.dataset.state = status;
}

let toastTimer;
function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => elements.toast.classList.remove("visible"), 2600);
}

function serializeData() {
    const data = { $schema: SCHEMA_PATH };
    for (const category of state.categories) {
        data[category.name] = category.links.map(({ text, url, color }) => ({ text, url, color }));
    }
    return data;
}

function parseData(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("服务返回的导航数据无效");
    }

    const categories = [];
    for (const [name, links] of Object.entries(data)) {
        if (name === "$schema") continue;
        if (!Array.isArray(links)) throw new Error(`分类“${name}”的内容不是链接列表`);

        categories.push({
            name,
            links: links.map((link) => ({
                text: link.text,
                url: link.url,
                color: normalizeColor(link.color) || "#409eff",
            })),
        });
    }
    return categories;
}

function normalizeColor(color) {
    if (typeof color !== "string") return "";
    const value = color.trim();
    if (/^#[0-9a-f]{6}$/i.test(value)) return value.toUpperCase();
    if (/^#[0-9a-f]{3}$/i.test(value)) {
        return `#${value.slice(1).split("").map((character) => character.repeat(2)).join("")}`.toUpperCase();
    }
    return "";
}

async function apiRequest(url, options = {}) {
    const response = await fetch(url, {
        cache: "no-store",
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {}),
        },
    });

    let result;
    try {
        result = await response.json();
    } catch {
        throw new Error(`本机编辑服务返回异常（HTTP ${response.status}）`);
    }

    if (!response.ok) {
        const error = new Error(result.error || `请求失败（HTTP ${response.status}）`);
        error.status = response.status;
        Object.assign(error, result);
        throw error;
    }
    return result;
}

async function loadFromServer({ confirmDiscard = false } = {}) {
    if (confirmDiscard && state.dirty && !confirm("当前修改尚未保存，确定重新载入吗？")) return;

    elements.retryBtn.hidden = true;
    setStatus("正在读取本机文件", "idle");
    try {
        const result = await apiRequest("/api/links");
        state.categories = parseData(result.data);
        state.revision = result.revision;
        state.csrfToken = result.csrfToken;
        state.dirty = false;
        state.saving = false;
        elements.loadingView.hidden = true;
        elements.editorView.hidden = false;
        elements.reloadBtn.disabled = false;
        elements.saveBtn.disabled = true;
        elements.publishBtn.disabled = false;
        render();
        setStatus("已与 links.enc 同步", "saved");
    } catch (error) {
        elements.editorView.hidden = true;
        elements.loadingView.hidden = false;
        elements.loadingTitle.textContent = "无法连接编辑服务";
        elements.loadingMessage.textContent = error.message;
        elements.retryBtn.hidden = false;
        elements.publishBtn.disabled = true;
        setStatus("连接失败", "error");
    }
}

async function saveToServer() {
    if (!state.dirty) return true;
    if (state.saving) return false;
    state.saving = true;
    elements.saveBtn.disabled = true;
    setStatus("正在加密并保存", "idle");

    try {
        const result = await apiRequest("/api/links", {
            method: "PUT",
            headers: { "X-MyNav-Token": state.csrfToken },
            body: JSON.stringify({
                data: serializeData(),
                revision: state.revision,
            }),
        });
        state.revision = result.revision;
        state.dirty = false;
        setStatus("已保存到 links.enc", "saved");
        showToast(`已保存 ${result.categoryCount} 个分类、${result.linkCount} 个链接`);
        return true;
    } catch (error) {
        setStatus(error.status === 409 ? "文件发生冲突" : "保存失败", "error");
        showToast(error.message);
        return false;
    } finally {
        state.saving = false;
        elements.saveBtn.disabled = !state.dirty;
    }
}

async function publishToGitHub(message) {
    if (state.publishing) return;
    state.publishing = true;
    elements.confirmPublishBtn.disabled = true;
    elements.confirmPublishBtn.textContent = "正在发布…";
    elements.publishBtn.disabled = true;
    elements.reloadBtn.disabled = true;
    elements.publishFormError.textContent = "";

    try {
        const saved = await saveToServer();
        if (!saved) {
            elements.publishFormError.textContent = "保存失败，尚未执行 Git 提交";
            return;
        }

        setStatus("正在提交并推送", "idle");
        const result = await apiRequest("/api/publish", {
            method: "POST",
            headers: { "X-MyNav-Token": state.csrfToken },
            body: JSON.stringify({
                message,
                revision: state.revision,
            }),
        });
        elements.publishDialog.close();
        setStatus(`已发布 ${result.commit}`, "saved");
        showToast(`已推送 ${result.branch} · ${result.commit}`);
    } catch (error) {
        elements.publishFormError.textContent = error.message;
        setStatus(error.committed ? "已提交，但推送失败" : "发布失败", "error");
    } finally {
        state.publishing = false;
        elements.confirmPublishBtn.disabled = false;
        elements.confirmPublishBtn.textContent = "保存并发布";
        elements.publishBtn.disabled = false;
        elements.reloadBtn.disabled = false;
    }
}

function markChanged() {
    state.dirty = true;
    elements.saveBtn.disabled = false;
    setStatus("有未保存的修改", "dirty");
    renderStats();
}

function makeIconButton(label, text, className = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `icon-button ${className}`.trim();
    button.setAttribute("aria-label", label);
    button.title = label;
    button.textContent = text;
    return button;
}

function render() {
    elements.categoryBoard.replaceChildren();

    state.categories.forEach((category, categoryIndex) => {
        const column = document.createElement("article");
        column.className = "category-column";
        column.draggable = true;
        column.dataset.categoryIndex = String(categoryIndex);

        const heading = document.createElement("div");
        heading.className = "category-heading";

        const handle = document.createElement("span");
        handle.className = "drag-handle";
        handle.textContent = "⠿";
        handle.title = "拖动分类";

        const title = document.createElement("h2");
        title.className = "category-title";
        title.textContent = category.name;

        const count = document.createElement("span");
        count.className = "category-count";
        count.textContent = String(category.links.length);

        const editCategory = makeIconButton("重命名分类", "···");
        editCategory.addEventListener("click", () => openCategoryDialog(categoryIndex));

        const deleteCategory = makeIconButton("删除分类", "×", "danger");
        deleteCategory.addEventListener("click", () => deleteCategoryAt(categoryIndex));

        heading.append(handle, title, count, editCategory, deleteCategory);

        const linkList = document.createElement("div");
        linkList.className = "link-list";
        linkList.dataset.categoryIndex = String(categoryIndex);
        category.links.forEach((link, linkIndex) => {
            linkList.appendChild(createLinkCard(link, categoryIndex, linkIndex));
        });

        const addLink = document.createElement("button");
        addLink.type = "button";
        addLink.className = "add-link-button";
        addLink.textContent = "＋ 添加链接";
        addLink.addEventListener("click", () => openLinkDialog(categoryIndex));

        attachCategoryDragEvents(column, categoryIndex);
        attachLinkListDropEvents(linkList, categoryIndex);
        column.append(heading, linkList, addLink);
        elements.categoryBoard.appendChild(column);
    });

    elements.emptyState.hidden = state.categories.length !== 0;
    renderStats();
}

function createLinkCard(link, categoryIndex, linkIndex) {
    const card = document.createElement("div");
    card.className = "link-card";
    card.draggable = true;
    card.style.backgroundColor = link.color || "#409eff";
    card.dataset.categoryIndex = String(categoryIndex);
    card.dataset.linkIndex = String(linkIndex);
    card.title = link.url;

    const handle = document.createElement("span");
    handle.className = "drag-handle";
    handle.textContent = "⠿";

    const label = document.createElement("span");
    label.className = "link-label";
    label.textContent = link.text;

    const edit = makeIconButton("编辑链接", "✎");
    edit.addEventListener("click", () => openLinkDialog(categoryIndex, linkIndex));

    const remove = makeIconButton("删除链接", "×");
    remove.addEventListener("click", () => {
        state.categories[categoryIndex].links.splice(linkIndex, 1);
        markChanged();
        render();
    });

    card.addEventListener("dragstart", (event) => {
        event.stopPropagation();
        state.draggedLink = { categoryIndex, linkIndex };
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", `link:${categoryIndex}:${linkIndex}`);
        requestAnimationFrame(() => card.classList.add("dragging"));
    });

    card.addEventListener("dragend", () => {
        state.draggedLink = null;
        card.classList.remove("dragging");
        document.querySelectorAll(".drag-over").forEach((element) => element.classList.remove("drag-over"));
    });

    card.addEventListener("dragover", (event) => {
        if (!state.draggedLink) return;
        event.preventDefault();
        event.stopPropagation();
        card.parentElement.classList.add("drag-over");
    });

    card.addEventListener("drop", (event) => {
        if (!state.draggedLink) return;
        event.preventDefault();
        event.stopPropagation();
        moveLink(state.draggedLink, { categoryIndex, linkIndex });
    });

    card.append(handle, label, edit, remove);
    return card;
}

function attachCategoryDragEvents(column, categoryIndex) {
    column.addEventListener("dragstart", (event) => {
        if (state.draggedLink || event.target.closest(".link-card")) return;
        state.draggedCategoryIndex = categoryIndex;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", `category:${categoryIndex}`);
        requestAnimationFrame(() => column.classList.add("dragging"));
    });

    column.addEventListener("dragover", (event) => {
        if (state.draggedCategoryIndex === null) return;
        event.preventDefault();
        column.classList.add("drag-over");
    });
    column.addEventListener("dragleave", () => column.classList.remove("drag-over"));
    column.addEventListener("drop", (event) => {
        if (state.draggedCategoryIndex === null) return;
        event.preventDefault();
        const [category] = state.categories.splice(state.draggedCategoryIndex, 1);
        state.categories.splice(categoryIndex, 0, category);
        state.draggedCategoryIndex = null;
        markChanged();
        render();
    });
    column.addEventListener("dragend", () => {
        state.draggedCategoryIndex = null;
        column.classList.remove("dragging", "drag-over");
    });
}

function attachLinkListDropEvents(linkList, categoryIndex) {
    linkList.addEventListener("dragover", (event) => {
        if (!state.draggedLink) return;
        event.preventDefault();
        event.stopPropagation();
        linkList.classList.add("drag-over");
    });
    linkList.addEventListener("dragleave", (event) => {
        if (!linkList.contains(event.relatedTarget)) linkList.classList.remove("drag-over");
    });
    linkList.addEventListener("drop", (event) => {
        if (!state.draggedLink || event.target.closest(".link-card")) return;
        event.preventDefault();
        event.stopPropagation();
        moveLink(state.draggedLink, {
            categoryIndex,
            linkIndex: state.categories[categoryIndex].links.length,
        });
    });
}

function moveLink(from, to) {
    const [link] = state.categories[from.categoryIndex].links.splice(from.linkIndex, 1);
    state.categories[to.categoryIndex].links.splice(to.linkIndex, 0, link);
    state.draggedLink = null;
    markChanged();
    render();
}

function renderStats() {
    elements.categoryCount.textContent = String(state.categories.length);
    elements.linkCount.textContent = String(
        state.categories.reduce((total, category) => total + category.links.length, 0),
    );
}

function openLinkDialog(categoryIndex, linkIndex = null) {
    const link = linkIndex === null ? null : state.categories[categoryIndex].links[linkIndex];
    elements.linkDialogTitle.textContent = link ? "编辑链接" : "添加链接";
    elements.linkCategoryIndex.value = String(categoryIndex);
    elements.linkIndex.value = linkIndex === null ? "" : String(linkIndex);
    elements.linkTextInput.value = link?.text || "";
    elements.linkUrlInput.value = link?.url || "https://";
    elements.linkColorInput.value = normalizeColor(link?.color) || "#409eff";
    elements.linkColorTextInput.value = elements.linkColorInput.value.toUpperCase();
    elements.linkFormError.textContent = "";
    elements.linkDialog.showModal();
    requestAnimationFrame(() => elements.linkTextInput.focus());
}

function openCategoryDialog(categoryIndex = null) {
    elements.categoryDialogTitle.textContent = categoryIndex === null ? "添加分类" : "重命名分类";
    elements.categoryIndex.value = categoryIndex === null ? "" : String(categoryIndex);
    elements.categoryNameInput.value = categoryIndex === null ? "" : state.categories[categoryIndex].name;
    elements.categoryFormError.textContent = "";
    elements.categoryDialog.showModal();
    requestAnimationFrame(() => elements.categoryNameInput.focus());
}

function deleteCategoryAt(categoryIndex) {
    const category = state.categories[categoryIndex];
    const detail = category.links.length ? `，其中有 ${category.links.length} 个链接` : "";
    if (!confirm(`确定删除“${category.name}”${detail}吗？`)) return;
    state.categories.splice(categoryIndex, 1);
    markChanged();
    render();
}

elements.saveBtn.addEventListener("click", saveToServer);
elements.reloadBtn.addEventListener("click", () => loadFromServer({ confirmDiscard: true }));
elements.retryBtn.addEventListener("click", () => loadFromServer());
elements.addCategoryBtn.addEventListener("click", () => openCategoryDialog());
elements.emptyAddCategoryBtn.addEventListener("click", () => openCategoryDialog());
elements.publishBtn.addEventListener("click", () => {
    elements.publishFormError.textContent = "";
    elements.publishDialog.showModal();
    requestAnimationFrame(() => {
        elements.commitMessageInput.focus();
        elements.commitMessageInput.select();
    });
});

elements.linkColorInput.addEventListener("input", () => {
    elements.linkColorTextInput.value = elements.linkColorInput.value.toUpperCase();
});
elements.linkColorTextInput.addEventListener("input", () => {
    const color = normalizeColor(elements.linkColorTextInput.value);
    if (color) elements.linkColorInput.value = color;
});

elements.linkForm.addEventListener("submit", (event) => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();

    const categoryIndex = Number(elements.linkCategoryIndex.value);
    const linkIndex = elements.linkIndex.value === "" ? null : Number(elements.linkIndex.value);
    const text = elements.linkTextInput.value.trim();
    const linkUrl = elements.linkUrlInput.value.trim();
    const color = normalizeColor(elements.linkColorTextInput.value);

    if (!text) {
        elements.linkFormError.textContent = "请输入链接名称";
        return;
    }
    try {
        const parsedUrl = new URL(linkUrl);
        if (!["http:", "https:"].includes(parsedUrl.protocol)) throw new Error();
    } catch {
        elements.linkFormError.textContent = "请输入完整的 http:// 或 https:// 网址";
        return;
    }
    if (!color) {
        elements.linkFormError.textContent = "请输入六位十六进制颜色";
        return;
    }

    const nextLink = { text, url: linkUrl, color };
    if (linkIndex === null) state.categories[categoryIndex].links.push(nextLink);
    else state.categories[categoryIndex].links[linkIndex] = nextLink;

    elements.linkDialog.close();
    markChanged();
    render();
});

elements.categoryForm.addEventListener("submit", (event) => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();

    const categoryIndex = elements.categoryIndex.value === "" ? null : Number(elements.categoryIndex.value);
    const name = elements.categoryNameInput.value.trim();
    const duplicate = state.categories.some((category, index) =>
        category.name === name && index !== categoryIndex,
    );

    if (!name) {
        elements.categoryFormError.textContent = "请输入分类名称";
        return;
    }
    if (name === "$schema") {
        elements.categoryFormError.textContent = "这个名称由配置文件保留，请换一个";
        return;
    }
    if (duplicate) {
        elements.categoryFormError.textContent = "已经有同名分类";
        return;
    }

    if (categoryIndex === null) state.categories.push({ name, links: [] });
    else state.categories[categoryIndex].name = name;

    elements.categoryDialog.close();
    markChanged();
    render();
});

elements.publishForm.addEventListener("submit", (event) => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    const message = elements.commitMessageInput.value.trim();
    if (!message) {
        elements.publishFormError.textContent = "请输入 Commit message";
        return;
    }
    publishToGitHub(message);
});

document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && !elements.editorView.hidden) {
        event.preventDefault();
        saveToServer();
    }
});

window.addEventListener("beforeunload", (event) => {
    if (!state.dirty && !state.publishing) return;
    event.preventDefault();
    event.returnValue = "";
});

loadFromServer();
