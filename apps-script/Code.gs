// ════════════════════════════════════════════════════════════════
// RADAR CSC 360° — Google Apps Script
// Configurar SHEET_ID com o ID da planilha Google Sheets
// Deployar como Web App: Execute as Me, Who has access: Anyone
// ════════════════════════════════════════════════════════════════

const SHEET_ID = '1JiLlzS_neUIksKnaSWf2dh2joq0nxquPgo4JvqHAzBw';

// Senha do admin — substitua pelo hash SHA-256 da senha desejada
// Para gerar: https://emn178.github.io/online-tools/sha256.html
// Exemplo: hash de "radar2024" = altere para sua senha real
const ADMIN_PASSWORD_HASH = '1dd87fb75ec72ae1dda8c1d5e3c25c3ed3e1d41aaabd0a37d66e971e33a70120';

// ─────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    let result;

    switch (data.action) {
      case 'validarCodigo':        result = validarCodigo(data); break;
      case 'salvarResposta':       result = salvarResposta(data); break;
      case 'adminLogin':           result = adminLogin(data); break;
      case 'criarEmpresa':         result = criarEmpresa(data); break;
      case 'editarEmpresa':        result = editarEmpresa(data); break;
      case 'criarAplicacao':       result = criarAplicacao(data); break;
      case 'adicionarParticipante':result = adicionarParticipante(data); break;
      case 'importarParticipantes':result = importarParticipantes(data); break;
      case 'listarEmpresas':       result = listarEmpresas(data); break;
      case 'listarAplicacoes':     result = listarAplicacoes(data); break;
      case 'listarParticipantes':  result = listarParticipantes(data); break;
      case 'exportarParticipantesCSV': result = exportarParticipantesCSV(data); break;
      case 'getDashboardData':     result = getDashboardData(data); break;
      case 'criarLinkPublico':     result = criarLinkPublico(data); break;
      case 'validarToken':         result = validarToken(data); break;
      default:
        result = { success: false, error: 'Ação desconhecida: ' + data.action };
    }

    return jsonResponse(result);
  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

function doGet(e) {
  return jsonResponse({ ok: true, app: 'RADAR CSC 360°' });
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.TEXT);
}

// ─────────────────────────────────────────────
// Sheet helpers
// ─────────────────────────────────────────────

function getSpreadsheet() {
  return SpreadsheetApp.openById(SHEET_ID);
}

function getSheet(name) {
  return getSpreadsheet().getSheetByName(name);
}

function sheetToObjects(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0].map(String);
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  });
}

function getHeaderMap(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const map = {};
  headers.forEach((h, i) => { map[h] = i; });
  return { headers, map };
}

function generateId() {
  return Utilities.getUuid();
}

function generateCodigo() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function isCodigoUnique(codigo) {
  const sheet = getSheet('participantes');
  const data = sheet.getDataRange().getValues();
  const { map } = getHeaderMap(sheet);
  for (let i = 1; i < data.length; i++) {
    if (data[i][map['codigo']] === codigo) return false;
  }
  return true;
}

function generateUniqueCodigo() {
  let code;
  let attempts = 0;
  do {
    code = generateCodigo();
    attempts++;
    if (attempts > 100) throw new Error('Não foi possível gerar código único.');
  } while (!isCodigoUnique(code));
  return code;
}

// ─────────────────────────────────────────────
// Etapa 1: validarCodigo + salvarResposta
// ─────────────────────────────────────────────

function validarCodigo(data) {
  const { codigo } = data;
  if (!codigo || codigo.length !== 6) {
    return { success: false, error: 'Código inválido.' };
  }

  const sheet = getSheet('participantes');
  const rows = sheet.getDataRange().getValues();
  const { map } = getHeaderMap(sheet);

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (String(row[map['codigo']]).toUpperCase() !== codigo.toUpperCase()) continue;

    if (row[map['respondido']] === true || row[map['respondido']] === 'TRUE') {
      return { success: false, error: 'Este questionário já foi respondido.' };
    }

    const participante = {
      id:            row[map['id']],
      aplicacao_id:  row[map['aplicacao_id']],
      empresa_id:    row[map['empresa_id']],
      nome:          row[map['nome']],
      email:         row[map['email']],
    };

    const empresa = getEmpresaById(participante.empresa_id);
    if (!empresa) {
      return { success: false, error: 'Empresa não encontrada.' };
    }

    return {
      success: true,
      participante,
      empresa: {
        nome:  empresa.nome,
        areas: parsearJSON(empresa.areas, []),
      },
    };
  }

  return { success: false, error: 'Código não encontrado. Verifique e tente novamente.' };
}

