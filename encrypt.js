const fs = require('fs');
const CryptoJS = require('crypto-js');
const { getPassword } = require('./password');

const jsonFilePath = './links3.json';
const encFilePath = './links.enc';

// 检查文件是否存在
if (!fs.existsSync(jsonFilePath)) {
    console.error(`❌ 错误: 找不到文件 ${jsonFilePath}`);
    process.exit(1);
}

// 读取明文的 JSON 文件
let rawData;
try {
    rawData = fs.readFileSync(jsonFilePath, 'utf8');
} catch (err) {
    console.error('❌ 读取 JSON 文件时出错:', err.message);
    process.exit(1);
}

// 尝试验证 JSON 格式是否正确
try {
    JSON.parse(rawData);
} catch (err) {
    console.warn('⚠️ 警告: links3.json 似乎不是一个合法的 JSON 格式。将继续加密...');
}

async function encrypt() {
    const password = await getPassword('请输入加密密码 🔐: ');

    if (!password) {
        console.error('❌ 密码不能为空');
        process.exit(1);
    }

    try {
        // 使用 CryptoJS 按照 AES 算法加密数据
        // 注意：前端是直接解密整个被加密的 JSON 字符串
        const encryptedData = CryptoJS.AES.encrypt(rawData, password).toString();
        
        // 写入到 links.enc 文件中
        fs.writeFileSync(encFilePath, encryptedData, 'utf8');
        console.log(`✅ 成功! 加密后的数据已写入到 ${encFilePath}`);
        console.log('你现在可以将修改后的 links.enc 提交到 GitHub 仓库了。');
    } catch (err) {
        console.error('❌ 加密失败:', err.message);
        process.exitCode = 1;
    }
}

encrypt().catch((err) => {
    console.error('❌ 读取密码失败:', err.message);
    process.exit(1);
});
