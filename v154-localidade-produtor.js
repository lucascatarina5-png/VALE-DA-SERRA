(function(){
  'use strict';

  const form=document.getElementById('formProd');
  if(!form||form.dataset.v154LocalidadePersistente==='1')return;
  form.dataset.v154LocalidadePersistente='1';

  let salvando=false;
  const campo=id=>document.getElementById(id);
  const valor=id=>String(campo(id)?.value||'').trim();
  const copia=obj=>JSON.parse(JSON.stringify(obj));

  function estadoCompleto(){
    let importacoesPdf=[];
    try{importacoesPdf=JSON.parse(localStorage.getItem('vds_pdf_import_batches_v137')||'[]')}catch(_){}
    return {produtores,lancamentos,pagamentos,debitos,pagamentosDebitos,importacoesPdf};
  }

  async function confirmarNoServidor(){
    const headers=typeof v4Headers==='function'?v4Headers():{};
    headers['Content-Type']='application/json';
    const resposta=await fetch('/api/state',{
      method:'PUT',
      headers,
      cache:'no-store',
      body:JSON.stringify({data:estadoCompleto()})
    });
    let retorno={};
    try{retorno=await resposta.json()}catch(_){}
    if(!resposta.ok||retorno.ok===false){
      throw new Error(retorno.error||'O servidor não confirmou a alteração.');
    }
    return true;
  }

  async function salvarCadastroPrincipal(){
    if(salvando)return false;

    const idAtual=editId;
    const eraEdicao=!!idAtual;
    const anterior=eraEdicao?prodById(idAtual):null;
    if(eraEdicao&&!anterior){
      alert('O produtor que seria editado não foi encontrado. Pesquise novamente.');
      return false;
    }

    const nome=valor('pNome');
    const local=valor('pLocal');
    if(!nome||!local){
      alert('Informe o nome e a localidade principal do produtor.');
      return false;
    }

    const antes=copia(produtores);
    const produtor={
      ...(anterior||{}),
      id:idAtual||crypto.randomUUID(),
      nome,
      local,
      tanqueiro:valor('pTanqueiro'),
      whatsTanqueiro:valor('pWhatsTanqueiro'),
      caminhao:valor('pCaminhao'),
      whatsapp:valor('pWhats'),
      formaPagamento:valor('pFormaPagamento'),
      banco:valor('pBanco'),
      agencia:valor('pAgencia'),
      conta:valor('pConta'),
      tipoConta:valor('pTipoConta'),
      titularConta:valor('pTitularConta'),
      documentoTitular:valor('pDocumentoTitular'),
      tipoChavePix:valor('pTipoChavePix'),
      chavePix:valor('pChavePix'),
      dadosBancariosConferidosEm:valor('pDadosBancariosConferidosEm')
    };

    const botao=form.querySelector('button[type="submit"]');
    const rotulo=botao?.textContent||'';
    salvando=true;
    if(botao){botao.disabled=true;botao.textContent='Salvando...'}

    produtores=eraEdicao
      ?produtores.map(p=>String(p.id)===String(idAtual)?produtor:p)
      :[...produtores,produtor];
    save();

    try{
      await confirmarNoServidor();
      editId=null;
      form.reset();
      try{
        await v25Audit(eraEdicao?'PRODUTOR_EDITADO':'PRODUTOR_CRIADO',{
          nome:produtor.nome,
          localPrincipal:produtor.local,
          tanqueiro:produtor.tanqueiro,
          caminhao:produtor.caminhao,
          formaPagamento:produtor.formaPagamento||'não informada'
        });
      }catch(_){}
      if(typeof renderPagamentos==='function')renderPagamentos(false);
      if(typeof v144Refresh==='function')v144Refresh();
      alert(eraEdicao
        ?'✅ Localidade principal atualizada para '+produtor.local+'.\n\nO pagamento deste produtor agora será conferido nessa localidade.'
        :'✅ Produtor cadastrado em '+produtor.local+' e confirmado no servidor.');
      return true;
    }catch(erro){
      produtores=antes;
      save();
      alert('❌ A alteração não foi concluída.\n\n'+erro.message+'\n\nA localidade anterior foi mantida para evitar divergência no pagamento.');
      return false;
    }finally{
      salvando=false;
      if(botao){botao.disabled=false;botao.textContent=rotulo}
    }
  }

  window.v154ConfirmarEstado=confirmarNoServidor;
  window.v154SalvarCadastroPrincipal=salvarCadastroPrincipal;
  form.addEventListener('submit',evento=>{
    evento.preventDefault();
    evento.stopImmediatePropagation();
    void salvarCadastroPrincipal();
  },true);
})();
