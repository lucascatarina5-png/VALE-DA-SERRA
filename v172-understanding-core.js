'use strict';

const STOP_WORDS = new Set('a ao aos as o os de da das do dos e em no na nos nas meu minha meus minhas eu voce por para com sem que quero queria saber diga mostre qual quais quanto quantos quantas tenho tem temos existe existem estoque estoques produto produtos item itens loja pdv galpao deposito armazem disponivel disponiveis fisico fisicos reservado reservados cadastrado cadastrados lista todos todas'.split(' '));

function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function terms(value) {
  return normalize(value).split(' ').filter(term => term.length > 1 && !STOP_WORDS.has(term));
}

function distance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const saved = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = saved;
    }
  }
  return row[b.length];
}

function isBroadStockQuestion(question) {
  const q = normalize(question);
  return /\b(quais|todos|todas|lista|listar)\b/.test(q)
    || /\b(produtos|itens|estoques)\b/.test(q)
    || /\b(quanto|quantos)\b.*\b(produtos|itens)\b/.test(q);
}

function isShortFollowUp(question) {
  const q = normalize(question);
  const words = q ? q.split(' ') : [];
  if (!q || words.length > 6 || isBroadStockQuestion(q)) return false;
  return /^(e\b|desse\b|dessa\b|dele\b|dela\b|o mesmo\b|a mesma\b|na loja\b|no pdv\b|no galpao\b|quanto tem\b|quanto resta\b|ainda tem\b|e quanto\b)/.test(q);
}

function shouldReuseEntity(question, context) {
  return Boolean(context && context.entity
    && ['stock', 'stock-clarification', 'stock-forecast'].includes(String(context.intent || ''))
    && isShortFollowUp(question));
}

function scoreProduct(question, productName) {
  const q = normalize(question);
  const name = normalize(productName);
  if (!name) return 0;
  if (q.includes(name)) return 100;
  const questionTerms = terms(q);
  const nameTerms = terms(name);
  let score = 0;
  for (const term of questionTerms) {
    for (const nameTerm of nameTerms) {
      if (term === nameTerm) score = Math.max(score, 35);
      else if (term.length >= 4 && nameTerm.length >= 4 && (term.startsWith(nameTerm) || nameTerm.startsWith(term))) score = Math.max(score, 24);
      else if (term.length >= 5 && nameTerm.length >= 5 && distance(term, nameTerm) <= 1) score = Math.max(score, 22);
    }
  }
  return score;
}

function matchProduct(question, products, previousEntity, allowPrevious) {
  if (isBroadStockQuestion(question)) return null;
  const ranked = (products || []).map(product => ({ product, score: scoreProduct(question, product.name) }))
    .filter(item => item.score >= 20).sort((a, b) => b.score - a.score);
  if (ranked.length) return ranked[0].product;
  if (allowPrevious && previousEntity) {
    const previous = normalize(previousEntity);
    return (products || []).find(product => normalize(product.name) === previous) || null;
  }
  return null;
}

function scoreSpeechCandidate(candidate, confidence) {
  const q = normalize(candidate);
  const domainWords = ['venda', 'vendas', 'pix', 'dinheiro', 'caixa', 'estoque', 'produto', 'produtos', 'loja', 'pdv', 'galpao', 'leite', 'produtor', 'produtores', 'debito', 'pagamento', 'tanque', 'relatorio', 'auditoria', 'usuario'];
  const domainScore = domainWords.reduce((sum, word) => sum + (q.split(' ').includes(word) ? 8 : 0), 0);
  const confidenceScore = Number.isFinite(Number(confidence)) && Number(confidence) >= 0 ? Number(confidence) * 20 : 8;
  return domainScore + confidenceScore + Math.min(q.split(' ').length, 12) * 0.25;
}

function chooseSpeechCandidate(primary, alternatives, confidences) {
  const candidates = [primary, ...(Array.isArray(alternatives) ? alternatives : [])]
    .map(value => String(value || '').trim()).filter(Boolean)
    .filter((value, index, list) => list.findIndex(other => normalize(other) === normalize(value)) === index)
    .slice(0, 5);
  if (!candidates.length) return { question: '', uncertain: true, alternatives: [] };
  const ranked = candidates.map((candidate, index) => ({
    candidate,
    confidence: Array.isArray(confidences) ? Number(confidences[index]) : -1,
    score: scoreSpeechCandidate(candidate, Array.isArray(confidences) ? confidences[index] : -1)
  })).sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const second = ranked[1];
  const uncertain = best.confidence >= 0 && best.confidence < 0.48
    && (!second || Math.abs(best.score - second.score) < 4);
  return { question: best.candidate, uncertain, alternatives: ranked.map(item => item.candidate) };
}

module.exports = {
  normalize,
  terms,
  isBroadStockQuestion,
  isShortFollowUp,
  shouldReuseEntity,
  scoreProduct,
  matchProduct,
  chooseSpeechCandidate
};
