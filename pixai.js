#!/usr/bin/env node

const CDP = require('chrome-remote-interface');
const fs = require('fs');
const path = require('path');
const https = require('https');
const {
    getProfile,
    ensureChrome
} = require('./profile-manager');

function arg(name, fallback = null) {
    const i = process.argv.indexOf(name);
    if (i === -1) return fallback;
    return process.argv[i + 1] ?? fallback;
}

function has(name) {
    return process.argv.includes(name);
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function download(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);

        https.get(url, res => {
            if (
                res.statusCode >= 300 &&
                res.statusCode < 400 &&
                res.headers.location
            ) {
                file.close();
                try { fs.unlinkSync(dest); } catch {}
                return resolve(download(res.headers.location, dest));
            }

            if (res.statusCode !== 200) {
                file.close();
                try { fs.unlinkSync(dest); } catch {}
                return reject(
                    new Error(`Download HTTP ${res.statusCode}`)
                );
            }

            res.pipe(file);

            file.on('finish', () => {
                file.close();
                resolve();
            });
        }).on('error', err => {
            file.close();
            try { fs.unlinkSync(dest); } catch {}
            reject(err);
        });
    });
}

function usage() {
    console.log(`
PixAI CLI

Uso:

  node pixai.js \\
    --prompt "1girl, long black hair" \\
    --width 768 \\
    --height 1280 \\
    --batch 1 \\
    --output resultado.webp

Opções:

  --prompt       Prompt da imagem
  --negative     Negative prompt
  --width        Largura
  --height       Altura
  --batch        Quantidade de imagens
  --output       Arquivo de saída
  --no-helper    Desativa Prompt Helper
  --help         Mostra esta ajuda

O Chromium precisa estar aberto com:
  --remote-debugging-port=9222
`);
}

if (has('--help')) {
    usage();
    process.exit(0);
}

const PROFILE_NAME = arg('--profile', null);

const PROMPT = arg(
    '--prompt',
    'anime girl, white hair, blue eyes, detailed anime illustration'
);

const NEGATIVE = arg(
    '--negative',
    'worst quality, photorealistic, bad anatomy, blur, low resolution'
);

const WIDTH = Number(arg('--width', '768'));
const HEIGHT = Number(arg('--height', '1280'));
const BATCH = Number(arg('--batch', '1'));

const OUTPUT = path.resolve(
    arg('--output', 'resultado.webp')
);

const PROMPT_HELPER = !has('--no-helper');

const MODEL_ID = '1983308862240288769';

const CREATE_HASH =
    '7662bf96848c0cd1e03cafc5a6b61785481a55a1c92faec3a248da9195bf9d25';

const GET_TASK_HASH =
    '2526f64c73c59fcfeff938b0f4a8b3b610f2294bc6eb6b6b281aa671ac81a08e';

