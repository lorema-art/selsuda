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

// 저장된 세션의 기수는 낡을 수 있다 (강사가 메인시트에서 기수를 고쳐도 폰은 모름).
//  앱을 열 때 현재 기수를 다시 물어보고 달라졌으면 갱신한다.
async function refreshSessionCohort() {
  if (!session || !session.userId) return false;
  try {
    const d = await api('whoami', { userId: session.userId });
    if (!d || !d.ok || !d.cohort) return false;
    if (String(d.cohort) === String(session.cohort || '') &&
        (!d.nickname || d.nickname === session.nickname)) return false;
    session.cohort = d.cohort;
    if (d.nickname) session.nickname = d.nickname;
    store.set('session', session);
    return true;
  } catch (_) { return false; }   // 서버가 옛 버전이면 조용히 넘어간다
}

const qApi = (a, e) => call(BRAIN.questionsUrl, a, e);
// 컨설팅은 기수마다 담당 강사 시트가 다르다.
//  ⚠ 예전에는 기수와 무관하게 BRAIN.coachingUrl(= 뷰셀 시트) 하나만 불러서,
//    다른 기수 학생도 뷰셀 코치 자리를 예약할 수 있었다. 이제 기수로 갈라 부른다.
// 기수 이름 비교용 키 — 공백·괄호 무시 ('뷰셀 1기' == '뷰셀1기'). PC·서버와 같은 규칙.
function cohortKey(s) { return String(s == null ? '' : s).replace(/[\s()（）]/g, '').toLowerCase(); }
function coachingUrlFor(cohort) {
  const k = cohortKey(cohort);
  if (!k) return '';
  const list = (window.COACHING || []);
  for (const ins of list) if ((ins.cohorts || []).some(c => cohortKey(c) === k)) return ins.url || '';
  return '';                                  // 목록에 없는 기수 = 연결 안 함
}
const coApi = (a, e) => {
  const url = coachingUrlFor(session && session.cohort);
  if (!url) return Promise.reject(new Error('NO_COACHING'));
  return call(url, a, e);
};
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
let _sheetLocked = false;                 // true면 배경을 눌러도 안 닫힘(확인 버튼만)
function sheet(html, lock) { $('sheetCard').innerHTML = html; _sheetLocked = !!lock; $('sheet').classList.remove('hidden'); }
function closeSheet(force) {
  if (_sheetLocked && !force) return;      // 잠긴 팝업은 확인 눌러야 닫힘
  _sheetLocked = false; $('sheet').classList.add('hidden');
}
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
  applyTabConfig();                    // 기수별로 숨긴/잠근 탭 반영 (PC 앱과 같은 시트 설정)
  try { showInstallBar(); } catch (_) {}
  setTimeout(() => { try { checkLogisticsMessages(); } catch (_) {} }, 1200);
}

// ── 기수별 탭 설정 (숨김 / 잠금) ──────────────────────
//  메인시트 '탭설정' 에서 기수마다 정한다. PC 앱과 똑같은 설정을 그대로 따른다.
//    N · X · 숨김 · OFF  → 아예 안 보임
//    잠금 · LOCK · 준비중 → 보이긴 하는데 누르면 안내만 뜸
//  기수 칸을 '전체' 로 하면 모든 기수에 적용된다.
let TABCFG = { hidden: new Set(), locked: new Set(), msg: null };
// 시트의 탭 이름 → 폰 앱의 탭
const TAB_MAP = {
  '1:1컨설팅': 'coach', '질문하기': 'ask', '오늘의할인': 'deals', '마진계산기': 'margin', '구매대행': 'buy', '공동구매': 'gb'
};
function tabKeyOf(tab) {                     // 폰 탭 → 시트 이름(되찾기)
  for (const k in TAB_MAP) if (TAB_MAP[k] === tab) return k;
  return null;
}
async function applyTabConfig() {
  let d = null;
  try { d = await api('getTabConfig', { cohort: session && session.cohort }); } catch (_) { return; }
  if (!d || !d.ok) return;
  const H = new Set(d.hidden || []), L = new Set(d.locked || []);
  TABCFG = { hidden: new Set(), locked: new Set(), msg: d.lockMsg || null };
  Object.keys(TAB_MAP).forEach(k => {
    if (H.has(k)) TABCFG.hidden.add(TAB_MAP[k]);
    else if (L.has(k)) TABCFG.locked.add(TAB_MAP[k]);
  });
  // 재고·배송은 두 탭이 하나로 합쳐져 있다 — 둘 다 숨김이거나 '택배관리' 지정일 때만 숨긴다
  if (H.has('택배관리') || (H.has('재고관리') && H.has('배송요청'))) TABCFG.hidden.add('ship');
  else if (L.has('택배관리') || (L.has('재고관리') && L.has('배송요청'))) TABCFG.locked.add('ship');
  document.querySelectorAll('.tab').forEach(b => {
    b.style.display = TABCFG.hidden.has(b.dataset.tab) ? 'none' : '';
  });
  if (TABCFG.hidden.has(cur)) go('home');    // 보고 있던 탭이 숨겨졌으면 홈으로
}
// 잠긴 탭을 눌렀을 때 — 문구는 시트('잠금안내')에서 온다
function showLockedTab() {
  const m = TABCFG.msg || {};
  const title = m.title || '준비 중이에요';
  const body = m.body || ('이 기능은 아직 열리지 않았어요.' + String.fromCharCode(10) + '담당자에게 문의해주세요.');
  const btn = (m.btnText && m.btnUrl)
    ? `<a class="btn" href="${esc(m.btnUrl)}" target="_blank" rel="noopener">${esc(m.btnText)}</a>` : '';
  sheet(`<h3>🔒 ${esc(title)}</h3>
    <p class="muted" style="line-height:1.75;margin:8px 0 14px">${nl2br(esc(body))}</p>
    ${btn}<button class="btn ghost" onclick="closeSheet()" style="margin-top:8px">닫기</button>`);
}

// ── 탭 ───────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => go(b.dataset.tab)));
function go(tab) {
  if (TABCFG.hidden.has(tab)) return;                     // 숨긴 탭은 아예 안 열린다
  if (TABCFG.locked.has(tab)) { showLockedTab(); return; }  // 잠긴 탭은 안내만
  cur = tab;
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  $('pane').scrollTop = 0;
  ({ home: viewHome, coach: viewCoach, ask: viewAsk, ship: viewShip, buy: viewBuy, gb: viewGroupBuy, margin: viewMargin, deals: viewDeals }[tab] || viewHome)();
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
      <button onclick="go('buy')"><i>🛒</i>구매대행</button>
      <button onclick="go('gb')"><i>🤝</i>공동구매</button>
      <button onclick="go('deals')"><i>🏷️</i>오늘의 할인</button>
      <button onclick="go('margin')"><i>💰</i>마진 계산기</button>
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
window.openRecharge = () => {
  if (!BRAIN.rechargeUrl) { toast('충전 페이지가 아직 설정되지 않았어요.'); return; }
  toast('매일 밤 10시에 입금 확인 후 잔액에 반영돼요');
  window.open(BRAIN.rechargeUrl, '_blank', 'noopener');
};

// ── 컨설팅 ───────────────────────────────────────────
let CO = { sections: [], slotRoles: {}, pick: null, topic: null, weekQuota: 1, myWeeks: {} };
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
function dayLabel(d) {
  const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return esc(d);
  const w = DOW[new Date(d + 'T00:00:00').getDay()] || '';
  return `${Number(m[2])}월 ${Number(m[3])}일 (${w})`;
}
// 그 날짜가 속한 주의 월요일
function monOf(dateStr) {
  const s = String(dateStr || '');
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T00:00:00') : null;
  if (!d || isNaN(d)) return '';
  const wd = d.getDay();
  d.setDate(d.getDate() + (wd === 0 ? -6 : 1 - wd));
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function weekFull(dateStr) {
  if (!(CO.weekQuota > 0)) return false;
  return (CO.myWeeks[monOf(dateStr)] || 0) >= CO.weekQuota;
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
  try { d = await coApi('getSlots'); }
  catch (e) {
    $('pane').innerHTML = String(e && e.message) === 'NO_COACHING'
      ? `<div class="empty">컨설팅은 준비 중이에요.<br>담당 강사가 코칭 시트를 연결하면 이용할 수 있어요.</div>`
      : `<div class="empty">연결에 실패했어요.</div>`;
    return;
  }
  if (d && !d.ok && d.error) { $('pane').innerHTML = `<div class="empty">${esc(d.error)}</div>`; return; }
  if (!d || !d.ok) { $('pane').innerHTML = `<div class="empty">불러오지 못했어요.</div>`; return; }
  CO.sections = d.sections || []; CO.slotRoles = {};
  const mine = d.myBookings || [];
  // 주당 신청 제한 — 이미 신청한 주는 미리 회색으로
  CO.weekQuota = Number(d.weekQuota != null ? d.weekQuota : 1);
  CO.myWeeks = {};
  mine.forEach(b => { const mo = monOf(b.date); if (mo) CO.myWeeks[mo] = (CO.myWeeks[mo] || 0) + 1; });
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
        : (weekFull(day.date)
            ? `<span class="chip full">${esc(s.time)}</span>`
            : `<button class="chip" onclick="coApply('${day.date}','${s.time}')">${esc(s.time)}${Number(s.free) > 1 ? `<span class="seat">${s.free}</span>` : ''}</button>`)
      ).join('') + `</div></div>`;
  }));
  h += `<div class="sec">🗓️ 신청 가능한 자리</div>`;
  if (CO.weekQuota > 0) h += `<p class="muted" style="margin:0 2px 8px;font-size:12.5px">컨설팅은 <b>일주일에 ${CO.weekQuota}번</b>까지 신청할 수 있어요. 이미 신청한 주는 회색으로 보여요.</p>`;
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
// 질문 시각 → 정렬용 숫자 + 보기 좋은 글자.
//  시트가 시각을 날짜값으로 저장하면 'Wed Jul 08 2026 …' 로 오는데,
//  그대로 정렬하면 요일 이름 알파벳순으로 섞인다. 두 형식 모두 알아듣게 한다.
function qTime(v) {
  const s = String(v == null ? '' : v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  const t = Date.parse(s);                       // 'Wed Jul 08 2026 …' 형식
  return isNaN(t) ? 0 : t;
}
function qDateLabel(v) {
  const t = qTime(v);
  if (!t) return String(v || '').slice(0, 16);
  const d = new Date(t), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
let QH = [];
const qNorm = (s) => String(s == null ? '' : s).toLowerCase().replace(/\s+/g, '');
async function viewAsk() {
  loading();
  let items = [];
  try { const d = await qApi('getMyHistory'); if (d && d.ok) items = d.items || []; } catch (_) {}
  // 최신순 보장 (서버가 옛 버전이어도 화면은 항상 최신순)
  items = items.slice().sort((a, b) => qTime(b.when || b.date) - qTime(a.when || a.date));
  QH = items;
  let h = `<div class="card">
      <label class="lbl">궁금한 점을 남겨주세요</label>
      <textarea id="qText" placeholder="예) 상세페이지 구성이 막막해요"></textarea>
      <div id="qPhotoBox"></div>
      <div class="row" style="margin-top:8px">
        <label class="btn mini ghost" for="qPhotoInput">📷 사진 첨부</label>
        <input id="qPhotoInput" type="file" accept="image/*" style="display:none" onchange="askPickPhoto(this)">
        <button class="btn" id="qBtn" onclick="askSend()">질문 보내기</button>
      </div>
      <p class="muted" style="font-size:12px;margin:10px 0 0">답변이 달리면 이 화면에 표시돼요.<br>화면을 캡쳐해서 붙이시면 훨씬 빨리 해결돼요.</p>
    </div>`;
  h += `<div class="sec">📜 내 질문 내역</div>`;
  if (items.length) {
    h += `<div class="invSrch">
        <input id="qQ" type="search" inputmode="search" placeholder="🔍 질문·답변 내용 검색" oninput="qFilter()">
        <div class="invSrchInfo"><span id="qCnt" class="muted"></span>
          <button type="button" id="qClr" class="btn mini ghost" style="display:none" onclick="qClear()">✕ 지우기</button></div>
      </div><div id="qList">`;
  }
  h += items.length ? items.map(q => {
    const answered = !!(q.answer || '').trim();
    return `<div class="item" data-s="${esc(qNorm((q.question || '') + ' ' + (q.answer || '') + ' ' + qDateLabel(q.date)))}">
      <div class="h"><span class="t">${esc(qDateLabel(q.date))}</span>
        <span class="pill ${answered ? 'done' : 'wait'}">${answered ? '답변완료' : '대기중'}</span></div>
      <div class="qa">${nl2br(q.question || '')}</div>
      ${answered ? `<div class="qa" style="background:var(--bloom-soft2)"><b>답변</b><br>${nl2br(q.answer)}</div>` : ''}
    </div>`;
  }).join('') + `<div id="qNone" class="empty" style="display:none">검색과 일치하는 질문이 없어요.</div></div>`
    : `<div class="empty">아직 질문이 없어요.</div>`;
  $('pane').innerHTML = h;
}
window.qFilter = function () {
  const box = $('qQ'); if (!box) return;
  const q = qNorm(box.value);
  let n = 0;
  document.querySelectorAll('#qList .item[data-s]').forEach(el => {
    const hit = !q || el.dataset.s.indexOf(q) >= 0;
    el.style.display = hit ? '' : 'none'; if (hit) n++;
  });
  const none = $('qNone'); if (none) none.style.display = (q && !n) ? '' : 'none';
  const c = $('qCnt'); if (c) c.textContent = q ? `${n}건 / 전체 ${QH.length}건` : `전체 ${QH.length}건`;
  const x = $('qClr'); if (x) x.style.display = q ? '' : 'none';
};
window.qClear = function () { const b = $('qQ'); if (b) { b.value = ''; b.focus(); } qFilter(); };
// ── 📷 사진 첨부 ─────────────────────────────────────────
//   폰 사진은 4~8MB나 돼서 그대로 보내면 전송이 실패한다.
//   브라우저에서 긴 변 1280px · JPEG 75% 로 줄여서 보낸다(보통 200KB 안팎).
const PHOTO_MAX_PX = 1280;
const PHOTO_QUALITY = 0.75;
let ASK_PHOTO = null;      // 질문에 붙일 사진 (data:image/jpeg;base64,...)

function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('파일이 없어요'));
    if (!/^image\//.test(file.type)) return reject(new Error('이미지 파일만 붙일 수 있어요'));
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('사진을 읽지 못했어요'));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('사진을 열지 못했어요'));
      img.onload = () => {
        let { width: w, height: h } = img;
        const scale = Math.min(1, PHOTO_MAX_PX / Math.max(w, h));
        w = Math.round(w * scale); h = Math.round(h * scale);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);   // 투명 png → 검은 배경 방지
        ctx.drawImage(img, 0, 0, w, h);
        try { resolve(c.toDataURL('image/jpeg', PHOTO_QUALITY)); }
        catch (e) { reject(new Error('사진을 변환하지 못했어요')); }
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

