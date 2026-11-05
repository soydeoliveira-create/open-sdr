-- Plataforma SDR da Open Soluções Tributárias
-- Rode este arquivo inteiro uma vez no SQL Editor de um projeto Supabase novo.
-- Não rode no projeto do Hub Comercial (comissoes-open-tributarias).

-- ---------------------------------------------------------------- acesso
create table public.membros (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  email     text not null,
  nome      text not null default '',
  papel     text not null default 'sdr' check (papel in ('gestao', 'sdr')),
  ativo     boolean not null default false,
  criado_em timestamptz not null default now()
);

create function public.eh_membro() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.membros m where m.user_id = auth.uid() and m.ativo);
$$;

create function public.eh_gestao() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.membros m
                 where m.user_id = auth.uid() and m.ativo and m.papel = 'gestao');
$$;

-- A primeira conta criada vira gestão. As seguintes ficam aguardando liberação.
create function public.ao_criar_usuario() returns trigger
language plpgsql security definer set search_path = '' as $$
declare primeiro boolean;
begin
  perform pg_advisory_xact_lock(727001);
  select not exists (select 1 from public.membros) into primeiro;
  insert into public.membros (user_id, email, nome, papel, ativo)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'nome', ''),
          case when primeiro then 'gestao' else 'sdr' end, primeiro);
  return new;
end $$;

create trigger ao_criar_usuario after insert on auth.users
  for each row execute function public.ao_criar_usuario();

-- Nunca deixa a plataforma sem ninguém da gestão.
create function public.protege_ultima_gestao() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.papel = 'gestao' and old.ativo and not (new.papel = 'gestao' and new.ativo)
     and not exists (select 1 from public.membros m
                     where m.user_id <> old.user_id and m.papel = 'gestao' and m.ativo) then
    raise exception 'A plataforma precisa de pelo menos uma pessoa da gestão ativa';
  end if;
  return new;
end $$;

create trigger protege_ultima_gestao before update on public.membros
  for each row execute function public.protege_ultima_gestao();

-- ---------------------------------------------------------------- cadastros
create table public.vendedoras (
  id        uuid primary key default gen_random_uuid(),
  nome      text not null check (btrim(nome) <> ''),
  telefone  text,
  email     text,
  ativa     boolean not null default true,
  criado_em timestamptz not null default now()
);

create table public.pracas (
  id           uuid primary key default gen_random_uuid(),
  nome         text not null unique check (btrim(nome) <> ''),
  ufs          text[] not null default '{}',
  vendedora_id uuid references public.vendedoras(id) on delete set null,
  ativa        boolean not null default true,
  criado_em    timestamptz not null default now()
);

-- ---------------------------------------------------------------- contatos
create table public.contatos (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null check (btrim(nome) <> ''),
  empresa         text,
  telefone        text,
  email           text,
  cidade          text,
  uf              text,
  origem          text not null default 'outro',
  interesse       text,
  observacoes     text,
  status          text not null default 'novo'
                  check (status in ('novo', 'atendimento', 'sem_retorno', 'encaminhado', 'descartado')),
  teve_retorno    boolean,
  avaliacao       text check (avaliacao in ('bom', 'medio', 'ruim')),
  retornar_em     date,
  motivo_descarte text,
  praca_id        uuid references public.pracas(id) on delete set null,
  vendedora_id    uuid references public.vendedoras(id) on delete restrict,
  encaminhado_em  timestamptz,
  encaminhado_por uuid references public.membros(user_id) on delete set null,
  criado_por      uuid default auth.uid() references public.membros(user_id) on delete set null,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  constraint contatos_tem_meio_de_contato
    check (nullif(btrim(telefone), '') is not null or nullif(btrim(email), '') is not null),
  constraint contatos_encaminhado_completo
    check (status <> 'encaminhado' or (vendedora_id is not null and avaliacao is not null)),
  constraint contatos_descarte_com_motivo
    check (status <> 'descartado' or motivo_descarte is not null)
);

create index contatos_criado_em_idx on public.contatos (criado_em desc);
create index contatos_status_idx on public.contatos (status);
create index contatos_vendedora_idx on public.contatos (vendedora_id);

create table public.interacoes (
  id         uuid primary key default gen_random_uuid(),
  contato_id uuid not null references public.contatos(id) on delete cascade,
  tipo       text not null check (tipo in ('ligacao', 'whatsapp', 'email', 'nota', 'sistema')),
  texto      text not null check (btrim(texto) <> ''),
  criado_por uuid default auth.uid() references public.membros(user_id) on delete set null,
  criado_em  timestamptz not null default now()
);

create index interacoes_contato_idx on public.interacoes (contato_id, criado_em desc);

