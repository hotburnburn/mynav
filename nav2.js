function CreateContainer() {
    const container = document.createElement("div");
    Object.assign(container.style, {
        display: "flex",
        flexWrap: "wrap", // 换行
        gap: "32px", // 列之间的间距
        justifyContent: "center", // 水平居中
        alignItems: "flex-start", // 顶部对齐
        width: "100%",
        maxWidth: "1400px", // 内容最大宽度
        margin: "0 auto", // 水平居中
        boxSizing: "border-box",
        marginTop: "7%",
    });
    document.body.appendChild(container);

    return container;
}

function createCategoryColumn(categoryName, links) {
    // 创建分类列容器
    const column = document.createElement("div");
    Object.assign(column.style, {
        display: "flex",
        flexDirection: "column", // 垂直排列
        gap: "12px", // 按钮间距
        alignItems: "stretch", // 按钮宽度一致
    });

    // 创建分类标题
    const title = document.createElement("div");
    title.textContent = categoryName;
    Object.assign(title.style, {
        fontSize: "20px",
        fontWeight: "bold",
        color: "#ffffff",
        marginBottom: "8px",
        textAlign: "center",
    });
    column.appendChild(title);

    // 为每个链接创建按钮
    links.forEach((link) => {
        const button = createLinkButton(link);
        column.appendChild(button);
    });

    return column;
}

function createLinkButton({ text, url, color }) {
    // 创建 button 标签
    const button = document.createElement("button");
    button.textContent = text;

    // 按钮样式：简约 + 现代感
    Object.assign(button.style, {
        padding: "10px 15px",
        margin: "1px 8px",
        backgroundColor: color || "#409eff", // 支持自定义颜色
        color: "#fff",
        border: "none",
        borderRadius: "8px",
        cursor: "pointer",
        fontSize: "22px",
        boxShadow: "0 2px 6px rgba(0,0,0,0.1)",
        transition: "background-color 0.3s, transform 0.2s",
    });

    // 点击事件，打开新页面并记录
    button.addEventListener("click", () => {
        // 打开新页面
        window.open(url, "_self");

        // 记录点击信息
        const timestamp = new Date().toISOString();
        const record = `${button.textContent}, ${timestamp}\n`;
        const records = localStorage.getItem("nav_clicks") || "";
        localStorage.setItem("nav_clicks", records + record);
    });

    return button;
}

// 导出并清理记录功能
function setupExportButton() {
    const exportBtn = document.getElementById("exportBtn");
    exportBtn.addEventListener("click", () => {
        // 获取所有记录
        const records = localStorage.getItem("nav_clicks") || "";

        if (!records) {
            alert("暂无记录");
            return;
        }

        // 创建并下载文件
        const blob = new Blob([records], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

        a.href = url;
        a.download = `nav_records_${timestamp}.txt`;
        a.click();

        // 清理
        URL.revokeObjectURL(url);
        localStorage.removeItem("nav_clicks");

        alert(`已导出并清理记录`);
    });
}

function renderData(data, container) {
    container.innerHTML = ""; // 清空之前的内容
    for (const [categoryName, links] of Object.entries(data)) {
        if (categoryName === "$schema") continue;

        const categoryColumn = createCategoryColumn(categoryName, links);
        container.appendChild(categoryColumn);
    }
}

async function initNav() {
    document.body.style.background = "#242424";
    const container = CreateContainer();
    
    let isEncryptedLoaded = false;
    const savedPassword = localStorage.getItem("nav_password");
    const unlockBtn = document.getElementById("unlockBtn");

    // 如果之前保存过密码，尝试直接自动解密并加载
    if (savedPassword) {
        try {
            const response = await fetch("links.enc");
            if (response.ok) {
                const encryptedData = await response.text();
                const bytes = CryptoJS.AES.decrypt(encryptedData, savedPassword);
                const decryptedStr = bytes.toString(CryptoJS.enc.Utf8);
                if (decryptedStr) {
                    const data = JSON.parse(decryptedStr);
                    renderData(data, container);
                    isEncryptedLoaded = true;
                    // 加载成功后隐藏解锁按钮
                    if (unlockBtn) unlockBtn.style.display = "none";
                }
            }
        } catch (e) {
            console.warn("自动解密失败，密码可能已过期或错误");
            localStorage.removeItem("nav_password");
        }
    }

    // 如果没有密码或者解密失败，则加载默认的 demo.json
    if (!isEncryptedLoaded) {
        try {
            const response = await fetch("demo.json");
            if (response.ok) {
                const data = await response.json();
                renderData(data, container);
            } else {
                console.warn("无法加载 demo.json");
            }
        } catch (err) {
            console.error("加载 Demo 数据失败:", err);
        }
    }

    setupExportButton();

    // 只有在没加载私密链接的情况下，才绑定解锁按钮事件
    if (unlockBtn && !isEncryptedLoaded) {
        unlockBtn.addEventListener("click", () => loadEncrypted(container, unlockBtn));
    }
}

async function loadEncrypted(container, unlockBtn) {
    // 1. 请求加密后的密文文件
    let response;
    try {
        response = await fetch("links.enc");
        if (!response.ok) throw new Error("无法读取加密文件 links.enc");
    } catch (err) {
        alert(err.message);
        return;
    }
    const encryptedData = await response.text();

    // 2. 尝试从 localStorage 获取密码，若没有则弹窗索要
    let password = localStorage.getItem("nav_password");
    let decryptedStr = "";
    let data = null;

    while (!data) {
        if (!password) {
            password = prompt("请输入导航页解密密码 🔐：");
            if (password === null) {
                return; // 取消输入，保持当前页面原样
            }
        }

        try {
            // 使用 CryptoJS 进行解密
            const bytes = CryptoJS.AES.decrypt(encryptedData, password);
            decryptedStr = bytes.toString(CryptoJS.enc.Utf8);

            if (!decryptedStr) throw new Error("密码错误");

            data = JSON.parse(decryptedStr); // 尝试解析为 JSON

            // 成功解密且是合法的 JSON，将密码记住
            localStorage.setItem("nav_password", password);
        } catch (e) {
            // 密码错误或 JSON 解析失败
            alert("密码错误，请重新输入！❌");
            password = null; // 清空密码，触发下一轮循环重新弹窗
            localStorage.removeItem("nav_password");
        }
    }

    // 3. 渲染私密数据并隐藏解锁按钮
    renderData(data, container);
    if (unlockBtn) {
        unlockBtn.style.display = "none";
    }
}

// execute here ----------------------
initNav();
