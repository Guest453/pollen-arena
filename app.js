// Pollen Arena — blind side-by-side battles between official Pollinations
// models and community models claiming the same name.
//
// Everything runs in the browser: BYOP OAuth (PKCE) for the key, the live
// /v1/models catalog for matchups and pricing, and streamed chat completions
// for each answer. No backend.

const ENTER_URL = "https://enter.pollinations.ai";
const GEN_URL = "https://gen.pollinations.ai";

// Set this to your Pollinations App Key (pk_...) with this page as a Redirect URI.
const CLIENT_ID = "pk_5drKIx9HHnvmdcqW";

const redirectUri = `${location.origin}${location.pathname}`;

const els = {
    connect: document.querySelector("#connect"),
    account: document.querySelector("#account"),
    matchup: document.querySelector("#matchup"),
    prompt: document.querySelector("#prompt"),
    battle: document.querySelector("#battle"),
    newprompt: document.querySelector("#newprompt"),
    status: document.querySelector("#status"),
    arena: document.querySelector("#arena"),
    modelA: document.querySelector("#model-a"),
    modelB: document.querySelector("#model-b"),
    revealA: document.querySelector("#reveal-a"),
    revealB: document.querySelector("#reveal-b"),
    answerA: document.querySelector("#answer-a"),
    answerB: document.querySelector("#answer-b"),
    footA: document.querySelector("#foot-a"),
    footB: document.querySelector("#foot-b"),
    voteA: document.querySelector("#vote-a"),
    voteB: document.querySelector("#vote-b"),
    voteTie: document.querySelector("#vote-tie"),
    verdict: document.querySelector("#verdict"),
    verdictTitle: document.querySelector("#verdict-title"),
    verdictPick: document.querySelector("#verdict-pick"),
    verdictCost: document.querySelector("#verdict-cost"),
    verdictLatency: document.querySelector("#verdict-latency"),
    verdictNote: document.querySelector("#verdict-note"),
    modeNote: document.querySelector("#mode-note"),
};

let accessToken = sessionStorage.getItem("arena_token") || null;
let pairs = [];
let current = null;
const modelsById = new Map();

const status = (text) => {
    els.status.textContent = text;
};

const fmtPollen = (n) =>
    n === undefined || n === null ? "—" : `${Number(n).toFixed(6)} pollen`;

// --- tiny PKCE helpers (same shape as the official OAuth demo) ---

const randomBase64Url = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return btoa(String.fromCharCode(...bytes))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replaceAll("=", "");
};

const challengeFor = async (verifier) => {
    const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(verifier),
    );
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replaceAll("=", "");
};

const connect = async () => {
    if (CLIENT_ID === "pk_your_app_key") {
        throw new Error(
            "Set CLIENT_ID in app.js to your Pollinations App Key first.",
        );
    }
    const verifier = randomBase64Url();
    const state = randomBase64Url();
    sessionStorage.setItem("oauth_verifier", verifier);
    sessionStorage.setItem("oauth_state", state);
    const params = new URLSearchParams({
        response_type: "code",
        client_id: CLIENT_ID,
        redirect_uri: redirectUri,
        scope: "profile usage",
        budget: "5",
        expiry: "7",
        state,
        code_challenge: await challengeFor(verifier),
        code_challenge_method: "S256",
    });
    location.href = `${ENTER_URL}/authorize?${params}`;
};

