export default async (req) => {
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Método não permitido" }), { status: 405, headers: { "Content-Type": "application/json" } });
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return new Response(JSON.stringify({ error: "A variável OPENAI_API_KEY não está configurada no Netlify." }), { status: 500, headers: { "Content-Type": "application/json" } });
  try {
    const form = await req.formData();
    const photo = form.get("photo");
    const answersRaw = form.get("answers") || "{}";
    if (!photo || typeof photo === "string") return new Response(JSON.stringify({ error: "Envie uma foto válida." }), { status: 400, headers: { "Content-Type": "application/json" } });
    if (photo.size > 10 * 1024 * 1024) return new Response(JSON.stringify({ error: "A foto deve ter no máximo 10 MB." }), { status: 413, headers: { "Content-Type": "application/json" } });
    let answers = {};
    try { answers = JSON.parse(answersRaw); } catch {}
    const choices = Object.values(answers).filter(v => typeof v === "string").join("; ");
    const prompt = `Transform the person in the provided reference photo into an original cinematic video-game character portrait inspired by the visual atmosphere of Grand Theft Auto: Vice City. Preserve recognizable facial identity, face shape, skin tone, hairstyle and key features of the person. Create a polished stylized 3D game character, high-quality cinematic lighting, tropical neon city atmosphere, magenta and cyan accents, detailed clothing and background. Character preferences from quiz: ${choices || "stylish modern urban character"}. Portrait composition, full visual quality, no text, no logos, no watermark. Do not copy any specific copyrighted character.`;
    const upstream = new FormData();
    upstream.append("model", "gpt-image-1");
    upstream.append("prompt", prompt);
    upstream.append("size", "1024x1024");
    upstream.append("quality", "medium");
    upstream.append("n", "1");
    upstream.append("image", photo, photo.name || "reference.png");
    const r = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: upstream });
    const payload = await r.json();
    if (!r.ok) return new Response(JSON.stringify({ error: payload?.error?.message || "A API de imagem retornou um erro." }), { status: r.status, headers: { "Content-Type": "application/json" } });
    const image = payload?.data?.[0]?.b64_json;
    if (!image) return new Response(JSON.stringify({ error: "A API não retornou uma imagem." }), { status: 502, headers: { "Content-Type": "application/json" } });
    return new Response(JSON.stringify({ image }), { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message || "Erro inesperado na geração." }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
