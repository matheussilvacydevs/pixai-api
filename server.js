'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');

const {
    getProfile,
    listProfiles,
    isChromeAlive
} = require('./profile-manager');

const ROOT = __dirname;
const ENV_FILE = path.join(
    ROOT,
    '.env'
);

function loadEnv(file) {
    if (!fs.existsSync(file)) {
        return;
    }

    const text = fs.readFileSync(
        file,
        'utf8'
    );

    for (
        const rawLine of text.split(/\r?\n/)
    ) {
        const line = rawLine.trim();

        if (
            !line ||
            line.startsWith('#')
        ) {
            continue;
        }

        const idx = line.indexOf('=');

        if (idx < 1) {
            continue;
        }

        const key =
            line
                .slice(0, idx)
                .trim();

        let value =
            line
                .slice(idx + 1)
                .trim();

        if (
            (
                value.startsWith('"') &&
                value.endsWith('"')
            ) ||
            (
                value.startsWith("'") &&
                value.endsWith("'")
            )
        ) {
            value =
                value.slice(1, -1);
        }

        if (!(key in process.env)) {
            process.env[key] = value;
        }
    }
}

loadEnv(ENV_FILE);

const HOST =
    process.env.API_HOST ||
    '127.0.0.1';

const PORT =
    Number(
        process.env.API_PORT ||
        8787
    );

const API_KEY =
    process.env.API_KEY ||
    '';

const NODE_BIN =
    process.env.NODE_BIN ||
    process.execPath;

const MAX_BODY =
    1024 * 1024;

const MAX_CONCURRENT =
    Number(
        process.env.MAX_CONCURRENT ||
        2
    );

let activeJobs = 0;

if (!API_KEY) {
    console.error(
        '❌ API_KEY não configurada.'
    );

    process.exit(1);
}

function json(
    res,
    status,
    body
) {
    const data =
        Buffer.from(
            JSON.stringify(
                body,
                null,
                2
            )
        );

    res.writeHead(
        status,
        {
            'content-type':
                'application/json; charset=utf-8',

            'content-length':
                data.length,

            'cache-control':
                'no-store',

            'access-control-allow-origin':
                '*',

            'access-control-allow-headers':
                'content-type, x-api-key, authorization',

            'access-control-allow-methods':
                'GET, POST, OPTIONS'
        }
    );

    res.end(data);
}

function authorized(req) {
    const supplied =
        req.headers['x-api-key'] ||
        String(
            req.headers.authorization ||
            ''
        ).replace(
            /^Bearer\s+/i,
            ''
        );

    if (!supplied) {
        return false;
    }

    const a =
        Buffer.from(
            String(supplied)
        );

    const b =
        Buffer.from(
            String(API_KEY)
        );

    if (a.length !== b.length) {
        return false;
    }

    return crypto.timingSafeEqual(
        a,
        b
    );
}

async function readJson(req) {
    let size = 0;
    const chunks = [];

    for await (
        const chunk of req
    ) {
        size += chunk.length;

        if (size > MAX_BODY) {
            const e =
                new Error(
                    'Payload grande demais'
                );

            e.statusCode = 413;
            throw e;
        }

        chunks.push(chunk);
    }

    if (!chunks.length) {
        return {};
    }

    try {
        return JSON.parse(
            Buffer.concat(chunks)
                .toString('utf8')
        );
    } catch {
        const e =
            new Error(
                'JSON inválido'
            );

        e.statusCode = 400;
        throw e;
    }
}

function safeOutputName(name) {
    if (!name) {
        return (
            `generation-${Date.now()}.webp`
        );
    }

    const base =
        path.basename(
            String(name)
        ).replace(
            /[^a-zA-Z0-9._-]/g,
            '_'
        );

    return (
        base ||
        `generation-${Date.now()}.webp`
    );
}

function intInRange(
    value,
    fallback,
    min,
    max
) {
    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {
        return fallback;
    }

    const n = Number(value);

    if (
        !Number.isInteger(n) ||
        n < min ||
        n > max
    ) {
        throw new Error(
            `Valor inválido: ${value}`
        );
    }

    return n;
}

function parseCliOutput(
    stdout,
    stderr,
    outputFile,
    profile
) {
    const text =
        `${stdout}\n${stderr}`;

    const capture =
        re => {
            const m =
                text.match(re);

            return m
                ? m[1]
                : null;
        };

    const insufficient =
        /saldo insuficiente|INSUFFICIENT_BALANCE/i
            .test(text);

    return {
        ok:
            /🎉\s*SUCESSO|Geração concluída/i
                .test(text)
            &&
            !insufficient,

        insufficientBalance:
            insufficient,

        profile,

        taskId:
            capture(
                /(?:✅\s*)?Task:\s*(\d+)/i
            ),

        mediaId:
            capture(
                /(?:🖼️\s*)?Media:\s*(\d+)/i
            ),

        seed:
            capture(
                /(?:🌱\s*)?Seed:\s*(\d+)/i
            ),

        paidCredit:
            (() => {
                const v =
                    capture(
                        /(?:💳\s*)?Créditos:\s*(\d+)/i
                    );

                return v === null
                    ? null
                    : Number(v);
            })(),

        publicUrl:
            capture(
                /🌐\s*(https?:\/\/\S+)/i
            ),

        output:
            fs.existsSync(outputFile)
                ? outputFile
                : null,

        sizeBytes:
            fs.existsSync(outputFile)
                ? fs.statSync(outputFile).size
                : null,

        log:
            text.trim()
    };
}

