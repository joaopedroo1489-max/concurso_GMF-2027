"use strict";
/* ===== CONFIGURAÇÃO (preencha estas três linhas) ===== */
const CONFIG = {
  API_KEY: "",          // chave da API do Google (Drive API ativada)
  ROOT_FOLDER_ID: "",   // ID da pasta raiz no Drive: Raiz / Semestre / Cadeira / arquivos
  CLIENT_ID: "",        // opcional: ID do cliente OAuth Web, só para enviar arquivos pelo site
  REFRESH_MS: 60000     // atualização automática do Drive
};

const $ = s => document.querySelector(s);
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const norm = s => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const uid = () => Math.random().toString(36).slice(2, 9);
const todayISO = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const fmt = s => { const d = new Date(s.length === 10 ? s + "T12:00:00" : s); return isNaN(d) ? "" : d.toLocaleDateString("pt-BR"); };

let S = null;
try { S = JSON.parse(localStorage.getItem("caderno1")); } catch (e) {}
if (!S || !Array.isArray(S.sem) || !Array.isArray(S.reg)) S = { sem: [], reg: [] };
function migrate() {
  S.log = S.log || []; S.meta = S.meta || 10;
  S.reg.forEach(r => { if (!r.revs) r.revs = r.rev === false ? [1, 1, 1, 1] : [0, 0, 0, 0]; });
  S.sem.forEach(s => s.cad.forEach(c => { c.top = c.top || []; }));
}
migrate();
const save = () => { try { localStorage.setItem("caderno1", JSON.stringify(S)); } catch (e) {} };

let sel = null, term = "", tree = { files: [], folders: [] }, drvErr = "", token = null;

const find = id => { for (const s of S.sem) { const c = s.cad.find(x => x.id === id); if (c) return { s, c }; } return null; };
const status = t => { $("#sync").textContent = t; };

/* ===== DRIVE (leitura com chave de API, sem backend) ===== */
async function listFolder(id) {
  const out = []; let pt = "";
  do {
    const u = new URL("https://www.googleapis.com/drive/v3/files");
    u.searchParams.set("q", "'" + id + "' in parents and trashed=false");
    u.searchParams.set("fields", "nextPageToken,files(id,name,mimeType,webViewLink,modifiedTime,size)");
    u.searchParams.set("pageSize", "1000");
    u.searchParams.set("key", CONFIG.API_KEY);
    if (pt) u.searchParams.set("pageToken", pt);
    const r = await fetch(u);
    if (!r.ok) throw new Error("erro " + r.status);
    const j = await r.json(); out.push(...j.files); pt = j.nextPageToken || "";
  } while (pt);
  return out;
}

async function loadDrive() {
  if (!CONFIG.API_KEY || !CONFIG.ROOT_FOLDER_ID) {
    drvErr = "Para ver os arquivos do Drive, preencha API_KEY e ROOT_FOLDER_ID no início do arquivo app.js.";
    status("Drive não configurado"); return renderFiles();
  }
  try {
    const files = [], folders = []; let level = [{ id: CONFIG.ROOT_FOLDER_ID, path: [] }];
    while (level.length) {
      const res = await Promise.all(level.map(n => listFolder(n.id))); const next = [];
      res.forEach((items, i) => items.forEach(f => {
        if (f.mimeType === "application/vnd.google-apps.folder") { const n = { id: f.id, path: [...level[i].path, f.name] }; folders.push(n); next.push(n); }
        else files.push({ ...f, path: level[i].path });
      }));
      level = next;
    }
    tree = { files, folders }; drvErr = "";
    status("Drive atualizado às " + new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }));
  } catch (e) {
    drvErr = "Não foi possível ler o Drive (" + e.message + "). Confira a chave, o ID da pasta e se ela está compartilhada para quem tem o link.";
    status("Falha ao atualizar o Drive");
  }
  renderFiles();
}

const filesOf = (s, c) => tree.files.filter(f => norm(f.path[0] || "") === norm(s.nome) && norm(f.path[1] || "") === norm(c.nome))
  .sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
const fileRow = f => '<a class="file" href="' + esc(f.webViewLink) + '" target="_blank" rel="noopener"><b>' + esc(f.name) + "</b><small>" +
  esc(f.path.join(" / ")) + " · " + fmt(f.modifiedTime) + "</small></a>";