function salvarResposta(data) {
  const { codigo, participante_id, aplicacao_id, empresa_id, respostas } = data;

  if (!codigo || !participante_id || !respostas) {
    return { success: false, error: 'Dados incompletos.' };
  }

  // Verificar código novamente (guard contra double-submit)
  const partSheet = getSheet('participantes');
  const partData  = partSheet.getDataRange().getValues();
  const { map: pm } = getHeaderMap(partSheet);

  let partRowIndex = -1;
  for (let i = 1; i < partData.length; i++) {
    if (String(partData[i][pm['codigo']]).toUpperCase() === codigo.toUpperCase()) {
      if (partData[i][pm['respondido']] === true || partData[i][pm['respondido']] === 'TRUE') {
        return { success: false, error: 'Este questionário já foi respondido.' };
      }
      partRowIndex = i;
      break;
    }
  }

  if (partRowIndex === -1) {
    return { success: false, error: 'Código não encontrado.' };
  }

  const now = new Date().toISOString();
  const id  = generateId();

  // Montar linha da aba respostas
  // Ordem das colunas: id, participante_id, aplicacao_id, empresa_id,
  //   p1..p32, p33, p34, p35, p36, p37_json, p38, p_aberta_1, p_aberta_2, respondido_em
  const p = (k) => respostas[k] != null ? respostas[k] : '';
  const row = [
    id, participante_id, aplicacao_id, empresa_id,
    p('p1'),  p('p2'),  p('p3'),  p('p4'),
    p('p5'),  p('p6'),  p('p7'),  p('p8'),
    p('p9'),  p('p10'), p('p11'), p('p12'),
    p('p13'), p('p14'), p('p15'), p('p16'),
    p('p17'), p('p18'), p('p19'), p('p20'),
    p('p21'), p('p22'), p('p23'), p('p24'),
    p('p25'), p('p26'), p('p27'), p('p28'),
    p('p29'), p('p30'), p('p31'), p('p32'),
    p('p33'), p('p34'), p('p35'), p('p36'),
    JSON.stringify(respostas.p37 || {}),
    p('p38'),
    p('p_aberta_1'),
    p('p_aberta_2'),
    now,
  ];

  getSheet('respostas').appendRow(row);

  // Marcar participante como respondido
  partSheet.getRange(partRowIndex + 1, pm['respondido']   + 1).setValue(true);
  partSheet.getRange(partRowIndex + 1, pm['respondido_em']+ 1).setValue(now);

  return { success: true };
}

// ─────────────────────────────────────────────
// Admin auth (Etapa 2)
// ─────────────────────────────────────────────

function adminLogin(data) {
  const { passwordHash } = data;
  if (!passwordHash) return { success: false, error: 'Senha não informada.' };

  if (passwordHash !== ADMIN_PASSWORD_HASH) {
    return { success: false, error: 'Senha incorreta.' };
  }

  // Token simples — suficiente para app de consultora
  const token = Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
      passwordHash + Date.now().toString())
  ).slice(0, 32);

  return { success: true, token };
}

// ─────────────────────────────────────────────
// Empresas (Etapa 2)
// ─────────────────────────────────────────────

function criarEmpresa(data) {
  const { nome, areas, max_aplicacoes } = data;
  if (!nome) return { success: false, error: 'Nome obrigatório.' };

  const id  = generateId();
  const now = new Date().toISOString();

  getSheet('empresas').appendRow([
    id, nome,
    JSON.stringify(areas || []),
    max_aplicacoes || 4,
    now,
  ]);

  return { success: true, id };
}

function editarEmpresa(data) {
  const { id, nome, areas, max_aplicacoes } = data;
  if (!id) return { success: false, error: 'ID obrigatório.' };

  const sheet = getSheet('empresas');
  const rows  = sheet.getDataRange().getValues();
  const { map } = getHeaderMap(sheet);

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][map['id']] !== id) continue;
    const r = i + 1;
    if (nome          != null) sheet.getRange(r, map['nome']           + 1).setValue(nome);
    if (areas         != null) sheet.getRange(r, map['areas']          + 1).setValue(JSON.stringify(areas));
    if (max_aplicacoes!= null) sheet.getRange(r, map['max_aplicacoes'] + 1).setValue(max_aplicacoes);
    return { success: true };
  }

  return { success: false, error: 'Empresa não encontrada.' };
}

