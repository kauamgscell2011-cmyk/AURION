const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

// Serve o HTML da AURION
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/status", (req, res) => {
  res.json({ status: "AURION backend rodando ✓" });
});

// ── ROTA DE CHAT (Groq) ──
app.post("/chat", async (req, res) => {
  const { messages, systemPrompt } = req.body;
  if (!messages || !systemPrompt)
    return res.status(400).json({ error: "messages e systemPrompt são obrigatórios" });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey)
    return res.status(500).json({ error: "GROQ_API_KEY não configurada" });

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        max_tokens: 1000,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages
        ]
      })
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({ error: err?.error?.message || "Erro no Groq" });
    }

    const data = await response.json();
    res.json({ reply: data.choices?.[0]?.message?.content || "" });

  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: "Erro interno no servidor" });
  }
});

// ── ROTA DE GERAÇÃO DE IMAGEM (Pollinations via redirect) ──
app.post("/generate-image", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "prompt é obrigatório" });

  try {
    const encoded = encodeURIComponent(prompt);
    const seed = Math.floor(Math.random() * 99999);
    // width/height closer to square reduces anatomy distortion on free model
    // nofeed=true avoids it appearing in public feed
    const url = `https://image.pollinations.ai/prompt/${encoded}?width=720&height=960&model=flux&nologo=true&nofeed=true&enhance=true&seed=${seed}`;
    res.json({ imageUrl: url });
  } catch (err) {
    res.status(500).json({ error: "Erro ao gerar URL de imagem" });
  }
});

// ── ROTA DE GERAÇÃO DE MÚSICA (Mubert/Instrumental) ──
app.post("/generate-music", async (req, res) => {
  const { prompt, duration } = req.body;
  if (!prompt) return res.status(400).json({ error: "prompt é obrigatório" });

  try {
    // Use Mubert API (free tier)
    const mubertKey = process.env.MUBERT_API_KEY;

    if (mubertKey) {
      const r = await fetch("https://api-b2b.mubert.com/v2/RecordTrackTTM", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: "RecordTrackTTM",
          params: {
            pat: mubertKey,
            prompt: prompt,
            duration: duration || 30,
            format: "mp3",
            intensity: "medium"
          }
        })
      });
      const d = await r.json();
      if (d?.data?.tasks?.[0]?.download_link) {
        return res.json({ audioUrl: d.data.tasks[0].download_link, source: "mubert" });
      }
    }

    // Fallback: Pixabay free music search based on mood
    const mood = prompt.toLowerCase().includes('epic') ? 'epic' :
                 prompt.toLowerCase().includes('sad') ? 'sad' :
                 prompt.toLowerCase().includes('action') ? 'action' : 'anime';

    const pixabayKey = process.env.PIXABAY_API_KEY;
    if (pixabayKey) {
      const r2 = await fetch(`https://pixabay.com/api/music/?key=${pixabayKey}&q=${mood}&per_page=3`);
      const d2 = await r2.json();
      if (d2?.hits?.length) {
        const track = d2.hits[0];
        return res.json({ audioUrl: track.audio, title: track.title, source: "pixabay" });
      }
    }

    // Last fallback: return a prompt for manual use
    res.json({
      audioUrl: null,
      prompt: prompt,
      sunoLink: `https://suno.com/create?prompt=${encodeURIComponent(prompt)}`,
      source: "manual"
    });

  } catch (err) {
    console.error("Music error:", err);
    res.status(500).json({ error: "Erro ao gerar música: " + err.message });
  }
});

// ── ROTA DE PROMPT DE IMAGEM ──
app.post("/build-prompt", async (req, res) => {
  const { charData, style, view } = req.body;

  const styleMap = {
    "90s":    "90s anime art style, cel shaded",
    "modern": "modern anime art style, detailed",
    "chibi":  "chibi anime style, kawaii, big eyes",
    "shonen": "shonen anime style, bold lines",
    "seinen": "seinen anime style, realistic proportions"
  };

  const viewMap = {
    front:  "front view, standing pose",
    back:   "back view, standing pose",
    detail: "portrait, face closeup"
  };

  const styleDesc = styleMap[style] || styleMap["modern"];
  const viewDesc  = viewMap[view]   || viewMap["front"];

  // Extract ONLY the pure visual description, strip anything non-visual
  const design = (charData.design || "anime character").trim();

  // Short, clean, high-signal prompt — long prompts confuse the free model
  const directPrompt = `anime character, ${design}, ${viewDesc}, ${styleDesc}, single character, solo, simple white background, full body, symmetrical anatomy, two arms, two legs, five fingers each hand, sharp focus, high detail, masterpiece`;

  res.json({ prompt: directPrompt });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`AURION backend rodando na porta ${PORT}`);
});
