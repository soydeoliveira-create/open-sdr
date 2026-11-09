// Recebe os leads do RD Station Marketing (webhook de conversão) e cria os contatos no Hub SDR.
//
// Instalação no painel do Supabase:
//   1. Edge Functions > Deploy a new function > Via Editor, com o nome receber-rd. Cole este arquivo.
//   2. Desligue "Verify JWT" (Enforce JWT verification): o RD Station não envia login do Supabase.
//   3. Edge Functions > Secrets: crie RD_TOKEN com a senha combinada.
//   4. No RD Station, o endereço do webhook é
//      https://<projeto>.supabase.co/functions/v1/receber-rd?token=<RD_TOKEN>

type Lead = Record<string, any>;
type Contato = { id: string; telefone: string | null; email: string | null };
type Praca = { id: string; ufs: string[]; ativa: boolean };

export interface Banco {
  contatos(): Promise<Contato[]>;
  pracas(): Promise<Praca[]>;
  criarContato(dados: Record<string, unknown>): Promise<string>;
  anotar(contatoId: string, texto: string): Promise<void>;
}

const ESTADOS: Record<string, string> = {
  acre: 'AC', alagoas: 'AL', amapa: 'AP', amazonas: 'AM', bahia: 'BA', ceara: 'CE', 'distrito federal': 'DF',
  'espirito santo': 'ES', goias: 'GO', maranhao: 'MA', 'mato grosso': 'MT', 'mato grosso do sul': 'MS',
  'minas gerais': 'MG', para: 'PA', paraiba: 'PB', parana: 'PR', pernambuco: 'PE', piaui: 'PI',
  'rio de janeiro': 'RJ', 'rio grande do norte': 'RN', 'rio grande do sul': 'RS', rondonia: 'RO', roraima: 'RR',
  'santa catarina': 'SC', 'sao paulo': 'SP', sergipe: 'SE', tocantins: 'TO',
};
const UFS = new Set(Object.values(ESTADOS));

const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
export const digitos = (t: unknown) => {
  let d = String(t ?? '').replace(/\D/g, '');
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  return d;
};

export function uf(estado: unknown): string | null {
  const t = texto(estado);
  if (!t) return null;
  const sigla = t.toUpperCase();
  if (UFS.has(sigla)) return sigla;
  return ESTADOS[semAcento(t)] ?? null;
}

// Converte a origem da conversão do RD nas opções de "Como chegou" da plataforma.
export function origem(lead: Lead): string {
  const o = lead.last_conversion?.conversion_origin ?? lead.first_conversion?.conversion_origin ?? {};
  const canal = semAcento(String(o.channel ?? ''));
  const fonte = semAcento(`${o.source ?? ''} ${o.medium ?? ''}`);
  if (canal.startsWith('paid') || /\b(cpc|ppc|paid|pago)\b/.test(fonte)) return 'trafego';
  for (const rede of ['instagram', 'linkedin', 'youtube', 'whatsapp']) if (fonte.includes(rede)) return rede;
  return 'rdstation';
}

function descricao(lead: Lead): string {
  const c = lead.last_conversion ?? lead.first_conversion ?? {};
  const o = c.conversion_origin ?? {};
  const partes = [`Conversão no RD Station${texto(c.content?.identificador) ? `: ${c.content.identificador}` : ''}`];
  const caminho = [o.source, o.medium, o.campaign].map(texto).filter(Boolean).join(' / ');
  if (caminho) partes.push(`origem ${caminho}`);
  return partes.join(' · ');
}

export async function processar(corpo: unknown, banco: Banco) {
  const leads: Lead[] = Array.isArray((corpo as any)?.leads) ? (corpo as any).leads : [];
  const resultado = { criados: 0, atualizados: 0, ignorados: 0 };
  if (!leads.length) return resultado;
  const [existentes, pracas] = await Promise.all([banco.contatos(), banco.pracas()]);

  for (const lead of leads) {
    const email = texto(lead.email)?.toLowerCase() ?? null;
    const telefone = texto(lead.mobile_phone) ?? texto(lead.personal_phone);
    const tel = digitos(telefone);
    if (!email && tel.length < 8) { resultado.ignorados++; continue; }

    const repetido = existentes.find((c) =>
      (email && c.email?.toLowerCase().trim() === email) || (tel.length >= 8 && digitos(c.telefone) === tel));
    if (repetido) {
      await banco.anotar(repetido.id, `Converteu de novo. ${descricao(lead)}`);
      resultado.atualizados++;
      continue;
    }

    const sigla = uf(lead.state);
    const daUf = pracas.filter((p) => p.ativa && sigla && p.ufs.includes(sigla));
    const id = await banco.criarContato({
      nome: texto(lead.name) ?? email ?? telefone,
      empresa: texto(lead.company),
      telefone,
      email,
      cidade: texto(lead.city),
      uf: sigla,
      praca_id: daUf.length === 1 ? daUf[0].id : null,
      origem: origem(lead),
      criado_por: null,
    });
    await banco.anotar(id, descricao(lead));
    existentes.push({ id, telefone, email });
    resultado.criados++;
  }
  return resultado;
}

// ---------------------------------------------------------------- no Supabase
function bancoSupabase(url: string, chave: string): Banco {
  const cab: Record<string, string> = { apikey: chave, 'Content-Type': 'application/json' };
  if (chave.startsWith('eyJ')) cab.Authorization = `Bearer ${chave}`;
  const rest = async (caminho: string, init: RequestInit = {}) => {
    const r = await fetch(`${url}/rest/v1/${caminho}`, { ...init, headers: { ...cab, ...(init.headers ?? {}) } });
    if (!r.ok) throw new Error(`${caminho.split('?')[0]}: ${r.status} ${await r.text()}`);
    return r.status === 204 ? null : r.json();
  };
  const todos = async <T>(caminho: string): Promise<T[]> => {
    const linhas: T[] = [];
    for (let de = 0; ; de += 1000) {
      const parte = await rest(caminho, { headers: { Range: `${de}-${de + 999}` } }) as T[];
      linhas.push(...parte);
      if (parte.length < 1000) return linhas;
    }
  };
  return {
    contatos: () => todos<Contato>('contatos?select=id,telefone,email&order=criado_em'),
    pracas: () => todos<Praca>('pracas?select=id,ufs,ativa'),
    async criarContato(dados) {
      const [c] = await rest('contatos?select=id', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(dados) });
      return c.id;
    },
    async anotar(contatoId, texto) {
      await rest('interacoes', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ contato_id: contatoId, tipo: 'sistema', texto, criado_por: null }) });
    },
  };
}

const iguais = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};

if (typeof (globalThis as any).Deno !== 'undefined') {
  const Deno = (globalThis as any).Deno;
  Deno.serve(async (req: Request) => {
    const esperado = Deno.env.get('RD_TOKEN') ?? '';
    const token = new URL(req.url).searchParams.get('token') ?? '';
    if (!esperado || !iguais(token, esperado)) return new Response('não autorizado', { status: 401 });
    if (req.method !== 'POST') return new Response('use POST', { status: 405 });
    const chave = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SDR_SECRET_KEY') || '';
    try {
      const corpo = await req.json();
      const r = await processar(corpo, bancoSupabase(Deno.env.get('SUPABASE_URL'), chave));
      console.log('RD Station', JSON.stringify(r));
      return Response.json(r);
    } catch (e) {
      console.error('RD Station', e);
      return new Response('erro ao gravar', { status: 500 });
    }
  });
}