(async () => {
    if (!PROMPT.trim()) {
        throw new Error('Prompt vazio.');
    }

    if (!Number.isInteger(WIDTH) || !Number.isInteger(HEIGHT)) {
        throw new Error('Width/height inválidos.');
    }

    if (!Number.isInteger(BATCH) || BATCH < 1) {
        throw new Error('Batch inválido.');
    }

    const profile = getProfile(PROFILE_NAME);

    console.log(`👤 Perfil: ${profile.name}`);

    await ensureChrome(profile);

    const targets = await CDP.List({
        port: profile.port
    });

    const target = targets.find(
        x => x.type === 'page' && /pixai\.art/i.test(x.url)
    );

    if (!target) {
        console.error('❌ Página do PixAI não encontrada.');
        console.error(
            `Nenhuma aba PixAI encontrada no perfil ${profile.name} (porta ${profile.port}).`
        );
        process.exit(1);
    }

    const client = await CDP({
        port: profile.port,
        target
    });

    const { Network, Runtime, Page } = client;

    await Network.enable();
    await Runtime.enable();
    await Page.enable();

    console.log('PixAI CLI');
    console.log('────────────────────────────────');
    console.log(`Prompt: ${PROMPT}`);
    console.log(`Tamanho: ${WIDTH}x${HEIGHT}`);
    console.log(`Batch: ${BATCH}`);
    console.log(`Prompt Helper: ${PROMPT_HELPER ? 'ON' : 'OFF'}`);
    console.log(`Saída: ${OUTPUT}`);
    console.log('');
    console.log('🔎 Detectando sessão GraphQL do PixAI...');

    let started = false;

    setTimeout(async () => {
        try {
            console.log('♻️ Recarregando PixAI via CDP...');
            await Page.reload({
                ignoreCache: false
            });
        } catch (err) {
            console.error(
                '⚠️ Não consegui recarregar automaticamente:',
                err.message
            );
        }
    }, 1000);

    Network.requestWillBeSent(async ({ request }) => {
        if (started) return;

        const url = request.url || '';

        if (
            !url.includes('api.pixai.art/graphql') ||
            !url.includes('u3t=')
        ) {
            return;
        }

        started = true;

        try {
            const parsed = new URL(url);
            const u3t = parsed.searchParams.get('u3t');

            if (!u3t) {
                throw new Error('u3t não encontrado.');
            }

            console.log('✅ Sessão detectada.');
            console.log('⏳ Aguardando a página estabilizar...');

            await new Promise(resolve => setTimeout(resolve, 3000));

            console.log('🎨 Criando geração...');

            const createExpression = `
(async () => {
    const endpoint =
        'https://api.pixai.art/graphql' +
        '?operation=createGenerationTask' +
        '&u3t=' + encodeURIComponent(${JSON.stringify(u3t)});

    const body = {
        operationName: 'createGenerationTask',

        variables: {
            parameters: {
                extra: {},

                width: ${WIDTH},
                height: ${HEIGHT},

                prompts: ${JSON.stringify(PROMPT)},

                modelId: ${JSON.stringify(MODEL_ID)},

                negativePrompts: ${JSON.stringify(NEGATIVE)},

                batchSize: ${BATCH},

                controlNets: [],

                promptHelper: {
                    userWantToEnable: ${PROMPT_HELPER},
                    forcePromptHelperDetectionSide: 'server'
                }
            }
        },

        extensions: {
            clientLibrary: {
                name: '@apollo/client',
                version: '4.1.4'
            },

            persistedQuery: {
                version: 1,
                sha256Hash: ${JSON.stringify(CREATE_HASH)}
            }
        }
    };

    const response = await fetch(endpoint, {
        method: 'POST',

        credentials: 'include',

        headers: {
            'content-type': 'application/json'
        },

        body: JSON.stringify(body)
    });

    const text = await response.text();

    let data;

    try {
        data = JSON.parse(text);
    } catch {
        data = text;
    }

    return {
        status: response.status,
        ok: response.ok,
        data
    };
})()
`;

            const createResult = await Runtime.evaluate({
                expression: createExpression,
                awaitPromise: true,
                returnByValue: true
            });

            const createValue = createResult.result.value;

            if (!createValue?.ok) {
                console.error('❌ Erro HTTP criando task:');
                console.dir(createValue, {
                    depth: 20,
                    colors: true
                });
                process.exit(1);
            }

            const task =
                createValue?.data?.data?.createGenerationTask;

            if (!task?.id) {
                const gqlError =
                    createValue?.data?.errors?.[0];

                const errorName =
                    gqlError?.extensions?.exception?.name;

                const errorMessage =
                    gqlError?.message ||
                    gqlError?.extensions?.message;

                if (
                    errorName === 'INSUFFICIENT_BALANCE' ||
                    errorMessage === 'insufficient balance'
                ) {
                    console.error(
                        '❌ Saldo insuficiente no PixAI para esta geração.'
                    );
                    process.exit(2);
                }

                console.error('❌ Task não retornada:');
                console.dir(createValue, {
                    depth: 20,
                    colors: true
                });
                process.exit(1);
            }

            const taskId = task.id;

            console.log(`✅ Task: ${taskId}`);
            console.log(`💳 Créditos: ${task.paidCredit}`);
            console.log(`📌 Status: ${task.status}`);

            let completedTask = null;

            for (let i = 1; i <= 120; i++) {
                await sleep(2000);

                const taskExpression = `
(async () => {
    const variables = {
        id: ${JSON.stringify(taskId)}
    };

    const extensions = {
        clientLibrary: {
            name: '@apollo/client',
            version: '4.1.4'
        },

        persistedQuery: {
            version: 1,
            sha256Hash: ${JSON.stringify(GET_TASK_HASH)}
        }
    };

    const endpoint =
        'https://api.pixai.art/graphql' +
        '?operation=getTaskById' +
        '&u3t=' + encodeURIComponent(${JSON.stringify(u3t)}) +
        '&operationName=getTaskById' +
        '&variables=' +
            encodeURIComponent(JSON.stringify(variables)) +
        '&extensions=' +
            encodeURIComponent(JSON.stringify(extensions));

    const response = await fetch(endpoint, {
        method: 'GET',

        credentials: 'include',

        headers: {
            'x-apollo-operation-name': 'getTaskById'
        }
    });

    const text = await response.text();

    let data;

    try {
        data = JSON.parse(text);
    } catch {
        data = text;
    }

    return {
        status: response.status,
        ok: response.ok,
        data
    };
})()
`;

                const taskResult = await Runtime.evaluate({
                    expression: taskExpression,
                    awaitPromise: true,
                    returnByValue: true
                });

                const response = taskResult.result.value;

                if (!response?.ok) {
                    console.error(
                        `⚠️ Consulta ${i}: HTTP ${response?.status}`
                    );
                    continue;
                }

                const currentTask =
                    response?.data?.data?.task;

                if (!currentTask) {
                    console.log(
                        `⏳ Consulta ${i}: sem task`
                    );
                    continue;
                }

                console.log(
                    `⏳ Consulta ${i}: ${currentTask.status}`
                );

                if (currentTask.status === 'completed') {
                    completedTask = currentTask;
                    break;
                }

                if (
                    currentTask.status === 'failed' ||
                    currentTask.status === 'cancelled'
                ) {
                    throw new Error(
                        `Task terminou como ${currentTask.status}`
                    );
                }
            }

            if (!completedTask) {
                throw new Error(
                    'Tempo limite aguardando geração.'
                );
            }

            console.log('✅ Geração concluída.');

            const media = completedTask.media;

            if (!media) {
                throw new Error(
                    'Task completed sem objeto media.'
                );
            }

            const original =
                media.urls?.find(
                    x => x.variant === 'PUBLIC'
                )?.url;

            if (!original) {
                throw new Error(
                    'URL PUBLIC não encontrada.'
                );
            }

            console.log(`🖼️ Media: ${media.id}`);
            console.log(
                `📐 ${media.width}x${media.height}`
            );
            console.log(
                `🌱 Seed: ${completedTask.outputs?.seed ?? 'N/D'}`
            );
            console.log(`🌐 ${original}`);

            console.log('⬇️ Baixando...');

            await download(original, OUTPUT);

            const stat = fs.statSync(OUTPUT);

            console.log('');
            console.log('🎉 SUCESSO');
            console.log(`📁 ${OUTPUT}`);
            console.log(
                `📦 ${(stat.size / 1024).toFixed(1)} KB`
            );

            // ─────────────────────────────────────────────
            // HISTÓRICO
            // ─────────────────────────────────────────────

            const historyDir = path.join(__dirname, 'history');
            const historyFile = path.join(historyDir, 'generations.jsonl');

            fs.mkdirSync(historyDir, {
                recursive: true
            });

            const historyEntry = {
        profile: profile.name,
                timestamp: new Date().toISOString(),

                taskId: taskId,

                mediaId: media.id,

                modelId: MODEL_ID,

                prompt: PROMPT,

                negativePrompt: NEGATIVE,

                promptHelper: PROMPT_HELPER,

                width: media.width || WIDTH,
                height: media.height || HEIGHT,

                batchSize: BATCH,

                seed: completedTask.outputs?.seed ?? null,

                paidCredit: task.paidCredit ?? null,

                inferenceProfile:
                    completedTask.parameters?.inferenceProfile ?? null,

                generatedPrompt:
                    completedTask.parameters?.prompts ?? null,

                naturalPrompt:
                    completedTask.parameters?.extra?.naturalPrompts ?? PROMPT,

                imageType:
                    media.imageType ?? null,

                output:
                    OUTPUT,

                sizeBytes:
                    stat.size,

                publicUrl:
                    original
            };

            fs.appendFileSync(
                historyFile,
                JSON.stringify(historyEntry) + '\n'
            );

            console.log(`📝 Histórico: ${historyFile}`);

        } catch (err) {
            console.error('');
            console.error(`❌ ${err.message}`);
        } finally {
            try {
                await client.close();
            } catch {}

            process.exit();
        }
    });

})().catch(err => {
    console.error(`❌ ${err.message}`);
    process.exit(1);
});