window.askPickPhoto = async function (input) {
  const f = input && input.files && input.files[0];
  if (!f) return;
  const box = $('qPhotoBox');
  if (box) box.innerHTML = `<p class="muted" style="font-size:12px">사진을 줄이는 중…</p>`;
  try {
    ASK_PHOTO = await shrinkImage(f);
    const kb = Math.round(ASK_PHOTO.length * 0.75 / 1024);
    if (box) box.innerHTML =
      `<div class="photoChip"><img src="${ASK_PHOTO}" alt="첨부한 사진">
         <span>사진 1장 (${kb}KB)</span>
         <button type="button" onclick="askClearPhoto()">✕</button></div>`;
  } catch (e) {
    ASK_PHOTO = null;
    if (box) box.innerHTML = '';
    alert(e.message || '사진을 붙이지 못했어요.');
  }
  if (input) input.value = '';        // 같은 사진을 다시 고를 수 있게
};
window.askClearPhoto = function () {
  ASK_PHOTO = null;
  const box = $('qPhotoBox'); if (box) box.innerHTML = '';
};

window.askSend = async function () {
  const btn = $('qBtn'), text = ($('qText').value || '').trim();
  if (!text) { alert('질문 내용을 입력해주세요.'); return; }
  if (!myName()) {
    const n = (prompt('강사님이 알아볼 수 있게 이름을 알려주세요. (한 번만 여쭤봐요)') || '').trim();
    if (n) store.set('realName', n);
  }
  btn.disabled = true; btn.textContent = '보내는 중…';
  try {
    if (ASK_PHOTO) btn.textContent = '사진 올리는 중…';
    const d = await qApi('ask', { question: text, photo: ASK_PHOTO || '' });
    if (d && d.ok) {
      $('qText').value = ''; ASK_PHOTO = null;
      toast(d.photoErr ? '질문은 보냈어요 (사진은 실패)' : '질문을 보냈어요 📨');
      viewAsk();
    }
    else alert((d && d.error) || '전송에 실패했어요.');
  } catch (_) { alert('연결 오류로 보내지 못했어요.'); }
  btn.disabled = false; btn.textContent = '질문 보내기';
};

// ── 재고 · 배송요청 ──────────────────────────────────
let DL = { inv: [], ship: [], bal: null, tab: 'inv', shipTab: 'all' };
const plainName = (n) => String(n || '').replace(/[\s,·]*\d+\s*개입?\s*$/, '').trim() || String(n || '');
const packOf = (n) => { const m = String(n || '').match(/(\d+)\s*개입?\s*$/); return m ? Math.max(1, Number(m[1])) : 1; };
// 재고를 카탈로그명 오름차순으로 — 재고가 늘면 찾기 힘들다는 수강생 요청(뷰셀 1기).
//  받아올 때 한 번 정렬해두면 재고표와 배송요청 목록이 같은 순서가 된다.
const dlSortByName = (arr) => (arr || []).slice().sort((a, b) =>
  (plainName(a.product) + ' ' + (a.option || '')).trim()
    .localeCompare((plainName(b.product) + ' ' + (b.option || '')).trim(), 'ko'));
// 유통기한 파싱 → 시각(ms). 없으면 Infinity(맨 아래).
const dlExpTs = (s) => { const m = String(s || '').match(/(\d{4})\D+(\d{1,2})(?:\D+(\d{1,2}))?/);
  return m ? new Date(+m[1], +m[2] - 1, +(m[3] || 1)).getTime() : Infinity; };
// 재고를 유통기한 임박순으로(없는 건 맨 아래). 같은 날짜면 이름순(안정 정렬로 유지). 루크 요청 09-29.
const dlSortByExpiry = (arr) => dlSortByName(arr).sort((a, b) => dlExpTs(a.expiry) - dlExpTs(b.expiry));
const fmtDT = (s) => String(s || '').replace('T', ' ').slice(0, 16);

async function viewShip() {
  loading();
  try {
    const [inv, ship, bal] = await Promise.all([
      dlApi('getInventory').catch(() => null),
      dlApi('getMyShipments').catch(() => null),
      dlApi('getBalance').catch(() => null)
    ]);
    DL.inv = dlSortByName((inv && inv.items) || []);   // 이름 오름차순(드롭다운·인덱스 조회 기준)
    DL.hist = (inv && inv.history) || [];
    DL.notice = (inv && inv.notice) || '';
    DL.ship = dlSortNewest(((ship && ship.items) || []).filter(s => String(s.status || '').indexOf('취소') < 0));
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
  h += `<button class="btn ghost" style="width:100%;margin:0 0 12px" onclick="mpInquiry()">💬 물류담당자에게 문의</button>`;
  h += `<div class="row" style="margin:0 0 12px">
      <button class="btn ${DL.tab === 'inv' ? '' : 'ghost'}" onclick="dlTab('inv')">📦 내 재고</button>
      <button class="btn ${DL.tab === 'ship' ? '' : 'ghost'}" onclick="dlTab('ship')">🚚 배송요청</button>
    </div>`;
  h += DL.tab === 'inv' ? paneInv() : paneShip();
  $('pane').innerHTML = h;
  if (DL.tab === 'ship') { try { dlInfo(); } catch (_) {} }
}
window.dlTab = (t) => { DL.tab = t; renderShip(); };

// ── 현금영수증용 사업자등록번호 (구매대행·공동구매 공용, 한 번 적으면 기억) — PC·서버와 같은 검증 규칙 ──
function bizNoFmt(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length !== 10) return null;
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0; for (let i = 0; i < 9; i++) sum += Number(d[i]) * w[i];
  sum += Math.floor(Number(d[8]) * 5 / 10);
  if ((10 - sum % 10) % 10 !== Number(d[9])) return null;
  return d.slice(0, 3) + '-' + d.slice(3, 5) + '-' + d.slice(5);
}
function bizNoTake(id) {
  const el = $(id); if (!el) return '';
  const f = bizNoFmt(el.value);
  if (f === null) { alert('사업자등록번호가 올바르지 않아요.\n10자리 숫자를 다시 확인해주세요. (예: 123-45-67890)\n현금영수증이 필요 없으면 비워두세요.'); el.focus(); return undefined; }
  el.value = f; if (f) store.set('bizNo', f); else store.del('bizNo'); return f;
}
const bizNoField = (id) => `<label class="lbl">🧾 사업자등록번호 <span class="muted" style="font-weight:400">(현금영수증용 · 선택)</span></label>
  <input id="${id}" type="text" inputmode="numeric" maxlength="12" placeholder="000-00-00000" value="${esc(store.get('bizNo', '') || '')}">`;
