GTA CHARACTER EXPERIENCE - NETLIFY PROJECT

This bundle contains index.html and a Netlify Function for real image generation.

IMPORTANT: A drag-and-drop static deploy in Netlify does not build Functions. Deploy this project using Git integration or Netlify CLI.

1. Add environment variable in Netlify: OPENAI_API_KEY = your secret API key. Never put the key in index.html.
2. Deploy this folder as a Netlify project with the included netlify.toml and netlify/functions/generate-avatar.mjs.
3. Open the deployed site, upload a photo, answer the quiz and click the create button.

The function uses OpenAI Images API (gpt-image-1) image edits. API billing/permissions are required. The image generation step is a prototype; payment/checkout and animated avatar are not integrated yet.