/* ===== UPLOAD (opcional, login Google no navegador) ===== */
function getToken() {
  return new Promise((res, rej) => {
    if (token) return res(token);
    const go = () => google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.CLIENT_ID, scope: "https://www.googleapis.com/auth/drive.file",
      callback: r => { if (r.access_token) { token = r.access_token; setTimeout(() => { token = null; }, 3300000); res(token); } else rej(new Error("login cancelado")); }
    }).requestAccessToken();
    if (window.google && google.accounts) return go();
    const sc = document.createElement("script"); sc.src = "https://accounts.google.com/gsi/client";
    sc.onload = go; sc.onerror = () => rej(new Error("login do Google indisponível")); document.head.appendChild(sc);
  });
}
async function folderFor(path, t) {
  let parent = CONFIG.ROOT_FOLDER_ID;
  for (let i = 0; i < path.length; i++) {
    const key = path.slice(0, i + 1).map(norm).join("/");
    let f = tree.folders.find(x => x.path.map(norm).join("/") === key);
    if (!f) {
      const r = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", { method: "POST",
        headers: { Authorization: "Bearer " + t, "Content-Type": "application/json" },
        body: JSON.stringify({ name: path[i], mimeType: "application/vnd.google-apps.folder", parents: [parent] }) });
      if (!r.ok) throw new Error("criar pasta " + r.status);
      f = { id: (await r.json()).id, path: path.slice(0, i + 1) }; tree.folders.push(f);
    }
    parent = f.id;
  }
  return parent;
}
async function upload(list) {
  const x = find(sel); if (!x) return;
  try {
    status("Enviando…"); const t = await getToken(); const parent = await folderFor([x.s.nome, x.c.nome], t);
    for (const file of list) {
      const fd = new FormData();
      fd.append("metadata", new Blob([JSON.stringify({ name: file.name, parents: [parent] })], { type: "application/json" }));
      fd.append("file", file);
      const r = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", { method: "POST", headers: { Authorization: "Bearer " + t }, body: fd });
      if (!r.ok) throw new Error("envio " + r.status);
    }
    await loadDrive();
  } catch (e) { status("Falha no envio: " + e.message); }
}

/* ===== PDF DE REVISÃO (impressão do navegador, sem biblioteca) ===== */
function makePdf(title, regs) {
  if (!regs.length) return status("Nada para exportar.");
  const css = "body{font:12pt/1.5 Georgia,serif;color:#111;margin:24px}h1{font-size:20pt;margin:0}h2{font-size:14pt;margin:20px 0 2px;border-bottom:1px solid #888}h4{margin:10px 0 2px}.m{color:#555;font-size:10pt}pre{white-space:pre-wrap;font:inherit;margin:0}.q{background:#eee;padding:6px 12px;margin-top:10px}li{margin:3px 0}";
  const body = regs.map(r => "<h2>" + esc(r.titulo) + '</h2><div class="m">' + fmt(r.data) + "</div>" +
    (r.resumo ? "<h4>Resumo</h4><pre>" + esc(r.resumo) + "</pre>" : "") +
    (r.aprof ? "<h4>Aprofundamento</h4><pre>" + esc(r.aprof) + "</pre>" : "") +
    (r.perg ? '<div class="q"><b>Perguntas de revisão</b><ol>' + r.perg.split("\n").filter(Boolean).map(p => "<li>" + esc(p) + "</li>").join("") + "</ol></div>" : "")).join("");
  const fr = document.createElement("iframe"); fr.style.cssText = "position:fixed;width:0;height:0;border:0";
  document.body.appendChild(fr); const d = fr.contentDocument; d.open();
  d.write("<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>" + esc(title) + "</title><style>" + css + "</style></head><body><h1>" + esc(title) + '</h1><div class="m">Gerado em ' + fmt(todayISO()) + "</div>" + body + "</body></html>");
  d.close();
  setTimeout(() => { fr.contentWindow.focus(); fr.contentWindow.print(); setTimeout(() => fr.remove(), 3000); }, 300);
}

