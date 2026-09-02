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
  try { showInstallBar(); } catch (_) {}
  setTimeout(() => { try { checkLogisticsMessages(); } catch (_) {} }, 1200);
}

// ── 탭 ───────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => go(b.dataset.tab)));
function go(tab) {
  cur = tab;
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  $('pane').scrollTop = 0;
  ({ home: viewHome, coach: viewCoach, ask: viewAsk, ship: viewShip, margin: viewMargin }[tab] || viewHome)();
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
window.openRecharge = () => { if (BRAIN.rechargeUrl) window.open(BRAIN.rechargeUrl, '_blank', 'noopener'); };

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
  h += `<div class="row" style="margin:0 0 12px">
      <button class="btn ${DL.tab === 'inv' ? '' : 'ghost'}" onclick="dlTab('inv')">📦 내 재고</button>
      <button class="btn ${DL.tab === 'ship' ? '' : 'ghost'}" onclick="dlTab('ship')">🚚 배송요청</button>
    </div>`;
  h += DL.tab === 'inv' ? paneInv() : paneShip();
  $('pane').innerHTML = h;
  if (DL.tab === 'ship') { try { dlInfo(); } catch (_) {} }
}
window.dlTab = (t) => { DL.tab = t; renderShip(); };

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
      DL.inv.map(it => {
        const p = packOf(it.product);
        return `<tr data-s="${invKey(it.product, it.option, it.price, it.expiry, it.memo, it.site)}"><td>${esc(plainName(it.product))}${p > 1 ? `<span class="pack">${p}개입</span>` : ''}
          ${it.option ? `<div class="muted" style="font-size:11.5px">${esc(it.option)}</div>` : ''}
          ${it.memo ? `<div class="invMemo">📝 ${esc(it.memo)}</div>` : ''}
          ${it.site ? (siteUrlOf(it.site)
            ? `<div class="invSite"><a href="#" data-site="${esc(it.site)}" onclick="openBuySite(this.dataset.site);return false;">🔗 ${esc(it.site)}</a></div>`
            : `<div class="invSite">🔗 ${esc(it.site)}</div>`) : ''}</td>
          <td class="n ${it.qty <= 0 ? 'zero' : ''}">${it.qty}${Number(it.reserved) > 0 ? `<div class="rsv">대기 ${it.reserved}</div>` : ''}${Number(it.pending) > 0 ? `<div class="pend">검수대기 ${it.pending}</div>` : ''}</td></tr>`;
      }).join('') + `<tr id="invNone1" style="display:none"><td colspan="2" class="muted">검색과 일치하는 재고가 없어요.</td></tr>`
      + `</tbody></table></div>`
    : `<div class="empty">아직 등록된 재고가 없어요.<br>위에서 입고 등록을 하면 강사 검수 후 반영돼요.</div>`;
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
      ${st.indexOf('접수') >= 0 ? `<div class="locked">🔒 접수 완료 · 변경은 물류담당자에게 문의해주세요</div>` : ''}
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
window.dlCancel = async function (at) {
  alert('접수된 배송요청은 취소할 수 없어요.\n\n' + '잘못 넣으셨다면 물류담당자에게 문의해주세요.');
  return;
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
  const more = MSG.queue.length > 1 ? `<p class="muted" style="margin-top:10px">읽지 않은 메시지가 ${MSG.queue.length - 1}개 더 있어요.</p>` : '';
  sheet(`<h3>💬 물류담당자 메시지</h3>
    <div class="msgBox">${nl2br(q.reply || '')}</div>${more}
    <div class="row"><button class="btn" onclick="ackMsg()">확인했어요</button></div>`, true);
}
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
  const bundleQty   = Math.max(0, Number(inp.bundleQty) || 0);
  const sellQty     = Math.max(1, Number(inp.sellQty) || 1);
  const price = Math.max(0, Number(inp.price) || 0);
  const ship  = Math.max(0, Number(inp.ship) || 0);
  const feeR  = Math.max(0, Number(inp.feeRate) || 0) / 100;

  const unitCost = bundleQty > 0 ? bundlePrice / bundleQty : 0;  // 개당 원가
  const cost = unitCost * sellQty;                               // 한 건에 나가는 원가
  const fee  = Math.round(price * feeR);                         // 판매 수수료
  const profit = price - cost - ship - fee;                      // 한 건 순이익
  const rate = price > 0 ? (profit / price) * 100 : 0;           // 마진율(판매가 대비)
  const roi  = cost  > 0 ? (profit / cost) * 100 : 0;            // 원가 대비 수익률

  const sets = sellQty > 0 ? Math.floor(bundleQty / sellQty) : 0; // 묶음 하나로 몇 건 팔 수 있나
  const leftover = bundleQty - sets * sellQty;                    // 팔고 남는 개수
  const totalProfit = sets * profit;                              // 다 팔았을 때 총 이익
  const totalRoi = bundlePrice > 0 ? (totalProfit / bundlePrice) * 100 : 0;
  return { price, bundlePrice, bundleQty, sellQty, unitCost, cost, ship, fee,
           profit, rate, roi, sets, leftover, totalProfit, totalRoi };
}

// 목표 마진율(%)을 남기려면 얼마에 팔아야 하나 → 권장 판매가
//   순이익 = 판매가 − 원가 − 택배비 − 판매가×수수료율 = 판매가 × 목표율
//   → 판매가 × (1 − 수수료율 − 목표율) = 원가 + 택배비
function marginTargetPrice(inp, targetRate) {
  const bundleQty = Math.max(0, Number(inp.bundleQty) || 0);
  const sellQty   = Math.max(1, Number(inp.sellQty) || 1);
  const unitCost  = bundleQty > 0 ? (Math.max(0, Number(inp.bundlePrice) || 0) / bundleQty) : 0;
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
    <div class="card">
      <p class="muted" style="margin:0 0 8px;font-size:12.5px"><b>여러 개 묶음으로 사와서 1개씩 나눠 파는</b> 방식에 맞춘 계산기예요.</p>
      <div class="mgSec">1️⃣ 얼마에 사오나요?</div>
      <label class="lbl">묶음 구매가 (원)</label><input id="mgBundlePrice" type="text" inputmode="numeric" placeholder="24000" oninput="mgRun()">
      <label class="lbl">묶음 수량 (개)</label><input id="mgBundleQty" type="text" inputmode="numeric" placeholder="10" oninput="mgRun()">
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
  mgRun();
}


function mgNum(id) { const el = $(id); return el ? Number(String(el.value).replace(/[^0-9.]/g, '')) || 0 : 0; }
function mgInput() {
  return { bundlePrice: mgNum('mgBundlePrice'), bundleQty: mgNum('mgBundleQty'),
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
         <span class="muted">${wonFmt(v.bundlePrice)}원 ÷ ${v.bundleQty}개</span></div>`
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
      <div class="mgTotRow"><span>들어간 돈 (묶음 구매가)</span><b>${wonFmt(r.bundlePrice)}원</b></div>
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

// ── 시작 ─────────────────────────────────────────────
(function boot() {
  warmUp();                       // 두뇌 미리 깨우기
  const s = store.get('session', null);
  if (s && s.userId) {
    session = s; enterMain();
    // 강사가 기수를 바꿨으면 따라잡는다 (바뀌면 화면도 새로 그림)
    refreshSessionCohort().then(function (ch) { if (ch) enterMain(); });
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
