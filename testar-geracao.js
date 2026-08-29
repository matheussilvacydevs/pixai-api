const CDP = require('chrome-remote-interface');
const fs = require('fs');
const path = require('path');
const https = require('https');

const OUT = path.join(process.env.HOME, 'pixai-capture', 'resultado.webp');

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function download(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);

        https.get(url, res => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                file.close();
                fs.unlinkSync(dest);
                return resolve(download(res.headers.location, dest));
            }

            if (res.statusCode !== 200) {
                file.close();
                try { fs.unlinkSync(dest); } catch {}
                return reject(new Error(`Download HTTP ${res.statusCode}`));
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

(async () => {
    const targets = await CDP.List({ port: 9222 });

    const target = targets.find(
        x => x.type === 'page' && /pixai\.art/.test(x.url)
    );

    if (!target) {
        console.error('❌ Página do PixAI não encontrada.');
        process.exit(1);
    }

    const client = await CDP({
        port: 9222,
        target
    });

    const { Network, Runtime } = client;

    await Network.enable();
    await Runtime.enable();

    console.log('🔎 Aguardando uma chamada GraphQL do PixAI...');
    console.log('No navegador, recarregue ou clique em alguma opção do gerador.');

    let started = false;

    Network.requestWillBeSent(async params => {
        if (started) return;

        const url = params.request.url || '';

        if (
            !url.includes('api.pixai.art/graphql') ||
            !url.includes('u3t=')
        ) {
            return;
        }

        started = true;

        const parsed = new URL(url);
        const u3t = parsed.searchParams.get('u3t');

        console.log('✅ Sessão GraphQL detectada.');
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
                width: 768,
                height: 1280,
                prompts: 'anime girl, white hair, blue eyes, detailed anime illustration',
                modelId: '1983308862240288769',
                negativePrompts: 'worst quality, photorealistic, bad anatomy, blur, low resolution',
                batchSize: 1,
                controlNets: [],
                promptHelper: {
                    userWantToEnable: true,
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
                sha256Hash: '7662bf96848c0cd1e03cafc5a6b61785481a55a1c92faec3a248da9195bf9d25'
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

    const data = await response.json();

    return {
        status: response.status,
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

        const task =
            createValue?.data?.data?.createGenerationTask;

        if (!task?.id) {
            console.error('❌ Não foi possível criar a task.');
            console.dir(createValue, { depth: 10 });
            await client.close();
            process.exit(1);
        }

        const taskId = task.id;

        console.log(`✅ Task criada: ${taskId}`);
        console.log(`💳 Créditos: ${task.paidCredit}`);
        console.log(`📌 Status inicial: ${task.status}`);

        let completedTask = null;

        for (let i = 1; i <= 120; i++) {
            await sleep(2000);

            const taskExpression = `
(async () => {
    const endpoint =
        'https://api.pixai.art/graphql' +
        '?operation=getTaskById' +
        '&u3t=' + encodeURIComponent(${JSON.stringify(u3t)}) +
        '&operationName=getTaskById' +
        '&variables=' + encodeURIComponent(
            JSON.stringify({ id: ${JSON.stringify(taskId)} })
        ) +
        '&extensions=' + encodeURIComponent(
            JSON.stringify({
                clientLibrary: {
                    name: '@apollo/client',
                    version: '4.1.4'
                },
                persistedQuery: {
                    version: 1,
                    sha256Hash: '2526f64c73c59fcfeff938b0f4a8b3b610f2294bc6eb6b6b281aa671ac81a08e'
                }
            })
        );

    const response = await fetch(endpoint, {
        credentials: 'include',
        headers: {
            'x-apollo-operation-name': 'getTaskById'
        }
    });

    return await response.json();
})()
`;

            const taskResult = await Runtime.evaluate({
                expression: taskExpression,
                awaitPromise: true,
                returnByValue: true
            });

            const currentTask =
                taskResult.result.value?.data?.task;

            if (!currentTask) {
                console.log(`\n⚠️ Consulta ${i}: resposta inesperada`);

                console.dir(
                    taskResult.result.value,
                    {
                        depth: 20,
                        colors: true
                    }
                );

                if (taskResult.exceptionDetails) {
                    console.log('\n❌ Erro do navegador:');
                    console.dir(taskResult.exceptionDetails, {
                        depth: 10,
                        colors: true
                    });
                }

                break;
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
                console.error(`❌ Task terminou como: ${currentTask.status}`);
                await client.close();
                process.exit(1);
            }
        }

        if (!completedTask) {
            console.error('❌ Tempo limite esperando a geração.');
            await client.close();
            process.exit(1);
        }

        console.log('✅ Geração concluída.');

        const media = completedTask.media;

        if (!media) {
            console.error('❌ Task terminou, mas não retornou media.');
            console.dir(completedTask, { depth: 10 });
            await client.close();
            process.exit(1);
        }

        console.log(`🖼️ mediaId: ${media.id}`);
        console.log(`📐 ${media.width}x${media.height}`);
        console.log(`📦 Formato: ${media.imageType || 'desconhecido'}`);

        const original =
            media.urls?.find(x => x.variant === 'PUBLIC')?.url;

        if (!original) {
            console.error('❌ URL PUBLIC não encontrada.');
            console.dir(media.urls, { depth: 10 });
            await client.close();
            process.exit(1);
        }

        console.log(`🌐 URL: ${original}`);
        console.log('⬇️ Baixando imagem...');

        await download(original, OUT);

        const stat = fs.statSync(OUT);

        console.log('');
        console.log('🎉 SUCESSO');
        console.log(`📁 Arquivo: ${OUT}`);
        console.log(`📦 Tamanho: ${(stat.size / 1024).toFixed(1)} KB`);
        console.log(`🌱 Seed: ${completedTask.outputs?.seed ?? 'N/D'}`);

        await client.close();
        process.exit(0);
    });

})().catch(async err => {
    console.error('❌ ERRO:', err);
    process.exit(1);
});
