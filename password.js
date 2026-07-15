const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ENV_FILE = path.join(__dirname, '.env');
const PASSWORD_VARIABLE = 'LINKS_PASSWORD';

function loadEnvFile() {
    if (!fs.existsSync(ENV_FILE)) return;

    // Node.js 20.12+ can parse .env files natively.
    if (typeof process.loadEnvFile === 'function') {
        process.loadEnvFile(ENV_FILE);
        return;
    }

    // Lightweight fallback for older Node.js versions.
    for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
        const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)?\s*$/);
        if (!match || process.env[match[1]] !== undefined) continue;

        let value = match[2] || '';
        const quote = value[0];
        if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
            value = value.slice(1, -1);
        } else {
            value = value.replace(/\s+#.*$/, '').trim();
        }
        process.env[match[1]] = value;
    }
}

async function getPassword(prompt) {
    loadEnvFile();

    const password = process.env[PASSWORD_VARIABLE];
    if (password) {
        console.log(`🔑 已从环境配置读取 ${PASSWORD_VARIABLE}`);
        return password;
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
        return await new Promise((resolve) => rl.question(prompt, resolve));
    } finally {
        rl.close();
    }
}

module.exports = { getPassword };
