const CDP = require('chrome-remote-interface');

const TASK_ID = '2050484018044794361';

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

    console.log('🔎 Aguardando uma chamada GraphQL...');
    console.log('👉 No PixAI, atualize a página ou clique em alguma opção.');

    let captured = false;

    Network.requestWillBeSent(async ({ request }) => {
        if (captured) return;

        const url = request.url || '';

        if (
            !url.includes('api.pixai.art/graphql') ||
            !url.includes('u3t=')
        ) return;

        captured = true;

        const parsed = new URL(url);
        const u3t = parsed.searchParams.get('u3t');

        console.log('✅ Sessão detectada.');
        console.log(`🔎 Consultando task ${TASK_ID}...`);

        const expression = `
(async () => {
    const variables = {
        id: ${JSON.stringify(TASK_ID)}
    };

    const extensions = {
        clientLibrary: {
            name: '@apollo/client',
            version: '4.1.4'
        },
        persistedQuery: {
            version: 1,
            sha256Hash:
                '2526f64c73c59fcfeff938b0f4a8b3b610f2294bc6eb6b6b281aa671ac81a08e'
        }
    };

    const endpoint =
        'https://api.pixai.art/graphql' +
        '?operation=getTaskById' +
        '&u3t=' + encodeURIComponent(${JSON.stringify(u3t)}) +
        '&operationName=getTaskById' +
        '&variables=' + encodeURIComponent(JSON.stringify(variables)) +
        '&extensions=' + encodeURIComponent(JSON.stringify(extensions));

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
        httpStatus: response.status,
        ok: response.ok,
        data
    };
})()
`;

        try {
            const result = await Runtime.evaluate({
                expression,
                awaitPromise: true,
                returnByValue: true
            });

            console.log('\n========== RESPOSTA ==========');

            console.dir(result.result.value, {
                depth: 20,
                colors: true
            });

            if (result.exceptionDetails) {
                console.log('\n❌ Exceção:');
                console.dir(result.exceptionDetails, {
                    depth: 10,
                    colors: true
                });
            }

        } catch (err) {
            console.error('❌ Erro:', err.message);
        }

        await client.close();
        process.exit(0);
    });

})().catch(err => {
    console.error('❌ ERRO:', err);
    process.exit(1);
});
