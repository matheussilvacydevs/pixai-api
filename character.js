#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function arg(name, fallback = null) {
    const i = process.argv.indexOf(name);
    if (i === -1) return fallback;
    return process.argv[i + 1] ?? fallback;
}

function usage() {
    console.log(`
Uso:

  node character.js NOME [opções]

Exemplo:

  node character.js personagem1 \\
    --roupa "uniforme escolar" \\
    --pose "em pé olhando para frente" \\
    --cenario "corredor da escola" \\
    --output escola.webp

Opções:

  --roupa       Roupa desejada
  --pose        Pose
  --cenario     Cenário
  --expressao   Expressão
  --extra       Detalhes adicionais
  --width       Largura
  --height      Altura
  --batch       Quantidade
  --output      Arquivo final
  --no-helper   Desativa Prompt Helper
`);
}

const args = process.argv.slice(2);

if (!args.length || args.includes('--help')) {
    usage();
    process.exit(0);
}

const characterName = args[0];

const file = path.join(
    __dirname,
    'characters',
    `${characterName}.json`
);

if (!fs.existsSync(file)) {
    console.error(`❌ Personagem não encontrado: ${characterName}`);
    console.error(`📁 Esperado: ${file}`);
    process.exit(1);
}

let character;

try {
    character = JSON.parse(
        fs.readFileSync(file, 'utf8')
    );
} catch (err) {
    console.error(`❌ JSON inválido: ${err.message}`);
    process.exit(1);
}

const roupa = arg('--roupa', character.defaultOutfit || '');
const pose = arg('--pose', character.defaultPose || '');
const cenario = arg('--cenario', character.defaultScenario || '');
const expressao = arg('--expressao', character.defaultExpression || '');
const extra = arg('--extra', '');

const width = arg(
    '--width',
    String(character.width || 768)
);

const height = arg(
    '--height',
    String(character.height || 1280)
);

const batch = arg('--batch', '1');

const output = arg(
    '--output',
    `${characterName}.webp`
);

const pieces = [];

if (character.basePrompt)
    pieces.push(character.basePrompt);

if (character.appearance)
    pieces.push(character.appearance);

if (roupa)
    pieces.push(`wearing ${roupa}`);

if (pose)
    pieces.push(`pose: ${pose}`);

if (expressao)
    pieces.push(`expression: ${expressao}`);

if (cenario)
    pieces.push(`background: ${cenario}`);

if (character.style)
    pieces.push(character.style);

if (extra)
    pieces.push(extra);

const prompt = pieces
    .filter(Boolean)
    .join(', ');

console.log('');
console.log('Character Manager');
console.log('────────────────────────────────');
console.log(`👤 ${character.name || characterName}`);
console.log(`👕 ${roupa || '-'}`);
console.log(`🧍 ${pose || '-'}`);
console.log(`🙂 ${expressao || '-'}`);
console.log(`🌎 ${cenario || '-'}`);
console.log('');
console.log('📝 Prompt montado:');
console.log(prompt);
console.log('');

const pixai = path.join(__dirname, 'pixai.js');

const childArgs = [
    pixai,

    '--prompt',
    prompt,

    '--width',
    width,

    '--height',
    height,

    '--batch',
    batch,

    '--output',
    output
];

if (character.negativePrompt) {
    childArgs.push(
        '--negative',
        character.negativePrompt
    );
}

if (args.includes('--no-helper')) {
    childArgs.push('--no-helper');
}

const child = spawn(
    process.execPath,
    childArgs,
    {
        stdio: 'inherit',
        cwd: __dirname
    }
);

child.on('exit', code => {
    process.exit(code ?? 1);
});
