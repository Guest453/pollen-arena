// Pollen Arena — blind community-vs-official battles on Pollinations.
// All browser: BYOP OAuth (PKCE), live /v1/models catalog, streamed answers.

const ENTER_URL = "https://enter.pollinations.ai";
const GEN_URL = "https://gen.pollinations.ai";
const CLIENT_ID = "pk_5drKIx9HHnvmdcqW";

const redirectUri = `${location.origin}${location.pathname}`;

const $ = (id) => document.getElementById(id);
const els = {
    connect: $("connect"),
    account: $("account"),
    matchup: $("matchup"),
    landing: $("landing"),
    arena: $("arena"),
    prompt: $("prompt"),
    composer: $("composer"),
    send: $("send"),
    suggestions: $("suggestions"),
    status: $("status"),
    modelA: $("model-a"),
    modelB: $("model-b"),
    answerA: $("answer-a"),
    answerB: $("answer-b"),
    thinkA: $("think-a"),
    thinkB: $("think-b"),
    thinkingA: $("thinking-a"),
    thinkingB: $("thinking-b"),
    thinkingTextA: $("thinking-text-a"),
    thinkingTextB: $("thinking-text-b"),
    footA: $("foot-a"),
    footB: $("foot-b"),
    verdict: $("verdict"),
    verdictBody: $("verdict-body"),
    voteA: $("vote-a"),
    voteB: $("vote-b"),
    voteTie: $("vote-tie"),
    verdictTitle: $("verdict-title"),
    factPick: $("fact-pick"),
    factCost: $("fact-cost"),
    factLatency: $("fact-latency"),
    factModels: $("fact-models"),
    again: $("again"),
};

let token = sessionStorage.getItem("arena_token") || null;
let pairs = [];
let current = null;
let running = false;
const models = new Map();

const setStatus = (t) => {
    els.status.textContent = t;
};
const fmtPollen = (n) =>
    n == null ? "—" : `${Number(n).toFixed(6)} pollen`;

// ---------- suggestions (B/W svgs) ----------
const icons = {
    spark:
        '<svg viewBox="0 0 24 24"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    code: '<svg viewBox="0 0 24 24"><path d="m9 8-4 4 4 4M15 8l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    poem: '<svg viewBox="0 0 24 24"><path d="M5 19c6 0 9-4 9-10V4M14 4h5v5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    brain:
        '<svg viewBox="0 0 24 24"><path d="M12 5a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V8a3 3 0 0 0-3-3ZM9 9H7a2 2 0 0 0 0 4h2M15 13h2a2 2 0 0 0 0-4h-2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    flag: '<svg viewBox="0 0 24 24"><path d="M6 21V4M6 5h11l-2 3 2 3H6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
const SUGGESTIONS = [
    { icon: "spark", text: "Explain why the sky is blue" },
    { icon: "code", text: "Write a binary search in Python" },
    { icon: "poem", text: "Write a haiku about winter" },
    { icon: "brain", text: "What are you thinking about?" },
    { icon: "flag", text: "Name the capital of Burkina Faso" },
];

const renderSuggestions = () => {
    els.suggestions.replaceChildren(
        ...SUGGESTIONS.map((s) => {
            const b = document.createElement("button");
            b.className = "suggestion";
            b.type = "button";
            b.innerHTML = `${icons[s.icon]}<span>${s.text}</span>`;
            b.addEventListener("click", () => {
                els.prompt.value = s.text;
                autosize();
                updateSend();
                els.prompt.focus();
            });
            return b;
        }),
    );
};

// ---------- PKCE ----------
const randomBase64Url = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return btoa(String.fromCharCode(...bytes))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replaceAll("=", "");
};
const challengeFor = async (v) => {
    const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v));
    return btoa(String.fromCharCode(...new Uint8Array(d)))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replaceAll("=", "");
};