/* ===== ESTUDO: ajudantes ===== */
const OFF = [1, 7, 15, 30];
const addD = (s, n) => { const d = new Date(s + "T12:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const nextRev = r => { const k = r.revs.indexOf(0); return k < 0 ? null : { k, dt: addD(r.data, OFF[k]) }; };
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
const hm = m => Math.floor(m / 60) + "h" + String(m % 60).padStart(2, "0");
const STL = ["Não iniciado", "Estudando", "Concluído"];
const accCls = a => a == null ? "" : a >= 70 ? "ok" : a >= 50 ? "mid" : "low";
function stats(c) {
  const top = c.top || [], lg = S.log.filter(l => l.cad === c.id);
  const q = lg.reduce((a, l) => a + l.qr, 0), ac = lg.reduce((a, l) => a + l.qc, 0);
  return { done: top.filter(t => t.st === 2).length, tot: top.length, q, ac, acc: q ? pct(ac, q) : null, min: lg.reduce((a, l) => a + l.min, 0), lg };
}
const prog = (p, c) => '<div class="pb"><i class="' + (c || "") + '" style="width:' + Math.min(100, p) + '%"></i></div>';

/* ===== FORMULÁRIOS ===== */
function ask(title, fields, cb) {
  const f = $("#frm");
  f.innerHTML = "<h3>" + esc(title) + "</h3>" + fields.map(x => "<label>" + esc(x.l) + (x.t === "area"
    ? '<textarea name="' + x.k + '" rows="' + (x.r || 4) + '">' + esc(x.v || "") + "</textarea>"
    : x.t === "sel" ? '<select name="' + x.k + '">' + x.o.map(o => '<option value="' + o[0] + '">' + esc(o[1]) + "</option>").join("") + "</select>"
    : '<input name="' + x.k + '" type="' + (x.t || "text") + '" value="' + esc(x.v == null ? "" : x.v) + '"' + (x.req ? " required" : "") + (x.t === "number" ? ' min="0"' : "") + ">") + "</label>").join("") +
    '<div class="act"><button value="x" formnovalidate class="ghost">Cancelar</button><button value="ok" class="pri">Salvar</button></div>';
  f.onsubmit = e => { if (e.submitter && e.submitter.value === "ok") cb(Object.fromEntries(new FormData(f))); };
  $("#dlg").showModal();
}
function regForm(r) {
  r = r || {};
  ask(r.id ? "Editar registro" : "Novo registro de aula", [
    { k: "titulo", l: "Assunto", v: r.titulo, req: 1 }, { k: "data", l: "Data de estudo (as revisões partem dela)", t: "date", v: r.data || todayISO(), req: 1 },
    { k: "resumo", l: "Resumo do que foi visto", t: "area", r: 4, v: r.resumo },
    { k: "aprof", l: "Aprofundamento para estudo futuro", t: "area", r: 7, v: r.aprof },
    { k: "perg", l: "Perguntas de revisão (uma por linha)", t: "area", r: 4, v: r.perg }
  ], o => { if (r.id) Object.assign(r, o); else S.reg.push({ id: uid(), cad: sel, revs: [0, 0, 0, 0], ...o }); save(); render(); });
}
function sessForm() {
  const cs = []; S.sem.forEach(s => s.cad.forEach(c => cs.push([c.id, s.nome + " / " + c.nome])));
  if (!cs.length) return status("Crie uma cadeira primeiro.");
  const f = [{ k: "data", l: "Data", t: "date", v: todayISO(), req: 1 }, { k: "min", l: "Minutos estudados", t: "number", req: 1 }, { k: "qr", l: "Questões resolvidas", t: "number", v: 0 }, { k: "qc", l: "Acertos nas questões", t: "number", v: 0 }];
  if (!find(sel)) f.unshift({ k: "cad", l: "Cadeira", t: "sel", o: cs });
  ask("Registrar sessão de estudo", f, o => {
    const qr = +o.qr || 0, qc = +o.qc || 0;
    if (qc > qr) return status("Acertos não pode passar de questões resolvidas.");
    S.log.push({ id: uid(), cad: o.cad || sel, data: o.data, min: +o.min || 0, qr, qc }); save(); render();
  });
}

/* ===== TELAS ===== */
function renderSide() {
  $("#side").innerHTML = '<a href="#" class="cad' + (sel === "hoje" ? " on" : "") + '" data-a="open" data-id="hoje"><b>Hoje</b></a><a href="#" class="cad' + (sel === "semana" ? " on" : "") + '" data-a="open" data-id="semana"><b>Semana</b></a>' +
    S.sem.map(s => '<section><div class="sh"><b>' + esc(s.nome) + '</b><button class="ghost" data-a="addCad" data-id="' + s.id + '" title="Nova cadeira">+</button></div>' +
      s.cad.map(c => { const t = stats(c); return '<a href="#" class="cad' + (c.id === sel ? " on" : "") + '" data-a="open" data-id="' + c.id + '">' + esc(c.nome) + "<small>" + (t.tot ? pct(t.done, t.tot) + "%" : "") + "</small></a>"; }).join("") + "</section>").join("") +
    '<button class="ghost wide" data-a="addSem">Novo semestre</button><div class="tools"><button class="ghost" data-a="bk">Exportar backup</button><label class="ghost">Importar<input type="file" id="imp" accept=".json" hidden></label></div>';
}
function regCard(r) {
  const td = todayISO(), n = nextRev(r), blk = (t, v) => v ? "<h4>" + t + "</h4><pre>" + esc(v) + "</pre>" : "";
  const chips = OFF.map((o, k) => { const d = addD(r.data, o); return '<span class="chip ' + (r.revs[k] ? "done" : d <= td ? "late" : "") + '">R' + (k + 1) + " " + fmt(d) + "</span>"; }).join("");
  return '<details class="reg"><summary><span class="t">' + esc(r.titulo) + '</span><span class="d">' + fmt(r.data) + "</span>" + (n && n.dt <= td ? "<mark>Revisar</mark>" : "") + '</summary><div class="chips">' + chips + "</div>" +
    blk("Resumo", r.resumo) + blk("Aprofundamento", r.aprof) + blk("Perguntas de revisão", r.perg) +
    '<div class="act">' + (n ? '<button class="ghost" data-a="rv" data-id="' + r.id + '" data-k="' + n.k + '">Revisei (R' + (n.k + 1) + ")</button>" : "") +
    '<button class="ghost" data-a="edit" data-id="' + r.id + '">Editar</button><button class="ghost" data-a="del" data-id="' + r.id + '">Excluir</button></div></details>';
}
function why(o) {
  if (o.st.acc != null && o.st.acc < 70) return "acerto de " + o.st.acc + "%: reforçar com questões";
  if (o.days == null) return "ainda sem sessões registradas";
  if (o.days >= 7) return "sem estudo há " + o.days + " dias";
  if (o.st.tot) return pct(o.st.done, o.st.tot) + "% da ementa concluída";
  return "adicione os assuntos da ementa";
}
function hojeBase() {
  if (!S.sem.some(s => s.cad.length)) return '<div class="empty"><h2>Comece pelo primeiro semestre</h2><p>Crie o semestre e as cadeiras. Depois liste os assuntos da ementa de cada uma: é com eles que o painel diz o que estudar e o que revisar.</p><button class="pri" data-a="addSem">Novo semestre</button></div>';
  const td = todayISO(), due = [];
  S.reg.forEach(r => { const n = nextRev(r); if (n && n.dt <= td) due.push({ r, n, x: find(r.cad) }); });
  due.sort((a, b) => a.n.dt < b.n.dt ? -1 : 1);
  const wk = S.log.filter(l => l.data >= addD(td, -6)), min = wk.reduce((a, l) => a + l.min, 0), qr = wk.reduce((a, l) => a + l.qr, 0), qc = wk.reduce((a, l) => a + l.qc, 0), acc = qr ? pct(qc, qr) : null;
  const cs = [];
  S.sem.forEach(s => s.cad.forEach(c => {
    const st = stats(c), ds = st.lg.map(l => l.data).sort(), last = ds[ds.length - 1], days = last ? Math.round((Date.parse(td) - Date.parse(last)) / 864e5) : null;
    const sc = (st.tot ? 100 - pct(st.done, st.tot) : 50) / 2 + (st.acc != null && st.acc < 70 ? 70 - st.acc : 0) + (days == null ? 25 : Math.min(days, 30));
    cs.push({ s, c, st, days, sc });
  }));
  cs.sort((a, b) => b.sc - a.sc);
  const nxt = []; cs.slice(0, 4).forEach(o => { const t = (o.c.top || []).find(t => t.st < 2); if (t) nxt.push({ o, t }); });
  return '<div class="head"><div><p>' + new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" }) + "</p><h2>Hoje</h2></div><div class=\"bar\"><button class=\"pri\" data-a=\"sess\">Registrar sessão</button></div></div>" +
    '<div class="kpis"><div class="panel"><p class="k">Horas nos últimos 7 dias</p><div class="big">' + hm(min) + '</div>' + prog(pct(min, S.meta * 60)) + '<button class="ghost" data-a="meta">Meta: ' + S.meta + " h</button></div>" +
    '<div class="panel"><p class="k">Questões em 7 dias</p><div class="big">' + qr + '</div><p class="k">' + qc + " acertos</p></div>" +
    '<div class="panel"><p class="k">Acerto em 7 dias</p><div class="big ' + accCls(acc) + '">' + (acc == null ? "—" : acc + "%") + '</div><p class="k">meta: 70% ou mais</p></div></div>' +
    '<div class="cols"><div class="panel"><h3>Revisões para hoje (' + due.length + ")</h3>" +
    (due.map(d => '<div class="line"><span><b>' + esc(d.r.titulo) + "</b><small>" + (d.x ? esc(d.x.c.nome) : "") + " · R" + (d.n.k + 1) + (d.n.dt < td ? " atrasada desde " + fmt(d.n.dt) : "") + '</small></span><button class="ghost" data-a="rv" data-id="' + d.r.id + '" data-k="' + d.n.k + '">Revisei</button></div>').join("") || '<div class="msg">Nenhuma revisão pendente. As próximas aparecem depois de registrar aulas.</div>') +
    '</div><div class="panel"><h3>Onde focar</h3>' + cs.slice(0, 3).map(o => '<div class="line"><span><b>' + esc(o.c.nome) + "</b><small>" + esc(why(o)) + '</small></span><a href="#" class="ghost" data-a="open" data-id="' + o.c.id + '">Abrir</a></div>').join("") + "</div></div>" +
    '<div class="panel"><h3>Próximos assuntos da ementa</h3>' + (nxt.map(n => '<div class="line"><span><b>' + esc(n.t.nome) + "</b><small>" + esc(n.o.c.nome) + '</small></span><button class="st st' + n.t.st + '" data-a="st" data-id="' + n.t.id + '">' + STL[n.t.st] + "</button></div>").join("") || '<div class="msg">Adicione os assuntos da ementa em cada cadeira para receber sugestões.</div>') + "</div>";
}
function cadView(x) {
  const c = x.c, st = stats(x.c), td = todayISO();
  const regs = S.reg.filter(r => r.cad === c.id).sort((a, b) => b.data.localeCompare(a.data));
  const sess = st.lg.slice().sort((a, b) => b.data.localeCompare(a.data)).slice(0, 5);
  return '<div class="head"><div><p>' + esc(x.s.nome) + "</p><h2>" + esc(c.nome) + '</h2></div><div class="bar"><button class="pri" data-a="sess">Registrar sessão</button><button class="ghost" data-a="newReg">Novo registro</button><button class="ghost" data-a="pdfAll">PDF completo</button><button class="ghost" data-a="pdfRev">PDF de revisão</button>' + (CONFIG.CLIENT_ID ? '<button class="ghost" data-a="upBtn">Enviar arquivos</button>' : "") + '</div></div>' +
    '<div class="cols"><div><div class="panel"><h3>Ementa: ' + st.done + "/" + st.tot + " concluídos</h3>" + prog(pct(st.done, st.tot)) +
    (c.top || []).map(t => '<div class="line"><span>' + esc(t.nome) + '</span><span class="rt"><button class="st st' + t.st + '" data-a="st" data-id="' + t.id + '">' + STL[t.st] + '</button><button class="ghost" data-a="delTop" data-id="' + t.id + '" aria-label="Remover">×</button></span></div>').join("") +
    '<div class="act"><button class="ghost" data-a="addTop">Adicionar assuntos</button></div></div>' +
    '<div class="panel"><h3>Aulas registradas (' + regs.length + ")</h3>" + (regs.map(regCard).join("") || '<div class="msg">Registre cada aula para gerar as revisões de 1, 7, 15 e 30 dias.</div>') + "</div></div>" +
    '<div><div class="panel"><h3>Desempenho</h3><div class="line"><span>Tempo estudado</span><b>' + hm(st.min) + '</b></div><div class="line"><span>Questões</span><b>' + st.q + '</b></div><div class="line"><span>Acerto</span><b class="' + accCls(st.acc) + '">' + (st.acc == null ? "—" : st.acc + "%") + "</b></div>" + (st.acc != null ? prog(st.acc, accCls(st.acc)) : "") +
    sess.map(l => '<div class="line"><small>' + fmt(l.data) + "</small><small>" + hm(l.min) + " · " + l.qc + "/" + l.qr + "</small></div>").join("") + '</div><div class="panel"><h3>Arquivos de apoio</h3><div id="files"></div></div></div></div>';
}
function renderMain() {
  const m = $("#main");
  if (term) {
    const t = norm(term);
    const rs = S.reg.filter(r => norm([r.titulo, r.resumo, r.aprof, r.perg].join(" ")).includes(t));
    const ts = []; S.sem.forEach(s => s.cad.forEach(c => (c.top || []).forEach(p => { if (norm(p.nome).includes(t)) ts.push({ c, p }); })));
    const fs = tree.files.filter(f => norm(f.name + " " + f.path.join(" ")).includes(t));
    m.innerHTML = '<div class="head"><h2>Resultados para “' + esc(term) + "”</h2></div>" +
      '<div class="cols"><div class="panel"><h3>Assuntos (' + (rs.length + ts.length) + ")</h3>" +
      (ts.map(o => '<a class="file" href="#" data-a="open" data-id="' + o.c.id + '"><b>' + esc(o.p.nome) + "</b><small>Ementa · " + esc(o.c.nome) + " · " + STL[o.p.st] + "</small></a>").join("") +
      rs.map(r => { const x = find(r.cad); return '<a class="file" href="#" data-a="open" data-id="' + r.cad + '"><b>' + esc(r.titulo) + "</b><small>" + (x ? esc(x.s.nome + " / " + x.c.nome) : "") + " · " + fmt(r.data) + "</small></a>"; }).join("") || '<div class="msg">Nenhum assunto encontrado.</div>') +
      '</div><div class="panel"><h3>Arquivos (' + fs.length + ")</h3>" + (fs.slice(0, 60).map(fileRow).join("") || '<div class="msg">Nenhum arquivo encontrado.</div>') + "</div></div>";
    return;
  }
  const x = find(sel);
  m.innerHTML = x ? cadView(x) : sel === "semana" ? semana() : hoje();
  renderFiles();
}
function renderFiles() {
  const box = $("#files"); if (!box || term) return;
  const x = find(sel); if (!x) return;
  const fs = filesOf(x.s, x.c);
  box.innerHTML = drvErr ? '<div class="msg err">' + esc(drvErr) + "</div>" : (fs.map(fileRow).join("") || '<div class="msg">Sem arquivos. Coloque-os na pasta “' + esc(x.s.nome + " / " + x.c.nome) + '” do Drive.</div>');
}
function render() { renderSide(); renderMain(); }

/* ===== EVENTOS ===== */
document.addEventListener("click", e => {
  const b = e.target.closest("[data-a]"); if (!b) return;
  e.preventDefault(); const a = b.dataset.a, id = b.dataset.id, x = find(sel);
  const topOf = i => { for (const s of S.sem) for (const c of s.cad) { const p = (c.top || []).find(t => t.id === i); if (p) return { c, p }; } return null; };
  if (a === "open") { sel = id; term = ""; $("#q").value = ""; render(); }
  else if (a === "addSem") ask("Novo semestre", [{ k: "nome", l: "Nome (ex.: 1º semestre)", req: 1 }], o => { S.sem.push({ id: uid(), nome: o.nome.trim(), cad: [] }); save(); render(); });
  else if (a === "addCad") ask("Nova cadeira", [{ k: "nome", l: "Nome da cadeira", req: 1 }], o => { const c = { id: uid(), nome: o.nome.trim(), top: [] }; S.sem.find(s => s.id === id).cad.push(c); sel = c.id; save(); render(); });
  else if (a === "addTop" && x) ask("Adicionar assuntos da ementa", [{ k: "t", l: "Um assunto por linha", t: "area", r: 8 }], o => { o.t.split("\n").map(s => s.trim()).filter(Boolean).forEach(n => x.c.top.push({ id: uid(), nome: n, st: 0 })); save(); render(); });
  else if (a === "st") { const o = topOf(id); if (o) { o.p.st = (o.p.st + 1) % 3; save(); render(); } }
  else if (a === "delTop") { const o = topOf(id); if (o && confirm("Remover este assunto da ementa?")) { o.c.top = o.c.top.filter(t => t.id !== id); save(); render(); } }
  else if (a === "sess") sessForm();
  else if (a === "meta") ask("Meta semanal", [{ k: "h", l: "Horas de estudo por semana", t: "number", v: S.meta, req: 1 }], o => { S.meta = Math.max(1, +o.h || 10); save(); render(); });
  else if (a === "rv") { const r = S.reg.find(r => r.id === id); if (r) { r.revs[+b.dataset.k] = 1; save(); render(); } }
  else if (a === "chk") { S.chk[id] = S.chk[id] ? 0 : 1; save(); render(); }
  else if (a === "prova") ask("Data da prova", [{ k: "d", l: "Data (deixe em branco se ainda não saiu)", t: "date", v: S.prova }], o => { S.prova = o.d || ""; save(); render(); });
  else if (a === "editPlan") ask("Editar plano semanal", [{ k: "t", l: "Uma linha por bloco: dia|cadeira|minutos|observação", t: "area", r: 14, v: planText() }], o => { const q = parsePlan(o.t); if (!q.length) return status("Plano vazio ou formato inválido."); S.plan = q; save(); render(); });
  else if (a === "newReg") regForm();
  else if (a === "edit") regForm(S.reg.find(r => r.id === id));
  else if (a === "del") { if (confirm("Excluir este registro?")) { S.reg = S.reg.filter(r => r.id !== id); save(); render(); } }
  else if (a === "pdfAll" && x) makePdf(x.s.nome + " · " + x.c.nome, S.reg.filter(r => r.cad === x.c.id).sort((p, q) => p.data.localeCompare(q.data)));
  else if (a === "pdfRev" && x) makePdf("Revisão · " + x.s.nome + " · " + x.c.nome, S.reg.filter(r => r.cad === x.c.id && r.revs.includes(0)).sort((p, q) => p.data.localeCompare(q.data)));
  else if (a === "upBtn") $("#up").click();
  else if (a === "refresh") loadDrive();
  else if (a === "bk") { const l = document.createElement("a"); l.href = URL.createObjectURL(new Blob([JSON.stringify(S)], { type: "application/json" })); l.download = "caderno-backup-" + todayISO() + ".json"; l.click(); }
});
document.addEventListener("change", e => {
  if (e.target.id === "up") { upload([...e.target.files]); e.target.value = ""; }
  if (e.target.id === "imp" && e.target.files[0]) {
    const rd = new FileReader();
    rd.onload = () => { try { const j = JSON.parse(rd.result); if (!Array.isArray(j.sem) || !Array.isArray(j.reg)) throw 0; if (confirm("Substituir os dados atuais pelo backup?")) { S = j; migrate(); ensure(); save(); sel = "hoje"; render(); } } catch (err) { status("Arquivo de backup inválido"); } };
    rd.readAsText(e.target.files[0]);
  }
});
$("#q").addEventListener("input", e => { term = e.target.value.trim(); renderMain(); });
document.addEventListener("visibilitychange", () => { if (!document.hidden) loadDrive(); });

/* ===== CONCURSO GMF: dados iniciais, plano semanal e contagem ===== */
const DISC = [
["Direito Penal e Processo Penal", ["Dos crimes (Art. 13 a 25 CP)", "Crimes contra a pessoa e o patrimônio (121 a 183)", "Crimes contra a dignidade sexual (213 a 218-C)", "Crimes contra a fé pública", "Crimes contra a Administração Pública (312 a 337-A)", "Inquérito policial (Art. 4º a 23 CPP)", "Prova: disposições gerais (155 a 157)", "Exame de corpo de delito, cadeia de custódia, perícias (158 a 184)", "Busca e apreensão (240 a 250)", "Prisão, medidas cautelares, flagrante (282 a 310)"]],
["Direito Constitucional e Direitos Humanos", ["Princípios fundamentais (Art. 1º a 4º)", "Direitos e garantias fundamentais (Art. 5º a 11)", "Direitos políticos (Art. 14 a 16)", "Organização do Estado (18 a 31; 37 a 41)", "Segurança Pública (Art. 144)", "Política urbana (182 e 183)", "Família, criança, adolescente, jovem e idoso (226 a 230)", "Direitos Humanos: conceito, características, gerações"]],
["Legislação Extravagante", ["Lei 13.022/2014 (Estatuto Geral das Guardas)", "Lei de Drogas (11.343)", "Lei 7.716/1989 (preconceito de raça ou cor)", "ECA (Lei 8.069/1990)", "Crimes ambientais (Lei 9.605/1998)", "Código de Trânsito (Lei 9.503/1997)", "Estatuto do Desarmamento (Lei 10.826/2003)", "Maria da Penha (Lei 11.340/2006)", "Abuso de Autoridade (Lei 13.869/2019)", "Lei Orgânica de Fortaleza (Art. 1º a 9º e 98 a 123)", "Estatuto dos Servidores de Fortaleza (Lei 6.794/1990)"]],
["Noções de Direito Administrativo", ["Estado, Governo e Administração Pública", "Direito Administrativo: conceito, fontes, princípios", "Ato administrativo: conceito, requisitos, atributos", "Classificação e espécies de atos", "Invalidação, anulação e revogação", "Prescrição"]],
["Língua Portuguesa", ["Leitura e interpretação de textos", "Estruturação do texto e articulação (pronomes, nexos)", "Significação contextual de palavras", "Equivalência e transformação de estruturas", "Sintaxe: coordenação e subordinação", "Tempos e modos verbais", "Pontuação", "Formação de palavras e classes gramaticais", "Pronomes: emprego, tratamento, colocação", "Concordância nominal e verbal", "Regência nominal e verbal", "Ortografia oficial e acentuação"]],
["Raciocínio Lógico", ["Estrutura lógica de relações arbitrárias", "Raciocínio verbal e sequencial", "Operações com conjuntos", "Problemas aritméticos", "Problemas geométricos e matriciais", "Orientação espacial e temporal"]],
["Noções de Informática", ["Hardware, armazenamento e periféricos", "Windows e Linux: pastas, arquivos, atalhos", "Writer (texto)", "Calc (planilhas, fórmulas)", "Correio eletrônico e reuniões on-line", "Internet, navegadores e redes sociais", "Segurança da informação, malwares, backup"]],
["Conhecimentos sobre Fortaleza-CE", ["Localização, limites, hidrografia, população", "Aspectos políticos, administrativos, econômicos, culturais", "Pontos turísticos e patrimônio cultural", "Clima, vegetação, ocupação geográfica", "História da cidade"]],
["Atualidades", ["Fatos políticos e econômicos do Brasil (últimos 6 meses)", "Fatos sociais, culturais, científicos e jurídicos (últimos 6 meses)"]],
["TAF (preparo físico)", ["Barra fixa: 3 repetições (mínimo)", "Flexão de braço: 20 em 1 minuto (mínimo)", "Abdominal: 35 em 1 minuto (mínimo)", "Corrida: 2.300 m em 12 minutos (mínimo)"]]];
const DEFPLAN = `seg|Direito Penal e Processo Penal|150|Teoria e 20 questões
seg|TAF (preparo físico)|60|Abdominal 5 séries no máximo e corrida leve de 20 min
ter|Direito Constitucional e Direitos Humanos|150|Teoria e 20 questões
ter|TAF (preparo físico)|60|Barra negativa e flexão 5 x 5
qua|Legislação Extravagante|150|Lei seca e questões
qui|Língua Portuguesa|150|Teoria e questões
qui|TAF (preparo físico)|60|Tiros 6 x 400 m e core
sex|Raciocínio Lógico|90|Teoria e questões
sex|Noções de Direito Administrativo|60|Teoria e questões
sex|TAF (preparo físico)|60|Barra, flexão e abdominal em volume
sab|Noções de Informática|40|Teoria e questões
sab|Atualidades|40|Notícias dos últimos 6 meses
sab|Conhecimentos sobre Fortaleza-CE|40|Leitura e questões
sab|Revisão semanal|60|Refazer erros da semana
sab|TAF (preparo físico)|45|Corrida longa de 30 a 40 min`;
const DN = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6 }, DS = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];
const parsePlan = t => t.split("\n").map(l => l.split("|").map(s => s.trim())).filter(a => a.length >= 3 && DN[norm(a[0]).slice(0, 3)] !== undefined && a[1] && +a[2] > 0)
  .map(a => ({ d: DN[norm(a[0]).slice(0, 3)], c: a[1], m: +a[2], n: a[3] || "" }));
