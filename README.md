<div align="center">

# 🎨 PixAI API

### API HTTP para automação de geração de imagens com PixAI

Uma interface HTTP desenvolvida em Node.js que utiliza uma sessão Chromium
autenticada para realizar gerações, acompanhar tarefas e baixar os
resultados automaticamente.



![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?style=for-the-badge&logo=node.js&logoColor=white)




![JavaScript](https://img.shields.io/badge/JavaScript-ESM-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)




![Chromium](https://img.shields.io/badge/Chromium-CDP-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)




![API](https://img.shields.io/badge/API-HTTP-009688?style=for-the-badge)




![Status](https://img.shields.io/badge/Status-Experimental-orange?style=for-the-badge)



</div>

---

## 📖 Sobre o projeto

PixAI API fornece uma camada HTTP para automatizar gerações através de uma
sessão do PixAI previamente autenticada no Chromium.

Isso permite integrar a geração com:

- 🤖 Bots
- 🌐 Aplicações web
- 📱 Aplicativos
- 🖥️ Serviços backend
- ⚙️ Automações
- 🧪 Ferramentas próprias

A aplicação cliente envia uma requisição HTTP e o projeto executa o fluxo
de geração automaticamente.

---

## 🏗️ Arquitetura

    Aplicação / Bot
          │ HTTP
          ▼
      server.js  (PixAI API)
          ▼
       pixai.js  (Generation Engine)
          │ CDP
          ▼
    Chromium Headless (sessão autenticada)
          ▼
         PixAI
          ▼
      🎨 Resultado

Fluxo interno:

    HTTP Request → server.js → pixai.js → profile-manager.js →
    Chromium Headless → PixAI → Task Polling → Media Result →
    Download → JSON Response

---

## ✨ Recursos

- 🎨 Geração de imagens através de HTTP
- 👤 Suporte a múltiplos profiles
- 🌐 Chromium em modo headless
- 🔄 Inicialização automática do navegador
- 🔐 Reutilização da sessão autenticada
- 📡 Comunicação via Chrome DevTools Protocol
- ⏳ Polling automático das tarefas
- 📥 Download automático das imagens
- 🧬 Retorno do seed utilizado
- 🆔 Retorno de Task ID
- 🖼️ Retorno de Media ID
- 💳 Informação de créditos utilizados
- 📐 Resolução configurável
- 🖼️ Batch configurável
- 🚫 Negative Prompt
- ✨ Prompt Helper opcional
- 📜 Histórico local de gerações
- 🔑 Proteção HTTP por API Key
- ⚡ Suporte a PM2

---

## 📁 Estrutura do projeto

    pixai-api/
    ├── server.js              Servidor HTTP
    ├── pixai.js               Motor principal de geração
    ├── profile-manager.js     Gerenciamento do Chromium
    ├── profiles-status.js     Consulta do estado dos profiles
    ├── profiles.json          Configuração dos profiles
    ├── character.js           Sistema auxiliar de personagens
    ├── history.js             Histórico das gerações
    ├── consultar-task.js      Consulta de tarefas
    ├── testar-geracao.js      Ferramenta de testes
    ├── ecosystem.config.cjs   Configuração PM2
    ├── start-api.sh           Inicializador da API
    ├── prepare-pixai-api.sh   Preparação do ambiente
    ├── .env.example           Exemplo de configuração
    └── README.md

> Profiles Chromium reais, cookies, sessões, credenciais, dumps de rede,
> histórico privado e imagens geradas não fazem parte do repositório.

---

## 🚀 Instalação

1. Clone o projeto

       git clone https://github.com/matheussilvacydevs/pixai-api.git
       cd pixai-api

2. Instale as dependências

       npm install

   É necessário possuir um navegador baseado em Chromium. O projeto
   procura automaticamente executáveis como chromium-browser, chromium,
   google-chrome, google-chrome-stable.

   Também é possível especificar manualmente:

       export CHROMIUM_BIN=/usr/bin/chromium

---

## ⚙️ Configuração

    cp .env.example .env

Configure o .env:

    API_KEY=COLOQUE_UMA_CHAVE_FORTE_AQUI
    API_HOST=0.0.0.0
    API_PORT=8787

> 🔐 Nunca envie seu .env para o GitHub.

---

## 👤 Profiles

A API suporta múltiplas sessões através de profiles Chromium independentes.

    {
      "default": "conta1",
      "profiles": {
        "conta1": { "dir": "chrome-profile", "port": 9222 },
        "conta2": { "dir": "profiles/conta2", "port": 9223 }
      }
    }

Campo dir: diretório local do profile Chromium.
Campo port: porta utilizada pelo Chrome DevTools Protocol.

Os diretórios contendo as sessões reais permanecem apenas no servidor.

---

## ▶️ Iniciando

    chmod +x start-api.sh
    ./start-api.sh

Por padrão: http://127.0.0.1:8787

---

## ❤️ Health Check

GET /health

    curl http://127.0.0.1:8787/health

Exemplo:

    {
      "ok": true,
      "service": "pixai-api",
      "activeJobs": 0,
      "maxConcurrent": 2
    }

---

## 🎨 Gerar uma imagem

POST /v1/generate

    curl -X POST \
      http://127.0.0.1:8787/v1/generate \
      -H 'Content-Type: application/json' \
      -H 'x-api-key: SUA_API_KEY' \
      -d '{
        "profile": "conta1",
        "prompt": "anime character, full body, detailed illustration",
        "negativePrompt": "low quality, bad anatomy",
        "width": 768,
        "height": 1280,
        "batchSize": 1,
        "promptHelper": false,
        "output": "resultado.webp"
      }'

Exemplo de resposta:

    {
      "ok": true,
      "insufficientBalance": false,
      "profile": "conta1",
      "taskId": "TASK_ID",
      "mediaId": "MEDIA_ID",
      "seed": "SEED",
      "paidCredit": 0,
      "publicUrl": "IMAGE_URL",
      "output": "/path/resultado.webp",
      "sizeBytes": 0,
      "exitCode": 0
    }

---

## 👥 Consultar profiles

GET /v1/profiles

    curl -H 'x-api-key: SUA_API_KEY' http://127.0.0.1:8787/v1/profiles

---

## 📜 Histórico

GET /v1/history

    curl -H 'x-api-key: SUA_API_KEY' http://127.0.0.1:8787/v1/history

---

## 📥 Download

GET /v1/file/:name

    curl -H 'x-api-key: SUA_API_KEY' \
      http://127.0.0.1:8787/v1/file/resultado.webp \
      -o resultado.webp

---

## 🧑‍💻 CLI

    node pixai.js \
      --profile conta1 \
      --prompt "anime character, full body" \
      --negative "low quality, bad anatomy" \
      --width 768 \
      --height 1280 \
      --batch 1 \
      --output resultado.webp

Para desabilitar o Prompt Helper:

    node pixai.js \
      --profile conta1 \
      --prompt "your detailed prompt" \
      --no-helper \
      --output resultado.webp

---

## ⚡ PM2

    npm install -g pm2
    pm2 start ecosystem.config.cjs
    pm2 save

Status: pm2 status
Logs: pm2 logs

---

## 🔒 Segurança

Este projeto utiliza profiles Chromium autenticados. Nunca publique:

- .env
- chrome-profile/
- profiles/
- cookies
- tokens
- JWTs
- dumps de rede
- logs contendo autenticação
- backups contendo credenciais

Para servidores públicos, recomenda-se:

- 🔒 HTTPS
- 🛡️ Firewall
- 🔑 API Key forte
- 🌐 Reverse Proxy
- 🚦 Rate limiting
- 📊 Monitoramento

---

## ⚠️ Aviso

Este projeto é independente e experimental. Não é uma API oficial do
PixAI e não possui afiliação oficial com o PixAI.

O usuário é responsável por utilizar o projeto de acordo com os termos
aplicáveis do serviço e por proteger suas próprias credenciais e sessões.
As gerações continuam sujeitas às regras, limites e sistema de créditos
da plataforma.

---

<div align="center">

🛠️ Desenvolvido por Matheus Silva

Automação • APIs • Node.js

PixAI API — Uma interface HTTP simples para automação de gerações.

</div>
