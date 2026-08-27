/* 셀러들의 수다 — 모바일(PWA)
 * PC 프로그램과 같은 두뇌(구글 앱스크립트)를 그대로 씁니다.
 * 담는 기능: 홈(공지·라이브) / 컨설팅 / 질문 / 재고·배송요청
 * PC 전용(여기 없음): 내장 브라우저, 스마트스토어 자동연동, 운송장 자동입력, 화면캡처 첨부
 */
'use strict';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nl2br = (s) => esc(s).replace(/\n/g, '<br>');

let session = null;
let cur = 'home';

// ── 통신 ─────────────────────────────────────────────
// 구글 앱스크립트는 한동안 안 쓰면 잠들어서, 처음 깨울 때 20~30초가 걸린다.
// 넉넉히 기다리고(60초), 실패하면 한 번 더 시도한다. (두 번째는 깨어 있어서 대부분 빠름)
const CALL_TIMEOUT = 60000;
async function call(url, action, extra, _retry) {
  if (!url) throw new Error('연결 주소가 없어요');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CALL_TIMEOUT);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({
        action,
        userId: session ? session.userId : '',
        nickname: session ? session.nickname : '',
        cohort: session ? session.cohort : '',
        name: myName()
      }, extra || {}))
    });
    return await res.json();
  } catch (e) {
    if (!_retry) return call(url, action, extra, true);   // 한 번 더
    throw e;
  } finally { clearTimeout(timer); }
}
// 앱을 열자마자 두뇌들을 미리 깨워둔다(결과는 안 씀) → 실제로 누를 땐 빠르게 응답
function warmUp() {
  ['questionsUrl', 'coachingUrl', 'deliveryUrl', 'apiUrl'].forEach(k => {
    const u = BRAIN[k];
    if (u) { try { fetch(u, { method: 'GET', mode: 'no-cors', cache: 'no-store' }).catch(() => {}); } catch (_) {} }
  });
}
const api = (a, e) => call(BRAIN.apiUrl, a, e);
const qApi = (a, e) => call(BRAIN.questionsUrl, a, e);
const coApi = (a, e) => call(BRAIN.coachingUrl, a, e);
const dlApi = (a, e) => call(BRAIN.deliveryUrl, a, e);

// ── 저장 ─────────────────────────────────────────────
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
  del(k) { try { localStorage.removeItem(k); } catch (_) {} }
};
const myName = () => String(store.get('realName', '') || '').trim();

function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), 2400);
}
function sheet(html) { $('sheetCard').innerHTML = html; $('sheet').classList.remove('hidden'); }
function closeSheet() { $('sheet').classList.add('hidden'); }
window.closeSheet = closeSheet;
$('sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeSheet(); });

// ── 로그인 ───────────────────────────────────────────
function fmtPhone(v) {
  const d = String(v || '').replace(/[^0-9]/g, '').slice(0, 11);
  if (d.length < 4) return d;
  if (d.length < 8) return d.slice(0, 3) + '-' + d.slice(3);
  return d.slice(0, 3) + '-' + d.slice(3, 7) + '-' + d.slice(7);
}
$('lgId').addEventListener('input', e => { e.target.value = fmtPhone(e.target.value); });

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const userId = $('lgId').value.trim(), userPw = $('lgPw').value;
  const msg = (t, k) => { const m = $('lgMsg'); m.textContent = t || ''; m.className = 'msg' + (k ? ' ' + k : ''); };
  if (!/^010-\d{4}-\d{4}$/.test(userId)) { msg('전화번호를 010-0000-0000 형식으로 입력해주세요.', 'err'); return; }
  $('lgBtn').disabled = true; $('lgBtn').textContent = '확인 중…'; msg('');
  const slow = setTimeout(() => { msg('서버를 깨우는 중이에요. 처음엔 20~30초 걸릴 수 있어요 🙂'); }, 4000);
  try {
    const d = await api('login', { userId, userPw });
    if (d && d.ok) {
      session = { userId, nickname: d.nickname || '', cohort: d.cohort || '' };
      store.set('session', session);
      enterMain();
    } else { msg((d && d.error) || '로그인에 실패했어요.', 'err'); }
  } catch (_) { msg('연결이 오래 걸리고 있어요. 잠시 후 [로그인]을 한 번 더 눌러주세요.', 'err'); }
  clearTimeout(slow);
  $('lgBtn').disabled = false; $('lgBtn').textContent = '로그인';
});