function listarEmpresas() {
  const rows = sheetToObjects(getSheet('empresas'));
  return {
    success: true,
    empresas: rows.map(r => ({
      ...r,
      areas: parsearJSON(r.areas, []),
    })),
  };
}

// ─────────────────────────────────────────────
// Aplicações (Etapa 2)
// ─────────────────────────────────────────────

function criarAplicacao(data) {
  const { empresa_id, nome } = data;
  if (!empresa_id || !nome) return { success: false, error: 'empresa_id e nome são obrigatórios.' };

  // Verifica limite
  const empresa = getEmpresaById(empresa_id);
  if (!empresa) return { success: false, error: 'Empresa não encontrada.' };

  const existentes = sheetToObjects(getSheet('aplicacoes'))
    .filter(a => a.empresa_id === empresa_id);
  const max = empresa.max_aplicacoes || 4;

  if (existentes.length >= max) {
    return { success: false, error: `Limite de ${max} aplicações atingido para esta empresa.` };
  }

  const id    = generateId();
  const ordem = existentes.length + 1;
  const now   = new Date().toISOString();

  getSheet('aplicacoes').appendRow([id, empresa_id, nome, ordem, now]);

  return { success: true, id };
}

function listarAplicacoes(data) {
  const { empresa_id } = data;
  if (!empresa_id) return { success: false, error: 'empresa_id obrigatório.' };

  const rows = sheetToObjects(getSheet('aplicacoes'))
    .filter(r => r.empresa_id === empresa_id)
    .sort((a, b) => a.ordem - b.ordem);

  return { success: true, aplicacoes: rows };
}

// ─────────────────────────────────────────────
// Participantes (Etapa 2)
// ─────────────────────────────────────────────

function adicionarParticipante(data) {
  const { aplicacao_id, empresa_id, nome, email } = data;
  if (!aplicacao_id || !empresa_id || !nome) {
    return { success: false, error: 'aplicacao_id, empresa_id e nome são obrigatórios.' };
  }

  const id     = generateId();
  const codigo = generateUniqueCodigo();
  const now    = new Date().toISOString();

  getSheet('participantes').appendRow([
    id, aplicacao_id, empresa_id, nome, email || '', codigo, false, '',
  ]);

  return { success: true, id, codigo };
}

function importarParticipantes(data) {
  const { aplicacao_id, empresa_id, participantes } = data;
  if (!aplicacao_id || !empresa_id || !Array.isArray(participantes)) {
    return { success: false, error: 'Dados inválidos.' };
  }

  const sheet = getSheet('participantes');
  const now   = new Date().toISOString();
  const criados = [];

  for (const p of participantes) {
    const id     = generateId();
    const codigo = generateUniqueCodigo();
    sheet.appendRow([
      id, aplicacao_id, empresa_id, p.nome || '', p.email || '', codigo, false, '',
    ]);
    criados.push({ id, codigo, nome: p.nome, email: p.email });
  }

  return { success: true, criados };
}

function listarParticipantes(data) {
  const { aplicacao_id } = data;
  if (!aplicacao_id) return { success: false, error: 'aplicacao_id obrigatório.' };

  const rows = sheetToObjects(getSheet('participantes'))
    .filter(r => r.aplicacao_id === aplicacao_id);

  return { success: true, participantes: rows };
}

function exportarParticipantesCSV(data) {
  const { aplicacao_id, base_url } = data;
  if (!aplicacao_id) return { success: false, error: 'aplicacao_id obrigatório.' };

  const rows = sheetToObjects(getSheet('participantes'))
    .filter(r => r.aplicacao_id === aplicacao_id);

  const linhas = [
    ['Nome', 'Email', 'Código', 'Link', 'Respondido'],
    ...rows.map(r => [
      r.nome,
      r.email,
      r.codigo,
      (base_url || '') + '?codigo=' + r.codigo,
      r.respondido ? 'Sim' : 'Não',
    ]),
  ];

  return { success: true, rows: linhas };
}

