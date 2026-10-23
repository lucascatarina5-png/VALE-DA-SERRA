# Transferências da indústria para o galpão

No computador ou celular, abra **Estoque / Galpão → Indústria → Galpão**.

1. Cadastre os produtos do galpão, como mussarela e queijo, com a unidade correta (kg ou unidade). O cadastro continua exclusivo do administrador.
2. Em **Registrar envio**, informe o responsável na indústria, quem transporta, os produtos e as quantidades enviadas. Salvar gera um número de transferência; ainda não soma ao estoque.
3. Na chegada, abra a transferência e escolha **Conferir e receber**. Digite as quantidades efetivamente recebidas, inclusive zero para um produto ausente. Informe o conferente e explique qualquer diferença.
4. Confirme o recebimento. Somente as quantidades conferidas entram no estoque do galpão, sem gerar venda ou débito de produtor.
5. Em **Imprimir cupom 80 mm**, imprima e colha as assinaturas de quem entregou e de quem recebeu. A assinatura é feita no papel. Se impresso antes da conferência, o cupom indica que o envio ainda não foi conferido.

Os status são “Aguardando recebimento”, “Recebida” e “Recebida com divergência”. Quantidades aceitam até três casas decimais. A diferença é recebido menos enviado. Uma falta é negativa e um excedente é positivo; produtos e unidades diferentes não são somados entre si.

Usuários precisam de permissão **estoque**. Recebimentos confirmados só podem ser corrigidos por administrador, informando um motivo. A correção ajusta o estoque pela diferença, sem apagar os movimentos ou a conferência anterior. O sistema bloqueia a redução que deixaria estoque negativo ou abaixo das reservas de pedidos. Cada revisão do comprovante fica identificada e o histórico mostra usuário, data, motivo e quantidades anteriores.

O registro do envio documenta a saída da indústria. Esta função movimenta o estoque já existente do galpão; não cria um estoque separado da fábrica.

## Instalação e validação

A entrada de produção continua `npm start` (`servidor.js`). No primeiro início com a atualização, uma migração idempotente cria apenas a tabela `app_industry_transfers` e seu índice. Os produtos, movimentos e demais registros existentes permanecem nas tabelas atuais. O cupom é um controle interno, sem valor fiscal.

```sh
npm install
npm run test:transfers
```

Os testes utilizam PostgreSQL via PGlite em memória, sem acessar dados reais. Cobrem validação, autenticação/permissões, envio, idempotência, recebimento parcial e zero, divergência, correção administrativa, revisão desatualizada, reservas, unidade alterada e reversão integral em falha de auditoria. A concorrência é protegida em produção por transações, bloqueio da transferência/produtos e chave idempotente; o teste em memória não simula múltiplas conexões PostgreSQL.

A impressão física deve ser conferida na impressora usada pela empresa. Selecione papel de 80 mm, escala 100% e desative cabeçalhos e rodapés do navegador.
