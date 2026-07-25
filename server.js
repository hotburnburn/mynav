const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const util = require("util");
const { execFile } = require("child_process");
const CryptoJS = require("crypto-js");
const { getPassword } = require("./password");

const execFileAsync = util.promisify(execFile);
const HOST = "127.0.0.1";
const PORT = Number(process.env.MYNAV_EDITOR_PORT || 8765);
const ROOT = __dirname;
const LINKS_FILE = path.resolve(ROOT, process.env.MYNAV_LINKS_FILE || "links.enc");
const BACKUP_DIR = path.resolve(ROOT, process.env.MYNAV_BACKUP_DIR || ".mynav-backups");
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_BACKUPS = 20;
const CSRF_TOKEN = crypto.randomBytes(32).toString("hex");

const EDITOR_ASSETS = new Map([
    ["/editor.html", { file: "editor.html", type: "text/html; charset=utf-8" }],
    ["/editor.css", { file: "editor.css", type: "text/css; charset=utf-8" }],
    ["/editor.js", { file: "editor.js", type: "text/javascript; charset=utf-8" }],
]);

let password = "";
let publishing = false;

function json(response, statusCode, payload) {
    response.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
    });
    response.end(JSON.stringify(payload));
}

function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

function revisionOf(encryptedText) {
    return crypto.createHash("sha256").update(encryptedText).digest("hex");
}

function decryptLinks(encryptedText) {
    const bytes = CryptoJS.AES.decrypt(encryptedText.trim(), password);
    const plaintext = bytes.toString(CryptoJS.enc.Utf8);
    if (!plaintext) {
        throw new Error("无法解密 links.enc：请检查 .env 中的 LINKS_PASSWORD");
    }

    try {
        return JSON.parse(plaintext);
    } catch {
        throw new Error("links.enc 解密成功，但内容不是有效的 JSON");
    }
}

function normalizeColor(color) {
    if (color === undefined || color === null || color === "") return "#409eff";
    if (typeof color !== "string") {
        throw new Error("链接颜色必须是十六进制颜色，例如 #409eff");
    }
    if (/^#[0-9a-f]{6}$/i.test(color)) return color.toUpperCase();
    if (/^#[0-9a-f]{3}$/i.test(color)) {
        return `#${color.slice(1).split("").map((character) => character.repeat(2)).join("")}`.toUpperCase();
    }
    throw new Error("链接颜色必须是十六进制颜色，例如 #409eff");
}

function validateLinksData(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("导航数据必须是一个对象");
    }

    const normalized = { $schema: "./link_schema.json" };
    for (const [categoryName, links] of Object.entries(data)) {
        if (categoryName === "$schema") continue;
        if (!categoryName.trim()) throw new Error("分类名称不能为空");
        if (categoryName.length > 40) throw new Error(`分类“${categoryName}”名称过长`);
        if (!Array.isArray(links)) throw new Error(`分类“${categoryName}”必须是链接列表`);

        normalized[categoryName] = links.map((link, index) => {
            if (!link || typeof link !== "object") {
                throw new Error(`分类“${categoryName}”的第 ${index + 1} 个链接无效`);
            }

            const text = typeof link.text === "string" ? link.text.trim() : "";
            const rawUrl = typeof link.url === "string" ? link.url.trim() : "";
            const linkUrl = rawUrl.replace(/^([a-z][a-z0-9+.-]*):\s+\/\//i, "$1://");
            if (!text || text.length > 60) {
                throw new Error(`分类“${categoryName}”中有名称为空或过长的链接`);
            }

            let parsedUrl;
            try {
                parsedUrl = new URL(linkUrl);
            } catch {
                throw new Error(`链接“${text}”的网址无效`);
            }
            if (!["http:", "https:"].includes(parsedUrl.protocol)) {
                throw new Error(`链接“${text}”只允许使用 http 或 https`);
            }

            return { text, url: linkUrl, color: normalizeColor(link.color) };
        });
    }

    return normalized;
}

function validateStoredShape(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("links.enc 中的导航数据必须是一个对象");
    }

    for (const [categoryName, links] of Object.entries(data)) {
        if (categoryName === "$schema") continue;
        if (!Array.isArray(links)) throw new Error(`分类“${categoryName}”必须是链接列表`);
        for (const link of links) {
            if (!link || typeof link.text !== "string" || typeof link.url !== "string") {
                throw new Error(`分类“${categoryName}”包含无效链接`);
            }
        }
    }
    return data;
}

