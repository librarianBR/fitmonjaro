# fitMonjaro

App Android instalável (PWA) para acompanhar um plano de treino: mostra o que fazer em cada dia, registra a execução e guarda a evolução física ao longo do tempo.

Funciona offline, sem conta nem servidor. Há um perfil por aparelho, e os dados ficam só nele. O app não traz nenhum plano: no primeiro uso, escolha o arquivo `.json` do seu plano. O app salva sozinho uma cópia em **Downloads** (`fitmonjaro-AAAA-MM-DD-HHMM.json`) ao concluir um treino ou salvar uma medição; para restaurar, use **Perfil › Recuperar backup**. O app não substitui orientação médica.

## Estrutura

| Caminho | Conteúdo |
| --- | --- |
| `web/` | O app: é a única pasta a publicar |
| `web/logic.js` | Regras puras: calendário, progressão, medidas, validação de plano e backup |
| `web/app.js` | Telas e eventos |
| `web/editor.js` | Editor de planos: criar, alterar, excluir, importar e exportar |
| `web/db.js` | Banco de dados IndexedDB: um registro por treino, medição, dia, aplicação e plano |
| `web/icons.js` | Ícones das atividades e da navegação |
| `web/sw.js` | Cache para uso offline |
| `tests/` | Testes executados no navegador |
| `tests/plano-exemplo.json` | Plano fictício usado nos testes e como modelo |
| `assets/` | Pasta local de trabalho, ignorada pelo Git: nunca é enviada nem publicada |

Não há dependências nem etapa de compilação.

## Rodar localmente

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

- App: <http://127.0.0.1:8000/web/>
- Testes de regras: <http://127.0.0.1:8000/tests/logic.test.html>
- Teste de ponta a ponta: <http://127.0.0.1:8000/tests/e2e.test.html>. Ele apaga os dados do app nesse endereço.

## Formato do plano

O jeito mais simples de montar um plano é o **Editor de planos** (em **Plano**, ou em **Criar ou editar planos** na primeira tela). Cada alteração fica salva no aparelho e entra nos backups; **Exportar** gera o arquivo `plano-<id>.json` em Downloads, que é o arquivo usado no app de quem vai treinar. O editor só exporta um plano completo e mostra o que falta ajustar.

Um plano é um arquivo JSON escolhido no primeiro uso ou importado depois em **Plano**. Use `tests/plano-exemplo.json` como modelo. Planos feitos para uma pessoa não devem entrar no repositório: guarde-os fora dele ou em `assets/`, que o Git ignora. Importar um plano com o mesmo `id` substitui o anterior e mantém o histórico.

| Campo | Função |
| --- | --- |
| `schemaVersion` | Sempre `1` |
| `id`, `name`, `version`, `description` | Identificação; `id` usa letras, números, `_` e `-` |
| `durationWeeks`, `maxRounds`, `lightRounds` | Semanas, limite de séries e séries da versão leve |
| `schedule` | `days` (0 = segunda) e `rotation`, com a ordem dos treinos por semana |
| `roundsByWeek`, `phases`, `reviewWeeks` | Séries por período, fases e semanas da tabela de evolução |
| `exercises` | Por id: `name`, `target`, `min`, `max`, `unit`, `load`, `band`, `how`, `video` |
| `workouts` | Por id: `title` e `blocks`; bloco `sets` ou `pyramid`, com `items`, `rounds` e `restSeconds` opcionais |
| `warmup`, `mobility` | `title`, `items` (`name`, `dose`, `video`) e `note` opcional |
| `dailyTasks` | Rotina diária: `id`, `label`, `days` e `list` opcional |
| `bandLevels`, `guidance`, `safety` | Níveis de elástico e orientações exibidas no app |
| `painLabel` | Opcional: rótulo da escala de dor, como `Dor no joelho` (padrão `Dor`) |

Links de vídeo precisam usar `https://`.

## Publicar e instalar

1. Publique **somente a pasta `web/`** em uma hospedagem com HTTPS. No GitHub, `.github/workflows/publicar.yml` faz isso no GitHub Pages a cada envio que altere `web/` (em **Settings › Pages**, escolha a origem **GitHub Actions**).
2. No Android, abra o endereço no Chrome e escolha **Instalar app** no menu.
3. Envie o arquivo do plano para o celular (por um canal seguro, como e-mail protegido ou cabo USB) e escolha-o no primeiro uso.

A cada nova publicação, aumente `CACHE` em `web/sw.js`; sem isso, os aparelhos continuam com a versão antiga. O app procura atualizações ao abrir e ao voltar do segundo plano, e mostra o aviso **Atualizar**; também dá para verificar em **Perfil › Verificar atualização**.
