#!/usr/bin/env bash
set -Eeuo pipefail

PIXAI_DIR="${PIXAI_DIR:-$HOME/pixai-capture}"
API_KEY_VALUE="${API_KEY_VALUE:-CHANGE_ME}"
API_HOST_VALUE="${API_HOST_VALUE:-0.0.0.0}"
API_PORT_VALUE="${API_PORT_VALUE:-8787}"
NODE_BIN_VALUE="${NODE_BIN_VALUE:-$(command -v node || true)}"

if [[ -z "$NODE_BIN_VALUE" ]]; then
  echo "❌ Node.js não encontrado."
  exit 1
fi

mkdir -p "$PIXAI_DIR"
cd "$PIXAI_DIR"

if [[ ! -f pixai.js ]]; then
  echo "❌ Não encontrei $PIXAI_DIR/pixai.js"
  exit 1
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$PIXAI_DIR/backups/api-$STAMP"
mkdir -p "$BACKUP_DIR"

for f in \
  pixai.js \
  profile-manager.js \
  profiles.json \
  character.js \
  history.js \
  server.js \
  ecosystem.config.cjs \
  .env \
  .gitignore
do
  [[ -f "$f" ]] && cp -a "$f" "$BACKUP_DIR/$f"
done

echo "📦 Backup criado em:"
echo "$BACKUP_DIR"

# =============================================================================
# CORRIGIR PIXAI.JS / HISTÓRICO
# =============================================================================

python - <<'PY'
from pathlib import Path
import re

p = Path("pixai.js")
s = p.read_text()
original = s

# Corrige JSONL com \n literal
s = s.replace(
    r"JSON.stringify(historyEntry) + '\\n'",
    r"JSON.stringify(historyEntry) + '\n'"
)

# Adiciona profile ao histórico
m = re.search(r"const\s+historyEntry\s*=\s*\{", s)

if m:
    end = s.find("};", m.end())

    if end != -1:
        block = s[m.start():end]

        if not re.search(r"(?m)^\s*profile\s*:", block):
            insert_at = m.end()

            s = (
                s[:insert_at]
                + "\n        profile: profile.name,"
                + s[insert_at:]
            )

            print("✅ Campo profile adicionado ao histórico.")
        else:
            print("ℹ️ Histórico já contém profile.")
else:
    print("⚠️ Não encontrei historyEntry em pixai.js.")

if s != original:
    p.write_text(s)
    print("✅ pixai.js atualizado.")
else:
    print("ℹ️ pixai.js não precisou de alterações.")
PY

node --check pixai.js

# =============================================================================
# PROFILE MANAGER
# =============================================================================

cat > profile-manager.js <<'NODE'
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const http = require('http');

const BASE_DIR = __dirname;
const CONFIG_FILE = path.join(BASE_DIR, 'profiles.json');

function loadConfig() {
    if (!fs.existsSync(CONFIG_FILE)) {
        throw new Error(
            `profiles.json não encontrado em ${CONFIG_FILE}`
        );
    }

    return JSON.parse(
        fs.readFileSync(CONFIG_FILE, 'utf8')
    );
}

function getProfile(name) {
    const config = loadConfig();

    const profileName =
        name ||
        process.env.PIXAI_PROFILE ||
        config.default;

    const profile = config.profiles?.[profileName];

    if (!profile) {
        throw new Error(
            `Perfil PixAI inexistente: ${profileName}`
        );
    }

    return {
        name: profileName,
        port: Number(profile.port),
        dir: path.resolve(BASE_DIR, profile.dir)
    };
}

function listProfiles() {
    const config = loadConfig();

    return Object.entries(config.profiles || {})
        .map(([name, p]) => ({
            name,
            port: Number(p.port),
            dir: path.resolve(BASE_DIR, p.dir),
            isDefault: config.default === name
        }));
}

function findChromium() {
    const envBin = process.env.CHROMIUM_BIN?.trim();

    if (envBin) {
        return envBin;
    }

    const candidates = [
        'chromium-browser',
        'chromium',
        'google-chrome',
        'google-chrome-stable'
    ];

    for (const bin of candidates) {
        const r = spawnSync(
            'sh',
            ['-lc', `command -v ${bin}`],
            {
                encoding: 'utf8'
            }
        );

        if (
            r.status === 0 &&
            r.stdout.trim()
        ) {
            return r.stdout.trim();
        }
    }

    throw new Error(
        'Chromium/Chrome não encontrado. ' +
        'Defina CHROMIUM_BIN no .env.'
    );
}

function isChromeAlive(port) {
    return new Promise(resolve => {
        const req = http.get(
            {
                hostname: '127.0.0.1',
                port,
                path: '/json/version',
                timeout: 1500
            },
            res => {
                res.resume();

                resolve(
                    res.statusCode === 200
                );
            }
        );

        req.on(
            'error',
            () => resolve(false)
        );

        req.on(
            'timeout',
            () => {
                req.destroy();
                resolve(false);
            }
        );
    });
}