function runGeneration(body) {
    return new Promise(
        (
            resolve,
            reject
        ) => {
            if (
                activeJobs >=
                MAX_CONCURRENT
            ) {
                const e =
                    new Error(
                        'Servidor ocupado'
                    );

                e.statusCode = 429;
                return reject(e);
            }

            const prompt =
                String(
                    body.prompt ||
                    ''
                ).trim();

            if (!prompt) {
                const e =
                    new Error(
                        'Campo prompt é obrigatório'
                    );

                e.statusCode = 400;
                return reject(e);
            }

            const profileName =
                String(
                    body.profile ||
                    ''
                ).trim()
                ||
                undefined;

            const profile =
                getProfile(profileName);

            const width =
                intInRange(
                    body.width,
                    768,
                    128,
                    4096
                );

            const height =
                intInRange(
                    body.height,
                    1280,
                    128,
                    4096
                );

            const batchSize =
                intInRange(
                    body.batchSize ??
                    body.batch,
                    1,
                    1,
                    4
                );

            const promptHelper =
                body.promptHelper === undefined
                    ? true
                    : Boolean(
                        body.promptHelper
                    );

            const outputName =
                safeOutputName(
                    body.output
                );

            const outputFile =
                path.resolve(
                    ROOT,
                    outputName
                );

            if (
                !outputFile.startsWith(
                    ROOT + path.sep
                )
            ) {
                const e =
                    new Error(
                        'Nome de saída inválido'
                    );

                e.statusCode = 400;
                return reject(e);
            }

            const args = [
                path.join(
                    ROOT,
                    'pixai.js'
                ),

                '--profile',
                profile.name,

                '--prompt',
                prompt,

                '--width',
                String(width),

                '--height',
                String(height),

                '--batch',
                String(batchSize),

                '--output',
                outputName
            ];

            const negative =
                String(
                    body.negativePrompt ??
                    body.negative ??
                    ''
                ).trim();

            if (negative) {
                args.push(
                    '--negative',
                    negative
                );
            }

            if (!promptHelper) {
                args.push(
                    '--no-helper'
                );
            }

            activeJobs++;

            const child =
                spawn(
                    NODE_BIN,
                    args,
                    {
                        cwd: ROOT,
                        env: process.env,
                        stdio: [
                            'ignore',
                            'pipe',
                            'pipe'
                        ]
                    }
                );

            let stdout = '';
            let stderr = '';

            child.stdout.on(
                'data',
                d => {
                    stdout +=
                        d.toString();
                }
            );

            child.stderr.on(
                'data',
                d => {
                    stderr +=
                        d.toString();
                }
            );

            child.on(
                'error',
                err => {
                    activeJobs--;
                    reject(err);
                }
            );

            child.on(
                'close',
                code => {
                    activeJobs--;

                    const result =
                        parseCliOutput(
                            stdout,
                            stderr,
                            outputFile,
                            profile.name
                        );

                    result.exitCode =
                        code;

                    if (
                        result.insufficientBalance
                    ) {
                        const e =
                            new Error(
                                'Saldo insuficiente no PixAI'
                            );

                        e.statusCode = 402;
                        e.details = result;

                        return reject(e);
                    }

                    if (
                        code !== 0 ||
                        !result.ok
                    ) {
                        const e =
                            new Error(
                                'Falha na geração'
                            );

                        e.statusCode = 502;
                        e.details = result;

                        return reject(e);
                    }

                    resolve(result);
                }
            );
        }
    );
}

function fileResponse(
    res,
    file
) {
    if (!fs.existsSync(file)) {
        return json(
            res,
            404,
            {
                ok: false,
                error:
                    'Arquivo não encontrado'
            }
        );
    }

    const stat =
        fs.statSync(file);

    res.writeHead(
        200,
        {
            'content-type':
                'image/webp',

            'content-length':
                stat.size,

            'cache-control':
                'private, no-store'
        }
    );

    fs.createReadStream(file)
        .pipe(res);
}

