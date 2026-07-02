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

// ── ROTA DE GERAÇÃO DE IMAGEM (Pollinations com negative prompt) ──
app.post("/generate-image", async (req, res) => {
  const { prompt, negativePrompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "prompt é obrigatório" });

  try {
    const encoded = encodeURIComponent(prompt);
    const neg = negativePrompt ? `&negative=${encodeURIComponent(negativePrompt)}` : "";
    const seed = Math.floor(Math.random() * 999999);
    // Use flux-realism for better anatomy, enhance=true for upscaling
    const url = `https://image.pollinations.ai/prompt/${encoded}?width=768&height=1024&model=flux-realism&nologo=true&nofeed=true&enhance=true&seed=${seed}${neg}`;
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

// ── ROTA DE PROMPT DE IMAGEM (Engenharia de prompt profissional) ──
app.post("/build-prompt", async (req, res) => {
  const { charData, style, view } = req.body;

  // Style tokens — specific artist/series references get better results
  const styleMap = {
    "modern": "masterpiece, best quality, ultra-detailed, modern anime style, (Demon Slayer:1.2), (Jujutsu Kaisen:1.1), vibrant colors, sharp lineart, cel shading",
    "90s":    "masterpiece, best quality, 1990s anime style, (Cowboy Bebop:1.1), (Neon Genesis Evangelion:1.1), cel shaded, retro anime, film grain, soft colors",
    "shonen": "masterpiece, best quality, shonen anime style, (Naruto:1.1), (My Hero Academia:1.1), dynamic pose, bold outlines, energetic, vivid colors",
    "chibi":  "masterpiece, best quality, chibi anime style, super deformed, big round eyes, small body, cute, kawaii, pastel colors, soft shading",
    "seinen": "masterpiece, best quality, seinen manga anime style, (Berserk:1.1), realistic proportions, detailed anatomy, dark atmosphere, mature aesthetic"
  };

  // View tokens
  const viewMap = {
    front:  "full body, front view, standing, arms at sides, looking at viewer",
    back:   "full body, back view, standing, seen from behind",
    detail: "upper body portrait, face focus, detailed face, expressive eyes, close-up"
  };

  // Negative prompt — things to avoid
  const negativePrompt = "worst quality, low quality, normal quality, lowres, blurry, jpeg artifacts, ugly, duplicate, morbid, mutilated, extra fingers, mutant hands, poorly drawn hands, poorly drawn face, mutation, deformed, extra limbs, extra arms, extra legs, missing limbs, disfigured, fused fingers, too many fingers, long neck, cross-eyed, cloned face, nsfw";

  const styleDesc = styleMap[style] || styleMap["modern"];
  const viewDesc  = viewMap[view]   || viewMap["front"];

  // Extract only visual elements from design
  const design = (charData.design || "anime character").trim();
  const outfit = charData.outfit ? `, ${charData.outfit.trim()}` : "";
  const name   = charData.name   ? `1girl, ` : ""; // helps model understand it's a single character

  // Determine gender hint from design text
  const designLower = design.toLowerCase();
  const genderHint = designLower.includes("mulher") || designLower.includes("garota") || designLower.includes("female") || designLower.includes("girl")
    ? "1girl, " : designLower.includes("homem") || designLower.includes("garoto") || designLower.includes("male") || designLower.includes("boy")
    ? "1boy, " : "1character, ";

  const finalPrompt = `${styleDesc}, ${genderHint}${design}${outfit}, ${viewDesc}, solo, white background, character sheet, professional illustration`;

  res.json({
    prompt: finalPrompt,
    negativePrompt
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`AURION backend rodando na porta ${PORT}`);
});