$('btnLogout').addEventListener('click', () => {
  if (!confirm('로그아웃할까요?')) return;
  store.del('session'); location.reload();
});

function enterMain() {
  $('meNick').textContent = session.nickname || session.userId;
  $('meCohort').textContent = session.cohort || '';
  $('loginView').classList.add('hidden');
  $('mainView').classList.remove('hidden');
  go('home');
  try { showInstallBar(); } catch (_) {}
}

// ── 탭 ───────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => go(b.dataset.tab)));
function go(tab) {
  cur = tab;
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  $('pane').scrollTop = 0;
  ({ home: viewHome, coach: viewCoach, ask: viewAsk, ship: viewShip }[tab] || viewHome)();
}
window.go = go;
const loading = (t) => {
  $('pane').innerHTML = `<div class="spin">${t || '불러오는 중…'}<br><span style="font-size:12px">처음엔 조금 오래 걸릴 수 있어요</span></div>`;
};

// ── 홈 ───────────────────────────────────────────────
async function viewHome() {
  loading();
  let notice = [], live = [];
  try { const d = await api('getAnnouncements'); if (d && d.ok) notice = d.items || []; } catch (_) {}
  try { const d = await api('getLiveSchedule'); if (d && d.ok) live = d.items || []; } catch (_) {}
  let h = `<div class="hero">
      <h2>${esc(session.nickname || '반가워요')} 님, 오늘도 화이팅!</h2>
      <p>${esc(session.cohort || '')}</p>
    </div>
    <div class="quick">
      <button onclick="go('coach')"><i>💎</i>컨설팅 신청</button>
      <button onclick="go('ask')"><i>💬</i>질문하기</button>
      <button onclick="go('ship')"><i>📦</i>재고·배송</button>
      <button onclick="openRecharge()"><i>💳</i>선불 충전</button>
    </div>`;
  if (notice.length) {
    h += `<div class="sec">📢 공지사항</div>`;
    h += notice.map(n => `<div class="card"><b>${esc(n.title || '')}</b><div class="noticeBox" style="margin-top:8px">${nl2br(n.body || '')}</div></div>`).join('');
  }
  const today = new Date().toISOString().slice(0, 10);
  const up = live.filter(x => !x.date || x.date >= today).slice(0, 6);
  if (up.length) {
    h += `<div class="sec">📺 라이브 방송</div><div class="card">` + up.map(x => `
      <div class="liveRow">
        <span class="liveD">${esc((x.date || '').slice(5))}</span>
        <span class="liveT">${esc(x.time || '')}</span>
        <span>${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title || '')}</a>` : esc(x.title || '')}</span>
      </div>`).join('') + `</div>`;
  }
  const inst = installRowHtml();
  if (inst) h += `<div class="sec">📱 설치</div>` + inst;
  h += `<div class="sec">ℹ️ 안내</div><div class="card muted" style="font-size:13px;line-height:1.8">
      상품등록·소싱처럼 <b>직접 작업하는 기능</b>은 PC 프로그램에서 이용해주세요.<br>
      여기서는 컨설팅 신청, 질문, 재고·배송요청을 편하게 하실 수 있어요.
    </div>`;
  $('pane').innerHTML = h;
}
window.openRecharge = () => { if (BRAIN.rechargeUrl) window.open(BRAIN.rechargeUrl, '_blank', 'noopener'); };

// ── 컨설팅 ───────────────────────────────────────────
let CO = { sections: [], slotRoles: {}, pick: null, topic: null };
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
function dayLabel(d) {
  const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return esc(d);
  const w = DOW[new Date(d + 'T00:00:00').getDay()] || '';
  return `${Number(m[2])}월 ${Number(m[3])}일 (${w})`;
}
function freeForOwner(date, time, owner) {
  const r = CO.slotRoles[date + ' ' + time];
  if (!r) return null;
  const want = String(owner || '').trim();
  if (!want) return Object.keys(r).reduce((a, k) => a + Number(r[k] || 0), 0);
  return Number(r[''] || 0) + Number(r[want] || 0);
}

async function viewCoach() {
  loading();
  let d;
  try { d = await coApi('getSlots'); } catch (_) { $('pane').innerHTML = `<div class="empty">연결에 실패했어요.</div>`; return; }
  if (!d || !d.ok) { $('pane').innerHTML = `<div class="empty">불러오지 못했어요.</div>`; return; }
  CO.sections = d.sections || []; CO.slotRoles = {};
  const mine = d.myBookings || [];
  let h = `<div class="card bal"><span>남은 신청 횟수</span><b>${d.remaining}회</b></div>`;
  if (mine.length) {
    h += `<div class="sec">📌 내가 신청한 자리</div>` + mine.map(b => `
      <div class="item"><div class="h">
        <span class="t">${dayLabel(b.date)} ${esc(b.time)}</span>
        <button class="btn mini ghost" onclick="coCancel('${b.date}','${b.time}')">취소</button>
      </div><div class="m">${[b.mode, b.topic, b.coach].filter(Boolean).map(esc).join(' · ')}</div></div>`).join('');
  }
  const weeks = d.weeks || [];
  let any = false;
  let body = '';
  weeks.forEach(w => (w.days || []).forEach(day => {
    const slots = (day.slots || []).filter(s => s.state === 'open' || s.state === 'mine');
    slots.forEach(s => { if (s.roles) CO.slotRoles[day.date + ' ' + s.time] = s.roles; });
    if (!slots.length) return;
    any = true;
    body += `<div class="coDay"><div class="coDayHd">${dayLabel(day.date)}</div><div class="chips">` +
      slots.map(s => s.state === 'mine'
        ? `<span class="chip mine">${esc(s.time)} ✓</span>`
        : `<button class="chip" onclick="coApply('${day.date}','${s.time}')">${esc(s.time)}${Number(s.free) > 1 ? `<span class="seat">${s.free}</span>` : ''}</button>`
      ).join('') + `</div></div>`;
  }));
  h += `<div class="sec">🗓️ 신청 가능한 자리</div>`;
  h += any ? body : `<div class="empty">지금 열린 자리가 없어요.<br>자리가 열리면 여기에 표시됩니다.${d.leadDays ? `<br><span class="muted">(당일 신청은 받지 않아요)</span>` : ''}</div>`;
  $('pane').innerHTML = h;
}

window.coApply = function (date, time) {
  CO.pick = { date, time }; CO.topic = null;
  const secs = CO.sections || [];
  let h = `<h3>💎 이 자리에 신청할까요?</h3><p class="muted" style="margin:0 0 10px">${dayLabel(date)} ${esc(time)}</p>`;
  if (secs.length) {
    h += `<label class="lbl">어떤 상담인가요?</label><div class="topics">` + secs.map((s, i) =>
      `<button type="button" class="topic" onclick="coPick(${i})">
         <b>${esc(s.name)}</b><em class="${String(s.owner).indexOf('강사') >= 0 ? 't' : ''}">${esc(s.owner)}</em>
       </button>`).join('') + `</div><div id="coBox"></div>`;
  }
  h += `<label class="lbl">어떤 부분이 어려운지 알려주세요</label>
    <textarea id="coDiff" placeholder="예) 상품 소싱 기준이 헷갈려요"></textarea>
    <label class="lbl">어떻게 받고 싶으세요?</label>
    <div class="modes">
      <label><input type="radio" name="coMode" value="온라인" checked> 💻 온라인</label>
      <label><input type="radio" name="coMode" value="오프라인"> 🤝 오프라인</label>
    </div>
    <div class="row"><button class="btn ghost" onclick="closeSheet()">닫기</button>
      <button class="btn" id="coSend" onclick="coSubmit()">신청하기</button></div>`;
  sheet(h);
};
window.coPick = function (i) {
  const s = (CO.sections || [])[i]; if (!s) return;
  CO.topic = s;
  document.querySelectorAll('.topic').forEach((el, k) => el.classList.toggle('on', k === i));
  let h = '';
  if (s.notice) h += `<div class="notice">${nl2br(s.notice)}</div>`;
  const list = s.checklist || [];
  if (list.length) {
    h += `<div class="checks"><h4>신청 전에 확인해주세요${s.required ? ' <span class="muted">(모두 체크해야 신청돼요)</span>' : ''}</h4>` +
      list.map(c => `<label><input type="checkbox" class="chk"><span>${esc(c)}</span></label>`).join('') + `</div>`;
  }
  const av = CO.pick ? freeForOwner(CO.pick.date, CO.pick.time, s.owner) : null;
  if (av !== null && av <= 0) {
    h += `<div class="noSeat">이 시간에는 <b>${esc(s.owner)}</b> 자리가 없어요.<br>다른 시간을 고르시거나, 다른 상담을 선택해주세요.</div>`;
    CO.topic = null;
  }
  $('coBox').innerHTML = h;
};
window.coSubmit = async function () {
  const btn = $('coSend'); if (btn.disabled) return;
  if ((CO.sections || []).length && !CO.topic) {
    alert(document.querySelector('.noSeat')
      ? '이 시간에는 그 상담의 자리가 없어요.\n\n다른 시간을 고르시거나, 다른 상담을 선택해주세요.'
      : '어떤 상담인지 분야를 먼저 선택해주세요.');
    return;
  }
  if (CO.topic && CO.topic.required && (CO.topic.checklist || []).length) {
    const boxes = Array.prototype.slice.call(document.querySelectorAll('.chk'));
    if (boxes.some(b => !b.checked)) { alert('체크리스트를 모두 확인하고 체크해주세요.'); return; }
  }
  const diff = ($('coDiff').value || '').trim();
  if (!diff) { alert('어려운 부분을 한 줄이라도 적어주세요.'); return; }
  const mode = (document.querySelector('input[name=coMode]:checked') || {}).value || '온라인';
  btn.disabled = true; btn.textContent = '신청 중…';
  try {
    const d = await coApi('book', {
      date: CO.pick.date, time: CO.pick.time, difficulty: diff, mode,
      topic: CO.topic ? CO.topic.name : '', owner: CO.topic ? CO.topic.owner : ''
    });
    if (d && d.ok) { closeSheet(); toast('신청 완료' + (d.coach ? ` · 담당 ${d.coach}` : '')); viewCoach(); }
    else { alert((d && d.error) || '신청에 실패했어요.'); btn.disabled = false; btn.textContent = '신청하기'; }
  } catch (_) { alert('연결 오류로 신청하지 못했어요.'); btn.disabled = false; btn.textContent = '신청하기'; }
};
window.coCancel = async function (date, time) {
  if (!confirm(`${dayLabel(date)} ${time} 신청을 취소할까요?\n시작 3시간 전까지는 횟수가 돌아와요.`)) return;
  try {
    const d = await coApi('cancel', { date, time });
    if (d && d.ok) { toast(d.refunded ? '취소했어요 (횟수 복구)' : '취소했어요'); viewCoach(); }
    else alert((d && d.error) || '취소하지 못했어요.');
  } catch (_) { alert('연결 오류로 취소하지 못했어요.'); }
};

// ── 질문 ─────────────────────────────────────────────
async function viewAsk() {
  loading();
  let items = [];
  try { const d = await qApi('getMyHistory', { limit: 30 }); if (d && d.ok) items = d.items || []; } catch (_) {}
  let h = `<div class="card">
      <label class="lbl">궁금한 점을 남겨주세요</label>
      <textarea id="qText" placeholder="예) 상세페이지 구성이 막막해요"></textarea>
      <div class="row"><button class="btn" id="qBtn" onclick="askSend()">질문 보내기</button></div>
      <p class="muted" style="font-size:12px;margin:10px 0 0">답변이 달리면 이 화면에 표시돼요.<br>화면 캡쳐 첨부는 PC 프로그램에서 할 수 있어요.</p>
    </div>`;
  h += `<div class="sec">📜 내 질문 내역</div>`;
  h += items.length ? items.map(q => {
    const answered = !!(q.answer || '').trim();
    return `<div class="item">
      <div class="h"><span class="t">${esc((q.date || '').slice(0, 16))}</span>
        <span class="pill ${answered ? 'done' : 'wait'}">${answered ? '답변완료' : '대기중'}</span></div>
      <div class="qa">${nl2br(q.question || '')}</div>
      ${answered ? `<div class="qa" style="background:var(--bloom-soft2)"><b>답변</b><br>${nl2br(q.answer)}</div>` : ''}
    </div>`;
  }).join('') : `<div class="empty">아직 질문이 없어요.</div>`;
  $('pane').innerHTML = h;
}
window.askSend = async function () {
  const btn = $('qBtn'), text = ($('qText').value || '').trim();
  if (!text) { alert('질문 내용을 입력해주세요.'); return; }
  if (!myName()) {
    const n = (prompt('강사님이 알아볼 수 있게 이름을 알려주세요. (한 번만 여쭤봐요)') || '').trim();
    if (n) store.set('realName', n);
  }
  btn.disabled = true; btn.textContent = '보내는 중…';
  try {
    const d = await qApi('ask', { question: text });
    if (d && d.ok) { $('qText').value = ''; toast('질문을 보냈어요 📨'); viewAsk(); }
    else alert((d && d.error) || '전송에 실패했어요.');
  } catch (_) { alert('연결 오류로 보내지 못했어요.'); }
  btn.disabled = false; btn.textContent = '질문 보내기';
};

// ── 재고 · 배송요청 ──────────────────────────────────
let DL = { inv: [], ship: [], bal: null, tab: 'inv' };
const plainName = (n) => String(n || '').replace(/[\s,·]*\d+\s*개입?\s*$/, '').trim() || String(n || '');
const packOf = (n) => { const m = String(n || '').match(/(\d+)\s*개입?\s*$/); return m ? Math.max(1, Number(m[1])) : 1; };
const fmtDT = (s) => String(s || '').replace('T', ' ').slice(0, 16);

async function viewShip() {
  loading();
  try {
    const [inv, ship, bal] = await Promise.all([
      dlApi('getInventory').catch(() => null),
      dlApi('getMyShipments').catch(() => null),
      dlApi('getBalance').catch(() => null)
    ]);
    DL.inv = (inv && inv.items) || [];
    DL.hist = (inv && inv.history) || [];
    DL.notice = (inv && inv.notice) || '';
    DL.ship = ((ship && ship.items) || []).filter(s => String(s.status || '').indexOf('취소') < 0);
    DL.bal = bal && bal.ok ? bal : null;
  } catch (_) { $('pane').innerHTML = `<div class="empty">연결에 실패했어요.</div>`; return; }
  renderShip();
}
function renderShip() {
  let h = '';
  if (DL.bal) {
    const b = Number(DL.bal.balance || 0);
    h += `<div class="card bal ${b < 0 ? 'neg' : ''}">
        <span>${b < 0 ? '미수금' : '선불 잔액'}</span>
        <span><b>${Math.abs(b).toLocaleString()}원</b>
        <button class="btn mini" style="margin-left:8px" onclick="openRecharge()">충전</button></span></div>`;
  }
  if (DL.notice) h += `<div class="noticeBox" style="margin-bottom:12px">${nl2br(DL.notice)}</div>`;
  h += `<div class="row" style="margin:0 0 12px">
      <button class="btn ${DL.tab === 'inv' ? '' : 'ghost'}" onclick="dlTab('inv')">📦 내 재고</button>
      <button class="btn ${DL.tab === 'ship' ? '' : 'ghost'}" onclick="dlTab('ship')">🚚 배송요청</button>
    </div>`;
  h += DL.tab === 'inv' ? paneInv() : paneShip();
  $('pane').innerHTML = h;
}
window.dlTab = (t) => { DL.tab = t; renderShip(); };

// 재고 검색 — 띄어쓰기·대소문자 무시. 현재 재고와 입출고 내역을 한 번에 거른다.
const invNorm = (s) => String(s == null ? '' : s).toLowerCase().replace(/\s+/g, '');
const invKey = function () { return esc(invNorm(Array.prototype.join.call(arguments, ' '))); };
window.invFilter = function () {
  const box = $('invQ'); if (!box) return;
  const q = invNorm(box.value);
  let n1 = 0, n2 = 0;
  document.querySelectorAll('#invRows tr[data-s]').forEach(tr => {
    const hit = !q || tr.dataset.s.indexOf(q) >= 0;
    tr.style.display = hit ? '' : 'none'; if (hit) n1++;
  });
  document.querySelectorAll('#invHist [data-s]').forEach(el => {
    const hit = !q || el.dataset.s.indexOf(q) >= 0;
    el.style.display = hit ? '' : 'none'; if (hit) n2++;
  });
  const e1 = $('invNone1'); if (e1) e1.style.display = (q && !n1) ? '' : 'none';
  const e2 = $('invNone2'); if (e2) e2.style.display = (q && !n2) ? '' : 'none';
  const c = $('invCnt'); if (c) c.textContent = q ? `재고 ${n1}건 · 내역 ${n2}건` : '';
  const x = $('invClr'); if (x) x.style.display = q ? '' : 'none';
};
window.invClear = function () { const b = $('invQ'); if (b) { b.value = ''; b.focus(); } invFilter(); };
function paneInv() {
  let h = '';
  if (DL.inv.length || (DL.hist || []).length) {
    h += `<div class="invSrch">
        <input id="invQ" type="search" inputmode="search" placeholder="🔍 상품·옵션·메모 검색" oninput="invFilter()">
        <div class="invSrchInfo"><span id="invCnt" class="muted"></span>
          <button type="button" id="invClr" class="btn mini ghost" style="display:none" onclick="invClear()">✕ 지우기</button></div>
      </div>`;
  }
  h += `<div class="sec">📦 현재 재고</div>`;
  h += DL.inv.length
    ? `<div class="card" style="padding:6px 12px"><table class="tbl">
        <thead><tr><th>상품</th><th style="text-align:right">수량</th></tr></thead><tbody id="invRows">` +
      DL.inv.map(it => {
        const p = packOf(it.product);
        return `<tr data-s="${invKey(it.product, it.option, it.price, it.expiry)}"><td>${esc(plainName(it.product))}${p > 1 ? `<span class="pack">${p}개입</span>` : ''}
          ${it.option ? `<div class="muted" style="font-size:11.5px">${esc(it.option)}</div>` : ''}</td>
          <td class="n ${it.qty <= 0 ? 'zero' : ''}">${it.qty}</td></tr>`;
      }).join('') + `<tr id="invNone1" style="display:none"><td colspan="2" class="muted">검색과 일치하는 재고가 없어요.</td></tr>`
      + `</tbody></table></div>`
    : `<div class="empty">아직 등록된 재고가 없어요.<br>입고 등록은 PC 프로그램에서 할 수 있어요.</div>`;
  const hist = (DL.hist || []).slice(0, 15);
  if (hist.length) {
    h += `<div class="sec">🧾 최근 입출고</div><div id="invHist">` + hist.map(x => {
      const out = String(x.gubun || '').indexOf('출') >= 0;
      const ret = String(x.gubun || '').indexOf('반품') >= 0;
      const pk = Number(x.pack) || packOf(x.product), pks = Number(x.packs) || 0;
      return `<div class="item" data-s="${invKey(x.product, x.option, x.gubun, x.memo, x.site, x.price, x.expiry, x.at)}"><div class="h">
          <span class="t">${esc(plainName(x.product))}</span>
          <span class="pill ${ret ? 'ret' : (out ? 'wait' : 'done')}">${esc(x.gubun || '')} ${ret ? '' : (out ? '-' : '+')}${x.qty}</span>
        </div><div class="m">${esc(fmtDT(x.at))}${pk > 1 && pks ? ` · 📦 ${pk}개입 × ${pks} = ${pk * pks}개` : ''}</div></div>`;
    }).join('') + `<div id="invNone2" class="empty" style="display:none">검색과 일치하는 내역이 없어요.</div></div>`;
  }
  return h;
}

function paneShip() {
  const inStock = DL.inv.map((it, i) => ({ it, i })).filter(x => Number(x.it.qty) > 0);
  let h = `<div class="sec">✏️ 새 배송요청</div>`;
  if (inStock.length) {
    h += `<div class="card">
      <label class="lbl">보낼 상품 (재고 있는 것만)</label>
      <select id="dlProd">${inStock.map(x => {
        const p = packOf(x.it.product);
        return `<option value="${x.i}">${esc(plainName(x.it.product))}${p > 1 ? ` [${p}개입]` : ''}${x.it.option ? ' · ' + esc(x.it.option) : ''} (재고 ${x.it.qty}개)</option>`;
      }).join('')}</select>
      <label class="lbl">수량</label><input id="dlQty" type="number" min="1" value="1">
      <label class="lbl">받는사람</label><input id="dlRcv" type="text" placeholder="예) 홍길동">
      <label class="lbl">연락처</label><input id="dlPh" type="tel" inputmode="numeric" placeholder="010-0000-0000">
      <label class="lbl">주소</label><textarea id="dlAddr" style="min-height:64px" placeholder="도로명 주소 + 상세주소"></textarea>
      <label class="lbl">배송메시지 (선택)</label><input id="dlMemo" type="text" placeholder="예) 부재 시 문 앞">
      <div class="row"><button class="btn" id="dlBtn" onclick="dlSend()">배송요청 보내기</button></div>
    </div>`;
  } else {
    h += `<div class="empty">배송요청할 수 있는 재고가 없어요.</div>`;
  }
  h += `<div class="sec">📋 내 배송요청 <span class="muted" style="font-weight:400">(${DL.ship.length}건)</span></div>`;
  h += DL.ship.length ? DL.ship.map(s => {
    const st = String(s.status || '');
    const k = st.indexOf('발송완료') >= 0 ? 'done' : (st.indexOf('반품') >= 0 ? 'ret' : 'wait');
    return `<div class="item">
      <div class="h"><span class="t">${esc(plainName(s.product))}${s.option ? ' · ' + esc(s.option) : ''} × ${s.qty}</span>
        <span class="pill ${k}">${esc(st)}</span></div>
      <div class="m">${esc(s.receiver || '')} · ${esc(fmtDT(s.at))}
        ${s.invoice ? `<br>송장 ${esc(s.invoice)} ${esc(s.courier || '')}` : ''}</div>
      ${st.indexOf('접수') >= 0 ? `<div class="row" style="margin-top:9px"><button class="btn mini ghost" onclick="dlCancel('${esc(s.at)}')">요청 취소</button></div>` : ''}
    </div>`;
  }).join('') : `<div class="empty">아직 배송요청이 없어요.</div>`;
  return h;
}

window.dlSend = async function () {
  const btn = $('dlBtn'); if (btn.disabled) return;
  const it = DL.inv[Number($('dlProd').value)];
  if (!it) { alert('상품을 선택해주세요.'); return; }
  const qty = Number($('dlQty').value) || 0;
  const receiver = $('dlRcv').value.trim(), phone = $('dlPh').value.trim();
  const addr = $('dlAddr').value.trim(), memo = $('dlMemo').value.trim();
  if (qty < 1) { alert('수량을 확인해주세요.'); return; }
  if (!receiver) { alert('받는사람을 입력해주세요.'); return; }
  if (!addr) { alert('주소를 입력해주세요.'); return; }
  const pack = packOf(it.product), need = qty * pack;
  if (need > it.qty) {
    const detail = pack > 1 ? `요청 ${qty}묶음 × ${pack}개입 = ${need}개` : `요청 ${need}개`;
    if (!confirm(`현재 재고 ${it.qty}개보다 많아요.\n(${detail})\n\n그래도 요청할까요?`)) return;
  }
  if (!myName()) {
    const n = (prompt('배송 확인을 위해 이름을 알려주세요. (한 번만 여쭤봐요)') || '').trim();
    if (n) store.set('realName', n);
  }
  btn.disabled = true; btn.textContent = '보내는 중…';
  try {
    const d = await dlApi('submitShipping', {
      product: it.product, option: it.option || '', qty, receiver, phone, addr, memo
    });
    if (d && d.ok) {
      toast(d.warn ? '접수했어요 (잔액 확인 필요)' : '배송요청을 보냈어요 🚚');
      viewShip();
    } else { alert((d && d.error) || '접수에 실패했어요.'); btn.disabled = false; btn.textContent = '배송요청 보내기'; }
  } catch (_) { alert('연결 오류로 보내지 못했어요.'); btn.disabled = false; btn.textContent = '배송요청 보내기'; }
};
window.dlCancel = async function (at) {
  if (!confirm('이 배송요청을 취소할까요?')) return;
  try {
    const d = await dlApi('cancelShipping', { at });
    if (d && d.ok) { toast('취소했어요'); viewShip(); }
    else alert((d && d.error) || '취소하지 못했어요.');
  } catch (_) { alert('연결 오류로 취소하지 못했어요.'); }
};


// ── 앱으로 설치하기 안내 ─────────────────────────────
//   안드로이드: 브라우저가 주는 설치 이벤트를 잡아 [설치] 버튼 한 번으로 끝냄
//   아이폰    : 설치 이벤트가 없어서, 공유버튼 위치를 그림으로 안내
let deferredPrompt = null;
const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  showInstallBar();
});
window.addEventListener('appinstalled', () => {
  store.set('installed', true);
  const b = $('installBar'); if (b) b.remove();
  toast('앱으로 설치됐어요 🎉');
});

function showInstallBar() {
  if (isStandalone() || store.get('installed', false)) return;   // 이미 설치됨
  if (store.get('installHideUntil', 0) > Date.now()) return;      // "나중에" 누른 경우
  if ($('installBar')) return;
  const bar = document.createElement('div');
  bar.id = 'installBar';
  bar.className = 'installBar';
  bar.innerHTML = `
    <img src="icon.png" alt="">
    <div class="t"><b>앱으로 설치하기</b><span>홈 화면에서 바로 열 수 있어요</span></div>
    <button class="btn mini" id="instGo">설치</button>
    <button class="x" id="instNo" aria-label="닫기">✕</button>`;
  document.body.appendChild(bar);
  $('instNo').onclick = () => {
    store.set('installHideUntil', Date.now() + 7 * 24 * 3600 * 1000);   // 일주일 뒤 다시
    bar.remove();
  };
  $('instGo').onclick = doInstall;
}

async function doInstall() {
  if (deferredPrompt) {                       // 안드로이드 — 원클릭
    deferredPrompt.prompt();
    try { await deferredPrompt.userChoice; } catch (_) {}
    deferredPrompt = null;
    const b = $('installBar'); if (b) b.remove();
    return;
  }
  guideInstall();                             // 아이폰 등 — 그림 안내
}
window.doInstall = doInstall;

function guideInstall() {
  const ios = isIOS();
  sheet(`<h3>📱 홈 화면에 추가하기</h3>
    <p class="muted" style="margin:0 0 12px">한 번만 하면 앱처럼 아이콘으로 열 수 있어요.</p>
    ${ios ? `
      <ol class="guide">
        <li>화면 <b>아래쪽 가운데</b>의 공유 버튼 <span class="key">⬆️</span> 를 누르세요</li>
        <li>메뉴를 <b>아래로 내려서</b> <span class="key">홈 화면에 추가</span> 를 누르세요</li>
        <li>오른쪽 위 <span class="key">추가</span> 를 누르면 끝!</li>
      </ol>
      <p class="muted" style="font-size:12.5px">※ 사파리(Safari)에서 열어야 추가할 수 있어요.</p>`
    : `
      <ol class="guide">
        <li>오른쪽 위 <span class="key">⋮</span> 를 누르세요</li>
        <li><span class="key">홈 화면에 추가</span> 또는 <span class="key">앱 설치</span> 를 누르세요</li>
        <li><span class="key">설치</span> 를 누르면 끝!</li>
      </ol>`}
    <div class="row"><button class="btn" onclick="closeSheet()">확인</button></div>`);
}

// 설치 안내 버튼은 홈 화면에도 항상 두기(배너를 닫았어도 찾을 수 있게)
function installRowHtml() {
  if (isStandalone() || store.get('installed', false)) return '';
  return `<div class="card" style="display:flex;align-items:center;gap:12px">
      <span style="font-size:26px">📱</span>
      <div style="flex:1"><b style="font-size:13.5px">앱으로 설치하기</b>
        <div class="muted" style="font-size:12px">홈 화면 아이콘으로 바로 열 수 있어요</div></div>
      <button class="btn mini" onclick="doInstall()">설치</button>
    </div>`;
}

// ── 시작 ─────────────────────────────────────────────
(function boot() {
  warmUp();                       // 두뇌 미리 깨우기
  const s = store.get('session', null);
  if (s && s.userId) { session = s; enterMain(); }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
