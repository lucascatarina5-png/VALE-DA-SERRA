# Transferências da indústria para o galpão

No computador ou celular, abra **Loja / PDV → Indústria → Galpão**.

1. Cadastre os produtos da Loja PDV, como mussarela e queijo, com a unidade correta (kg ou unidade). A lista usa os produtos existentes do PDV e identifica também a variante e o peso da embalagem. A quantidade segue a unidade de estoque cadastrada no produto.
2. Em **Registrar envio**, informe o responsável na indústria, quem transporta, os produtos e as quantidades enviadas. Salvar gera um número de transferência; ainda não soma ao estoque.
3. Na chegada, abra a transferência e escolha **Conferir e receber**. Digite as quantidades efetivamente recebidas, inclusive zero para um produto ausente. Informe o conferente e explique qualquer diferença.
4. Confirme o recebimento. Somente as quantidades conferidas entram no estoque da Loja PDV, sem gerar venda ou débito de produtor.
5. Em **Imprimir cupom 80 mm**, imprima e colha as assinaturas de quem entregou e de quem recebeu. A assinatura é feita no papel. Se impresso antes da conferência, o cupom indica que o envio ainda não foi conferido.

Os status são “Aguardando recebimento”, “Recebida” e “Recebida com divergência”. Quantidades aceitam até três casas decimais. A diferença é recebido menos enviado. Uma falta é negativa e um excedente é positivo; produtos e unidades diferentes não são somados entre si.

Usuários precisam de permissão **loja**. Recebimentos confirmados só podem ser corrigidos por administrador, informando um motivo. A correção ajusta o estoque da Loja PDV pela diferença, sem apagar os movimentos ou a conferência anterior. O sistema bloqueia a redução que deixaria estoque negativo . Cada revisão do comprovante fica identificada e o histórico mostra usuário, data, motivo e quantidades anteriores.

O registro do envio documenta a saída da indústria. Esta função movimenta o estoque já existente da Loja PDV; não cria um estoque separado da fábrica.

## Instalação e validação

A entrada de produção continua `npm start` (`servidor.js`). No primeiro início com a atualização, uma migração idempotente cria a tabela `app_industry_transfers` e seu índice, e acrescenta a coluna `target_scope`. Os produtos, movimentos e demais registros existentes permanecem nas tabelas atuais. O cupom é um controle interno, sem valor fiscal.

```sh
npm install
npm run test:transfers
```

Os testes utilizam PostgreSQL via PGlite em memória, sem acessar dados reais. Cobrem validação, autenticação/permissões, envio, idempotência, recebimento parcial e zero, divergência, correção administrativa, revisão desatualizada, separação entre PDV e Galpão, apresentação da embalagem, unidade alterada e reversão integral em falha de auditoria. A concorrência é protegida em produção por transações, bloqueio da transferência/produtos e chave idempotente; o teste em memória não simula múltiplas conexões PostgreSQL.

A impressão física deve ser conferida na impressora usada pela empresa. Selecione papel de 80 mm, escala 100% e desative cabeçalhos e rodapés do navegador.

## Correção do destino do estoque

Os novos envios usam exclusivamente produtos, permissões, saldos e histórico de movimentos da Loja PDV. Registros criados pela primeira versão permanecem identificados como `target_scope=galpao`, sem conversão de produtos nem alteração automática de saldos. A listagem e os recebimentos atuais aceitam apenas `target_scope=pdv`; números ou IDs antigos não são reinterpretados como produtos da loja. A sequência de numeração é preservada.
