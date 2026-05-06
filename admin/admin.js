// ─────────────────────────────────────────────────────────────
// admin.js — utilitários compartilhados do painel admin
// ─────────────────────────────────────────────────────────────

async function apiCall(action, payload) {
  const res = await fetch(CONFIG.APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, ...(payload || {}) }),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error('Erro de rede (' + res.status + ')');
  const text = await res.text();
  return JSON.parse(text);
}

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Auth ──

function checkAuth() {
  if (!sessionStorage.getItem('admin_token')) {
    window.location.replace('index.html');
    return false;
  }
  return true;
}

function logout() {
  sessionStorage.removeItem('admin_token');
  sessionStorage.removeItem('admin_token_ts');
  window.location.replace('index.html');
}

// ── URL helpers ──

function getParam(name) {
  return new URLSearchParams(window.location.search).get(name) || '';
}

function getResponderUrl(codigo) {
  const href = window.location.href;
  const idx  = href.indexOf('/admin/');
  const base = idx > -1 ? href.substring(0, idx + 1) : (window.location.origin + '/');
  return base + 'responder.html?codigo=' + encodeURIComponent(codigo);
}

// ── Toast ──

let _toastTimer;
function showToast(msg, type) {
  type = type || 'success';
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
  el.className = 'toast toast-' + type;
  el.textContent = msg;
  el.classList.remove('show');
  clearTimeout(_toastTimer);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
  _toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

// ── Modals ──

function showModal(id) { document.getElementById(id).classList.remove('hidden'); }
function hideModal(id) { document.getElementById(id).classList.add('hidden'); }

// ── Button loading ──

function setLoading(btn, loading) {
  if (loading) {
    btn.disabled = true;
    btn._orig = btn.innerHTML;
    btn.innerHTML = '<span class="spinner"></span> Aguarde...';
  } else {
    btn.disabled = false;
    if (btn._orig != null) btn.innerHTML = btn._orig;
  }
}

// ── Escape HTML ──

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Tag input ──

function initTagInput(wrapperId, initial) {
  const wrapper = document.getElementById(wrapperId);
  let tags = Array.isArray(initial) ? [...initial] : [];

  function render() {
    wrapper.innerHTML = '';
    tags.forEach((tag, i) => {
      const span = document.createElement('span');
      span.className = 'tag';
      span.innerHTML = escHtml(tag) + ' <button type="button" title="Remover">×</button>';
      span.querySelector('button').addEventListener('click', (e) => {
        e.stopPropagation();
        tags.splice(i, 1);
        render();
      });
      wrapper.appendChild(span);
    });

    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'tag-input';
    inp.placeholder = tags.length === 0 ? 'Ex: Financeiro, DHO...' : 'Adicionar...';
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const v = inp.value.trim().replace(/,+$/, '');
        if (v && !tags.includes(v)) { tags.push(v); render(); } else { inp.value = ''; }
      }
      if (e.key === 'Backspace' && inp.value === '' && tags.length > 0) {
        tags.pop(); render();
      }
    });
    inp.addEventListener('blur', () => {
      const v = inp.value.trim().replace(/,+$/, '');
      if (v && !tags.includes(v)) { tags.push(v); render(); }
    });
    wrapper.appendChild(inp);
  }

  wrapper.addEventListener('click', () => wrapper.querySelector('input') && wrapper.querySelector('input').focus());
  render();
  return {
    getTags: () => [...tags],
    setTags: (t) => { tags = [...(t || [])]; render(); },
  };
}

// ── CSV download ──

function downloadCSV(rows, filename) {
  const csv = rows.map(r =>
    r.map(c => '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"').join(',')
  ).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Parse CSV text — detecta separador (vírgula ou ponto-e-vírgula) e cabeçalho ──

function parseCSVText(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  if (lines.length === 0) return [];

  // Detecta separador pela primeira linha
  const sep = lines[0].split(';').length > lines[0].split(',').length ? ';' : ',';

  // Detecta e mapeia cabeçalho se existir
  const firstCols = lines[0].split(sep).map(c => c.trim().replace(/^["']|["']$/g, '').toLowerCase());
  const HEADER_KEYWORDS = ['nome', 'name', 'email', 'área', 'area', 'departamento', 'setor', 'dept'];
  const hasHeader = firstCols.some(c => HEADER_KEYWORDS.includes(c));

  let nomeIdx = 0, emailIdx = 1, areaIdx = 2;
  if (hasHeader) {
    firstCols.forEach((c, i) => {
      if (['nome', 'name'].includes(c))                              nomeIdx  = i;
      else if (['email', 'e-mail'].includes(c))                     emailIdx = i;
      else if (['área','area','departamento','setor','dept'].includes(c)) areaIdx = i;
    });
  }

  return (hasHeader ? lines.slice(1) : lines)
    .map(l => {
      const cols = l.split(sep).map(c => c.trim().replace(/^["']|["']$/g, ''));
      return { nome: cols[nomeIdx] || '', email: cols[emailIdx] || '', area: cols[areaIdx] || '' };
    })
    .filter(p => p.nome.length > 0);
}

// ── Mailto builder ──

function gerarMailto(participante, link, dataLimite) {
  const assunto = 'Avaliação CSC 360° — Seu código de acesso';
  const prazoLinhas = dataLimite
    ? ['', '⏰ Prazo para resposta: ' + fmtDateLocal(dataLimite)]
    : [];
  const corpo = [
    'Olá, ' + participante.nome + '!',
    '',
    'Você foi convidado(a) para responder à Avaliação CSC 360°.',
    '',
    'Sua participação é muito importante! A pesquisa de satisfação com os serviços CSC tem como objetivo contribuir para a melhoria da eficácia, identificando pontos fortes e oportunidades de melhoria, sempre com foco em uma prestação de serviços de excelência. Ressaltamos que a avaliação não é sobre pessoas, e sim sobre as áreas e os serviços prestados.',
    '',
    'Acesse o questionário pelo link abaixo:',
    link,
    '',
    '🔐 Código de acesso: ' + participante.codigo,
    ...prazoLinhas,
    '',
    'O questionário leva cerca de 10 minutos para ser concluído, e suas respostas são confidenciais.',
    '',
    'Agradecemos pela sua participação!',
  ].join('\n');
  return 'mailto:' + encodeURIComponent(participante.email || '')
    + '?subject=' + encodeURIComponent(assunto)
    + '&body='    + encodeURIComponent(corpo);
}

// ── Copy to clipboard ──

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  }
}

// ── Format date ──

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('pt-BR');
  } catch { return iso; }
}

function fmtDateLocal(dateStr) {
  if (!dateStr) return '—';
  const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[3] + '/' + m[2] + '/' + m[1];
  return String(dateStr);
}

// ── Render breadcrumb ──

function renderBreadcrumb(items) {
  const el = document.getElementById('breadcrumb');
  if (!el) return;
  el.innerHTML = items.map((item, i) => {
    const isLast = i === items.length - 1;
    const sep = i > 0 ? '<span class="sep">›</span>' : '';
    if (isLast || !item.href) return sep + '<span>' + escHtml(item.label) + '</span>';
    return sep + '<a href="' + escHtml(item.href) + '">' + escHtml(item.label) + '</a>';
  }).join('');
}