const planText = () => S.plan.map(p => DS[p.d] + "|" + p.c + "|" + p.m + "|" + (p.n || "")).join("\n");
function ensure() {
  S.chk = S.chk || {}; S.prova = S.prova || "";
  if (!S.sem.length && !S.reg.length) {
    S.sem = [{ id: uid(), nome: "Concurso GMF 2027", cad: DISC.map(d => ({ id: uid(), nome: d[0], top: d[1].map(n => ({ id: uid(), nome: n, st: 0 })) })) }]; S.meta = 18;
  }
  if (!S.plan) S.plan = parsePlan(DEFPLAN);
  save();
}
function planPanel() {
  const td = todayISO(), dow = new Date().getDay(), all = S.sem.flatMap(s => s.cad);
  const n = S.prova ? Math.ceil((Date.parse(S.prova) - Date.parse(td)) / 864e5) : null;
  const cd = n == null ? "Prova prevista para 2027. Defina a data quando o edital sair." : n >= 0 ? n + " dias para a prova (" + fmt(S.prova) + ")" : "A data da prova já passou.";
  const it = S.plan.map((p, i) => ({ ...p, i })).filter(p => p.d === dow);
  return '<div class="panel"><div class="line" style="border-top:0"><b>' + esc(cd) + '</b><button class="ghost" data-a="prova">Data da prova</button></div><h3 style="margin-top:8px">Plano de hoje</h3>' +
    (it.map(p => { const k = td + "|" + p.i, x = all.find(c => norm(c.nome) === norm(p.c));
      return '<label class="line"><span><input type="checkbox" data-a="chk" data-id="' + esc(k) + '"' + (S.chk[k] ? " checked" : "") + "> <b>" + esc(p.c) + "</b> · " + p.m + " min<small>" + esc(p.n) + "</small></span>" + (x ? '<a href="#" class="ghost" data-a="open" data-id="' + x.id + '">Abrir</a>' : "") + "</label>"; }).join("") || '<div class="msg">Dia de descanso.</div>') + "</div>";
}
function hoje() {
  const h = hojeBase(), i = h.indexOf('<div class="kpis">');
  return i < 0 ? h : h.slice(0, i) + planPanel() + h.slice(i);
}
function semana() {
  const nm = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"], td = new Date().getDay();
  return '<div class="head"><div><p>Rotina fixa de estudos e treinos</p><h2>Semana</h2></div><div class="bar"><button class="pri" data-a="editPlan">Editar plano</button></div></div><div class="cols eq">' +
    [1, 2, 3, 4, 5, 6, 0].map(d => { const it = S.plan.filter(p => p.d === d), tot = it.reduce((a, p) => a + p.m, 0);
      return '<div class="panel"' + (d === td ? ' style="border-color:var(--ac)"' : "") + "><h3>" + nm[d] + ' <small class="k">' + (tot ? hm(tot) : "descanso") + "</small></h3>" +
        it.map(p => '<div class="line"><span><b>' + esc(p.c) + "</b><small>" + esc(p.n) + "</small></span><small>" + p.m + " min</small></div>").join("") + "</div>"; }).join("") + "</div>";
}
ensure();

sel = "hoje";
render(); loadDrive(); setInterval(loadDrive, CONFIG.REFRESH_MS);