const server =
    http.createServer(
        async (
            req,
            res
        ) => {
            try {
                const url =
                    new URL(
                        req.url,
                        `http://${
                            req.headers.host ||
                            'localhost'
                        }`
                    );

                if (
                    req.method ===
                    'OPTIONS'
                ) {
                    res.writeHead(
                        204,
                        {
                            'access-control-allow-origin':
                                '*',

                            'access-control-allow-headers':
                                'content-type, x-api-key, authorization',

                            'access-control-allow-methods':
                                'GET, POST, OPTIONS'
                        }
                    );

                    return res.end();
                }

                if (
                    req.method === 'GET' &&
                    url.pathname === '/health'
                ) {
                    return json(
                        res,
                        200,
                        {
                            ok: true,
                            service:
                                'pixai-api',

                            activeJobs,

                            maxConcurrent:
                                MAX_CONCURRENT,

                            time:
                                new Date()
                                    .toISOString()
                        }
                    );
                }

                if (!authorized(req)) {
                    return json(
                        res,
                        401,
                        {
                            ok: false,
                            error:
                                'Unauthorized'
                        }
                    );
                }

                if (
                    req.method === 'GET' &&
                    url.pathname === '/v1/profiles'
                ) {
                    const rows = [];

                    for (
                        const p of listProfiles()
                    ) {
                        rows.push(
                            {
                                name:
                                    p.name,

                                port:
                                    p.port,

                                default:
                                    p.isDefault,

                                chromiumOnline:
                                    await isChromeAlive(
                                        p.port
                                    )
                            }
                        );
                    }

                    return json(
                        res,
                        200,
                        {
                            ok: true,
                            profiles: rows
                        }
                    );
                }

                if (
                    req.method === 'POST' &&
                    url.pathname === '/v1/generate'
                ) {
                    const body =
                        await readJson(req);

                    const result =
                        await runGeneration(
                            body
                        );

                    return json(
                        res,
                        200,
                        {
                            ok: true,
                            ...result,
                            log: undefined
                        }
                    );
                }

                if (
                    req.method === 'GET' &&
                    url.pathname === '/v1/history'
                ) {
                    const history =
                        path.join(
                            ROOT,
                            'history',
                            'generations.jsonl'
                        );

                    if (
                        !fs.existsSync(
                            history
                        )
                    ) {
                        return json(
                            res,
                            200,
                            {
                                ok: true,
                                items: []
                            }
                        );
                    }

                    const items =
                        fs
                            .readFileSync(
                                history,
                                'utf8'
                            )
                            .split(
                                /\r?\n/
                            )
                            .map(
                                x =>
                                    x.trim()
                            )
                            .filter(
                                Boolean
                            )
                            .flatMap(
                                line => {
                                    try {
                                        return [
                                            JSON.parse(
                                                line
                                            )
                                        ];
                                    } catch {
                                        return [];
                                    }
                                }
                            )
                            .reverse();

                    return json(
                        res,
                        200,
                        {
                            ok: true,
                            items
                        }
                    );
                }

                if (
                    req.method === 'GET' &&
                    url.pathname.startsWith(
                        '/v1/file/'
                    )
                ) {
                    const name =
                        path.basename(
                            decodeURIComponent(
                                url.pathname.slice(
                                    '/v1/file/'.length
                                )
                            )
                        );

                    if (
                        !name ||
                        name.includes('..')
                    ) {
                        return json(
                            res,
                            400,
                            {
                                ok: false,
                                error:
                                    'Nome de arquivo inválido'
                            }
                        );
                    }

                    return fileResponse(
                        res,
                        path.join(
                            ROOT,
                            name
                        )
                    );
                }

                return json(
                    res,
                    404,
                    {
                        ok: false,
                        error: 'Not found'
                    }
                );
            } catch (err) {
                const status =
                    Number(
                        err.statusCode ||
                        500
                    );

                return json(
                    res,
                    status,
                    {
                        ok: false,

                        error:
                            err.message ||
                            'Erro interno',

                        details:
                            err.details
                                ? {
                                    profile:
                                        err.details.profile,

                                    taskId:
                                        err.details.taskId,

                                    mediaId:
                                        err.details.mediaId,

                                    seed:
                                        err.details.seed,

                                    paidCredit:
                                        err.details.paidCredit,

                                    publicUrl:
                                        err.details.publicUrl,

                                    exitCode:
                                        err.details.exitCode
                                }
                                : undefined
                    }
                );
            }
        }
    );

server.requestTimeout =
    15 * 60 * 1000;

server.headersTimeout =
    30 * 1000;

server.listen(
    PORT,
    HOST,
    () => {
        console.log(
            'PixAI API'
        );

        console.log(
            '────────────────────────────────'
        );

        console.log(
            `🌐 http://${HOST}:${PORT}`
        );

        console.log(
            '🔐 Proteção: x-api-key / Bearer'
        );

        console.log(
            `⚙️ Concorrência: ${MAX_CONCURRENT}`
        );

        console.log('');

        console.log(
            'GET  /health'
        );

        console.log(
            'GET  /v1/profiles'
        );

        console.log(
            'GET  /v1/history'
        );

        console.log(
            'POST /v1/generate'
        );

        console.log(
            'GET  /v1/file/:nome'
        );
    }
);

function shutdown(signal) {
    console.log(
        `\n${signal}: encerrando API...`
    );

    server.close(
        () => {
            process.exit(0);
        }
    );

    setTimeout(
        () => process.exit(1),
        5000
    ).unref();
}

process.on(
    'SIGTERM',
    () => shutdown('SIGTERM')
);

process.on(
    'SIGINT',
    () => shutdown('SIGINT')
);