const connect = async () => {
    const verifier = randomBase64Url();
    const state = randomBase64Url();
    sessionStorage.setItem("v", verifier);
    sessionStorage.setItem("s", state);
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
    const p = new URLSearchParams(location.search);
    const code = p.get("code");
    const err = p.get("error");
    if (!code && !err) return false;
    if (p.get("state") !== sessionStorage.getItem("s")) {
        throw new Error("OAuth state mismatch");
    }
    const verifier = sessionStorage.getItem("v");
    sessionStorage.removeItem("s");
    sessionStorage.removeItem("v");
    history.replaceState({}, "", location.pathname);
    if (err) throw new Error(`Authorization: ${err}`);
    const res = await fetch(`${ENTER_URL}/api/oauth/token`, {
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
    const t = await res.json();
    if (!res.ok) throw new Error(t.error_description ?? t.error ?? "token failed");
    token = t.access_token;
    sessionStorage.setItem("arena_token", token);
    return true;
};

const signedIn = () => {
    els.connect.hidden = Boolean(token);
    els.account.textContent = token ? "connected" : "";
    updateSend();
};

// ---------- catalog ----------
const baseName = (id) => id.split("/").pop().toLowerCase().replace(/:.*$/, "");

const loadCatalog = async () => {
    const res = await fetch(`${GEN_URL}/v1/models`);
    const body = await res.json();
    const list = body.data ?? body;
    for (const m of list) models.set(m.id, m);
    const official = new Map();
    for (const m of list) {
        if (m.community !== true && m.output_modalities?.includes("text")) {
            official.set(baseName(m.id), m.id);
        }
    }
    pairs = [];
    for (const m of list) {
        if (m.community !== true) continue;
        const o = official.get(baseName(m.id));
        if (o && o !== m.id) pairs.push({ official: o, community: m.id });
    }
    pairs.sort((a, b) => a.official.localeCompare(b.official));
    return pairs.length;
};

const pickPair = () => {
    const pair = pairs[Math.floor(Math.random() * pairs.length)];
    els.matchup.value = `${pair.official}||${pair.community}`;
    current = pair;
};

// ---------- cost ----------
const estimateCost = (modelId, usage) => {
    const p = models.get(modelId)?.pricing;
    if (!p || !usage) return null;
    return (
        Number(p.promptTextTokens) * (usage.prompt_tokens ?? 0) +
        Number(p.completionTextTokens) * (usage.completion_tokens ?? 0)
    );
};

// ---------- streaming ----------
// Reads OpenAI-style SSE: content deltas plus reasoning deltas (reasoning_content,
// reasoning, or reasoning_content-ish fields) straight into their panes.
async function stream(modelId, prompt, ui) {
    const started = performance.now();
    const res = await fetch(`${GEN_URL}/v1/chat/completions`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: modelId,
            stream: true,
            messages: [{ role: "user", content: prompt }],
        }),
    });
    if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e?.error?.message ?? `HTTP ${res.status}`);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let text = "";
    let thinking = "";
    let usage = null;

    const firstByte = () => {
        ui.answer.classList.add("cursor");
    };
    firstByte();

    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
            const line = part.split("\n").find((l) => l.startsWith("data:"));
            if (!line) continue;
            const data = line.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            let chunk;
            try {
                chunk = JSON.parse(data);
            } catch {
                continue;
            }
            const delta = chunk.choices?.[0]?.delta ?? {};
            const reason =
                delta.reasoning_content ?? delta.reasoning ?? delta.thinking;
            if (reason) {
                thinking += reason;
                ui.thinkingText.textContent = thinking;
                if (ui.thinking.hidden === false) ui.scrollThinking();
            }
            if (delta.content) {
                text += delta.content;
                ui.answer.textContent = text;
                ui.answer.scrollTop = ui.answer.scrollHeight;
            }
            if (chunk.usage) usage = chunk.usage;
        }
    }
    ui.answer.classList.remove("cursor");
    return { text, thinking, usage, ms: performance.now() - started };
}

// ---------- battle ----------
const collect = (side) => ({
    panel: document.querySelector(`[data-side="${side}"]`),
    answer: side === "a" ? els.answerA : els.answerB,
    thinking: side === "a" ? els.thinkingA : els.thinkingB,
    thinkingText: side === "a" ? els.thinkingTextA : els.thinkingTextB,
    toggle: side === "a" ? els.thinkA : els.thinkB,
    foot: side === "a" ? els.footA : els.footB,
    scrollThinking() {
        this.thinkingText.parentElement.scrollTop =
            this.thinkingText.parentElement.scrollHeight;
    },
});

const runBattle = async () => {
    const prompt = els.prompt.value.trim();
    if (!token || !prompt || running) return;
    if (!current) pickPair();
    running = true;
    els.send.disabled = true;

    // switch landing -> arena
    els.landing.hidden = true;
    els.arena.hidden = false;
    els.verdict.hidden = false;
    els.verdictBody.hidden = true;
    for (const el of [els.voteA, els.voteB, els.voteTie]) el.disabled = true;

    // blind swap
    const flip = Math.random() < 0.5;
    const sideA = flip ? current.community : current.official;
    const sideB = flip ? current.official : current.community;
    const uiA = collect("a");
    const uiB = collect("b");

    uiA.panel.removeAttribute("data-winner");
    uiB.panel.removeAttribute("data-winner");
    els.modelA.textContent = "resolving…";
    els.modelB.textContent = "resolving…";
    uiA.answer.textContent = "";
    uiB.answer.textContent = "";
    uiA.thinkingText.textContent = "";
    uiB.thinkingText.textContent = "";
    uiA.thinking.hidden = true;
    uiB.thinking.hidden = true;
    uiA.toggle.hidden = true;
    uiB.toggle.hidden = true;
    uiA.toggle.classList.remove("on");
    uiB.toggle.classList.remove("on");
    uiA.foot.textContent = "";
    uiB.foot.textContent = "";

    // reveal the real ids immediately (no guessing game for the model names)
    els.modelA.textContent = sideA;
    els.modelB.textContent = sideB;

    const [rA, rB] = await Promise.allSettled([
        stream(sideA, prompt, uiA),
        stream(sideB, prompt, uiB),
    ]);

    const settle = (r, ui, id) => {
        if (r.status === "rejected") {
            ui.answer.textContent = `⚠ ${r.reason?.message ?? r.reason}`;
            ui.answer.classList.remove("cursor");
            return null;
        }
        const { ms, usage, thinking } = r.value;
        if (thinking) {
            ui.toggle.hidden = false;
            // auto-open while streaming is over; user can collapse
            ui.thinking.hidden = false;
            ui.toggle.classList.add("on");
        }
        const cost = estimateCost(id, usage);
        ui.foot.textContent = `${Math.round(ms)} ms · ${
            usage?.total_tokens ?? "?"
        } tokens · ${fmtPollen(cost)}`;
        return { ms, usage, cost };
    };
    const infoA = settle(rA, uiA, sideA);
    const infoB = settle(rB, uiB, sideB);

    current = { ...current, sideA, sideB, infoA, infoB };
    for (const el of [els.voteA, els.voteB, els.voteTie]) el.disabled = false;
    setStatus("Vote for the better answer.");
    running = false;
    updateSend();
};

