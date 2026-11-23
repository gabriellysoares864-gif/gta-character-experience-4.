const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: JSON_HEADERS
  });
}

export default async (req) => {
  const apiKey = process.env.PICSART_API_KEY;
  let paymentStore = null;
  let currentIntentId = null;

  if (!apiKey) {
    return json({
      error: "PICSART_API_KEY não está configurada no Netlify."
    }, 500);
  }

  // CONSULTAR STATUS DO VÍDEO
  if (req.method === "GET") {
    const taskId = new URL(req.url).searchParams.get("taskId");

    if (!taskId) {
      return json({ error: "ID da geração não informado." }, 400);
    }
    const blobs = (await import("@netlify/blobs")).getStore("gta-payments");
    const intentId = await blobs.get(`task:${taskId}`, { type: "text" });
    const paymentRecord = intentId ? await blobs.get(intentId, { type: "json" }) : null;

    try {
      const response = await fetch(
        `https://api.picsart.com/workflows/v1/models/${taskId}/result`,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`
          }
        }
      );

      
      const payload = await response.json();

      if (!response.ok) {
        return json({
          error: payload?.error?.message || "Erro ao consultar geração.",
          details: payload
        }, 502);
      }

      const result = payload?.response;

      if (result?.status === "COMPLETED") {
        const videoUrl =
          result?.result?.url ||
          result?.result?.items?.[0]?.url;

        if (!videoUrl) {
          return json({
            error: "A geração terminou, mas não encontramos o vídeo."
          }, 502);
        }

        if (intentId && paymentRecord) {
          await blobs.set(intentId, JSON.stringify({ ...paymentRecord, generationStatus: "completed", videoUrl, completedAt: new Date().toISOString() }));
        }
        return json({
          status: "completed",
          videoUrl
        });
      }

      if (result?.status === "FAILED") {
        if (intentId && paymentRecord) {
          await blobs.set(intentId, JSON.stringify({ ...paymentRecord, generationStatus: "failed", generationError: result?.error || "Generation failed" }));
        }
        return json({
          status: "failed",
          error: result?.error || "A geração do vídeo falhou."
        });
      }

      return json({
        status: "processing",
        taskId
      });

    } catch (error) {
      return json({
        error: error.message || "Erro ao consultar o vídeo."
      }, 500);
    }
  }

  // INICIAR GERAÇÃO
  if (req.method !== "POST") {
    return json({ error: "Método não permitido." }, 405);
  }

  try {
    const form = await req.formData();
    const intentId = String(form.get("intentId") || "");
    currentIntentId = intentId;
    if (!/^[a-zA-Z0-9_-]{20,80}$/.test(intentId)) return json({ error: "Identificador de compra inválido." }, 400);
    paymentStore = (await import("@netlify/blobs")).getStore("gta-payments");
    const payment = await paymentStore.get(intentId, { type: "json" });
    if (!payment?.paid) return json({ error: "Pagamento ainda não confirmado. Aguarde a confirmação da Kiwify." }, 402);
    if (payment.taskId && payment.generationStatus === "processing") return json({ status: "processing", taskId: payment.taskId, message: "Esta compra já está gerando o vídeo." });
    if (payment.generationStatus === "starting") return json({ error: "A geração já está sendo iniciada. Aguarde alguns instantes." }, 409);
    const photo = form.get("photo");
    const answersRaw = form.get("answers") || "{}";

    if (!photo || typeof photo === "string") {
      return json({
        error: "Envie uma foto válida."
      }, 400);
    }

    if (photo.size > 10 * 1024 * 1024) {
      return json({
        error: "A foto deve ter no máximo 10 MB."
      }, 413);
    }

    // Reserve this paid order to avoid duplicate generations.
    await paymentStore.set(intentId, JSON.stringify({ ...payment, generationStatus: "starting", generationStartedAt: new Date().toISOString() }));
    const markFailed = async (reason) => {
      const record = await paymentStore.get(intentId, { type: "json" });
      await paymentStore.set(intentId, JSON.stringify({ ...record, generationStatus: "failed", generationError: reason }));
    };
    let answers = {};

    try {
      answers = JSON.parse(answersRaw);
    } catch {
      answers = {};
    }

    const choices = Object.values(answers)
      .filter(value => typeof value === "string")
      .join(", ");

    // PROMPT CINEMATOGRÁFICO PERSONALIZADO — baseado nas respostas do quiz
    const answerText = Object.values(answers)
      .filter(value => typeof value === "string")
      .join(" | ");

    const lifestyle = answerText.includes("Luxuoso")
      ? "Luxury lifestyle, VIP parties, penthouses, premium fashion, supercars and high-status atmosphere."
      : answerText.includes("Criminoso")
      ? "Underground crime drama, street power, mysterious locations, tense urban nightlife and cinematic danger."
      : answerText.includes("Racer")
      ? "Underground racing culture, tuned sports cars, speed, adrenaline and cinematic road action."
      : answerText.includes("Empresário")
      ? "Business empire, luxury offices, high-rise penthouses, influence and sophisticated lifestyle."
      : "A distinctive Vice City lifestyle with cinematic urban atmosphere.";

    const personality = answerText.includes("Estratégico")
      ? "Calm, calculated movements, intelligent expressions, controlled and observant protagonist."
      : answerText.includes("Impulsivo")
      ? "Energetic movements, spontaneous action, intense expressions and unpredictable behavior."
      : answerText.includes("Carismático")
      ? "Magnetic presence, confident smile, natural charisma and captivating interactions."
      : answerText.includes("Dominante")
      ? "Commanding presence, powerful posture, confident movement and strong visual framing."
      : "Confident protagonist with natural, expressive behavior.";

    const visual = answerText.includes("Casual tropical")
      ? "Tropical streetwear, relaxed summer clothing and Miami-inspired fashion."
      : answerText.includes("Luxo e elegância")
      ? "Tailored designer clothing, sophisticated styling and premium accessories."
      : answerText.includes("Streetwear")
      ? "Urban streetwear, oversized clothing, sneakers and modern street fashion."
      : answerText.includes("Ostentação")
      ? "Extravagant designer fashion, gold accessories and high-status styling."
      : "Fashion that matches the selected character profile.";

    const territory = answerText.includes("Praia")
      ? "Tropical beach, ocean sunset, palm trees, coastal roads and beach-club atmosphere."
      : answerText.includes("Downtown")
      ? "Modern skyscrapers, busy streets, rooftop views and urban nightlife."
      : answerText.includes("Ruas e avenidas")
      ? "Cinematic city streets, neon signs, traffic and palm-lined avenues."
      : "Neon-lit Vice City streets, palm trees, art-deco architecture and tropical nightlife.";

    const vehicle = answerText.includes("Moto")
      ? "Feature a powerful motorcycle and a cinematic riding sequence."
      : answerText.includes("Jet ski")
      ? "Feature a luxury jet ski, tropical water action and coastal scenery."
      : answerText.includes("Helicóptero")
      ? "Feature a luxury helicopter, aerial city shots and a dramatic skyline arrival."
      : answerText.includes("Carro esportivo")
      ? "Feature a premium sports car, cinematic vehicle reveal and driving sequence."
      : "Include a cinematic vehicle moment that matches the protagonist.";

    const prompt = `CREATE A CINEMATIC CHARACTER INTRODUCTION TRAILER inspired by Grand Theft Auto VI and the Vice City universe.

REFERENCE PHOTO AND IDENTITY: Use the uploaded photo as the identity reference for the protagonist. Preserve recognizable facial identity, facial structure, skin tone, hairstyle and distinctive features. Do not replace the person with a generic face.

LIFESTYLE: ${lifestyle}
PERSONALITY: ${personality}
WARDROBE AND VISUAL STYLE: ${visual}
LOCATION AND ENVIRONMENT: ${territory}
VEHICLE AND ACTION: ${vehicle}

TRAILER STORY STRUCTURE: (1) CINEMATIC OPENING — establish the selected territory with a wide atmospheric shot, moving camera and dramatic lighting. (2) PROTAGONIST REVEAL — introduce the protagonist based on the reference photo with a cinematic camera move, natural expression and confident posture. (3) LIFESTYLE AND ACTION — show the character interacting with the chosen lifestyle, environment and vehicle, using dynamic but realistic motion. (4) ICONIC FINAL SHOT — finish with a memorable protagonist moment, strong composition and dramatic camera movement.

STYLE: GTA VI / Vice City inspired universe, AAA video-game trailer, cinematic realism, tropical neon atmosphere, dramatic shadows, premium color grading, immersive storytelling, dynamic camera movement and realistic environmental motion. This must feel like a VIDEO GAME CHARACTER INTRODUCTION TRAILER, not a static portrait or slideshow. Vertical 9:16. No text, logos or watermark. Avoid facial distortion, identity changes, unnatural motion, flicker, generic AI imagery and low-quality details.`.trim();

    // 1. ENVIAR FOTO PARA O PICSART
    const uploadForm = new FormData();

    uploadForm.append(
      "file",
      photo,
      photo.name || "reference.jpg"
    );

    const uploadResponse = await fetch(
      "https://video-api.picsart.io/v1/upload",
      {
        method: "POST",
        headers: {
          "X-Picsart-API-Key": apiKey
        },
        body: uploadForm
      }
    );

    const uploadText = await uploadResponse.text();

    let uploadPayload;

    try {
      uploadPayload = JSON.parse(uploadText);
    } catch {
      await markFailed("Invalid upload response");
      return json({
        error: "O Picsart retornou uma resposta inválida no upload.",
        details: uploadText
      }, 502);
    }

    if (!uploadResponse.ok) {
      await markFailed("Upload failed");
      return json({
        error: "Não foi possível enviar a foto para o Picsart.",
        details: uploadPayload
      }, 502);
    }

    // Tentar localizar URL da imagem retornada
    const imageUrl =
      uploadPayload?.url ||
      uploadPayload?.data?.url ||
      uploadPayload?.result?.url ||
      uploadPayload?.image_url ||
      uploadPayload?.data?.image_url ||
      uploadPayload?.result?.image_url;

    if (!imageUrl) {
      await markFailed("Upload image URL missing");
      return json({
        error: "O upload foi realizado, mas não encontramos a URL da imagem.",
        details: uploadPayload
      }, 502);
    }

    // 2. SUBMETER GERAÇÃO DO VÍDEO
    const generationResponse = await fetch(
      "https://api.picsart.com/workflows/v1/models/submit",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          params: {
            model: "minimax-h3-max-turbo",
            params: {
              prompt,
              startFrame: imageUrl,
              duration: 15,
              resolution: "768p",
              aspectRatio: "9:16",
              promptExpansionMode: "balanced",
              enableSafetyChecker: true
            }
          }
        })
      }
    );

    const generationText = await generationResponse.text();

    let generationPayload;

    try {
      generationPayload = JSON.parse(generationText);
    } catch {
      await markFailed("Invalid generation response");
      return json({
        error: "Resposta inválida ao iniciar a geração do vídeo.",
        details: generationText
      }, 502);
    }

    if (!generationResponse.ok) {
      await markFailed("Generation request rejected");
      return json({
        error: "O Picsart não conseguiu iniciar a geração.",
        details: generationPayload
      }, 502);
    }

    const taskId =
      generationPayload?.response?.id ||
      generationPayload?.id ||
      generationPayload?.task_id;

    if (!taskId) {
      await markFailed("Task id missing");
      return json({
        error: "A API não retornou o ID da geração.",
        details: generationPayload
      }, 502);
    }

    // Persist task mapping so the success page can resume polling after refresh.
    await paymentStore.set(`task:${taskId}`, currentIntentId);
    const latestPayment = await paymentStore.get(currentIntentId, { type: "json" });
    await paymentStore.set(currentIntentId, JSON.stringify({ ...latestPayment, generationStatus: "processing", taskId, generationStarted: true }));
    return json({
      status: "processing",
      taskId,
      message: "Seu vídeo está sendo criado."
    });

  } catch (error) {
    if (paymentStore && currentIntentId) {
      try {
        const record = await paymentStore.get(currentIntentId, { type: "json" });
        if (record?.paid && record.generationStatus === "starting") {
          await paymentStore.set(currentIntentId, JSON.stringify({ ...record, generationStatus: "failed", generationError: error.message || "Unexpected generation error" }));
        }
      } catch {}
    }
    return json({
      error: error.message || "Erro inesperado na geração."
    }, 500);
  }
};