async function readEncryptedFile() {
    return fs.promises.readFile(LINKS_FILE, "utf8");
}

async function readLinksResponse() {
    const encryptedText = await readEncryptedFile();
    const data = validateStoredShape(decryptLinks(encryptedText));
    return {
        data,
        revision: revisionOf(encryptedText),
        csrfToken: CSRF_TOKEN,
    };
}

async function readJsonBody(request) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) throw new Error("提交内容过大");
        chunks.push(chunk);
    }

    try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
        throw new Error("请求内容不是有效的 JSON");
    }
}

async function createBackup(encryptedText) {
    await fs.promises.mkdir(BACKUP_DIR, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    await fs.promises.writeFile(
        path.join(BACKUP_DIR, `links-${timestamp}.enc`),
        encryptedText,
        "utf8",
    );

    const backupNames = (await fs.promises.readdir(BACKUP_DIR))
        .filter((name) => /^links-.*\.enc$/.test(name))
        .sort()
        .reverse();

    await Promise.all(
        backupNames.slice(MAX_BACKUPS).map((name) =>
            fs.promises.unlink(path.join(BACKUP_DIR, name)),
        ),
    );
}

async function saveLinks(data, expectedRevision) {
    const currentEncryptedText = await readEncryptedFile();
    const currentRevision = revisionOf(currentEncryptedText);
    if (expectedRevision !== currentRevision) {
        const conflict = new Error("links.enc 已在编辑器外发生变化，请重新载入后再保存");
        conflict.code = "REVISION_CONFLICT";
        throw conflict;
    }

    const normalized = validateLinksData(data);
    const plaintext = JSON.stringify(normalized, null, 2);
    const encryptedText = CryptoJS.AES.encrypt(plaintext, password).toString();
    const temporaryFile = path.join(ROOT, `.links-${crypto.randomUUID()}.tmp`);

    await createBackup(currentEncryptedText);
    try {
        await fs.promises.writeFile(temporaryFile, encryptedText, "utf8");
        await fs.promises.rename(temporaryFile, LINKS_FILE);
    } catch (error) {
        await fs.promises.unlink(temporaryFile).catch(() => {});
        throw error;
    }

    return {
        revision: revisionOf(encryptedText),
        categoryCount: Object.keys(normalized).filter((key) => key !== "$schema").length,
        linkCount: Object.entries(normalized)
            .filter(([key]) => key !== "$schema")
            .reduce((total, [, links]) => total + links.length, 0),
    };
}

async function runGit(args) {
    try {
        return await execFileAsync("git", args, {
            cwd: ROOT,
            windowsHide: true,
            timeout: 120000,
            maxBuffer: 1024 * 1024,
        });
    } catch (error) {
        const detail = String(error.stderr || error.stdout || error.message || "").trim();
        const gitError = new Error(detail || `git ${args[0]} 执行失败`);
        gitError.cause = error;
        throw gitError;
    }
}

function samePath(left, right) {
    return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

async function publishLinks(commitMessage, expectedRevision) {
    if (publishing) {
        const error = new Error("已有发布任务正在执行");
        error.statusCode = 409;
        throw error;
    }

    const message = typeof commitMessage === "string" ? commitMessage.trim() : "";
    if (!message) throw new Error("Commit message 不能为空");
    if (message.length > 200) throw new Error("Commit message 不能超过 200 个字符");
    if (/[\r\n]/.test(message)) throw new Error("Commit message 只能使用单行文本");

    const productionLinksFile = path.join(ROOT, "links.enc");
    if (!samePath(LINKS_FILE, productionLinksFile)) {
        throw new Error("测试文件模式下不能执行 Git 发布");
    }

    const encryptedText = await readEncryptedFile();
    if (revisionOf(encryptedText) !== expectedRevision) {
        const error = new Error("links.enc 已发生变化，请重新载入后再发布");
        error.statusCode = 409;
        throw error;
    }

    publishing = true;
    let commit = "";
    try {
        const repositoryRoot = (await runGit(["rev-parse", "--show-toplevel"])).stdout.trim();
        if (!samePath(repositoryRoot, ROOT)) {
            throw new Error("编辑服务必须从 MyNav 仓库根目录运行");
        }

        const status = (await runGit(["status", "--porcelain", "--", "links.enc"])).stdout.trim();
        if (!status) {
            const error = new Error("links.enc 没有需要发布的修改");
            error.statusCode = 409;
            throw error;
        }

        await runGit(["add", "--", "links.enc"]);
        await runGit(["commit", "-m", message, "--", "links.enc"]);
        commit = (await runGit(["rev-parse", "--short", "HEAD"])).stdout.trim();
        const branch = (await runGit(["branch", "--show-current"])).stdout.trim();

        try {
            const pushResult = await runGit(["push"]);
            return {
                ok: true,
                commit,
                branch,
                message,
                output: String(pushResult.stderr || pushResult.stdout || "").trim(),
            };
        } catch (error) {
            const pushError = new Error(`提交 ${commit} 已创建，但推送失败：${error.message}`);
            pushError.statusCode = 502;
            pushError.payload = { committed: true, commit, branch };
            throw pushError;
        }
    } finally {
        publishing = false;
    }
}

function isAllowedHost(request) {
    const host = request.headers.host || "";
    return host === `${HOST}:${PORT}` || host === `localhost:${PORT}`;
}

async function serveAsset(response, asset) {
    const body = await fs.promises.readFile(path.join(ROOT, asset.file));
    response.writeHead(200, {
        "Content-Type": asset.type,
        "Cache-Control": "no-store",
        "Content-Security-Policy": [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self'",
            "connect-src 'self'",
            "img-src 'self' data:",
            "object-src 'none'",
            "base-uri 'none'",
            "frame-ancestors 'none'",
        ].join("; "),
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
    });
    response.end(body);
}

async function handleRequest(request, response) {
    if (!isAllowedHost(request)) {
        json(response, 403, { error: "拒绝未知 Host" });
        return;
    }

    const url = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === "GET" && url.pathname === "/") {
        response.writeHead(302, { Location: "/editor.html", "Cache-Control": "no-store" });
        response.end();
        return;
    }

    if (request.method === "GET" && EDITOR_ASSETS.has(url.pathname)) {
        await serveAsset(response, EDITOR_ASSETS.get(url.pathname));
        return;
    }

    if (request.method === "GET" && url.pathname === "/api/links") {
        json(response, 200, await readLinksResponse());
        return;
    }

    if (request.method === "PUT" && url.pathname === "/api/links") {
        if (request.headers["x-mynav-token"] !== CSRF_TOKEN) {
            json(response, 403, { error: "编辑会话已失效，请刷新页面" });
            return;
        }

        const body = await readJsonBody(request);
        const result = await saveLinks(body.data, body.revision);
        json(response, 200, { ok: true, ...result });
        return;
    }

    if (request.method === "POST" && url.pathname === "/api/publish") {
        if (request.headers["x-mynav-token"] !== CSRF_TOKEN) {
            json(response, 403, { error: "编辑会话已失效，请刷新页面" });
            return;
        }

        const body = await readJsonBody(request);
        const result = await publishLinks(body.message, body.revision);
        json(response, 200, result);
        return;
    }

    if (request.method === "GET" && url.pathname === "/favicon.ico") {
        response.writeHead(204, { "Cache-Control": "public, max-age=86400" });
        response.end();
        return;
    }

    json(response, 404, { error: "Not found" });
}

async function main() {
    if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
        throw new Error("MYNAV_EDITOR_PORT 必须是有效端口号");
    }

    password = await getPassword("请输入导航页密码以启动编辑器 🔐: ");
    if (!password) throw new Error("导航页密码不能为空");

    // Fail before listening if the configured password or encrypted file is invalid.
    const initial = await readLinksResponse();
    const server = http.createServer((request, response) => {
        handleRequest(request, response).catch((error) => {
            const statusCode = error.statusCode || (error.code === "REVISION_CONFLICT" ? 409 : 400);
            console.error("请求失败:", errorMessage(error));
            if (!response.headersSent) {
                json(response, statusCode, {
                    error: errorMessage(error),
                    ...(error.payload || {}),
                });
            }
            else response.end();
        });
    });

    server.listen(PORT, HOST, () => {
        const categoryCount = Object.keys(initial.data).filter((key) => key !== "$schema").length;
        const linkCount = Object.entries(initial.data)
            .filter(([key]) => key !== "$schema")
            .reduce((total, [, links]) => total + links.length, 0);
        console.log(`✅ MyNav 编辑服务已启动：http://${HOST}:${PORT}/`);
        console.log(`📊 已载入 ${categoryCount} 个分类、${linkCount} 个链接`);
        console.log("按 Ctrl+C 停止服务");
    });
}

main().catch((error) => {
    console.error(`❌ 编辑服务启动失败：${errorMessage(error)}`);
    process.exitCode = 1;
});