// ---------- vote + reveal ----------
const reveal = (pick) => {
    if (!current) return;
    for (const side of ["a", "b"]) {
        document
            .querySelector(`[data-side="${side}"]`)
            .setAttribute("data-winner", "false");
    }
    const { official, community, sideA, sideB, infoA, infoB } = current;
    const chosen = pick === "tie" ? null : pick === "a" ? sideA : sideB;
    els.verdictBody.hidden = false;

    if (pick === "tie") {
        els.verdictTitle.textContent = "Tie";
        els.factPick.textContent = "no winner";
    } else {
        const communityWon = chosen === community;
        els.verdictTitle.textContent = communityWon
            ? "Community model took it 🥊"
            : "Official model held its ground";
        els.factPick.textContent = `${chosen}${communityWon ? " (community)" : " (official)"}`;
        const winner = pick === "a" ? collect("a") : collect("b");
        winner.panel.setAttribute("data-winner", "true");
    }
    els.factCost.textContent = fmtPollen(
        (infoA?.cost ?? 0) + (infoB?.cost ?? 0),
    );
    els.factLatency.textContent = `${Math.round(infoA?.ms ?? 0)} / ${Math.round(
        infoB?.ms ?? 0,
    )} ms`;
    els.factModels.textContent = `${official}  ·  ${community}`;

    for (const el of [els.voteA, els.voteB, els.voteTie]) el.disabled = true;
};

// ---------- misc UI ----------
const autosize = () => {
    els.prompt.style.height = "auto";
    els.prompt.style.height = `${Math.min(els.prompt.scrollHeight, 200)}px`;
};
const updateSend = () => {
    els.send.disabled = !(token && els.prompt.value.trim()) || running;
};

const wire = () => {
    renderSuggestions();
    els.prompt.addEventListener("input", () => {
        autosize();
        updateSend();
    });
    els.prompt.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            runBattle();
        }
    });
    els.composer.addEventListener("submit", (e) => {
        e.preventDefault();
        runBattle();
    });
    els.connect.addEventListener("click", () =>
        connect().catch((err) => setStatus(err.message)),
    );
    els.voteA.addEventListener("click", () => reveal("a"));
    els.voteB.addEventListener("click", () => reveal("b"));
    els.voteTie.addEventListener("click", () => reveal("tie"));
    els.again.addEventListener("click", () => {
        els.arena.hidden = true;
        els.verdict.hidden = true;
        els.landing.hidden = false;
        els.prompt.value = "";
        autosize();
        pickPair();
        updateSend();
        els.prompt.focus();
    });
    const toggle = (btn, panel) =>
        btn.addEventListener("click", () => {
            panel.hidden = !panel.hidden;
            btn.classList.toggle("on", !panel.hidden);
        });
    toggle(els.thinkA, els.thinkingA);
    toggle(els.thinkB, els.thinkingB);
};

const boot = async () => {
    wire();
    setStatus("loading catalog…");
    try {
        const connected = await handleCallback();
        signedIn();
        const count = await loadCatalog();
        pickPair();
        els.matchup.hidden = pairs.length === 0;
        els.matchup.replaceChildren(
            ...pairs.map((p) => {
                const o = document.createElement("option");
                o.value = `${p.official}||${p.community}`;
                o.textContent = `${p.official}  ⚔  ${p.community}`;
                return o;
            }),
        );
        els.matchup.addEventListener("change", () => {
            const [official, community] = els.matchup.value.split("||");
            current = { official, community };
        });
        setStatus(`${count} matchups ready`);
        if (connected) setStatus("connected");
    } catch (err) {
        setStatus(err.message);
    }
    setStatus(els.status.textContent); // preserve
};

boot();
