// Banco de mentira, só para ver a plataforma no computador, sem Supabase.
// Guarda no localStorage e imita os gatilhos e as restrições de supabase.sql.
(function () {
  window.__MOCK = true;
  const CHAVE = 'open-sdr-mock';
  const uid = () => crypto.randomUUID();
  const agora = () => new Date().toISOString();
  const atras = n => new Date(Date.now() - n * 864e5).toISOString();
  function semente() {
    const g = 'u-gestao', s = 'u-sdr', v1 = uid(), v2 = uid(), p1 = uid(), p2 = uid();
    const c = (nome, x) => ({ id: uid(), nome, empresa: null, telefone: null, email: null, cidade: null, uf: null, origem: 'site', interesse: null, observacoes: null, status: 'novo', teve_retorno: null, avaliacao: null, retornar_em: null, motivo_descarte: null, praca_id: null, vendedora_id: null, encaminhado_em: null, encaminhado_por: null, criado_por: s, criado_em: agora(), atualizado_em: agora(), ...x });
    return {
      sessao: null,
      contas: [{ id: g, email: 'gestao@teste.local', senha: 'teste123' }, { id: s, email: 'sdr@teste.local', senha: 'teste123' }],
      membros: [{ user_id: g, email: 'gestao@teste.local', nome: 'Gestão (exemplo)', papel: 'gestao', ativo: true, criado_em: atras(30) }, { user_id: s, email: 'sdr@teste.local', nome: 'SDR (exemplo)', papel: 'sdr', ativo: true, criado_em: atras(20) }],
      vendedoras: [{ id: v1, nome: 'Vendedora Exemplo A', telefone: '(11) 90000-0001', email: null, ativa: true, criado_em: atras(20) }, { id: v2, nome: 'Vendedora Exemplo B', telefone: '(31) 90000-0002', email: null, ativa: true, criado_em: atras(20) }],
      pracas: [{ id: p1, nome: 'Praça Sudeste', ufs: ['SP', 'RJ'], vendedora_id: v1, ativa: true, criado_em: atras(20) }, { id: p2, nome: 'Praça Minas', ufs: ['MG'], vendedora_id: v2, ativa: true, criado_em: atras(20) }],
      contatos: [
        c('Cliente Exemplo 1', { empresa: 'Empresa Exemplo Ltda', telefone: '(11) 90000-1111', cidade: 'São Paulo', uf: 'SP', praca_id: p1, origem: 'instagram', interesse: 'consultoria', observacoes: 'Quer revisar créditos tributários.' }),
        c('Cliente Exemplo 2', { telefone: '(31) 90000-2222', cidade: 'Belo Horizonte', uf: 'MG', praca_id: p2, status: 'sem_retorno', teve_retorno: false, retornar_em: atras(2).slice(0, 10), criado_em: atras(4) }),
        c('Cliente Exemplo 3', { empresa: 'Prefeitura Exemplo', email: 'contato@exemplo.test', cidade: 'Campinas', uf: 'SP', praca_id: p1, origem: 'indicacao', interesse: 'publicos', status: 'encaminhado', teve_retorno: true, avaliacao: 'bom', vendedora_id: v1, encaminhado_em: atras(1), encaminhado_por: s, criado_em: atras(3) }),
      ],
      interacoes: [],
    };
  }
  let db = JSON.parse(localStorage.getItem(CHAVE) || 'null') || semente();
  const gravar = () => localStorage.setItem(CHAVE, JSON.stringify(db));
  const log = (id, texto) => db.interacoes.push({ id: uid(), contato_id: id, tipo: 'sistema', texto, criado_por: db.sessao?.user.id, criado_em: agora() });
  const NS = { novo: 'Novo', atendimento: 'Em atendimento', sem_retorno: 'Sem retorno', encaminhado: 'Encaminhado', descartado: 'Descartado' };
  const NA = { bom: 'Bom', medio: 'Médio', ruim: 'Ruim' };
  function contato(n, o) {
    if (!n.nome?.trim()) throw new Error('nome obrigatório');
    if (!n.telefone?.trim() && !n.email?.trim()) throw new Error('contatos_tem_meio_de_contato');
    n.atualizado_em = agora();
    if (n.status === 'encaminhado') {
      if (!o || o.status !== 'encaminhado' || o.vendedora_id !== n.vendedora_id) { n.encaminhado_em = agora(); n.encaminhado_por = db.sessao?.user.id; }
    } else { n.vendedora_id = null; n.encaminhado_em = null; n.encaminhado_por = null; }
    if (n.status === 'encaminhado' && (!n.vendedora_id || !n.avaliacao)) throw new Error('contatos_encaminhado_completo');
    if (n.status === 'descartado' && !n.motivo_descarte) throw new Error('contatos_descarte_com_motivo');
    if (!o) return log(n.id, 'Contato cadastrado');
    if (n.avaliacao !== o.avaliacao) log(n.id, 'Avaliação: ' + (NA[n.avaliacao] || 'sem avaliação'));
    if (n.vendedora_id && n.vendedora_id !== o.vendedora_id) log(n.id, 'Encaminhado para ' + db.vendedoras.find(v => v.id === n.vendedora_id).nome);
    else if (n.status !== o.status) log(n.id, 'Situação: ' + NS[n.status] + (n.status === 'descartado' ? ` (${n.motivo_descarte})` : ''));
  }
  class Q {
    constructor(t) { this.t = t; this.op = 'select'; this.f = []; }
    select() { return this; }
    insert(d) { this.op = 'insert'; this.d = d; return this; }
    update(d) { this.op = 'update'; this.d = d; return this; }
    delete() { this.op = 'delete'; return this; }
    eq(k, v) { this.f.push([k, v]); return this; }
    order(k, o) { this.o = [k, o.ascending]; return this; }
    range(a, b) { this.r = [a, b]; return this; }
    single() { this.um = true; return this; }
    maybeSingle() { this.um = true; this.talvez = true; return this; }
    executar() {
      const casa = x => this.f.every(([k, v]) => x[k] === v);
      const tab = db[this.t]; let out;
      if (this.op === 'insert') {
        const n = { id: uid(), criado_em: agora(), ...(this.t === 'contatos' ? { status: 'novo', criado_por: db.sessao?.user.id, praca_id: null, vendedora_id: null, teve_retorno: null, avaliacao: null, retornar_em: null, motivo_descarte: null } : {}), ...(this.t === 'vendedoras' || this.t === 'pracas' ? { ativa: true } : {}), ...this.d };
        if (this.t === 'pracas' && tab.some(p => p.nome === n.nome)) throw new Error('pracas_nome_key');
        if (this.t === 'contatos') contato(n);
        tab.push(n); out = [n];
      } else if (this.op === 'update') {
        out = tab.filter(casa).map(x => { const n = { ...x, ...this.d }; if (this.t === 'contatos') contato(n, x); Object.assign(x, n); return x; });
      } else if (this.op === 'delete') {
        db[this.t] = tab.filter(x => !casa(x)); out = [];
        if (this.t === 'contatos') db.interacoes = db.interacoes.filter(i => db.contatos.some(c => c.id === i.contato_id));
      } else {
        out = tab.filter(casa);
        if (this.o) { const [k, asc] = this.o; out = [...out].sort((a, b) => String(a[k]).localeCompare(String(b[k])) * (asc ? 1 : -1)); }
        if (this.r) out = out.slice(this.r[0], this.r[1] + 1);
      }
      gravar();
      if (this.um) { if (!out.length && !this.talvez) throw new Error('nenhuma linha'); return out[0] ?? null; }
      return out;
    }
    then(ok, erro) {
      let r; try { r = { data: this.executar(), error: null }; } catch (e) { r = { data: null, error: { message: e.message } }; }
      return Promise.resolve(r).then(ok, erro);
    }
  }
  window.supabase = {
    createClient: () => ({
      from: t => new Q(t),
      auth: {
        getSession: async () => ({ data: { session: db.sessao } }),
        signInWithPassword: async ({ email, password }) => {
          const c = db.contas.find(x => x.email === email && x.senha === password);
          if (!c) return { data: {}, error: { message: 'Invalid login credentials' } };
          db.sessao = { user: { id: c.id, email } }; gravar();
          return { data: { session: db.sessao }, error: null };
        },
        signUp: async ({ email, password, options }) => {
          if (db.contas.some(x => x.email === email)) return { data: {}, error: { message: 'User already registered' } };
          const id = uid(); db.contas.push({ id, email, senha: password });
          db.membros.push({ user_id: id, email, nome: options?.data?.nome || '', papel: 'sdr', ativo: false, criado_em: agora() });
          db.sessao = { user: { id, email } }; gravar();
          return { data: { session: db.sessao }, error: null };
        },
        signOut: async () => { db.sessao = null; gravar(); return { error: null }; },
      },
    }),
  };
})();