// ══════════ 🛒 구매대행 (모바일) — PC와 같은 규칙 ══════════
//  신청 때 '구매요청 상한가 + 수수료(실제 구매가의 5%)' 만큼 쓸 수 있는 잔액 필요. 실제 차감은 코치 구매 후.
//  용어: 구매가 = 코치가 산 금액 / 판매가 = 내가 네이버에서 파는 가격(마진 계산용)
const M_PUR_DIRECT = '고객에게 바로 배송', M_PUR_INV = '내 재고로 입고';
let PUR = { data: null, form: { product: '', link: '', option: '', qty: 1, max: '', method: M_PUR_INV, receiver: '', phone: '', addr: '', memo: '', sell: '', npct: '' } };
async function loadPurchases() {
  try { const d = await dlApi('getPurchases'); PUR.data = d && d.ok ? d : { error: (d && d.error) || '' }; }
  catch (_) { PUR.data = { error: 'net' }; }
}
const purRate = () => ((PUR.data && PUR.data.feeRate) || 0.05);
const purNeed = (max) => Math.ceil((Number(max) || 0) * (1 + purRate()));
const mWon = (n) => Math.round(n).toLocaleString() + '원';
// 개당 마진 = 판매가 − 구매가 − 판매가×네이버수수료 − 구매가×구매대행수수료
function mpMargin(sell, cost, npct) {
  const naver = sell * npct / 100, agent = cost * purRate();
  const m = sell - cost - naver - agent;
  return { naver, agent, m, rate: sell > 0 ? m / sell * 100 : 0 };
}
function purGrab() {
  const g = (id) => String(($(id) || {}).value || '').trim();
  if (!$('mpProduct')) return;
  const f = PUR.form;
  f.product = g('mpProduct'); f.link = g('mpLink'); f.option = g('mpOption');
  f.qty = Number(g('mpQty')) || 0; f.max = g('mpMax').replace(/[^\d]/g, ''); f.memo = g('mpMemo');
  f.sell = g('mpSell').replace(/[^\d]/g, ''); f.npct = g('mpNpct');
  const m = document.querySelector('input[name="mpMethod"]:checked'); if (m) f.method = m.value;
  if ($('mpRecv')) { f.receiver = g('mpRecv'); f.phone = g('mpPhone'); f.addr = g('mpAddr'); }
}
// 🛒 구매대행 = 재고·배송과 별도 탭(루크 10-07)
async function viewBuy() {
  loading();
  await loadPurchases();
  if (cur === 'buy') renderBuy();
}
function renderBuy() {
  const d = PUR.data;
  let h = '';
  if (d && !d.error) {
    const b = Number(d.balance || 0);
    h += `<div class="card bal ${b < 0 ? 'neg' : ''}"><span>${b < 0 ? '미수금' : '선불 잔액'}</span>
        <span><b>${Math.abs(b).toLocaleString()}원</b><button class="btn mini" style="margin-left:8px" onclick="openRecharge()">충전</button></span></div>`;
  }
  $('pane').innerHTML = h + panePur();
  try { mpNeedHint(); } catch (_) {}
}
function mpItemMargin(x) {
  const sell = Number(x.sellPrice || 0), qty = Number(x.qty || 0);
  if (!(sell > 0) || !(qty > 0)) return '';
  const npct = Number(x.naverPct || 0) || dealFeePct();
  const done = x.charged > 0;
  const cost = done ? (x.price + x.shipFee) / qty : x.max / qty;
  const r = mpMargin(sell, cost, npct);
  if (done) { r.m = sell - cost - r.naver - x.fee / qty; r.rate = r.m / sell * 100; }
  return `<div class="m" style="color:${r.m < 0 ? '#c0392b' : '#1f6b3a'}">💰 ${done ? '실제' : '예상(상한가 기준)'} 마진 개당 <b>${mWon(r.m)}</b> (${r.rate.toFixed(1)}%) · 판매가 ${mWon(sell)}</div>`;
}
function panePur() {
  const d = PUR.data;
  if (!d) return `<div class="empty">불러오는 중…</div>`;
  if (d.error) return `<div class="empty">${/unknown action/.test(d.error) ? '구매대행 기능이 아직 준비 중이에요.' : '불러오지 못했어요.'}</div>`;
  const f = PUR.form, pct = Math.round(purRate() * 100), held = Number(d.held || 0);
  const npct = f.npct !== '' ? f.npct : String(dealFeePct());
  let h = `<div class="card purIntro">🛒 <b>코치가 대신 구매해드려요.</b><br>
    · 수수료: <b>실제 구매가의 ${pct}%</b> · 결제: 선불잔액 차감<br>
    · 신청하려면 <b>구매요청 상한가 + 수수료</b>만큼 잔액이 필요해요. 실제로는 산 금액만큼만 빠져요.
    ${held > 0 ? `<br>· 진행 중 구매대행에 ${held.toLocaleString()}원 잡혀 있어요 → 쓸 수 있는 잔액 <b>${Number(d.available || 0).toLocaleString()}원</b>` : ''}</div>`;
  h += `<div class="sec">✏️ 새 구매대행 신청</div><div class="card">
    <label class="lbl">카탈로그명</label><input id="mpProduct" type="text" placeholder="예) 시카플라스트 B5 100ml" value="${esc(f.product)}">
    <label class="lbl">구매처 링크 (있으면)</label><input id="mpLink" type="url" placeholder="https://..." value="${esc(f.link)}">
    <label class="lbl">옵션 (선택)</label><input id="mpOption" type="text" value="${esc(f.option)}">
    <label class="lbl">수량</label><input id="mpQty" type="number" inputmode="numeric" min="1" value="${f.qty || 1}" oninput="mpNeedHint()">
    <label class="lbl">구매요청 상한가 (배송비 포함 · 수량 전체 · 원)</label>
    <input id="mpMax" type="text" inputmode="numeric" placeholder="이 금액을 넘으면 사지 않아요" value="${esc(f.max)}" oninput="mpNeedHint()">
    <div id="mpNeed" class="muted" style="font-size:12.5px;margin-top:6px"></div>
    <label class="lbl">받는 방법</label>
    <label style="display:block;margin:4px 0"><input type="radio" name="mpMethod" value="${M_PUR_INV}" ${f.method !== M_PUR_DIRECT ? 'checked' : ''} onchange="mpMethod()"> 📦 내 재고로 입고</label>
    <label style="display:block;margin:4px 0"><input type="radio" name="mpMethod" value="${M_PUR_DIRECT}" ${f.method === M_PUR_DIRECT ? 'checked' : ''} onchange="mpMethod()"> 🚚 고객에게 바로 배송</label>
    ${f.method === M_PUR_DIRECT ? `
      <label class="lbl">받는사람</label><input id="mpRecv" type="text" value="${esc(f.receiver)}">
      <label class="lbl">연락처</label><input id="mpPhone" type="tel" value="${esc(f.phone)}">
      <label class="lbl">주소</label><input id="mpAddr" type="text" value="${esc(f.addr)}">` : ''}
    <label class="lbl">요청 메모 (선택)</label><input id="mpMemo" type="text" placeholder="코치에게 전할 말" value="${esc(f.memo)}">
    ${bizNoField('mpBiz')}
    <div class="purCalc">
      <b>💰 마진 미리 보기</b> <span class="muted" style="font-size:12px">(개당 · 선택)</span>
      <label class="lbl">내 판매가 (개당 · 원)</label><input id="mpSell" type="text" inputmode="numeric" placeholder="네이버에 올릴 가격" value="${esc(f.sell)}" oninput="mpNeedHint()">
      <label class="lbl">네이버 수수료 (%)</label><input id="mpNpct" type="number" inputmode="decimal" step="0.1" value="${esc(npct)}" oninput="mpNeedHint()">
      <div id="mpCalcOut" style="margin-top:8px;font-size:13px"></div>
    </div>
    <div class="row" style="margin-top:12px"><button class="btn" id="mpBtn" onclick="mpSubmit()">🛒 구매대행 신청</button></div></div>`;
  const items = d.items || [];
  h += `<div class="sec">📋 내 구매대행 (${items.length})</div>`;
  if (!items.length) h += `<div class="empty">아직 신청한 구매대행이 없어요.</div>`;
  h += items.map(x => {
    const money = x.charged > 0
      ? `결제 ${x.charged.toLocaleString()}원 (구매가 ${x.price.toLocaleString()} + 배송비 ${x.shipFee.toLocaleString()} + 수수료 ${x.fee.toLocaleString()})`
      : `상한가 ${x.max.toLocaleString()}원`;
    const st = String(x.status || '접수');
    const cls = /취소|품절/.test(st) ? 'cancel' : (/완료/.test(st) ? 'done' : (st === '구매중' ? 'ing' : 'wait'));
    return `<div class="item"><div class="h"><b>${esc(x.product || x.link)}${x.option ? ' · ' + esc(x.option) : ''}</b><span class="purBadge ${cls}">${esc(st)}</span></div>
      <div class="m">${esc(fmtDT(x.at))} · 수량 ${x.qty} · ${esc(x.method || '')}<br>${money}${x.order ? `<br>주문/송장 ${esc(x.order)}` : ''}</div>
      ${mpItemMargin(x)}
      ${x.bizNo ? `<div class="m">🧾 현금영수증 ${esc(x.bizNo)}</div>` : ''}
      ${x.note ? `<div class="m" style="color:#4a3d7a">💬 코치: ${esc(x.note)}</div>` : ''}
      ${x.canCancel ? `<div class="row" style="margin-top:8px"><button class="btn mini ghost" onclick="mpCancel('${esc(x.id)}')">신청 취소</button></div>` : ''}</div>`;
  }).join('');
  return h;
}
window.mpNeedHint = function () {
  const el = $('mpNeed'), mx = $('mpMax'); if (!el || !mx) return;
  const max = Number(String(mx.value || '').replace(/[^\d]/g, '')) || 0;
  const qty = Math.max(1, Number(($('mpQty') || {}).value) || 1);
  if (!max) el.textContent = '';
  else {
    const need = purNeed(max), avail = Number((PUR.data && PUR.data.available) || 0);
    el.innerHTML = `필요 잔액 <b>${need.toLocaleString()}원</b>` + (need > avail ? ` · <span style="color:#c0392b">${(need - avail).toLocaleString()}원 부족</span>` : ' · ✅ 신청 가능');
  }
  const out = $('mpCalcOut'); if (!out) return;
  const sell = Number(String(($('mpSell') || {}).value || '').replace(/[^\d]/g, '')) || 0;
  const npct = Number(($('mpNpct') || {}).value) || 0;
  if (!sell || !max) { out.innerHTML = `<span class="muted">판매가와 구매요청 상한가를 넣으면 개당 마진이 계산돼요.</span>`; return; }
  const cost = max / qty, r = mpMargin(sell, cost, npct);
  const row = (a, b, st) => `<div style="display:flex;justify-content:space-between;padding:2px 0;${st || ''}"><span>${a}</span><span>${b}</span></div>`;
  out.innerHTML = row('판매가', mWon(sell)) + row(`− 구매가 (상한가 ÷ ${qty}개)`, mWon(cost)) +
    row(`− 네이버 수수료 ${npct}%`, mWon(r.naver)) + row(`− 구매대행 수수료 ${Math.round(purRate() * 100)}%`, mWon(r.agent)) +
    row('= 개당 마진', `${mWon(r.m)} (${r.rate.toFixed(1)}%)`, `border-top:1px solid #e3dcc0;margin-top:4px;padding-top:6px;font-weight:800;color:${r.m < 0 ? '#c0392b' : '#1f6b3a'}`) +
    `<div class="muted" style="font-size:11.5px;margin-top:4px">상한가로 계산한 '최소' 마진이에요. 더 싸게 사면 늘어나요. (택배비 등 제외)</div>`;
};
window.mpMethod = function () { purGrab(); renderBuy(); };
function mpShort(r) {
  sheet(`<h3>💳 잔액을 먼저 충전해주세요</h3>
    <p>구매대행은 <b>구매요청 상한가 + 수수료</b>만큼 잔액이 있어야 신청할 수 있어요.</p>
    <div class="msgBox">필요 금액 <b>${Number(r.need || 0).toLocaleString()}원</b><br>현재 잔액 ${Number(r.balance || 0).toLocaleString()}원${Number(r.held || 0) > 0 ? ` (진행 중 ${Number(r.held).toLocaleString()}원 잡혀 있음)` : ''}<br>
    <b style="color:#c0392b">${Number(r.short || 0).toLocaleString()}원 이상 충전</b> 후 다시 신청해주세요.</div>
    <p class="muted" style="font-size:12.5px">매일 밤 10시에 입금 확인 후 잔액에 반영돼요. 입력한 내용은 남아 있어요.</p>
    <div class="row">${BRAIN.rechargeUrl ? `<button class="btn" onclick="closeSheet(true);openRecharge()">💳 충전하기</button>` : ''}<button class="btn ghost" onclick="closeSheet(true)">돌아가기</button></div>`);
}
window.mpSubmit = async function () {
  purGrab();
  const f = PUR.form;
  if (!f.product && !f.link) { alert('카탈로그명이나 구매처 링크를 적어주세요.'); return; }
  if (!(f.qty >= 1)) { alert('수량을 확인해주세요.'); return; }
  if (!(Number(f.max) >= 1000)) { alert('구매요청 상한가(배송비 포함, 수량 전체)를 적어주세요.'); return; }
  if (f.method === M_PUR_DIRECT && (!f.receiver || !f.phone || !f.addr)) { alert('바로 배송은 받는사람·연락처·주소가 필요해요.'); return; }
  const bizNo = bizNoTake('mpBiz'); if (bizNo === undefined) return;
  const need = purNeed(f.max), avail = Number((PUR.data && PUR.data.available) || 0);
  if (need > avail) { mpShort({ need, balance: PUR.data && PUR.data.balance, held: PUR.data && PUR.data.held, short: need - avail }); return; }
  if (!confirm(`구매대행을 신청할까요?\n\n${f.product || f.link} × ${f.qty}\n구매요청 상한가 ${Number(f.max).toLocaleString()}원 (배송비 포함)\n수수료: 실제 구매가의 ${Math.round(purRate() * 100)}%`)) return;
  const btn = $('mpBtn'); if (btn) { btn.disabled = true; btn.textContent = '신청 중…'; }
  try {
    const d = await dlApi('submitPurchase', { product: f.product, link: f.link, option: f.option, qty: f.qty, max: Number(f.max),
      method: f.method, receiver: f.receiver, phone: f.phone, addr: f.addr, memo: f.memo,
      sellPrice: Number(f.sell) || 0, naverPct: Number(f.npct) || 0, bizNo });
    if (d && d.ok) {
      PUR.form = { product: '', link: '', option: '', qty: 1, max: '', method: f.method, receiver: '', phone: '', addr: '', memo: '', sell: '', npct: f.npct };
      toast('구매대행을 신청했어요 🛒');
      await loadPurchases(); renderBuy();
    } else if (d && d.blocked === '잔액부족') { if (btn) { btn.disabled = false; btn.textContent = '🛒 구매대행 신청'; } mpShort(d); }
    else { if (btn) { btn.disabled = false; btn.textContent = '🛒 구매대행 신청'; } alert((d && d.error) || '신청하지 못했어요.'); }
  } catch (_) { if (btn) { btn.disabled = false; btn.textContent = '🛒 구매대행 신청'; } alert('연결 오류로 신청하지 못했어요.'); }
};
window.mpCancel = async function (id) {
  if (!confirm('이 구매대행 신청을 취소할까요?')) return;
  try {
    const d = await dlApi('cancelPurchase', { id });
    if (d && d.ok) { toast('신청을 취소했어요'); await loadPurchases(); renderBuy(); }
    else alert((d && d.error) || '취소하지 못했어요.');
  } catch (_) { alert('연결 오류로 취소하지 못했어요.'); }
};

