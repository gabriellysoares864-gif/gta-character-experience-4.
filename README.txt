GTA CHARACTER EXPERIENCE — INTEGRAÇÃO DE PAGAMENTO E ENTREGA

Arquivos do projeto:
- index.html: landing page, upload, quiz, checkout (preservado)
- success.html: página de retorno pós-pagamento, confirma compra e gera/retoma trailer
- netlify/functions/generate-avatar.mjs: geração MiniMax/Picsart (15 segundos), protegida por pagamento
- netlify/functions/payment-status.mjs: consulta status da compra e geração
- netlify/functions/kiwify-webhook.mjs: recebe compra aprovada e valida assinatura HMAC-SHA1
- netlify.toml: configuração Netlify
- package.json: dependência Netlify Blobs

CONFIGURAÇÃO NETLIFY
1. Mantenha PICSART_API_KEY já existente.
2. Configure KIWIFY_WEBHOOK_TOKEN com o token que a Kiwify gerar para o webhook (o mesmo token, sem espaços).
3. Faça deploy do projeto.

CONFIGURAÇÃO KIWIFY
1. Apps > Webhooks > Criar Webhook.
2. Nome: GTA Character Experience.
3. URL: https://gta-character-experience-4.netlify.app/.netlify/functions/kiwify-webhook
4. Token: use o token gerado pela Kiwify. Copie-o para a variável KIWIFY_WEBHOOK_TOKEN da Netlify.
5. Produtos: selecione somente o produto GTA Character Experience.
6. Evento: Compra aprovada.
7. Crie o webhook e teste; confira Apps > Webhooks > Ver logs.

PÁGINA DE OBRIGADO
No produto Kiwify: Produtos > GTA Character Experience > Configurações > Páginas de Obrigado (ou página de obrigado personalizada). Configure:
https://gta-character-experience-4.netlify.app/success.html
Use somente para pagamento aprovado, conforme as opções da Kiwify.

COMO FUNCIONA
- O site cria um identificador de experiência e passa como parâmetro sck ao checkout.
- O webhook valida a assinatura HMAC-SHA1 do corpo bruto, reconhece compra aprovada e grava o pagamento no Netlify Blobs pelo sck.
- success.html consulta o pagamento; só inicia geração após paid=true.
- A função de geração bloqueia pedidos não pagos e mantém o status da tarefa para retomar polling após atualização da página.
- Geração configurada para 15 segundos, vertical 9:16.

LIMITAÇÕES E TESTES OBRIGATÓRIOS
- O teste de webhook da Kiwify pode não reproduzir um pedido com sck; teste a entrega e confira os logs.
- Teste compra real ou método de teste suportado, retorno à página, geração de 15 segundos, vídeo e download.
- Foto e respostas ficam no navegador original (IndexedDB/sessionStorage). Se o comprador trocar de dispositivo/navegador ou limpar os dados antes de voltar, a experiência pode não ser recuperada.
- Netlify Blobs usa o registro de pagamento; não é um sistema de armazenamento de vídeo permanente. O vídeo é entregue pela URL retornada pela API.
- Não divulgar até validar o fluxo ponta a ponta.
