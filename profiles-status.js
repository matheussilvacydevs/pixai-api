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
