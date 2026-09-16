(function () {
  'use strict';

  if (window.ValeMascotEvents?.version >= 167) return;

  const EVENT_NAME = 'vds:mascot';
  const recent = new Map();
  let sequence = 0;

  const catalog = {
    BUTTON_FOCUS: {
      animation: 'point',
      sequence: ['turn', 'walk_to_target', 'point'],
      silent: true
    },
    SALE_COMPLETED: {
      message: 'Venda finalizada com sucesso!',
      animation: 'dance',
      sequence: ['look_happy', 'talk', 'dance']
    },
    DONATION_COMPLETED: {
      message: 'Doação registrada! Que gesto bonito!',
      animation: 'heart',
      sequence: ['look_happy', 'talk', 'heart']
    },
    MILK_DEBT_SALE: {
      message: 'Venda concluída e lançada no leite!',
      animation: 'nod',
      sequence: ['look_happy', 'talk', 'nod']
    },
    WAREHOUSE_SALE: {
      message: 'Retirada do Galpão registrada!',
      animation: 'nod',
      sequence: ['turn', 'talk', 'nod']
    },
    PAYMENT_COMPLETED: {
      message: 'Pagamento finalizado! Comprovantes disponíveis.',
      animation: 'dance',
      sequence: ['look_happy', 'talk', 'dance']
    },
    MILK_ENTRY: {
      message: 'Entrada de leite registrada!',
      animation: 'jump',
      sequence: ['look_happy', 'talk', 'jump']
    },
    PDF_IMPORT: {
      message: 'Lote confirmado e entradas registradas!',
      animation: 'dance',
      sequence: ['look_happy', 'talk', 'dance']
    },
    CASH_OPENED: {
      message: 'Caixa aberto. Vamos começar!',
      animation: 'wave',
      sequence: ['turn', 'talk', 'wave']
    },
    CASH_CLOSED: {
      message: 'Caixa fechado com sucesso!',
      animation: 'dance',
      sequence: ['look_happy', 'talk', 'dance']
    },
    TANK_COMPLETED: {
      message: 'Conferência do tanque finalizada!',
      animation: 'nod',
      sequence: ['turn', 'talk', 'nod']
    }
  };

  const cooldowns = {
    BUTTON_FOCUS: 450,
    MILK_ENTRY: 1800,
    PAYMENT_COMPLETED: 2500,
    TANK_COMPLETED: 1800
  };

  function enabled() {
    return localStorage.getItem('vds_mascot_enabled') !== '0';
  }

  function safeJson(value) {
    if (!value) return {};
    if (typeof value === 'object' && !(value instanceof FormData)) return value;
    if (value instanceof FormData) return Object.fromEntries(value.entries());
    try { return JSON.parse(String(value)); } catch (_) { return {}; }
  }

  function targetInfo(element) {
    if (!element?.getBoundingClientRect) return null;
    const rect = element.getBoundingClientRect();
    return {
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
      normalizedX: Number(((rect.left + rect.width / 2) / Math.max(1, innerWidth)).toFixed(4)),
      normalizedY: Number(((rect.top + rect.height / 2) / Math.max(1, innerHeight)).toFixed(4)),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
  }

  function deliver(payload) {
    document.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: payload }));
    const bridge = window.ValeMascot;
    if (!bridge) return;

    try {
      if (typeof bridge.perform === 'function') {
        bridge.perform(JSON.stringify(payload));
        return;
      }
      if (payload.silent) return;
      const message = payload.message || 'Tudo certo!';
      if (['dance', 'heart', 'wave', 'nod'].includes(payload.animation) && typeof bridge.celebrate === 'function') {
        bridge.celebrate(message);
      } else if (typeof bridge.jump === 'function') {
        bridge.jump(message);
      }
    } catch (error) {
      console.debug('[V167 Mascote] Ponte indisponível:', error);
    }
  }

  function emit(type, detail) {
    if (!enabled()) return false;
    const now = Date.now();
    const key = type + ':' + String(detail?.dedupeKey || 'default');
    const cooldown = Number(detail?.cooldown ?? cooldowns[type] ?? 900);
    if (now - Number(recent.get(key) || 0) < cooldown) return false;
    recent.set(key, now);

    const preset = catalog[type] || {};
    const payload = {
      protocol: 1,
      version: 167,
      id: ++sequence,
      timestamp: new Date(now).toISOString(),
      type,
      ...preset,
      ...(detail || {})
    };
    payload.mouth = !payload.silent && Boolean(payload.message);
    deliver(payload);
    return true;
  }

  const importantButton = [
    '#finishSale',
    '#v137ConfirmBtn',
    '#v139ConfirmButton',
    '#v155Finish',
    '#v157TankFinish',
    '#g118Finish',
    '.gal-final',
    '.loja-finalizar[onclick="lojaFinalizar()"]',
    '.cash-open',
    '.cash-close',
    '[onclick*="ConfirmarAbrirCaixa"]',
    '[onclick*="ConfirmarFecharCaixa"]',
    '[onclick*="ConfirmImport"]',
    '[onclick*="ConfirmPayment"]',
    '[onclick*="FinalizarVenda"]'
  ].join(',');

  document.addEventListener('pointerdown', function (event) {
    const button = event.target?.closest?.('button');
    if (!button || !button.matches(importantButton)) return;
    emit('BUTTON_FOCUS', {
      target: targetInfo(button),
      label: String(button.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80),
      dedupeKey: button.id || button.getAttribute('onclick') || button.className,
      source: 'button'
    });
  }, true);

  function classify(url, method, body) {
    if (!['POST', 'PUT', 'PATCH'].includes(method)) return null;
    const path = new URL(url, location.href).pathname;
    const data = safeJson(body);

    if (path === '/api/store/sales') {
      const payment = String(data.payment_method || '').toLowerCase();
      if (payment === 'doacao') return ['DONATION_COMPLETED', { source: 'store-sale' }];
      if (payment === 'leite') return ['MILK_DEBT_SALE', { source: 'store-sale' }];
      return ['SALE_COMPLETED', { source: 'store-sale' }];
    }
    if (path === '/api/inventory/sale') return ['WAREHOUSE_SALE', { source: 'warehouse-sale' }];
    if (path === '/api/inventory/movements' && /VENDA GALPÃO/i.test(String(data.destination || ''))) {
      return ['WAREHOUSE_SALE', { source: 'warehouse-movement' }];
    }
    if (path === '/api/store/cash/open') return ['CASH_OPENED', { source: 'cash' }];
    if (path === '/api/store/cash/close') return ['CASH_CLOSED', { source: 'cash' }];
    if ((path === '/api/tank-conferences' && method === 'POST') ||
        /\/api\/tanks?\/.+\/(finish|close)$/.test(path) ||
        /\/api\/tank-(cycles|conferences)\/.+\/(finish|close)$/.test(path)) {
      return ['TANK_COMPLETED', { source: 'tank' }];
    }
    if (path === '/api/audit/event') {
      const action = String(data.action || '').toUpperCase();
      if (action === 'LEITE_ENTRADA_REGISTRADA') return ['MILK_ENTRY', { source: 'milk-entry' }];
      if (action === 'PAGAMENTO_QUINZENA_REGISTRADO') return ['PAYMENT_COMPLETED', { source: 'payment' }];
      if (action === 'IMPORTACAO_PDF_CONFIRMADA') return ['PDF_IMPORT', { source: 'pdf-import' }];
    }
    return null;
  }

  function installFetchObserver() {
    if (window.fetch?.__v167MascotWrapped) return;
    const originalFetch = window.fetch.bind(window);
    const wrapped = async function (input, init) {
      const request = typeof Request !== 'undefined' && input instanceof Request ? input : null;
      const url = request?.url || String(input);
      const method = String(init?.method || request?.method || 'GET').toUpperCase();
      const body = init?.body;
      const response = await originalFetch(input, init);
      if (response.ok) {
        queueMicrotask(function () {
          try {
            const match = classify(url, method, body);
            if (match) emit(match[0], match[1]);
          } catch (error) {
            console.debug('[V167 Mascote] Evento ignorado:', error);
          }
        });
      }
      return response;
    };
    wrapped.__v167MascotWrapped = true;
    window.fetch = wrapped;
  }

  window.ValeMascotEvents = Object.freeze({
    version: 167,
    emit,
    enable: function () { localStorage.setItem('vds_mascot_enabled', '1'); },
    disable: function () { localStorage.setItem('vds_mascot_enabled', '0'); },
    isEnabled: enabled
  });

  installFetchObserver();
  document.dispatchEvent(new CustomEvent('vds:mascot-ready', { detail: { version: 167 } }));
})();
