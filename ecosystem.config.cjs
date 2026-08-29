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
