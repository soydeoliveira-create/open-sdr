# Hub SDR · Open Soluções Tributárias

Plataforma para lançar os contatos que chegam ao SDR, avaliar o cliente e encaminhar para a vendedora dona da praça.

## Fluxo

1. O SDR cadastra o contato em **+ Novo contato**. A plataforma avisa se o telefone ou e-mail já existe.
2. Na ficha, marca se **teve retorno**. Sem retorno, agenda a próxima tentativa ou descarta com motivo.
3. Com retorno, avalia o cliente como **Bom, Médio ou Ruim**.
4. Escolhe a praça (a dona já vem marcada) e clica em **Seguir para a vendedora**, ou descarta com motivo.
5. Clica em **Avisar pelo WhatsApp**, que abre a mensagem pronta para a vendedora.

Cada mudança entra sozinha no histórico do contato, com data e autor.

## Quem faz o quê

| | SDR | Gestão |
| --- | --- | --- |
| Cadastrar, atender e encaminhar contatos | Sim | Sim |
| Ver relatórios e exportar planilha | Não | Sim |
| Cadastrar vendedoras e praças | Não | Sim |
| Liberar e bloquear pessoas (aba Equipe) | Não | Sim |
| Excluir qualquer contato, de quem for | Não | Sim |

As vendedoras não entram na plataforma: elas são um cadastro e recebem o aviso pelo WhatsApp.

## Como colocar no ar

1. Crie um projeto novo no Supabase. Não use o projeto do Hub Comercial.
2. Rode o `supabase.sql` inteiro no SQL Editor.
3. Em `index.html`, preencha `SUPABASE_URL` e `SUPABASE_KEY` com o endereço e a chave **pública** (publishable/anon). Nunca use a chave secreta.
4. Publique a pasta no GitHub Pages ou na Vercel. A pasta `dev/` não é usada em produção.
5. **Crie logo a conta da gestão:** a primeira conta criada vira gestão automaticamente. As seguintes ficam aguardando liberação na aba Equipe.

Para a senha esquecida, a gestão redefine em Authentication → Users, no painel do Supabase.

## Testar no computador

```bash
python dev/serve.py 8560
```

Abre em http://localhost:8560 com dados de exemplo guardados só no navegador (`dev/mock-supabase.js`). As contas de teste estão nesse arquivo.

## Leads do RD Station Marketing

Cada conversão no RD Station vira um contato **Novo** na plataforma, com a praça pelo estado e "Como chegou" pela origem da conversão (tráfego pago, Instagram etc.; nos demais casos, RD Station). Se o e-mail ou o telefone já existir, a conversão entra no histórico do contato existente. O código fica em `supabase/functions/receber-rd/index.ts`.

Instalação, uma vez:

1. No Supabase, em **Edge Functions → Secrets**, crie `RD_TOKEN` com a senha combinada.
2. Em **Edge Functions → Deploy a new function → Via Editor**, use o nome `receber-rd`, cole o conteúdo de `index.ts` e publique.
3. Nos detalhes da função, desligue **Verify JWT** e salve.
4. No RD Station Marketing, em **Integrações → Webhooks**, crie um webhook com o gatilho **Conversão** e o endereço `https://sirepfbcdhtbvwcninpt.supabase.co/functions/v1/receber-rd?token=<RD_TOKEN>`.
5. Faça uma conversão de teste e confira o contato em **Contatos**. Os registros ficam em **Edge Functions → receber-rd → Logs**.

Se o log disser que falta a chave, crie também o secret `SDR_SECRET_KEY` com a chave secreta do projeto (Project Settings → API Keys). Ela fica só no Supabase, nunca no código.
