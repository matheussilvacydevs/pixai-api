#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const file = path.join(
    __dirname,
    'history',
    'generations.jsonl'
);

if (!fs.existsSync(file)) {
    console.log('📭 Nenhuma geração registrada ainda.');
    process.exit(0);
}

const entries = fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => {
        try {
            return JSON.parse(line);
        } catch {
            return null;
        }
    })
    .filter(Boolean);

if (!entries.length) {
    console.log('📭 Histórico vazio.');
    process.exit(0);
}

console.log('');
console.log(`📚 Histórico PixAI — ${entries.length} gerações`);
console.log('════════════════════════════════════════════');

for (const [index, x] of entries.entries()) {
    console.log('');
    console.log(`#${index + 1}`);
    console.log(`📅 ${x.timestamp}`);
    console.log(`🆔 Task: ${x.taskId}`);
    console.log(`🖼️ Media: ${x.mediaId}`);
    console.log(`📐 ${x.width}x${x.height}`);
    console.log(`🌱 Seed: ${x.seed ?? 'N/D'}`);
    console.log(`⚙️ Perfil: ${x.inferenceProfile ?? 'N/D'}`);
    console.log(`💳 Créditos: ${x.paidCredit ?? 'N/D'}`);
    console.log(`📝 Prompt: ${x.naturalPrompt || x.prompt}`);
    console.log(`📁 ${x.output}`);
}

console.log('');
