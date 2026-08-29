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