const handleCallback = async () => {
    const params = new URLSearchParams(location.search);
    const code = params.get("code");
    const oauthError = params.get("error");
    if (!code && !oauthError) return false;

    const expectedState = sessionStorage.getItem("oauth_state");
    if (!expectedState || params.get("state") !== expectedState) {
        throw new Error("OAuth state did not match.");
    }
    const verifier = sessionStorage.getItem("oauth_verifier");
    sessionStorage.removeItem("oauth_state");
    sessionStorage.removeItem("oauth_verifier");
    history.replaceState({}, "", location.pathname);

    if (oauthError) throw new Error(`Authorization: ${oauthError}`);
    if (!verifier) throw new Error("Missing PKCE verifier.");

    const response = await fetch(`${ENTER_URL}/api/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            client_id: CLIENT_ID,
            redirect_uri: redirectUri,
            code_verifier: verifier,
        }),
    });
    const token = await response.json();
    if (!response.ok) {
        throw new Error(
            token.error_description ?? token.error ?? "Token exchange failed.",
        );
    }
    accessToken = token.access_token;
    // sessionStorage only: never localStorage or the URL.
    sessionStorage.setItem("arena_token", accessToken);
    return true;
};

const signedIn = () => {
    els.connect.hidden = Boolean(accessToken);
    els.account.textContent = accessToken ? "connected" : "";
    els.battle.disabled = !accessToken;
};

// --- catalog + matchup detection ---

const baseName = (id) => id.split("/").pop().toLowerCase().replace(/:.*$/, "");

const loadCatalog = async () => {
    const response = await fetch(`${GEN_URL}/v1/models`);
    const body = await response.json();
    const models = body.data ?? body;
    for (const model of models) modelsById.set(model.id, model);

    const official = new Map();
    for (const model of models) {
        if (model.community !== true && model.output_modalities?.includes("text")) {
            official.set(baseName(model.id), model.id);
        }
    }
    const found = [];
    for (const model of models) {
        if (model.community !== true) continue;
        const officialId = official.get(baseName(model.id));
        if (officialId && officialId !== model.id) {
            found.push({ official: officialId, community: model.id });
        }
    }
    found.sort((a, b) => a.official.localeCompare(b.official));
    pairs = found;

    els.matchup.replaceChildren(
        ...found.map((pair) => {
            const option = document.createElement("option");
            option.value = `${pair.official}||${pair.community}`;
            option.textContent = `${pair.official}  vs  ${pair.community}`;
            return option;
        }),
    );
    return found.length;
};

// --- cost estimation from the model's published pricing ---

const estimateCost = (modelId, usage) => {
    const pricing = modelsById.get(modelId)?.pricing;
    if (!pricing || !usage) return null;
    const prompt = Number(pricing.promptTextTokens) * (usage.prompt_tokens ?? 0);
    const completion =
        Number(pricing.completionTextTokens) * (usage.completion_tokens ?? 0);
    return prompt + completion;
};

// --- the battle ---

const streamAnswer = async (modelId, prompt, answerEl) => {
    const started = performance.now();
    const response = await fetch(`${GEN_URL}/v1/chat/completions`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: modelId,
            stream: true,
            messages: [{ role: "user", content: prompt }],
        }),
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(
            error?.error?.message ?? `HTTP ${response.status} from ${modelId}`,
        );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let usage = null;

    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const segments = buffer.split("\n\n");
        buffer = segments.pop() ?? "";
        for (const segment of segments) {
            const line = segment
                .split("\n")
                .find((l) => l.startsWith("data:"));
            if (!line) continue;
            const data = line.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            let chunk;
            try {
                chunk = JSON.parse(data);
            } catch {
                continue;
            }
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) {
                text += delta;
                answerEl.textContent = text;
            }
            if (chunk.usage) usage = chunk.usage;
        }
    }
    return { text, usage, ms: performance.now() - started };
};

const runBattle = async () => {
    if (!accessToken || !current) return;
    const prompt = els.prompt.value.trim();
    if (!prompt) return;

    sessionStorage.setItem("arena_prompt", prompt);
    els.verdict.hidden = true;
    els.arena.hidden = false;
    for (const el of [els.answerA, els.answerB]) {
        el.textContent = "";
        el.classList.add("streaming");
    }
    for (const el of [els.modelA, els.modelB, els.revealA, els.revealB]) {
        el.textContent = "";
    }
    els.footA.textContent = "";
    els.footB.textContent = "";
    els.voteA.disabled = els.voteB.disabled = els.voteTie.disabled = true;
    els.battle.disabled = true;
    status("both models thinking…");

    // Blind: swap which side is which so the label does not leak the source.
    const flip = Math.random() < 0.5;
    const sideA = flip ? current.community : current.official;
    const sideB = flip ? current.official : current.community;
    els.modelA.textContent = "Model A";
    els.modelB.textContent = "Model B";

    const [resultA, resultB] = await Promise.allSettled([
        streamAnswer(sideA, prompt, els.answerA),
        streamAnswer(sideB, prompt, els.answerB),
    ]);

    els.answerA.classList.remove("streaming");
    els.answerB.classList.remove("streaming");

    const finish = (el, result, modelId) => {
        if (result.status === "rejected") {
            el.textContent = `error: ${result.reason?.message ?? result.reason}`;
            return null;
        }
        const cost = estimateCost(modelId, result.value.usage);
        return { ...result.value, cost, modelId };
    };
    const infoA = finish(els.footA, resultA, sideA);
    const infoB = finish(els.footB, resultB, sideB);

    const describe = (info) =>
        info === null
            ? "failed"
            : `${Math.round(info.ms)} ms · ${info.usage?.total_tokens ?? "?"} tokens · ${
                  info.cost === null ? "n/a" : fmtPollen(info.cost)
              }`;
    els.footA.textContent = describe(infoA);
    els.footB.textContent = describe(infoB);

    current = { ...current, sideA, sideB, infoA, infoB, flip };
    status("vote for the better answer");
    els.voteA.disabled = els.voteB.disabled = els.voteTie.disabled = false;
    els.battle.disabled = false;
};

const reveal = (pick) => {
    if (!current) return;
    const { official, community, sideA, sideB, infoA, infoB } = current;
    els.revealA.textContent = sideA;
    els.revealB.textContent = sideB;
    document
        .querySelector('[data-side="a"]')
        .setAttribute("data-revealed", "true");
    document
        .querySelector('[data-side="b"]')
        .setAttribute("data-revealed", "true");

    const chosen = pick === "tie" ? null : pick === "a" ? sideA : sideB;
    const isCommunity = chosen ? chosen === community : null;
    els.verdict.hidden = false;

    if (pick === "tie") {
        els.verdictTitle.textContent = "Tie";
        els.verdictPick.textContent = "no winner";
    } else {
        els.verdictTitle.textContent = isCommunity
            ? "Community model won 🥊"
            : "Official model won";
        els.verdictPick.textContent = chosen;
        const winnerCard = pick === "a" ? els.answerA : els.answerB;
        winnerCard.closest(".card").setAttribute("data-winner", "true");
    }

    const total =
        (infoA?.cost ?? 0) + (infoB?.cost ?? 0);
    els.verdictCost.textContent = fmtPollen(total);
    els.verdictLatency.textContent = `${Math.round(infoA?.ms ?? 0)} / ${Math.round(
        infoB?.ms ?? 0,
    )} ms`;
    els.verdictNote.textContent = `official: ${official} · community: ${community}`;
};

const newPrompt = () => {
    const kicks = [
        "Explain why the sky is blue in two sentences.",
        "Write a haiku about breakfast.",
        "What is the capital of Burkina Faso? One line.",
        "Give one surprising fact about octopuses.",
        "Summarise the plot of Romeo and Juliet in 20 words.",
        "Name three uses for a paperclip.",
    ];
    els.prompt.value = kicks[Math.floor(Math.random() * kicks.length)];
};

const boot = async () => {
    els.modeNote.textContent = CLIENT_ID === "pk_your_app_key"
        ? "Set CLIENT_ID to go live."
        : "BYOP: your key, your pollen.";
    try {
        const handled = await handleCallback();
        signedIn();
        const count = await loadCatalog();
        status(`${count} impostor matchup(s) ready`);
        if (handled) status("connected");
    } catch (error) {
        status(error.message);
    }
};

els.connect.addEventListener("click", () =>
    connect().catch((error) => status(error.message)),
);
els.battle.addEventListener("click", () =>
    runBattle().catch((error) => status(error.message)),
);
els.newprompt.addEventListener("click", newPrompt);
els.voteA.addEventListener("click", () => reveal("a"));
els.voteB.addEventListener("click", () => reveal("b"));
els.voteTie.addEventListener("click", () => reveal("tie"));
els.matchup.addEventListener("change", () => {
    const [official, community] = els.matchup.value.split("||");
    current = { official, community };
    els.verdict.hidden = true;
});

boot();
