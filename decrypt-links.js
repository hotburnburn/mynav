const fs = require('fs');
const CryptoJS = require('crypto-js');
const readline = require('readline');

const encFilePath = './links.enc';
const jsonFilePath = './links3.json';

// 检查加密文件是否存在
if (!fs.existsSync(encFilePath)) {
    console.error(`❌ 错误: 找不到文件 ${encFilePath}`);
    process.exit(1);
}

// 读取加密文件
let encryptedData;
try {
    encryptedData = fs.readFileSync(encFilePath, 'utf8');
} catch (err) {
    console.error('❌ 读取加密文件时出错:', err.message);
    process.exit(1);
}

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function tryDecrypt(password) {
    try {
        const bytes = CryptoJS.AES.decrypt(encryptedData, password);
        const decryptedStr = bytes.toString(CryptoJS.enc.Utf8);

        if (!decryptedStr) {
            return { success: false, error: '密码错误，解密结果为空' };
        }

        // 验证是否为合法 JSON
        let data;
        try {
            data = JSON.parse(decryptedStr);
        } catch (e) {
            return { success: false, error: '密码错误，解密结果不是有效的 JSON' };
        }

        return { success: true, data };
    } catch (err) {
        return { success: false, error: '解密过程出错: ' + err.message };
    }
}

console.log('🔓 正在解密 links.enc ...\n');

rl.question('请输入解密密码 🔐: ', (password) => {
    if (!password) {
        console.error('❌ 密码不能为空');
        rl.close();
        process.exit(1);
    }

    const result = tryDecrypt(password);

    if (!result.success) {
        console.error(`❌ ${result.error}`);
        rl.close();
        process.exit(1);
    }

    // 写入 links3.json
    try {
        const jsonStr = JSON.stringify(result.data, null, 2);
        fs.writeFileSync(jsonFilePath, jsonStr, 'utf8');
        console.log(`✅ 解密成功! 数据已写入 ${jsonFilePath}`);

        // 统计信息
        let totalLinks = 0;
        let categoryCount = 0;
        for (const [key, value] of Object.entries(result.data)) {
            if (key === '$schema') continue;
            categoryCount++;
            if (Array.isArray(value)) totalLinks += value.length;
        }
        console.log(`📊 共 ${categoryCount} 个分类, ${totalLinks} 个链接`);
    } catch (err) {
        console.error('❌ 写入文件失败:', err.message);
    }

    rl.close();
});
