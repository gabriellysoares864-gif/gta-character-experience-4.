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

        return json({
          status: "completed",
          videoUrl
        });
      }

      if (result?.status === "FAILED") {
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

    let answers = {};

    try {
      answers = JSON.parse(answersRaw);
    } catch {
      answers = {};
    }

    const choices = Object.values(answers)
      .filter(value => typeof value === "string")
      .join(", ");

    // PROMPT PERSONALIZADO
    const prompt = `
Create a cinematic GTA-inspired video using Image 1
as the main character reference.

Preserve the person's recognizable facial identity,
skin tone, facial features and hairstyle.

Transform the person into a high-quality cinematic
3D video-game character inspired by the atmosphere
of GTA Vice City.

Scene and character preferences:
${choices || "A stylish urban character in a cinematic Miami-inspired city."}

Create a dynamic cinematic scene with:

- Tropical coastal city atmosphere
- Neon lights in pink, cyan and purple
- Palm trees and urban streets
- Cinematic lighting
- Realistic shadows and reflections
- Detailed 3D game graphics
- Smooth camera movement
- Natural character movement
- Professional movie-trailer composition

Animate the character naturally.
The scene should feel like a cinematic video game trailer.

Vertical video, 9:16.
No text.
No logos.
No watermark.
Do not change the person's identity.
Do not create a different face.
    `.trim();

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
      return json({
        error: "O Picsart retornou uma resposta inválida no upload.",
        details: uploadText
      }, 502);
    }

    if (!uploadResponse.ok) {
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
              duration: 5,
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
      return json({
        error: "Resposta inválida ao iniciar a geração do vídeo.",
        details: generationText
      }, 502);
    }

    if (!generationResponse.ok) {
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
      return json({
        error: "A API não retornou o ID da geração.",
        details: generationPayload
      }, 502);
    }

    // 3. RETORNAR ID PARA O SITE ACOMPANHAR
    return json({
      status: "processing",
      taskId,
      message: "Seu vídeo está sendo criado."
    });

  } catch (error) {
    return json({
      error: error.message || "Erro inesperado na geração."
    }, 500);
  }
};