// ─────────────────────────────────────────────
// Dashboard (Etapa 3)
// ─────────────────────────────────────────────

const EIXOS = {
  'Clareza e Comunicação':    ['p1','p2','p3','p4'],
  'Tempo e Fluxo':            ['p5','p6','p7','p8'],
  'Postura de Atendimento':   ['p9','p10','p11','p12'],
  'Qualidade e Confiabilidade':['p13','p14','p15','p16'],
  'Proatividade':             ['p17','p18','p19','p20'],
  'Gentileza no Contato':     ['p21','p22','p23','p24'],
  'Equilíbrio Emocional':     ['p25','p26','p27','p28'],
  'Foco na Solução':          ['p29','p30','p31','p32'],
};

function getDashboardData(data) {
  const { empresa_id } = data;
  if (!empresa_id) return { success: false, error: 'empresa_id obrigatório.' };

  const empresa = getEmpresaById(empresa_id);
  if (!empresa) return { success: false, error: 'Empresa não encontrada.' };

  const aplicacoes = sheetToObjects(getSheet('aplicacoes'))
    .filter(a => a.empresa_id === empresa_id)
    .sort((a, b) => a.ordem - b.ordem);

  const respostas = sheetToObjects(getSheet('respostas'))
    .filter(r => r.empresa_id === empresa_id);

  const resultado = aplicacoes.map(ap => {
    const resp = respostas.filter(r => r.aplicacao_id === ap.id);
    if (resp.length === 0) return null;

    const eixos = {};
    for (const [nome, perguntas] of Object.entries(EIXOS)) {
      const vals = resp.flatMap(r => perguntas.map(p => Number(r[p])).filter(v => v > 0));
      eixos[nome] = vals.length > 0 ? parseFloat((vals.reduce((a,b)=>a+b,0) / vals.length).toFixed(2)) : null;
    }

    // Moda de p36
    const p36vals = resp.map(r => r['p36']).filter(Boolean);
    const posicionamento = moda(p36vals);

    // Médias de p37 por área
    const areas = parsearJSON(empresa.areas, []);
    const avaliacaoAreas = {};
    areas.forEach(area => {
      const vals = resp.map(r => {
        const p37 = parsearJSON(r['p37_json'], {});
        return Number(p37[area] || 0);
      }).filter(v => v > 0);
      avaliacaoAreas[area] = vals.length > 0
        ? parseFloat((vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(2))
        : null;
    });

    return {
      aplicacao_id:   ap.id,
      aplicacao_nome: ap.nome,
      aplicacao_ordem:ap.ordem,
      total_respondentes: resp.length,
      eixos,
      posicionamento,
      avaliacao_areas: avaliacaoAreas,
    };
  }).filter(Boolean);

  return {
    success: true,
    empresa: { nome: empresa.nome, areas: parsearJSON(empresa.areas, []) },
    aplicacoes: resultado,
  };
}

// ─────────────────────────────────────────────
// Links públicos (Etapa 4)
// ─────────────────────────────────────────────

function criarLinkPublico(data) {
  const { empresa_id, dias_validade } = data;
  if (!empresa_id) return { success: false, error: 'empresa_id obrigatório.' };

  const token    = generateToken();
  const now      = new Date();
  const expira   = dias_validade ? new Date(now.getTime() + dias_validade * 86400000).toISOString() : '';

  getSheet('links_publicos').appendRow([
    token, empresa_id, now.toISOString(), expira, true,
  ]);

  return { success: true, token };
}

function validarToken(data) {
  const { token } = data;
  if (!token) return { success: false, error: 'Token obrigatório.' };

  const rows = sheetToObjects(getSheet('links_publicos'));
  const link = rows.find(r => r.token === token);

  if (!link) return { success: false, error: 'Link inválido.' };
  if (!link.ativo || link.ativo === 'FALSE') return { success: false, error: 'Link desativado.' };
  if (link.expira_em && new Date(link.expira_em) < new Date()) {
    return { success: false, error: 'Link expirado.' };
  }

  return { success: true, empresa_id: link.empresa_id };
}

// ─────────────────────────────────────────────
// Utilitários internos
// ─────────────────────────────────────────────

function getEmpresaById(id) {
  const rows = sheetToObjects(getSheet('empresas'));
  return rows.find(r => r.id === id) || null;
}

function parsearJSON(str, fallback) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

function moda(arr) {
  if (!arr || arr.length === 0) return null;
  const freq = {};
  arr.forEach(v => { freq[v] = (freq[v] || 0) + 1; });
  return Object.entries(freq).sort((a,b) => b[1]-a[1])[0][0];
}

function generateToken() {
  return Utilities.base64Encode(
    Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      Utilities.getUuid() + Date.now()
    )
  ).replace(/[+/=]/g, '').slice(0, 40);
}

