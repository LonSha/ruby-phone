# GPT public image local relay

Use this relay when the mobile browser can reach SillyTavern but direct GPT public image generation fails with CORS or `Failed to fetch`.

Run in Termux or a local Node environment:

```bash
node workers/openai-image-local-relay.cjs
```

Easier Termux setup:

```bash
bash workers/install-termux-imgrelay.sh
```

After installing, start the relay from any Termux directory:

```bash
imgrelay
```

If `imgrelay` is not found immediately after installing, restart Termux or run:

```bash
source ~/.profile
```

Default behavior:

- Listens on `http://127.0.0.1:8787`
- Forwards to the real public site sent by the phone UI through `X-OpenAI-Image-Relay-Target`
- Supports `GET /v1/models`
- Supports `POST /v1/images/generations`
- Forwards the browser `Authorization` header

In the phone image settings:

- Provider: `GPT / OpenAI compatible`
- Site: `public`
- Real public Base URL: your actual GPT public site, for example `https://imagegen.mukyu.me`
- Local relay URL: `http://127.0.0.1:8787`
- API Key: keep using the GPT public site key

Optional fallback default target for non-phone clients:

```bash
OPENAI_IMAGE_RELAY_TARGET=https://imagegen.mukyu.me OPENAI_IMAGE_RELAY_PORT=8787 node workers/openai-image-local-relay.cjs
```

Optional fallback key for other clients that do not send `Authorization`:

```bash
OPENAI_IMAGE_RELAY_KEY=sk-your-key node workers/openai-image-local-relay.cjs
```

The current phone UI still requires a non-empty GPT public API Key field before sending a request.