async function ensureChrome(profile) {
    if (
        await isChromeAlive(profile.port)
    ) {
        return;
    }

    fs.mkdirSync(
        profile.dir,
        {
            recursive: true
        }
    );

    const chromium = findChromium();

    console.log(
        `🌐 Iniciando Chromium headless ` +
        `[${profile.name}] ` +
        `na porta ${profile.port}...`
    );

    const logFile = path.join(
        BASE_DIR,
        `chromium-${profile.name}.log`
    );

    const out = fs.openSync(
        logFile,
        'a'
    );

    const err = fs.openSync(
        logFile,
        'a'
    );

    const child = spawn(
        chromium,
        [
            '--headless=new',
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            `--user-data-dir=${profile.dir}`,
            '--remote-debugging-address=127.0.0.1',
            `--remote-debugging-port=${profile.port}`,
            'https://pixai.art/'
        ],
        {
            detached: true,
            stdio: [
                'ignore',
                out,
                err
            ]
        }
    );

    child.unref();

    for (
        let i = 0;
        i < 30;
        i++
    ) {
        await new Promise(
            r => setTimeout(r, 500)
        );

        if (
            await isChromeAlive(profile.port)
        ) {
            console.log(
                `✅ Chromium ` +
                `[${profile.name}] pronto.`
            );

            return;
        }
    }

    throw new Error(
        `Chromium do perfil ` +
        `${profile.name} não iniciou. ` +
        `Veja ${logFile}`
    );
}

module.exports = {
    getProfile,
    listProfiles,
    isChromeAlive,
    ensureChrome,
    findChromium
};
NODE

node --check profile-manager.js

# =============================================================================
# .ENV
# =============================================================================

cat > .env <<EOF
API_KEY=$API_KEY_VALUE
API_HOST=$API_HOST_VALUE
API_PORT=$API_PORT_VALUE
NODE_BIN=$NODE_BIN_VALUE

# Se necessário:
# CHROMIUM_BIN=/usr/bin/chromium
EOF

cat > .env.example <<'EOF'
API_KEY=troque-por-uma-chave-forte
API_HOST=0.0.0.0
API_PORT=8787
NODE_BIN=/usr/bin/node

# CHROMIUM_BIN=/usr/bin/chromium
EOF

chmod 600 .env

# =============================================================================
# API HTTP
# =============================================================================

cat > server.js <<'NODE'
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
NODE

node --check server.js

# =============================================================================
# STATUS DOS PROFILES
# =============================================================================

cat > profiles-status.js <<'NODE'
const {
    listProfiles,
    isChromeAlive
} = require('./profile-manager');

(async () => {
    const profiles =
        listProfiles();

    console.log(
        'PixAI profiles'
    );

    console.log(
        '────────────────────────────────'
    );

    for (
        const p of profiles
    ) {
        const online =
            await isChromeAlive(
                p.port
            );

        console.log(
            `${online ? '🟢' : '⚫'} ` +
            `${p.name}` +
            `${p.isDefault ? ' [default]' : ''}` +
            ` | porta ${p.port}` +
            ` | ${online ? 'online' : 'offline'}`
        );
    }
})();
NODE

node --check profiles-status.js

# =============================================================================
# START API
# =============================================================================

cat > start-api.sh <<'SH'
#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")"

if [[ -f .env ]]; then
  set -a
  source .env
  set +a
fi

exec "${NODE_BIN:-node}" server.js
SH

chmod +x start-api.sh

# =============================================================================
# PM2
# =============================================================================

cat > ecosystem.config.cjs <<'NODE'
module.exports = {
    apps: [
        {
            name: 'pixai-api',
            script: './server.js',
            cwd: __dirname,
            instances: 1,
            exec_mode: 'fork',
            autorestart: true,
            watch: false,
            max_memory_restart: '700M',
            env: {
                NODE_ENV: 'production'
            }
        }
    ]
};
NODE

# =============================================================================
# GITIGNORE
# =============================================================================

touch .gitignore

for line in \
  ".env" \
  "chrome-profile/" \
  "profiles/" \
  "history/" \
  "backups/" \
  "chromium-*.log" \
  "*.webp" \
  "*.png" \
  "*.jpg" \
  "*.jpeg" \
  "node_modules/"
do
  grep -qxF "$line" .gitignore 2>/dev/null \
    || echo "$line" >> .gitignore
done

# =============================================================================
# VERIFICAÇÃO
# =============================================================================

echo
echo "🔎 Verificando arquivos..."

node --check pixai.js
node --check profile-manager.js
node --check profiles-status.js
node --check server.js

echo
echo "========================================"
echo "✅ PIXAI API PREPARADA"
echo "========================================"
echo
echo "Projeto:"
echo "  $PIXAI_DIR"
echo
echo "API:"
echo "  http://$API_HOST_VALUE:$API_PORT_VALUE"
echo
echo "API KEY:"
echo "  configurada no .env"
echo
echo "Iniciar:"
echo
echo "  cd \"$PIXAI_DIR\""
echo "  ./start-api.sh"
echo
echo "Health:"
echo
echo "  curl http://127.0.0.1:$API_PORT_VALUE/health"
echo
echo "Profiles:"
echo
echo "  curl -H 'x-api-key: $API_KEY_VALUE' \\"
echo "    http://127.0.0.1:$API_PORT_VALUE/v1/profiles"
echo
echo "Histórico:"
echo
echo "  curl -H 'x-api-key: $API_KEY_VALUE' \\"
echo "    http://127.0.0.1:$API_PORT_VALUE/v1/history"
echo
echo "========================================"