// ══════════ 🤝 공동구매 (모바일) — PC와 같은 규칙 ══════════
//  신청 즉시 선불잔액 차감 → 신청자에게만 제품 공개(서버가 신청자에게만 내려줌) → 내 재고로 입고.
let GB = { data: null };
async function viewGroupBuy() {
  loading();
  try { const d = await dlApi('getGroupBuys'); GB.data = d && d.ok ? d : { error: (d && d.error) || '' }; }
  catch (_) { GB.data = { error: 'net' }; }
  if (cur === 'gb') renderGroupBuy();
}
function renderGroupBuy() {
  const d = GB.data || {};
  if (d.error) { $('pane').innerHTML = `<div class="empty">${/unknown action/.test(d.error) ? '공동구매 기능이 아직 준비 중이에요.' : '불러오지 못했어요.'}<br><br><button class="btn mini" onclick="viewGroupBuy()">다시 시도</button></div>`; return; }
  const b = Number(d.balance || 0);
  let h = `<div class="card bal ${b < 0 ? 'neg' : ''}"><span>${b < 0 ? '미수금' : '선불 잔액'}</span>
      <span><b>${Math.abs(b).toLocaleString()}원</b><button class="btn mini" style="margin-left:8px" onclick="openRecharge()">충전</button></span></div>`;
  h += `<div class="card purIntro">🤝 <b>강사가 직접 소싱한 상품을 선착순으로 나눠드려요.</b><br>
    · 신청하면 <b>필요 금액이 잔액에서 바로 차감</b>되고, 그때 제품이 공개돼요.<br>
    · 산 물건은 <b>내 재고로 바로 들어와요</b> (바로 배송요청 가능).<br>
    · 결제 후 취소는 강사에게 문의해주세요.</div>`;
  h += `<div class="card">${bizNoField('gbBiz')}</div>`;
  const items = d.items || [];
  if (!items.length) h += `<div class="empty">지금 진행 중인 공동구매가 없어요.</div>`;
  h += items.map(x => {
    const won = (n) => Math.round(Number(n) || 0).toLocaleString() + '원';
    const col = x.unitMargin < 0 ? '#c0392b' : '#1f6b3a';
    const row = (a, v, st) => `<div style="display:flex;justify-content:space-between;padding:2px 0;${st || ''}"><span>${a}</span><span>${v}</span></div>`;
    const badge = x.joined ? '<span class="purBadge done">✅ 참여 완료</span>' : (x.open ? '<span class="purBadge ing">모집중</span>' : `<span class="purBadge cancel">${esc(x.closedWhy || '마감')}</span>`);
    let c = `<div class="item gbCard ${!x.open && !x.joined ? 'closed' : ''}"><div class="h"><b>${esc(x.category || '카테고리 미정')}</b>${badge}</div>
      <div style="font-size:13px;margin-top:6px">
        ${row('개당 공구가', `<b>${won(x.price)}</b>`)}${row('1인 수량', x.per + '개')}${row('필요 금액', `<b>${won(x.need)}</b>`)}
        ${row('예상 판매가 (개당)', won(x.sell))}
        ${row(`예상 마진 (개당 · 수수료 ${x.npct}%)`, won(x.unitMargin), `color:${col};border-top:1px solid #eee;margin-top:4px;padding-top:5px`)}
        ${row(`<b>총 예상 마진 (${x.per}개)</b>`, `<b>${won(x.totalMargin)}</b>`, `color:${col}`)}
      </div>
      <div class="m" style="margin-top:6px">👥 ${x.seats > 0 ? `${x.used}/${x.seats}명${x.left > 0 ? ` · ${x.left}자리 남음` : ''}` : `${x.used}명 신청`}${x.until ? ` · ⏰ ${esc(x.until)}까지` : ''}</div>`;
    if (x.joined) {
      c += `<div class="gbReveal"><b>🎁 공개된 제품</b>
        ${x.img ? `<img class="gbImg" src="${esc(x.img)}" alt="" onerror="this.remove()">` : ''}
        <div style="font-weight:800;margin-top:4px">${esc(x.name)}${x.option ? ' · ' + esc(x.option) : ''}</div>
        ${x.desc ? `<div class="m" style="margin-top:4px">${nl2br(x.desc).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')}</div>` : ''}
        <div class="m" style="margin-top:6px">결제 ${won(x.paid)} · 내 재고에 ${x.qty}개 입고됨${x.bizNo ? `<br>🧾 현금영수증 ${esc(x.bizNo)}` : ''}</div></div>`;
    } else {
      c += `<div class="gbLock">🔒 어떤 제품인지는 신청한 분께만 공개돼요.</div>`;
      if (x.open) c += `<div class="row" style="margin-top:8px"><button class="btn gbJoin" onclick="gbJoin('${esc(x.id)}')">🤝 선착순 신청 (${won(x.need)} 차감)</button></div>`;
    }
    return c + `</div>`;
  }).join('');
  $('pane').innerHTML = h;
}
function gbShort(r) {
  const won = (n) => Math.round(Number(n) || 0).toLocaleString() + '원';
  sheet(`<h3>💳 잔액을 먼저 충전해주세요</h3>
    <p>공동구매는 신청할 때 필요 금액이 선불잔액에서 바로 빠져요.</p>
    <div class="msgBox">필요 금액 <b>${won(r.need)}</b><br>쓸 수 있는 잔액 ${won((r.balance || 0) - (r.held || 0))}<br>
    <b style="color:#c0392b">${won(r.short)} 이상 충전</b> 후 신청해주세요.</div>
    <p class="muted" style="font-size:12.5px">선착순이라 충전하는 동안 마감될 수 있어요. 매일 밤 10시에 입금 확인 후 반영돼요.</p>
    <div class="row">${BRAIN.rechargeUrl ? `<button class="btn" onclick="closeSheet(true);openRecharge()">💳 충전하기</button>` : ''}<button class="btn ghost" onclick="closeSheet(true)">돌아가기</button></div>`);
}
window.gbJoin = async function (id) {
  const x = ((GB.data && GB.data.items) || []).find(i => i.id === id); if (!x) return;
  const bizNo = bizNoTake('gbBiz'); if (bizNo === undefined) return;
  const avail = Number((GB.data && GB.data.available) || 0);
  if (x.need > avail) { gbShort({ need: x.need, balance: GB.data.balance, held: (GB.data.balance || 0) - avail, short: x.need - avail }); return; }
  if (!confirm(`🤝 공동구매 신청\n\n${x.category}\n${x.per}개 × ${x.price.toLocaleString()}원 = ${x.need.toLocaleString()}원\n\n신청하면 잔액에서 바로 차감되고 제품이 공개돼요.\n결제 후 취소는 강사 문의로만 가능해요.`)) return;
  document.querySelectorAll('.gbJoin').forEach(b => { b.disabled = true; });
  try {
    const d = await dlApi('joinGroupBuy', { id, bizNo });
    if (d && d.ok) { toast('신청 완료! 제품이 공개됐어요 🎁'); viewGroupBuy(); }
    else if (d && d.blocked === '잔액부족') { gbShort(d); renderGroupBuy(); }
    else { alert((d && d.error) || '신청하지 못했어요.'); viewGroupBuy(); }
  } catch (_) { alert('연결 오류로 신청하지 못했어요. 목록에서 다시 확인해주세요.'); viewGroupBuy(); }
};

// 💬 물류담당자 문의 (모바일) — PC '물류 문의'와 같은 두뇌(sendInquiry/getInquiries). 10-08 민원: 모바일에 문의 창이 없었다.
let INQ = { sending: false, draft: '' };
window.mpInquiry = async function () {
  sheet(`<h3>💬 물류담당자 문의</h3><div class="muted" style="font-size:13px">불러오는 중…</div>`);
  let list = [];
  try { const d = await dlApi('getInquiries'); if (d && d.ok) list = d.items || []; } catch (_) {}
  const thread = list.length ? list.slice().reverse().map(q => {
    const done = String(q.reply || '').trim();
    return `<div class="item"><div class="m" style="color:#333"><b>Q.</b> ${nl2br(q.message || '')}</div>
      <div class="m">${esc(fmtDT(q.when || q.at))} · ${done ? '✅ 답변완료' : '⏳ 답변 대기'}</div>
      ${done ? `<div class="msgBox" style="margin-top:6px"><b>답변</b><br>${nl2br(q.reply)}</div>` : ''}</div>`;
  }).join('') : `<div class="empty">아직 남긴 문의가 없어요.</div>`;
  sheet(`<h3>💬 물류담당자 문의</h3>
    <p class="muted" style="font-size:12.5px;margin:4px 0 10px">배송·재고 관련 문의를 남기면 물류담당자가 확인 후 답변드려요.<br>(오전 11시 이전 문의는 당일 오전 / 오후에는 2~3시간 이내 답변)</p>
    <textarea id="mpInqMsg" rows="3" style="width:100%;box-sizing:border-box" placeholder="예) 김수지님 배송요청 취소 부탁드려요">${esc(INQ.draft)}</textarea>
    <div class="row" style="margin:8px 0 12px"><button class="btn" id="mpInqBtn" onclick="mpInquirySend()">문의 남기기</button><button class="btn ghost" onclick="closeSheet(true)">닫기</button></div>
    <div style="max-height:45vh;overflow:auto">${thread}</div>`);
};
window.mpInquirySend = async function () {
  if (INQ.sending) return;
  const el = $('mpInqMsg'); const msg = String((el && el.value) || '').trim();
  if (!msg) { alert('문의 내용을 입력해주세요.'); return; }
  INQ.sending = true; INQ.draft = msg;
  const b = $('mpInqBtn'); if (b) { b.disabled = true; b.textContent = '보내는 중…'; }
  try {
    const d = await dlApi('sendInquiry', { message: msg });
    if (d && d.ok) { INQ.draft = ''; toast('문의를 남겼어요. 답변이 오면 알려드려요'); INQ.sending = false; mpInquiry(); return; }
    alert((d && d.error) || '보내지 못했어요. 잠시 후 다시 시도해주세요.');
  } catch (_) { alert('연결 오류로 보내지 못했어요.'); }
  INQ.sending = false; if (b) { b.disabled = false; b.textContent = '문의 남기기'; }
};

// ➕ 입고 등록 (모바일) — 화면을 다시 그려도 입력값이 날아가지 않게 따로 들고 있는다
let INB = { open: false, product: '', option: '', qty: 1, price: '', site: '', memo: '' };
function inbCollect() {
  const g = (id) => String(($(id) || {}).value || '').trim();
  if ($('inbProduct')) {
    INB.product = g('inbProduct'); INB.option = g('inbOption');
    INB.qty = Number(g('inbQty')) || 0; INB.price = g('inbPrice');
    INB.site = g('inbSite'); INB.memo = g('inbMemo');
  }
}
window.inbToggle = function () { inbCollect(); INB.open = !INB.open; renderShip(); };
window.inbSubmit = async function () {
  inbCollect();
  if (!INB.product) { alert('카탈로그명을 입력해주세요.'); return; }
  if (!(INB.qty >= 1)) { alert('수량을 확인해주세요.'); return; }
  const btn = $('inbBtn'); if (btn) { btn.disabled = true; btn.textContent = '등록 중…'; }
  try {
    const d = await dlApi('addInbound', { product: INB.product, option: INB.option, qty: INB.qty,
                                          price: INB.price, site: INB.site, memo: INB.memo });
    if (d && d.ok) {
      INB = { open: false, product: '', option: '', qty: 1, price: '', site: '', memo: '' };
      toast('입고 등록했어요 📦');
      viewShip();                       // 재고 목록까지 새로 불러온다
    } else {
      if (btn) { btn.disabled = false; btn.textContent = '➕ 입고 등록'; }
      alert((d && d.error) || '등록에 실패했어요.');
    }
  } catch (_) {
    if (btn) { btn.disabled = false; btn.textContent = '➕ 입고 등록'; }
    alert('연결 오류로 등록하지 못했어요.');
  }
};


// 재고 검색 — 띄어쓰기·대소문자 무시. 현재 재고와 입출고 내역을 한 번에 거른다.
const invNorm = (s) => String(s == null ? '' : s).toLowerCase().replace(/\s+/g, '');
const invKey = function () { return esc(invNorm(Array.prototype.join.call(arguments, ' '))); };
// 구매처 열기 — 학생이 직접 넣은 주소면 새 탭으로 연다 (주소 형태가 아니면 글자만 보여줌)
function siteUrlOf(v) {
  const t = String(v || '').trim();
  if (!t) return '';
  if (/^https?:\/\//i.test(t)) return t;
  if (/^[\w.-]+\.[a-z]{2,}([/?#]|$)/i.test(t)) return 'https://' + t;
  return '';
}
window.openBuySite = function (v) {
  const url = siteUrlOf(v);
  if (!url) { toast('구매처가 주소 형태가 아니라서 열 수 없어요.'); return; }
  window.open(url, '_blank', 'noopener');
};

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
  // ➕ 입고 등록 — PC에서만 되던 걸 폰에서도 (접었다 펼 수 있게)
  h += `<div class="sec">➕ 입고 등록 (사무실로 보낼 물건)</div>
    <div class="card">
      ${INB.open ? `
        <label class="lbl">카탈로그명</label>
        <input id="inbProduct" type="text" placeholder="예) 포레스트 샴푸" value="${esc(INB.product)}">
        <label class="lbl">옵션 (선택)</label>
        <input id="inbOption" type="text" placeholder="예) 블랙 (색상만 · 용량은 카탈로그명에)" value="${esc(INB.option)}">
        <label class="lbl">수량</label>
        <input id="inbQty" type="number" inputmode="numeric" min="1" value="${INB.qty || 1}">
        <label class="lbl">공급가 (선택)</label>
        <input id="inbPrice" type="text" inputmode="numeric" placeholder="예) 12000" value="${esc(INB.price)}">
        <label class="lbl">구매사이트 (선택)</label>
        <input id="inbSite" type="text" placeholder="예) 도매처 링크" value="${esc(INB.site)}">
        <label class="lbl">메모 (선택)</label>
        <input id="inbMemo" type="text" placeholder="예) 택배 3박스로 발송" value="${esc(INB.memo)}">
        <div class="row" style="margin-top:10px">
          <button class="btn" id="inbBtn" onclick="inbSubmit()">➕ 입고 등록</button>
          <button class="btn mini ghost" onclick="inbToggle()">접기</button>
        </div>`
      : `<p class="muted" style="margin:0 0 8px;font-size:12.5px">사무실로 보낼 물건을 등록하면 강사가 검수 후 보관해요.</p>
         <button class="btn" onclick="inbToggle()">➕ 입고 등록하기</button>`}
    </div>`;
  h += `<div class="sec">📦 현재 재고</div>`;
  h += DL.inv.length
    ? `<div class="card" style="padding:6px 12px"><table class="tbl">
        <thead><tr><th>상품</th><th style="text-align:right">수량</th></tr></thead><tbody id="invRows">` +
      dlSortByExpiry(DL.inv).map(it => {   // 표는 유통기한 임박순(원본 DL.inv는 이름순 유지)
        const p = packOf(it.product);
        const send = Math.max(0, (Number(it.qty) || 0) - (Number(it.pending) || 0));   // 검수완료 보낼수있음
        return `<tr data-s="${invKey(it.product, it.option, it.price, it.expiry, it.memo, it.site)}"><td>${esc(plainName(it.product))}${p > 1 ? `<span class="pack">${p}개입</span>` : ''}
          ${it.option ? `<div class="muted" style="font-size:11.5px">${esc(it.option)}</div>` : ''}
          ${it.memo ? `<div class="invMemo">📝 ${esc(it.memo)}</div>` : ''}
          ${it.site ? (siteUrlOf(it.site)
            ? `<div class="invSite"><a href="#" data-site="${esc(it.site)}" onclick="openBuySite(this.dataset.site);return false;">🔗 ${esc(it.site)}</a></div>`
            : `<div class="invSite">🔗 ${esc(it.site)}</div>`) : ''}${it.expiry ? `<div class="muted" style="font-size:11.5px">📅 유통기한 ${esc(it.expiry)}</div>` : ''}</td>
          <td class="n ${send <= 0 ? 'zero' : ''}">${send}${Number(it.reserved) > 0 ? `<div class="rsv">대기 ${it.reserved}</div>` : ''}${Number(it.pending) > 0 ? `<div class="pend">검수대기 ${it.pending}</div>` : ''}</td></tr>`;
      }).join('') + `<tr id="invNone1" style="display:none"><td colspan="2" class="muted">검색과 일치하는 재고가 없어요.</td></tr>`
      + `</tbody></table></div>`
    : `<div class="empty">아직 등록된 재고가 없어요.<br>위에서 입고 등록을 하면 강사 검수 후 반영돼요.</div>`;
  const hist = (DL.hist || []).slice(0, 15);
  if (hist.length) {
    h += `<div class="sec">🧾 최근 입출고</div><div id="invHist">` + hist.map((x, hi) => {
      const out = String(x.gubun || '').indexOf('출') >= 0;
      const ret = /반품|취소/.test(String(x.gubun || ''));   // 반품·취소 = 재고에서 빠진 줄
      const pk = Number(x.pack) || packOf(x.product), pks = Number(x.packs) || 0;
      // 검수 전 입고는 스스로 물릴 수 있다(서버가 canCancel 로 판정)
      const cancel = (!out && !ret)
        ? (x.canCancel
            ? `<button class="btn ghost sm" onclick="cancelInb(${hi})">입고 취소</button>`
            : (x.cancelWhy ? `<span class="lock">🔒 ${esc(String(x.cancelWhy).split('\n')[0])}</span>` : ''))
        : '';
      return `<div class="item" data-s="${invKey(x.product, x.option, x.gubun, x.memo, x.site, x.price, x.expiry, x.at)}"><div class="h">
          <span class="t">${esc(plainName(x.product))}</span>
          <span class="pill ${ret ? 'ret' : (out ? 'wait' : 'done')}">${esc(x.gubun || '')} ${ret ? '' : (out ? '-' : '+')}${x.qty}</span>
        </div><div class="m">${esc(fmtDT(x.at))}${pk > 1 && pks ? ` · 📦 ${pk}개입 × ${pks} = ${pk * pks}개` : ''}</div>${cancel ? `<div class="act">${cancel}</div>` : ''}</div>`;
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
      <select id="dlProd" onchange="dlInfo()">${inStock.map(x => {
        const p = packOf(x.it.product);
        return `<option value="${x.i}">${esc(plainName(x.it.product))}${p > 1 ? ` [${p}개입]` : ''}${x.it.option ? ' · ' + esc(x.it.option) : ''} (재고 ${x.it.qty}개)</option>`;
      }).join('')}</select>
      <div id="dlInfoBox"></div>
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
  h += `<div class="sec">📋 내 배송요청</div>`;
  if (DL.ship.length) {
    const cnt = (st) => DL.ship.filter(s => {
      const x = String(s.status || '');
      return st === 'wait' ? x.indexOf('접수') >= 0
           : st === 'done' ? x.indexOf('발송') >= 0
           : st === 'return' ? x.indexOf('반품') >= 0 : true;
    }).length;
    h += `<div class="chips shipChips">
      ${[['all','전체'],['wait','접수'],['done','발송완료'],['return','반품']].map(([k, t]) =>
        `<button type="button" class="chip ${DL.shipTab === k ? 'on' : ''}" onclick="dlShipTab('${k}')">${t}<span class="cnt">${cnt(k)}</span></button>`).join('')}
    </div>`;
  }
  const shown = DL.ship.filter(s => {
    const x = String(s.status || ''), st = DL.shipTab || 'all';
    return st === 'wait' ? x.indexOf('접수') >= 0
         : st === 'done' ? x.indexOf('발송') >= 0
         : st === 'return' ? x.indexOf('반품') >= 0 : true;
  });
  h += shown.length ? shown.map(s => {
    const st = String(s.status || '');
    const k = st.indexOf('발송완료') >= 0 ? 'done' : (st.indexOf('반품') >= 0 ? 'ret' : 'wait');
    return `<div class="item">
      <div class="h"><span class="t">${esc(plainName(s.product))}${s.option ? ' · ' + esc(s.option) : ''} × ${s.qty}</span>
        <span class="pill ${k}">${esc(st)}</span></div>
      <div class="m">${esc(s.receiver || '')} · ${esc(fmtDT(s.at))}
        ${s.invoice ? `<br>송장 ${esc(s.invoice)} ${esc(s.courier || '')}` : ''}</div>
      ${s.canCancel
        ? `<div class="row" style="margin-top:9px"><button class="btn mini ghost" onclick="dlCancel('${esc(s.at)}')">요청 취소</button></div>`
        : (st.indexOf('접수') >= 0 ? `<div class="locked">🔒 ${esc(dlOneLine(s.cancelWhy) || '변경은 물류담당자에게 문의해주세요')}</div>` : '')}
    </div>`;
  }).join('') : `<div class="empty">${DL.ship.length ? '조건에 맞는 배송요청이 없어요.' : '아직 배송요청이 없어요.'}</div>`;
  if (DL.ship.length) h += `<p class="muted" style="margin:8px 2px 0;font-size:12px">${shown.length}건 표시 중 (전체 ${DL.ship.length}건)</p>`;
  return h;
}
// 배송 목록 정렬용 시각 — 서버가 옛 버전이면 'Wed Aug 26 2026…' 로 올 수 있어 앱에서도 정규화한다
function dlWhen(v) {
  const t = String(v == null ? '' : v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t;
  const d = new Date(t);
  return isNaN(d.getTime()) ? t : (d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' ' +
    String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' +
    String(d.getSeconds()).padStart(2, '0'));
}
// 최근 배송이 위로 (수강생 요청)
function dlSortNewest(list) {
  return (list || []).map((s, i) => ({ s, i, k: dlWhen(s.at) }))
    .sort((a, b) => (a.k === b.k ? b.i - a.i : (a.k < b.k ? 1 : -1)))
    .map(x => x.s);
}
window.dlShipTab = (k) => { DL.shipTab = k; renderShip(); };

// 선택한 상품의 구매처·구매가격·입고메모 표시
window.dlInfo = function () {
  const box = $('dlInfoBox'); if (!box) return;
  const sel = $('dlProd'); if (!sel) { box.innerHTML = ''; return; }
  const it = DL.inv[Number(sel.value)];
  if (!it) { box.innerHTML = ''; return; }
  const rows = [];
  if (it.price) rows.push(['💰 구매가격', esc(String(it.price)) + '원']);
  if (it.site)  rows.push(['🔗 구매처', /^https?:\/\//i.test(it.site)
      ? `<a href="${esc(it.site)}" target="_blank" rel="noopener">${esc(it.site)}</a>`
      : esc(it.site)]);
  if (it.memo)  rows.push(['📝 입고메모', esc(it.memo)]);
  if (it.expiry) rows.push(['📅 유통기한', esc(it.expiry)]);
  box.innerHTML = rows.length
    ? `<div class="infoBox">${rows.map(r => `<div><b>${r[0]}</b><span>${r[1]}</span></div>`).join('')}</div>`
    : `<div class="infoBox muted">구매처·가격·메모가 입력되지 않은 상품이에요.</div>`;
};
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
// 서버 안내문은 줄바꿈이 있어 카드에 그대로 못 쓴다 → 첫 줄만
function dlOneLine(t){ return String(t == null ? '' : t).split('\n')[0].trim(); }
window.dlCancel = async function (at) {
  if (!confirm('이 배송요청을 취소할까요?\n\n차감된 배송비가 있으면 함께 환불돼요.')) return;
  // ⚠ 줄 번호(row)도 같이 보낸다 — 시각만 보내면 서버 시트의 날짜 형식과 달라 못 찾았다(10-08 민원). PC와 동일.
  const s = (DL.ship || []).find(x => x.at === at) || {};
  try {
    const d = await dlApi('cancelShipping', { row: s.row, at });
    if (d && d.ok) { toast('취소했어요'); viewShip(); }
    else alert((d && d.error) || '취소하지 못했어요.');
  } catch (_) { alert('연결 오류로 취소하지 못했어요.'); }
};

// 검수 전 입고 자체취소 — 잘못 넣은 입고를 수강생이 스스로 물린다(루크 요청 09-10)
window.cancelInb = async function (hi) {
  const x = (DL.hist || [])[hi]; if (!x) return;
  const n = (Number(x.pack) || 1) * (Number(x.packs) || 0);
  if (!confirm(`이 입고를 취소할까요?\n\n${plainName(x.product)}${x.option ? ' · ' + x.option : ''}`
    + `\n${n ? n + '개' : ''}\n\n재고에서 빠집니다. (기록은 남아요)`)) return;
  try {
    const d = await dlApi('cancelInbound', { row: x.row, at: x.at });
    if (d && d.ok) { toast('입고를 취소했어요'); viewShip(); }
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


// ── 물류담당자 메시지: 확인 눌러야 닫히는 팝업 ──────────
let MSG = { queue: [], showing: false };
const msgAck = () => store.get('dlMsgAck', {}) || {};
const msgAckSave = (m) => store.set('dlMsgAck', m);

async function checkLogisticsMessages() {
  if (!session || !BRAIN.deliveryUrl) return;
  let d;
  try { d = await dlApi('getDeliveryAlerts'); } catch (_) { return; }
  if (!d || !d.ok) return;
  const list = d.inquiries || [];
  const ack = msgAck();
  if (!store.get('dlMsgInit', false)) {          // 처음 켠 기기: 기존 메시지는 읽음 처리
    list.forEach(q => { const t = String(q.reply || '').trim(); if (t) ack[q.at] = t; });
    msgAckSave(ack); store.set('dlMsgInit', true);
    return;
  }
  list.forEach(q => {
    const t = String(q.reply || '').trim();
    if (t && ack[q.at] !== t && !MSG.queue.some(x => x.at === q.at)) MSG.queue.push(q);
  });
  showNextMsg();
}

function showNextMsg() {
  if (MSG.showing || !MSG.queue.length) return;
  const q = MSG.queue[0];
  MSG.showing = true;
  const more = MSG.queue.length > 1 ? `<p class="muted" style="margin-top:10px">읽지 않은 메시지가 ${MSG.queue.length - 1}개 더 있어요. <a href="#" onclick="ackAllMsg();return false">남은 메시지 모두 확인</a></p>` : '';
  const qMsg = String(q.message || '').trim();   // 어떤 문의에 대한 답변인지 원래 질문도 보여줌
  const qBox = qMsg ? `<div class="msgQ"><b>내 문의</b><br>${nl2br(qMsg)}</div>` : '';
  sheet(`<h3>💬 물류담당자 답변</h3>
    ${qBox}<div class="msgBox"><b>답변</b><br>${nl2br(q.reply || '')}</div>${more}
    <div class="row"><button class="btn" onclick="ackMsg()">확인했어요</button></div>`, true);
}
window.ackAllMsg = function () {   // 남은 메시지 한 번에 읽음 처리
  const m = msgAck();
  MSG.queue.forEach(q => { m[q.at] = String(q.reply || '').trim(); });
  msgAckSave(m);
  MSG.queue = []; MSG.showing = false;
  closeSheet(true);
};
window.ackMsg = function () {
  const q = MSG.queue.shift();
  if (q) { const m = msgAck(); m[q.at] = String(q.reply || '').trim(); msgAckSave(m); }
  MSG.showing = false;
  closeSheet(true);
  if (MSG.queue.length) setTimeout(showNextMsg, 250);
};

// ══════════ 💰 마진 계산기 (묶음 → 낱개 분할 판매) ══════════
//  여러 개 들어있는 묶음을 사와서 1개(또는 몇 개)씩 나눠 파는 방식에 맞춰져 있다.
//   · bundlePrice 묶음 하나를 사는 데 실제로 나간 돈 (배송비까지 포함한 결제금액)
//   · bundleQty   그 묶음 안에 들어있는 개수
//   · sellQty     한 번 주문에 몇 개씩 보내는지 (보통 1)
//   · price       그 한 건의 판매가
//   · ship        내가 보낼 때 드는 택배비
//   · feeRate     판매 수수료 % (결제수수료 + 매출연동수수료)
function marginCalc(inp) {
  const bundlePrice = Math.max(0, Number(inp.bundlePrice) || 0);
  const point       = Math.max(0, Number(inp.point) || 0);        // 공급가에서 빠지는 포인트·할인
  const netBundle   = Math.max(0, bundlePrice - point);           // 실제로 나간 돈
  const bundleQty   = Math.max(0, Number(inp.bundleQty) || 0);
  const sellQty     = Math.max(1, Number(inp.sellQty) || 1);
  const price = Math.max(0, Number(inp.price) || 0);
  const ship  = Math.max(0, Number(inp.ship) || 0);
  const feeR  = Math.max(0, Number(inp.feeRate) || 0) / 100;

  const unitCost = bundleQty > 0 ? netBundle / bundleQty : 0;    // 개당 원가 (포인트 뺀 뒤)
  const cost = unitCost * sellQty;                               // 한 건에 나가는 원가
  const fee  = Math.round(price * feeR);                         // 판매 수수료
  const profit = price - cost - ship - fee;                      // 한 건 순이익
  const rate = price > 0 ? (profit / price) * 100 : 0;           // 마진율(판매가 대비)
  const roi  = cost  > 0 ? (profit / cost) * 100 : 0;            // 원가 대비 수익률

  const sets = sellQty > 0 ? Math.floor(bundleQty / sellQty) : 0; // 묶음 하나로 몇 건 팔 수 있나
  const leftover = bundleQty - sets * sellQty;                    // 팔고 남는 개수
  const totalProfit = sets * profit;                              // 다 팔았을 때 총 이익
  const totalRoi = netBundle > 0 ? (totalProfit / netBundle) * 100 : 0;
  return { price, bundlePrice, point, netBundle, bundleQty, sellQty, unitCost, cost, ship, fee,
           profit, rate, roi, sets, leftover, totalProfit, totalRoi };
}

// 목표 마진율(%)을 남기려면 얼마에 팔아야 하나 → 권장 판매가
//   순이익 = 판매가 − 원가 − 택배비 − 판매가×수수료율 = 판매가 × 목표율
//   → 판매가 × (1 − 수수료율 − 목표율) = 원가 + 택배비
function marginTargetPrice(inp, targetRate) {
  const bundleQty = Math.max(0, Number(inp.bundleQty) || 0);
  const sellQty   = Math.max(1, Number(inp.sellQty) || 1);
  const net = Math.max(0, (Number(inp.bundlePrice) || 0) - (Number(inp.point) || 0));   // 포인트 뺀 실제 지출
  const unitCost  = bundleQty > 0 ? (net / bundleQty) : 0;
  const cost = unitCost * sellQty;
  const ship = Math.max(0, Number(inp.ship) || 0);
  const feeR = Math.max(0, Number(inp.feeRate) || 0) / 100;
  const m    = (Number(targetRate) || 0) / 100;
  const den  = 1 - feeR - m;
  if (den <= 0) return null;                     // 수수료 + 목표마진이 100% 이상 → 불가능
  return Math.ceil(((cost + ship) / den) / 10) * 10;   // 10원 단위 올림
}
const wonFmt = (n) => (Math.round(Number(n) || 0)).toLocaleString('ko-KR');

const MG_DEF = { ship: 3000, feeRate: 6.7 };
function mgPrefs() { return Object.assign({}, MG_DEF, store.get('marginPrefs2', {}) || {}); }

function viewMargin() {
  const p = mgPrefs();
  $('pane').innerHTML = `
    <div class="sec">💰 마진 계산기</div>
    <div id="mgFrom" class="card mgFrom" style="display:none"></div>
    <div class="card">
      <p class="muted" style="margin:0 0 8px;font-size:12.5px"><b>여러 개 묶음으로 사와서 1개씩 나눠 파는</b> 방식에 맞춘 계산기예요.</p>
      <div class="mgSec">1️⃣ 얼마에 사오나요?</div>
      <label class="lbl">묶음 구매가 (원)</label><input id="mgBundlePrice" type="text" inputmode="numeric" placeholder="24000" oninput="mgRun()">
      <label class="lbl">묶음 수량 (개)</label><input id="mgBundleQty" type="text" inputmode="numeric" placeholder="10" oninput="mgRun()">
      <label class="lbl">포인트 · 할인 (원)</label><input id="mgPoint" type="text" inputmode="numeric" placeholder="공급가에서 빠지는 금액" oninput="mgRun()">
      <div id="mgUnit"></div>
    </div>
    <div class="card">
      <div class="mgSec">2️⃣ 얼마에 파나요?</div>
      <label class="lbl">한 번에 보낼 개수</label><input id="mgSellQty" type="text" inputmode="numeric" value="1" oninput="mgRun()">
      <label class="lbl">판매가 (원)</label><input id="mgPrice" type="text" inputmode="numeric" placeholder="6900" oninput="mgRun()">
      <label class="lbl">택배비 (원)</label><input id="mgShip" type="text" inputmode="numeric" value="${p.ship}" oninput="mgRun()">
      <label class="lbl">수수료 (%)</label><input id="mgFee" type="text" inputmode="decimal" value="${p.feeRate}" oninput="mgRun()">
    </div>
    <div id="mgOut"></div>
    <div class="sec">🎯 목표 마진율로 판매가 계산</div>
    <div class="mgTargets">${[10,15,20,25,30,40].map(t => `<button type="button" class="mgT" onclick="mgTarget(${t})">${t}%</button>`).join('')}</div>
    <div id="mgTargetOut"></div>
    <div class="card muted" style="font-size:11.5px;line-height:1.8;margin-top:12px">
      · <b>묶음 구매가</b>는 그 묶음을 받기까지 실제로 나간 돈이에요. 사올 때 낸 배송비도 넣어주세요.<br>
      · 수수료는 결제수수료 + 매출연동수수료 합계예요. 스마트스토어는 보통 <b>6.7%</b> 예요.
    </div>`;
  applyMgPrefill();
  mgRun();
}

// '오늘의 할인'에서 넘어온 값 채우기 (사온 값=딜 가격, 팔 값=카탈로그 최저가보다 10원 싸게)
let MG_PREFILL = null;
function applyMgPrefill() {
  if (!MG_PREFILL) return;
  const p = MG_PREFILL; MG_PREFILL = null;
  const set = (id, v) => { if (v && $(id)) $(id).value = v; };
  set('mgBundlePrice', p.bundlePrice); set('mgBundleQty', p.bundleQty || 1);
  set('mgPoint', p.point); set('mgSellQty', p.sellQty || 1); set('mgPrice', p.price);
  set('mgFee', p.feeRate);              // 할인 탭에서 정한 수수료
  if (p.ship !== undefined && $('mgShip')) $('mgShip').value = p.ship;   // 구성 같으면 0원
  const box = $('mgFrom');
  if (box && p.name) {
    box.style.display = '';
    box.innerHTML = `🏷️ <b>오늘의 할인</b>에서 가져왔어요<div class="muted" style="margin-top:4px;font-size:12px">${esc(p.name)}</div>`
      + (p.price ? `<div class="muted" style="margin-top:4px;font-size:11.5px">팔 값은 네이버 최저가보다 10원 싸게 잡은 값이에요. 고쳐도 돼요.</div>` : '');
  }
}
// ── 내 적립 설정 (수강생마다 다름) ──────────────────
//  G마켓 '최대 적립'에는 현대카드 7% 같은 1회성 혜택이 섞여 있어서 그대로 쓰면
//  매입가가 실제보다 싸게 잡히고 마진이 부풀려진다. 각자 받는 것만 켜서 쓴다.
//  적립 제도는 마켓마다 다르다 — G마켓·옥션은 한 회사(스마일클럽)라 같이 쓰고,
//  화해는 기본 적립 5% 하나뿐이다(루크 확인 09-08). 그래서 마켓별로 따로 켠다.
const DEAL_PT = [
  { key: 'member',  rate: 5,   label: '꼭멤버 5%',      def: true,  mkt: 'ebay'   },
  { key: 'smile',   rate: 2,   label: '스마일카드 2%',   def: false, mkt: 'ebay'   },
  { key: 'hyundai', rate: 0.7, label: '꼭현대카드 0.7%', def: false, mkt: 'ebay'   },
  { key: 'hwbase',  rate: 5,   label: '기본적립 5%',     def: true,  mkt: 'hwahae' },
  // 11번가가 목록에 보여주는 '11pay 최대 N P' 는 카드 혜택까지 섞인 값이라 쓰지 않는다.
  //  루크가 정한 기준(09-09): 기본적립 0.5% 는 누구나, 11번가카드 2% 는 카드 있는 사람만.
  { key: 'st11base', rate: 0.5, label: '기본적립 0.5%',  def: true,  mkt: 'st11' },
  { key: 'st11card', rate: 2,   label: '11번가카드 2%', def: false, mkt: 'st11' },
  // 네이버+스토어 — 루크가 정한 기준(09-10): 기본적립 1% 는 누구나, 멤버십 4% 는 가입자만
  { key: 'npbase',   rate: 1,   label: '기본적립 1%',    def: true,  mkt: 'nplus' },
  { key: 'npmember', rate: 4,   label: '멤버십 적립 4%',  def: false, mkt: 'nplus' },
  // SSG — SSG머니 적립. 기준을 루크가 정할 때까지 꺼둔다(꺼짐=적립 0=보수적)
  { key: 'ssgmoney', rate: 1,   label: 'SSG머니 적립 1%', def: false, mkt: 'ssg' },
  // 쿠팡 — 로켓와우는 무료배송 혜택뿐, 표준 적립이 없다. 목록가가 곧 매입가라 적립 0(보수적).
  // 컬리(뷰티컬리) — 컬리페이/카드혜택가 없음. 목록가가 곧 매입가라 적립 0(보수적).
];
const DEAL_PT_GRP = [
  { id: 'ebay',    name: 'G마켓·옥션' },
  { id: 'hwahae',  name: '화해' },
  { id: 'st11',    name: '11번가' },
  { id: 'nplus',   name: '네이버+스토어' },
  { id: 'ssg',     name: 'SSG' },
  { id: 'coupang', name: '쿠팡' },
  { id: 'kurly',   name: '컬리' },
];
function dealPtGrpOf(market) {
  const m = String(market || '');
  if (m === '화해') return 'hwahae';
  if (m === '11번가') return 'st11';
  if (m === '네이버+스토어') return 'nplus';
  if (m === 'SSG') return 'ssg';
  if (m === '쿠팡') return 'coupang';
  if (m === '컬리') return 'kurly';
  return 'ebay';
}
const DEAL_FEE_DEF = 6.7, DEAL_SHIP = 3000;
function dealFeePct() {
  const v = Number(store.get('dealFeePct', NaN));
  return (isFinite(v) && v > 0 && v < 30) ? v : DEAL_FEE_DEF;
}
window.setDealFee = function (val) {
  let v = Number(String(val).replace(/[^0-9.]/g, ''));
  if (!isFinite(v) || v <= 0 || v >= 30) v = DEAL_FEE_DEF;
  store.set('dealFeePct', v);
  renderDeals();
};
function dealPtCfg() {
  const saved = store.get('dealPointCfg', null);
  const out = {};
  DEAL_PT.forEach(p => { out[p.key] = saved && (p.key in saved) ? !!saved[p.key] : p.def; });
  return out;
}
window.toggleDealPt = function (key) {
  const c = dealPtCfg(); c[key] = !c[key];
  store.set('dealPointCfg', c);
  renderDeals();
};
function dealPtRateOf(gid) {
  const c = dealPtCfg();
  return DEAL_PT.reduce((s, p) => s + (p.mkt === gid && c[p.key] ? p.rate : 0), 0) / 100;
}
function dealPtRate(market) { return dealPtRateOf(dealPtGrpOf(market)); }
function dealPtBar() {
  const c = dealPtCfg();
  const grp = DEAL_PT_GRP.map(g => {
    const pct = (dealPtRateOf(g.id) * 100).toFixed(1).replace(/\.0$/, '');
    return `<span class="dealPtGrp"><i>${g.name} <b>${pct}%</b></i>${
      DEAL_PT.filter(p => p.mkt === g.id).map(p => `<label class="dealPtChk">
        <input type="checkbox" ${c[p.key] ? 'checked' : ''}
          onchange="toggleDealPt('${p.key}')"> ${p.label}</label>`).join('')}</span>`;
  }).join('');
  return `<div class="card dealPtBar">💳 내 적립
    ${grp}
    <span class="dealFeeBox">판매수수료
      <input type="text" inputmode="decimal" value="${dealFeePct()}"
        onchange="setDealFee(this.value)">%</span>
    <span class="dealPtNote">내가 실제로 받는 적립만 켜고, 수수료는 내 스토어 기준으로 고쳐주세요 · 이 값으로 마진을 계산해요</span></div>`;
}
function dealBuy(it) {
  const price = Number(it.price) || 0, cp = Number(it.cardPrice) || 0;
  return (cp > 0 && cp < price && cp >= price * 0.5) ? cp : price;
}
// 네이버 슈퍼적립처럼 '그 상품만 적립이 큰' 것은 목록에 적힌 적립금을 그대로 쓴다(루크 09-10).
//  판매페이지(상세) 적립금은 리뷰 적립까지 섞여 있어 쓰면 안 된다 → 수집기가 목록 값만 담아 온다.
function dealPoint(it) {
  const p = Number(it.point) || 0;
  if (String(it.market || '') === '네이버+스토어' && p > 0) return p;
  return Math.round(dealBuy(it) * dealPtRate(it.market));
}
// 카드 결제할인가·적립 — 상세페이지에서 못 가져왔으면 아무것도 안 보인다
function dealCardLine(it) {
  const cp = Number(it.cardPrice) || 0, pt = dealPoint(it), price = Number(it.price) || 0;
  let out = '';
  if (cp > 0 && price > 0 && cp < price) {
    const why = String(it.cardDesc || '').replace(/결제할인.*$/, '').trim();   // '스마일카드 10%' 만
    out += `<span class="dealCard2">→ ${cp.toLocaleString()}원 <i>${esc(why || '카드할인')}</i></span>`;
  }
  if (pt > 0) out += `<span class="dealPoint2">적립 ${pt.toLocaleString()}원</span>`;
  return out;
}
// 판매가는 카탈로그 최저가보다 10원 싸게 — 최저가 자리를 잡아야 실제로 팔린다
function dealSellPrice(base, it) {
  return Math.max(0, (Number(base) || 0) - (Number(it.naverUndercut) || 0));
}
// 마진은 앱에서 다시 계산한다 — 적립 설정이 사람마다 달라서 서버 값을 그대로 쓸 수 없다
// 택배비가 드는가 — 위탁으로 보낼 수 있으면 안 든다(루크 기준 09-07).
//  배수 1   → 딜 1개 그대로 위탁 → 0원
//  배수 0.5 → 딜 2개를 주문해 손님에게 바로 위탁 → 0원 (내가 받아서 합치는 게 아니다)
//  배수 4   → 4개들이를 받아 1개씩 쪼개 보내야 함 → 3,000원
//  즉, 딜을 정수 개 주문해 카탈로그 구성과 딱 맞출 수 있으면 위탁이다.
function dealShipFor(ratio) {
  const r = Number(ratio) || 0;
  if (!r) return DEAL_SHIP;
  const k = 1 / r;                        // 카탈로그 1건을 채우는 데 필요한 딜 개수
  return (Math.abs(k - Math.round(k)) < 0.01 && Math.round(k) >= 1) ? 0 : DEAL_SHIP;
}
function dealMarginOf(it, base, ratio) {
  const r = Number(ratio) || 0;
  const b = Number(base) || 0;
  if (!r || b <= 0) return null;
  const sell = Math.max(0, b - (Number(it.naverUndercut) || 0));
  const net = Math.max(0, dealBuy(it) - dealPoint(it));
  return Math.round(sell - net / r - dealShipFor(r) - sell * (dealFeePct() / 100));
}
function dealMargins(it) {
  return { rep: dealMarginOf(it, it.naverRepPrice, it.ratioRep),
           unit: dealMarginOf(it, it.naverUnitPrice, it.ratioUnit) };
}
function dealBestMargin(it) {
  const m = dealMargins(it);
  const xs = [m.rep, m.unit].filter(v => v !== null);
  return xs.length ? Math.max.apply(null, xs) : null;
}
function dealToMargin(code) {
  const it = (DEALS.items || []).find(x => String(x.goodscode) === String(code));
  if (!it) return;
  const price = Number(it.price) || 0, cp = Number(it.cardPrice) || 0;
  const unit = Number(it.naverUnitPrice) || 0, rep = Number(it.naverRepPrice) || 0;
  MG_PREFILL = {
    name: it.name,
    bundlePrice: dealBuy(it),
    bundleQty: Number(it.dealQty) || 1,   // 딜 하나에 '네이버 1건'이 몇 개 들어있나
    point: dealPoint(it),                 // 내 적립 설정 기준
    feeRate: dealFeePct(),                // 할인 탭에서 정한 수수료 그대로
    ship: dealShipFor(Number(it.ratioUnit) || Number(it.ratioRep) || 0),
    sellQty: 1,                           // 한 번에 그 1건씩 판다
    price: dealSellPrice(unit > 0 ? unit : rep, it)
  };
  go('margin');
}
// 네이버 가격비교와 견준 줄 — 먼저 뜨는 수량과 1개 단위 딱 둘만 본다
function dealNaverLine(it) {
  const rep = Number(it.naverRepPrice) || 0, repQ = Number(it.naverRepQty) || 0;
  const unit = Number(it.naverUnitPrice) || 0;
  if (rep <= 0 && unit <= 0) return '';
  const m = dealMargins(it);
  const money = (v) => (v > 0 ? '+' : '') + v.toLocaleString() + '원';
  const row = (label, base, margin, qtyTxt) => {
    let h = `<span class="dealNvPrice">${qtyTxt} 최저 <b>${base.toLocaleString()}원</b></span>`;
    if (margin !== null) h += `<span class="${margin > 0 ? 'dealWin' : 'dealLose'}">${label} ${money(margin)}</span>`;
    return `<div class="dealNvRow">${h}</div>`;
  };
  let out = '';
  if (repQ === 1 || (rep > 0 && unit === rep)) {
    out += row('낱개', rep, m.unit !== null ? m.unit : m.rep, '네이버 1개');
  } else {
    if (rep > 0) out += row('묶음', rep, m.rep, `네이버 ${repQ || '?'}개`);
    if (unit > 0) out += row('낱개', unit, m.unit, '네이버 1개');
  }
  return `<div class="dealNaver">${out}</div>`;
}


function mgNum(id) { const el = $(id); return el ? Number(String(el.value).replace(/[^0-9.]/g, '')) || 0 : 0; }
function mgInput() {
  return { bundlePrice: mgNum('mgBundlePrice'), point: mgNum('mgPoint'), bundleQty: mgNum('mgBundleQty'),
           sellQty: mgNum('mgSellQty'), price: mgNum('mgPrice'),
           ship: mgNum('mgShip'), feeRate: mgNum('mgFee') };
}

window.mgRun = function () {
  const v = mgInput();
  store.set('marginPrefs2', { ship: v.ship, feeRate: v.feeRate });
  const r = marginCalc(v);
  const u = $('mgUnit');
  if (u) u.innerHTML = (v.bundlePrice && v.bundleQty)
    ? `<div class="mgUnit">개당 원가 <b>${wonFmt(r.unitCost)}원</b>
         <span class="muted">${r.point ? `(${wonFmt(r.bundlePrice)} − 포인트 ${wonFmt(r.point)})` : `${wonFmt(r.bundlePrice)}원`} ÷ ${v.bundleQty}개</span></div>`
    : `<div class="mgUnit off">묶음 구매가와 수량을 넣으면 개당 원가가 나와요.</div>`;

  const box = $('mgOut'); if (!box) return;
  if (!v.price || !v.bundleQty) { box.innerHTML = `<div class="mgHint">사온 가격과 팔 가격을 넣으면 바로 계산돼요.</div>`; return; }
  const good = r.profit > 0;
  const unitTxt = r.sellQty > 1 ? `− 매입원가 (${wonFmt(r.unitCost)}원 × ${r.sellQty}개)` : `− 매입원가 (개당)`;
  box.innerHTML = `
    <div class="mgResult ${good ? '' : 'bad'}">
      <div class="mgBig"><span>1건 순이익</span><b>${wonFmt(r.profit)}원</b></div>
      <div class="mgRate">마진율 <b>${r.rate.toFixed(1)}%</b><span class="muted"> · 원가대비 ${r.roi.toFixed(1)}%</span></div>
      ${good ? '' : `<div class="mgWarn">⚠️ 팔수록 손해예요. 판매가를 올리거나 더 싸게 사와야 해요.</div>`}
    </div>
    <div class="mgRows">
      <div><span>판매가</span><b>${wonFmt(r.price)}원</b></div>
      <div><span>${unitTxt}</span><b>${wonFmt(r.cost)}원</b></div>
      <div><span>− 택배비</span><b>${wonFmt(r.ship)}원</b></div>
      <div><span>− 수수료 (${v.feeRate}%)</span><b>${wonFmt(r.fee)}원</b></div>
      <div class="tot"><span>= 1건에 남는 돈</span><b>${wonFmt(r.profit)}원</b></div>
    </div>
    <div class="mgTotal ${r.totalProfit > 0 ? '' : 'bad'}">
      <div class="mgTotHead">📦 이 묶음 하나를 다 팔면</div>
      <div class="mgTotRow"><span>판매 가능 건수</span><b>${r.sets}건</b></div>
      <div class="mgTotRow"><span>들어간 돈${r.point ? ' (포인트 뺀 실지출)' : ' (묶음 구매가)'}</span><b>${wonFmt(r.netBundle)}원</b></div>
      ${r.point ? `<div class="mgTotRow"><span>ㄴ 포인트로 아낀 돈</span><b>${wonFmt(r.point)}원</b></div>` : ''}
      <div class="mgTotRow big"><span>총 이익</span><b>${wonFmt(r.totalProfit)}원</b></div>
      <div class="mgTotRow"><span>투자금 대비 수익률</span><b>${r.totalRoi.toFixed(1)}%</b></div>
      ${r.leftover ? `<div class="mgTotNote">※ ${r.leftover}개가 남아요. 개수를 딱 나눠떨어지게 잡으면 손해가 없어요.</div>` : ''}
    </div>`;
};

window.mgTarget = function (t) {
  const v = mgInput(), box = $('mgTargetOut'); if (!box) return;
  if (!v.bundlePrice || !v.bundleQty) { box.innerHTML = `<div class="mgHint">먼저 묶음 구매가와 수량을 넣어주세요.</div>`; return; }
  const p = marginTargetPrice(v, t);
  if (!p) { box.innerHTML = `<div class="mgHint">수수료가 너무 커서 그 마진율은 나올 수 없어요.</div>`; return; }
  const chk = marginCalc(Object.assign({}, v, { price: p }));
  box.innerHTML = `<div class="mgTargetBox">마진율 <b>${t}%</b> 를 남기려면 → <b class="mgP">${wonFmt(p)}원</b> 에 파세요
      <div class="muted" style="margin-top:5px">1건에 ${wonFmt(chk.profit)}원 · 묶음 다 팔면 ${wonFmt(chk.totalProfit)}원</div>
      <button type="button" class="btn mini ghost" style="margin-top:8px" onclick="mgApply(${p})">이 가격으로 계산</button></div>`;
};
window.mgApply = function (p) { const el = $('mgPrice'); if (el) { el.value = p; mgRun(); } };

// ── 🏷️ 오늘의 할인 ───────────────────────────────────
// 강사 PC의 딜워치 수집기가 모아 올린 오픈마켓 할인정보를 보여준다.
// [알림 받기]를 켜면 앱을 꺼놔도 새 핫딜 때 폰으로 푸시가 온다(웹푸시).
let DEALS = { items: [], updatedAt: '', filter: 'all', cat: 'all' };
// 딜 카테고리 분류(PC와 동일 규칙) — category 필드 먼저, 없으면 상품명 낱말로.
const DEAL_CAT_RULES = [
  ['뷰티', /뷰티|화장품|메이크업|스킨|토너|세럼|에센스|앰플|크림|로션|마스크팩|시트마스크|클렌징|폼클|선크림|선블럭|선블록|자외선차단|틴트|립스틱|립밤|쿠션|파운데이션|섀도|마스카라|아이라이너|아이브로|향수|샴푸|린스|트리트먼트|헤어|바디워시|바디로션|스크럽|필링|미스트|괄사|프라이머|컨실러|네일|제모|왁싱|패치/i],
  ['건강식품', /유산균|프로바이오틱스|비타민|오메가|루테인|홍삼|녹용|콜라겐|영양제|효소|밀크씨슬|코큐텐|큐텐|글루타치온|마그네슘|칼슘|철분|아연|프로폴리스|보스웰리아|크릴|멀티비타|엽산|비오틴|글루코사민|밀크시슬|가르시니아|다이어트|이너뷰티|건강기능/i],
  ['식품', /간편식|즉석|라면|과자|스낵|음료|커피|녹차|홍차|우유|요거트|치즈|만두|국\b|탕\b|찌개|햇반|김치|반찬|소스|견과|아몬드|호두|떡\b|빵\b|시리얼|참치|햄\b|소시지|정육|한우|삼겹|수산|생선|새우|과일|채소|잡곡|계란|누룽지|건강즙|즙\b|사과|고구마|닭가슴살|도시락|밀키트/i],
  ['생활', /세제|섬유유연제|화장지|물티슈|기저귀|생리대|주방|세척|청소|살균|소독|방향제|탈취|칫솔|치약|가글|면도|샤워|비누|손소독|락스|밀폐용기|위생|주방세제|수세미|고무장갑|건전지/i],
];
function dealCategoryOf(it) {
  // 이름 우선(정확), 못 정하면 category 폴백. SSG '가공/건강식품' 합침라벨은 식품으로.
  const n = String((it && it.name) || '');
  for (const r of DEAL_CAT_RULES) if (r[1].test(n)) return r[0];
  const c = String((it && it.category) || '');
  if (/뷰티|화장/.test(c)) return '뷰티';
  if (/건강기능|영양제|헬스/.test(c)) return '건강식품';
  if (/가공|신선|식품|푸드|먹거리/.test(c)) return '식품';
  if (/생활|리빙|주방/.test(c)) return '생활';
  return '기타';
}
window.setDealCat = function (c) { DEALS.cat = c; renderDeals(); };
// 이미 눌러본 제품 표시 — 어디까지 봤는지 알 수 있게(루크 요청). 수집분(updatedAt) 바뀌면 초기화.
let _dealViewed = new Set(), _dealViewedAt = '';
function loadDealViewed(at) {
  try { const raw = JSON.parse(localStorage.getItem('dealViewed') || 'null');
    if (raw && raw.at === at) { _dealViewed = new Set(raw.codes || []); _dealViewedAt = at; return; } } catch (_) {}
  _dealViewed = new Set(); _dealViewedAt = at;
}
function markDealViewed(code) {
  if (!code) return;
  _dealViewed.add(String(code));
  try { localStorage.setItem('dealViewed', JSON.stringify({ at: _dealViewedAt, codes: [..._dealViewed] })); } catch (_) {}
}

function pushReady() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && !!window.PUSH_PUBKEY;
}
function b64ToU8(s) {
  const pad = '='.repeat((4 - s.length % 4) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
async function pushCurrentSub() {
  try { const reg = await navigator.serviceWorker.ready; return await reg.pushManager.getSubscription(); }
  catch (_) { return null; }
}
async function refreshPushBtn() {
  const btn = $('dealPushBtn'); if (!btn) return;
  if (!pushReady()) {
    // 아이폰은 홈 화면에 설치해야 알림 지원 (사파리 탭에선 PushManager 없음)
    btn.textContent = '📱 홈 화면에 설치하면 알림을 받을 수 있어요';
    btn.disabled = true; btn.classList.add('ghost');
    return;
  }
  const sub = await pushCurrentSub();
  btn.disabled = false;
  btn.textContent = sub ? '🔕 할인 알림 끄기' : '🔔 핫딜 알림 받기';
  btn.classList.toggle('ghost', !!sub);
}
window.toggleDealPush = async function () {
  const btn = $('dealPushBtn'); if (!btn || btn.disabled) return;
  btn.disabled = true;
  try {
    const cur = await pushCurrentSub();
    if (cur) {                                             // 끄기
      try { await api('pushSub', { sub: { endpoint: cur.endpoint }, off: true }); } catch (_) {}
      await cur.unsubscribe();
      toast('할인 알림을 껐어요');
    } else {                                               // 켜기
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { toast('알림 권한을 허용해야 받을 수 있어요'); await refreshPushBtn(); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(window.PUSH_PUBKEY) });
      const d = await api('pushSub', { sub: sub.toJSON() });
      if (d && d.ok) toast('좋아요! 새 핫딜이 뜨면 알려드릴게요 🔔');
      else { await sub.unsubscribe(); toast('저장에 실패했어요. 잠시 후 다시 시도해주세요.'); }
    }
  } catch (e) { toast('알림 설정에 실패했어요'); }
  await refreshPushBtn();
};
window.setDealFilter = function (f) { DEALS.filter = f; renderDeals(); };
window.openDeal = function (u) { if (u) window.open(u, '_blank', 'noopener'); };
// 행을 누르면 어디로 갈지 고른다 — 오픈마켓 / 네이버 카탈로그 (루크 요청)
window.openDealChoice = function (code) {
  const it = (DEALS.items || []).find(x => String(x.goodscode) === String(code));
  if (!it) return;
  markDealViewed(code);
  // 재렌더 없이 해당 행만 '봤음'으로(스크롤 유지) → 어디까지 봤는지 표시
  try { const el = document.querySelector('.dealRow2[data-code="' + code + '"]'); if (el) el.classList.add('viewed'); } catch (_) {}
  const nv = String(it.naverUrl || '').trim();
  if (!nv) { window.openDeal(it.url); return; }
  sheet(`<h3>어디로 갈까요?</h3>
    <p class="muted" style="margin:6px 0 14px;line-height:1.6">${esc(String(it.name || '').slice(0, 60))}</p>
    <button class="btn" onclick="closeSheet();openDeal('${esc(it.url)}')">🛒 ${esc(it.market || '오픈마켓')}에서 보기</button>
    <button class="btn ghost" style="margin-top:8px" onclick="closeSheet();openDeal('${esc(nv)}')">🟢 네이버 가격비교에서 보기</button>
    <button class="btn ghost" style="margin-top:8px" onclick="closeSheet()">← 할인 목록으로 돌아가기</button>`);
};
// 캐시로 먼저 띄운 뒤 뒤에서 새로 받아온다. 내용이 그대로면 화면을 건드리지 않는다
async function refreshDealsQuietly() {
  let d = null;
  try { d = await api('getDeals'); } catch (_) { return; }
  if (!d || !d.ok) return;
  if (!d.items || !d.items.length) return;        // 빈 목록(콜드 스타트)은 무시 — 보던 목록을 지우지 않는다
  const changed = String(d.updatedAt || '') !== String(DEALS.updatedAt || '');
  DEALS.items = d.items || []; DEALS.updatedAt = d.updatedAt || '';
  if (changed && document.getElementById('dealListMark')) renderDeals();
}

async function viewDeals() {
  // 한 번 받아둔 게 있으면 기다리지 않고 바로 보여준다(딜은 하루 한 번 모인다)
  if (DEALS.items && DEALS.items.length) { renderDeals(); refreshDealsQuietly(); return; }
  loading();
  // 두뇌가 차가우면 404 오류나 빈 목록(딜 0개)이 오기도 한다 → 최대 3번까지 다시 시도
  let d = null, err = '';
  for (let i = 0; i < 3; i++) {
    try { d = await api('getDeals'); }
    catch (e) { err = (e && e.message) ? e.message : '연결이 불안정해요.'; d = null; }
    if (d && d.ok && d.items && d.items.length) { err = ''; break; }   // 정상(딜 있음)
    if (i < 2) { await new Promise(r => setTimeout(r, 1500)); }        // 오류·빈목록이면 잠시 뒤 재시도
  }
  if (err && (!d || !d.ok)) {
    $('pane').innerHTML = `<div class="empty">${esc(err)}<br><br><button onclick="viewDeals()">다시 시도</button></div>`;
    return;
  }
  if (!d || !d.ok) {
    $('pane').innerHTML = `<div class="empty">아직 준비 중이에요.<br>강사가 할인정보를 채우면 여기에 표시됩니다.</div>`;
    return;
  }
  if (!d.items || !d.items.length) {
    // 두뇌가 차가워 빈 목록이 온 경우(보통 잠시 뒤 정상) — 보던 캐시가 있으면 지우지 않는다
    if (DEALS.items && DEALS.items.length) { renderDeals(); return; }
    $('pane').innerHTML = `<div class="empty">할인정보를 불러오는 중이에요.<br>잠시 뒤에 다시 눌러주세요.<br><br><button onclick="viewDeals()">다시 시도</button></div>`;
    return;
  }
  DEALS.items = d.items || []; DEALS.updatedAt = d.updatedAt || '';
  renderDeals();
}
function renderDeals() {
  const items = DEALS.items;
  const at = String(DEALS.updatedAt || '');
  if (_dealViewedAt !== at) loadDealViewed(at);   // 수집분 바뀌면 본 기록 초기화
  let h = `<div class="sec" style="margin-top:2px">🏷️ 오늘의 할인${DEALS.updatedAt ? ` <span class="muted" style="font-weight:400;font-size:12px">· ${esc(DEALS.updatedAt)}</span>` : ''}</div>
    <button class="btn dealPush" id="dealPushBtn" onclick="toggleDealPush()">🔔 핫딜 알림 받기</button>`;
  if (!items.length) {
    h += `<div class="empty">아직 등록된 할인정보가 없어요.</div>`;
    $('pane').innerHTML = h; refreshPushBtn(); return;
  }
  const plain = items.filter(x => !x.bundle);
  const bundles = items.filter(x => x.bundle);
  const nHot = plain.filter(x => x.hot).length, nLow = plain.filter(x => x.low).length;
  const chip = (f, t) => `<button class="chip ${DEALS.filter === f ? 'on' : ''}" onclick="setDealFilter('${f}')">${t}</button>`;
  h += `<span id="dealListMark" hidden></span>`;   // 아직 목록을 보고 있는지 판단용
  const nWin = plain.filter(x => (dealBestMargin(x) || 0) > 0).length;
  h += dealPtBar();
  h += `<div class="chips" style="margin:10px 0">${chip('all', `전체 ${plain.length}`)}${chip('hot', `🔥 핫딜 ${nHot}`)}${nLow ? chip('low', `📉 최저가 ${nLow}`) : ''}${nWin ? chip('win', `💰 마진 ${nWin}`) : ''}${bundles.length ? chip('bundle', `📦 모음전 ${bundles.length}`) : ''}</div>`;
  // 카테고리 필터 — 있는 것만(개수와 함께)
  const CAT_ORDER = ['뷰티', '건강식품', '식품', '생활', '기타'];
  const catCount = {};
  plain.forEach(x => { const cc = dealCategoryOf(x); catCount[cc] = (catCount[cc] || 0) + 1; });
  const catChip = (c, t) => `<button class="chip ${DEALS.cat === c ? 'on' : ''}" onclick="setDealCat('${c}')">${t}</button>`;
  const catChips = [catChip('all', '전체')].concat(
    CAT_ORDER.filter(c => catCount[c]).map(c => catChip(c, `${c} ${catCount[c]}`))).join('');
  h += `<div class="chips" style="margin:-2px 0 10px">${catChips}</div>`;
  let list = plain;
  if (DEALS.filter === 'hot') list = plain.filter(x => x.hot);
  if (DEALS.filter === 'low') list = plain.filter(x => x.low);
  if (DEALS.filter === 'bundle') list = bundles;
  if (DEALS.filter === 'win') list = plain.filter(x => (dealBestMargin(x) || 0) > 0)
    .sort((a, b) => (dealBestMargin(b) || 0) - (dealBestMargin(a) || 0));
  if (DEALS.cat !== 'all') list = list.filter(x => dealCategoryOf(x) === DEALS.cat);
  h += list.slice(0, 100).map(it => `
    <div class="card dealRow2${_dealViewed.has(String(it.goodscode)) ? ' viewed' : ''}" data-code="${esc(it.goodscode)}" onclick="openDealChoice('${esc(it.goodscode)}')">
      <span class="dealPct2${it.discountPct ? '' : ' none'}">${it.discountPct ? it.discountPct + '%' : '-'}</span>
      <div class="dealBody">
        <div class="dealNm">${esc(it.name)}</div>
        <div class="dealMt"><b>${it.price ? Number(it.price).toLocaleString() + '원' : ''}</b>${dealCardLine(it)}
          ${it.market ? `<span class="tagMkt">${esc(it.market)}</span>` : ''}
          ${it.low ? `<span class="tagLow">📉 3개월 최저가</span>` : (it.hot ? `<span class="tagHot">🔥 핫딜</span>` : '')}
        </div>
        ${dealNaverLine(it)}
      </div>
      <span class="dealAct">
        <button class="dealCalc" onclick="event.stopPropagation();dealToMargin('${esc(it.goodscode)}')">💰</button>
        <span class="dealArw">›</span>
      </span>
    </div>`).join('');
  h += `<div class="card muted" style="font-size:12.5px;line-height:1.7;margin-top:10px">
    가격·할인율은 수집 시점 기준이에요. 상품을 누르면 판매 페이지로 이동합니다.<br>
    소싱·판매가 조사에 활용해보세요 💪</div>`;
  $('pane').innerHTML = h;
  refreshPushBtn();
}

// ── 미수금(마이너스 잔액) 안내 ────────────────────────
//  앱을 켤 때 잔액이 마이너스면 화면 전체를 덮는 안내가 뜨고 '충전하기'로만 닫힌다.
//  입금 확인은 담당자가 하니 시간이 걸린다 → 충전 페이지를 열어주기만 하면 바로 닫는다(루크 요청).
function closeRechargeLock() {
  const el = $('rechargeLock');
  if (el) el.remove();
}
window.rechargeNow = function () {
  closeRechargeLock();
  try { openRecharge(); } catch (_) {}
};
function showRechargeLock(balance) {
  if ($('rechargeLock')) return;
  const amt = Math.abs(Number(balance) || 0).toLocaleString() + '원';
  const d = document.createElement('div');
  d.id = 'rechargeLock';
  d.className = 'lockWrap';
  d.innerHTML = `<div class="lockCard">
      <div style="font-size:44px;line-height:1">💳</div>
      <h3 style="margin:10px 0 6px">충전이 필요해요</h3>
      <p class="muted" style="line-height:1.75;margin:0 0 8px">
        지금 선불잔액이 <b style="color:#e0457e;font-size:17px">-${amt}</b> 예요.<br>
        아직 내지 않은 배송비가 있어요. 충전해주시면 자동으로 정산됩니다. 🙏</p>
      <p class="muted" style="font-size:12px;line-height:1.7;margin:0 0 14px">
        충전 페이지를 여시면 이 안내는 바로 닫혀요.<br>
        <b>매일 밤 10시</b>에 강사가 입금내역을 확인하고 잔액에 넣어드려요.<br>
        그때까지는 잔액이 그대로 보일 수 있어요.</p>
      <button class="btn" onclick="rechargeNow()">💳 충전하기</button>
    </div>`;
  document.body.appendChild(d);
}
async function checkNegativeBalance() {
  if (!session || !session.userId || !BRAIN || !BRAIN.deliveryUrl) return;
  let b = null;
  try { b = await dlApi('getBalance'); } catch (_) { return; }
  if (!b || !b.ok) return;
  if (Number(b.balance || 0) < 0) showRechargeLock(b.balance);
}

// ── 시작 ─────────────────────────────────────────────
(function boot() {
  warmUp();                       // 두뇌 미리 깨우기
  const s = store.get('session', null);
  if (s && s.userId) {
    session = s; enterMain();
    checkNegativeBalance();          // 미수금이면 안내가 화면을 덮는다
    if (location.hash === '#deals') go('deals');    // 푸시 알림 눌러 들어온 경우 → 할인 탭
    // 강사가 기수를 바꿨으면 따라잡는다 (바뀌면 화면도 새로 그림)
    refreshSessionCohort().then(function (ch) { if (ch && location.hash !== '#deals') enterMain(); });
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