-- Quem encaminhou, e quando, é carimbado no banco.
create function public.contato_carimbos() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.atualizado_em := now();
  if new.status = 'encaminhado' then
    if tg_op = 'INSERT' or old.status <> 'encaminhado'
       or old.vendedora_id is distinct from new.vendedora_id then
      new.encaminhado_em := now();
      new.encaminhado_por := auth.uid();
    end if;
  else
    new.vendedora_id := null;
    new.encaminhado_em := null;
    new.encaminhado_por := null;
  end if;
  return new;
end $$;

create trigger contato_carimbos before insert or update on public.contatos
  for each row execute function public.contato_carimbos();

-- O histórico de cada mudança é escrito aqui, não pela tela.
create function public.contato_historico() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  nome_status constant jsonb := '{"novo":"Novo","atendimento":"Em atendimento","sem_retorno":"Sem retorno","encaminhado":"Encaminhado","descartado":"Descartado"}';
  nome_avaliacao constant jsonb := '{"bom":"Bom","medio":"Médio","ruim":"Ruim"}';
  vendedora text;
begin
  if tg_op = 'INSERT' then
    insert into public.interacoes (contato_id, tipo, texto, criado_por)
    values (new.id, 'sistema', 'Contato cadastrado', auth.uid());
    return null;
  end if;

  if new.avaliacao is distinct from old.avaliacao then
    insert into public.interacoes (contato_id, tipo, texto, criado_por)
    values (new.id, 'sistema',
            'Avaliação: ' || coalesce(nome_avaliacao ->> new.avaliacao, 'sem avaliação'), auth.uid());
  end if;

  if new.vendedora_id is not null and new.vendedora_id is distinct from old.vendedora_id then
    select v.nome into vendedora from public.vendedoras v where v.id = new.vendedora_id;
    insert into public.interacoes (contato_id, tipo, texto, criado_por)
    values (new.id, 'sistema', 'Encaminhado para ' || vendedora, auth.uid());
  elsif new.status is distinct from old.status then
    insert into public.interacoes (contato_id, tipo, texto, criado_por)
    values (new.id, 'sistema',
            'Situação: ' || (nome_status ->> new.status)
            || case when new.status = 'descartado' then ' (' || new.motivo_descarte || ')' else '' end,
            auth.uid());
  end if;
  return null;
end $$;

create trigger contato_historico after insert or update on public.contatos
  for each row execute function public.contato_historico();

-- ---------------------------------------------------------------- regras de acesso
alter table public.membros    enable row level security;
alter table public.vendedoras enable row level security;
alter table public.pracas     enable row level security;
alter table public.contatos   enable row level security;
alter table public.interacoes enable row level security;

revoke all on public.membros, public.vendedoras, public.pracas, public.contatos, public.interacoes from anon;
revoke all on public.membros, public.vendedoras, public.pracas, public.contatos, public.interacoes from authenticated;
grant select, update                 on public.membros    to authenticated;
grant select, insert, update, delete on public.vendedoras to authenticated;
grant select, insert, update, delete on public.pracas     to authenticated;
grant select, insert, update, delete on public.contatos   to authenticated;
grant select, insert                 on public.interacoes to authenticated;

revoke execute on function public.eh_membro(), public.eh_gestao() from public, anon;
grant  execute on function public.eh_membro(), public.eh_gestao() to authenticated;
revoke execute on function public.ao_criar_usuario(), public.contato_historico() from public, anon, authenticated;

create policy membros_ler on public.membros for select to authenticated
  using (user_id = auth.uid() or public.eh_membro());
create policy membros_gestao on public.membros for update to authenticated
  using (public.eh_gestao()) with check (public.eh_gestao());

create policy vendedoras_ler on public.vendedoras for select to authenticated using (public.eh_membro());
create policy vendedoras_gestao on public.vendedoras for all to authenticated
  using (public.eh_gestao()) with check (public.eh_gestao());

create policy pracas_ler on public.pracas for select to authenticated using (public.eh_membro());
create policy pracas_gestao on public.pracas for all to authenticated
  using (public.eh_gestao()) with check (public.eh_gestao());

create policy contatos_ler on public.contatos for select to authenticated using (public.eh_membro());
create policy contatos_criar on public.contatos for insert to authenticated with check (public.eh_membro());
create policy contatos_editar on public.contatos for update to authenticated
  using (public.eh_membro()) with check (public.eh_membro());
create policy contatos_excluir on public.contatos for delete to authenticated using (public.eh_gestao());

create policy interacoes_ler on public.interacoes for select to authenticated using (public.eh_membro());
create policy interacoes_criar on public.interacoes for insert to authenticated
  with check (public.eh_membro() and tipo <> 'sistema' and criado_por = auth.uid());
