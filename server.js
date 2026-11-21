require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const app = express();
const upload = multer({ dest: "uploads/", limits: { fileSize: 25 * 1024 * 1024 } });
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

const key = () => process.env.OPENAI_API_KEY;
const requireKey = (res) => {
  if (!key()) { res.status(503).json({ error: "أضف OPENAI_API_KEY في ملف .env أولاً." }); return false; }
  return true;
};

app.get("/api/health", (_req, res) => res.json({ ok: true, version: "1.4.0", aiConfigured: !!key() }));

app.post("/api/ai", async (req, res) => {
  if (!requireKey(res)) return;
  try {
    const { prompt, model = "gpt-4o-mini", system = "أنت مساعد إبداعي يساعد في إعداد محتوى عربي واضح." } = req.body || {};
    if (!prompt?.trim()) return res.status(400).json({ error: "اكتب المطلوب أولاً." });
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "system", content: system }, { role: "user", content: prompt }] })
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.error?.message || "تعذر تنفيذ طلب الذكاء الاصطناعي." });
    res.json({ text: data.choices?.[0]?.message?.content || "" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/transcribe", upload.single("audio"), async (req, res) => {
  if (!requireKey(res)) return;
  if (!req.file) return res.status(400).json({ error: "ارفع ملفاً صوتياً." });
  try {
    const form = new FormData();
    form.append("file", new Blob([fs.readFileSync(req.file.path)]), req.file.originalname);
    form.append("model", "whisper-1");
    form.append("language", "ar");
    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST", headers: { Authorization: `Bearer ${key()}` }, body: form
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.error?.message || "فشل تفريغ الصوت." });
    res.json({ text: data.text || "" });
  } catch (e) { res.status(500).json({ error: e.message }); }
  finally { if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); }
});

app.post("/api/image", async (req, res) => {
  if (!requireKey(res)) return;
  try {
    const { prompt, size = "1024x1024" } = req.body || {};
    if (!prompt?.trim()) return res.status(400).json({ error: "اكتب وصف الصورة." });
    const r = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-image-1", prompt, size, n: 1 })
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.error?.message || "فشل توليد الصورة." });
    const item = data.data?.[0];
    res.json({ image: item?.b64_json ? `data:image/png;base64,${item.b64_json}` : item?.url || null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


app.post("/api/speech", async (req, res) => {
  if (!requireKey(res)) return;
  try {
    const { text, voice = "alloy" } = req.body || {};
    if (!text?.trim()) return res.status(400).json({ error: "لا يوجد نص لتحويله إلى صوت." });
    const r = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "tts-1", voice, input: text.slice(0, 4000), response_format: "mp3" })
    });
    if (!r.ok) {
      let message = "فشل إنشاء التعليق الصوتي.";
      try { const e = await r.json(); message = e.error?.message || message; } catch {}
      return res.status(r.status).json({ error: message });
    }
    const audio = Buffer.from(await r.arrayBuffer());
    res.json({ audio: audio.toString("base64"), mime: "audio/mpeg" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


app.post("/api/image-reference", upload.single("reference"), async (req, res) => {
  if (!requireKey(res)) return;
  if (!req.file) return res.status(400).json({ error: "ارفع صورة مرجعية للشخصية أولاً." });
  try {
    const prompt = (req.body.prompt || "").trim();
    if (!prompt) return res.status(400).json({ error: "اكتب وصف المشهد." });
    const form = new FormData();
    const bytes = fs.readFileSync(req.file.path);
    form.append("image", new Blob([bytes], { type: req.file.mimetype || "image/png" }), req.file.originalname || "reference.png");
    form.append("model", "gpt-image-1");
    form.append("prompt", prompt);
    form.append("size", req.body.size || "1536x1024");
    form.append("n", "1");
    const r = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST", headers: { Authorization: `Bearer ${key()}` }, body: form
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.error?.message || "فشل إنشاء الصورة باستخدام المرجع." });
    const item = data.data?.[0];
    res.json({ image: item?.b64_json ? `data:image/png;base64,${item.b64_json}` : item?.url || null });
  } catch (e) { res.status(500).json({ error: e.message }); }
  finally { if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); }
});

app.post("/api/scenes", async (req, res) => {
  if (!requireKey(res)) return;
  try {
    const { script, style = "2D animation, clean shapes, expressive characters" } = req.body || {};
    if (!script?.trim()) return res.status(400).json({ error: "أدخل نص القصة أو السكريبت." });
    const prompt = `حوّل السكريبت التالي إلى مخطط إنتاج أنيميشن متناسق. أخرج JSON صالحاً فقط بالشكل {"title":"...","style_guide":"...","characters":[{"name":"...","appearance":"وصف ثابت ودقيق للشكل والملابس والألوان والملامح","personality":"..."}],"scenes":[{"number":1,"duration":"5 seconds","characters":["اسم الشخصية"],"visual":"...","action":"...","voiceover":"...","image_prompt":"وصف المشهد مع الحفاظ على تصميم الشخصيات الثابت"}]}. استخرج الشخصيات الأساسية أولاً، واصنع لكل شخصية وصفاً بصرياً ثابتاً قابلاً لإعادة الاستخدام. في image_prompt كرر أوصاف الشخصيات التي تظهر في المشهد حرفياً قدر الإمكان حتى لا تتغير ملامحها وملابسها بين الصور. لا تضف شخصيات غير موجودة في السكريبت. اجعل عدد المشاهد مناسباً لطول النص، وحافظ على تسلسل الأحداث. الأسلوب البصري: ${style}. السكريبت:\n${script}`;
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o-mini", response_format: { type: "json_object" }, messages: [{ role: "user", content: prompt }] })
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.error?.message || "فشل تقسيم السكريبت." });
    res.json(JSON.parse(data.choices?.[0]?.message?.content || "{}"));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(process.env.PORT || 3000, () => console.log(`Workflow Studio running on http://localhost:${process.env.PORT || 3000}`));