// ─────────────────────────────────────────────
// Setup inicial — rode UMA VEZ para criar as abas
// ─────────────────────────────────────────────

function setupPlanilha() {
  const ss = getSpreadsheet();

  const abas = {
    empresas: ['id','nome','areas','max_aplicacoes','criado_em'],
    aplicacoes: ['id','empresa_id','nome','ordem','criado_em'],
    participantes: ['id','aplicacao_id','empresa_id','nome','email','codigo','respondido','respondido_em'],
    respostas: [
      'id','participante_id','aplicacao_id','empresa_id',
      'p1','p2','p3','p4','p5','p6','p7','p8',
      'p9','p10','p11','p12','p13','p14','p15','p16',
      'p17','p18','p19','p20','p21','p22','p23','p24',
      'p25','p26','p27','p28','p29','p30','p31','p32',
      'p33','p34','p35','p36','p37_json','p38',
      'p_aberta_1','p_aberta_2','respondido_em',
    ],
    links_publicos: ['token','empresa_id','criado_em','expira_em','ativo'],
  };

  for (const [nome, headers] of Object.entries(abas)) {
    let sheet = ss.getSheetByName(nome);
    if (!sheet) {
      sheet = ss.insertSheet(nome);
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
  }

  Logger.log('✅ Planilha configurada com sucesso!');
}

// ─────────────────────────────────────────────
// Dados de teste — rode para popular respostas fictícias
// ─────────────────────────────────────────────

function criarRespostasTeste() {
  const empresas = sheetToObjects(getSheet('empresas'));
  const empresa  = empresas.find(e => e.nome === 'TESTE');
  if (!empresa) { Logger.log('Empresa TESTE não encontrada.'); return; }

  const areas = parsearJSON(empresa.areas, []);
  const participantes = sheetToObjects(getSheet('participantes'))
    .filter(p => p.empresa_id === empresa.id && !p.respondido);

  Logger.log('Participantes pendentes: ' + participantes.length);

  const p36opcoes = ['Apoio', 'Parceiro', 'Estratégico'];
  const bases     = [
    [4,3,4,5, 3,4,3,4, 5,4,4,3, 4,4,5,4, 3,4,3,4, 4,5,4,3, 4,3,4,4, 5,4,3,4],
    [3,4,3,4, 4,5,4,3, 4,3,5,4, 3,4,4,5, 4,3,4,5, 3,4,3,4, 5,4,3,4, 4,3,5,4],
    [5,4,5,4, 3,3,4,5, 4,5,3,4, 5,4,3,4, 5,4,5,3, 4,3,5,4, 3,5,4,4, 4,5,4,3],
  ];

  participantes.forEach((part, idx) => {
    const vals = bases[idx % bases.length];
    const respostas = {};
    for (let i = 1; i <= 32; i++) respostas['p' + i] = vals[i - 1];
    respostas.p33 = 4;
    respostas.p34 = 3 + (idx % 3);
    respostas.p35 = ['Analista', 'Coordenadora', 'Gestora'][idx % 3];
    respostas.p36 = p36opcoes[idx % p36opcoes.length];
    const p37 = {};
    areas.forEach((area, ai) => { p37[area] = 3 + ((idx + ai) % 3); });
    respostas.p37 = p37;
    respostas.p38 = '';
    respostas.p_aberta_1 = 'Boa comunicação e clareza nos processos.';
    respostas.p_aberta_2 = 'Melhorar o tempo de resposta das solicitações.';

    const r = salvarResposta({
      codigo:          part.codigo,
      participante_id: part.id,
      aplicacao_id:    part.aplicacao_id,
      empresa_id:      part.empresa_id,
      respostas,
    });
    Logger.log(part.nome + ': ' + JSON.stringify(r));
  });

  Logger.log('✅ Respostas de teste criadas!');
}
