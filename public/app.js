const state = {
  actor: null,
  data: null,
  view: "dashboard",
  from: "2026-08-01",
  to: "2026-08-31",
  activityFilter: "all",
  candidateFilter: "active",
  candidateSearch: "",
  activeCandidateId: null,
  activeCandidateApplicationId: null,
  candidateDetail: null,
  calendarMonth: "2026-08",
  calendarCache: {},
  calendarRequest: 0,
  calendarExpandedDay: null,
  reportType: "performance_1",
  reportDate: "2026-08-12",
  activeReportSnapshot: null,
  modalSubmit: null,
  setupNeeded: false,
};

const activityLabels = {
  application_received: "사람인·공고 접수",
  resume_reviewed: "이력서 검토",
  interview_scheduled: "신규 면접수립",
  interview_conducted: "면접 실시",
  dm_sent: "DM 발송",
  dm_accepted: "DM 수락",
  dm_followup: "수락자 연락",
  past_pool_reviewed: "과거후보 검토",
  past_pool_contacted: "과거후보 재접촉",
  reinterview_scheduled: "재면접 수립",
  offer_coordination: "처우·입사 조율",
  hired: "입사 완료",
  other: "기타 채용활동",
};
const sourceLabels = { saramin: "사람인", dm: "DM", past_pool: "24~26년 인재풀", referral: "추천", jobkorea: "잡코리아", mixed: "복합", other: "기타" };
const riskLabels = { on_track: "정상", risk: "주의", checkpoint_due: "점검 필요", overdue: "목표일 경과", completed: "완료", on_hold: "보류" };
const stageLabels = { sourced: "접수", contacted: "연락", screening: "검토", interview: "면접", offer: "처우·제안", hired: "채용", talent_pool: "인재풀", closed: "종료" };
const candidateFilterLabels = { active: "진행 중", due: "일정 임박·지연", overdue: "일정 지연", interview: "면접 단계", offer: "처우·제안", talent_pool: "과거 인재풀", all: "전체 후보군" };
const reportTypeLabels = { daily: "일일 HR 활동보고", week: "주간 마감보고", month: "월간 마감보고", performance_1: "1차 실적회의 보고", performance_2: "2차 실적회의 보고", performance_3: "3차 실적회의 보고" };
const departmentStatusLabels = { completed: "목표 달성", on_track: "양호", action_required: "조치 필요", pipeline_needed: "후보군 확보 필요" };
const roleLabels = { admin: "시스템 관리자", recruiter: "채용 담당자", viewer: "조회자" };
const interviewStatusLabels = { scheduled: "예정", completed: "완료", cancelled: "취소", no_show: "불참" };
const interviewResultLabels = { pending: "결과 대기", pass: "합격·다음 단계", hold: "보류", fail: "불합격", withdrawn: "지원 철회", no_show: "면접 불참" };
const rejectionReasons = ["", "경력 부족", "직무 부적합", "연봉 불일치", "조직 적합성", "지원 철회", "타사 합격", "연락 두절", "면접 불참", "기타"];
const meetingStatusLabels = { scheduled: "예정", completed: "회의 완료", cancelled: "취소" };
const actionStatusLabels = { open: "미착수", in_progress: "진행 중", review: "검토 필요", completed: "완료", cancelled: "취소" };
const actionPriorityLabels = { urgent: "긴급", high: "높음", normal: "보통", low: "낮음" };
const $ = (selector) => document.querySelector(selector);

const authView = $("#auth-view");
const appView = $("#app-view");
const bootView = $("#boot-view");
const authError = $("#auth-error");
const content = $("#content");
const busy = $("#busy");
const toast = $("#toast");

init();

async function init() {
  bindEvents();
  setInitialPeriod();
  const setupToken = new URL(location.href).searchParams.get("setup");
  if (setupToken) {
    bootView.hidden = true;
    authView.hidden = false;
    $("#login-panel").hidden = true;
    $("#setup-panel").hidden = false;
    $("#setup-form").dataset.token = setupToken;
    return;
  }
  try {
    const { actor } = await api("/api/me");
    if (!actor) {
      const status = await api("/api/setup/status");
      state.setupNeeded = Boolean(status.setupNeeded);
    }
    if (actor) await enterApp(actor);
    else showLogin();
  } catch (error) {
    showLogin();
    showAuthError(error.message);
  }
}

function setInitialPeriod() {
  const today = seoulYmd(new Date());
  state.from = `${today.slice(0, 7)}-01`;
  state.to = monthEnd(today);
  state.calendarMonth = today.slice(0, 7);
  state.reportDate = today;
  $("#period-from").value = state.from;
  $("#period-to").value = state.to;
}

function bindEvents() {
  $("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    await authAction(async () => {
      const result = await api("/api/login", { method: "POST", body: valuesOf(event.currentTarget) });
      await enterApp(result.actor);
    });
  });
  $("#setup-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = valuesOf(event.currentTarget);
    if (values.password !== values.passwordConfirm) return showAuthError("비밀번호 확인이 일치하지 않습니다.");
    values.token = event.currentTarget.dataset.token;
    delete values.passwordConfirm;
    await authAction(async () => {
      await api("/api/setup", { method: "POST", body: values });
      history.replaceState({}, "", "/");
      const { actor } = await api("/api/me");
      await enterApp(actor);
    });
  });
  $("#nav-list").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-view]");
    if (!button) return;
    state.view = button.dataset.view;
    syncNav();
    if (state.view === "reports") {
      const range = reportRangeForType(state.reportType, state.reportDate || state.data?.today || localYmd(new Date()));
      if (range.from !== state.from || range.to !== state.to) {
        state.from = range.from;
        state.to = range.to;
        await loadData();
        return;
      }
    }
    render();
  });
  $("#apply-period").addEventListener("click", async () => {
    const from = $("#period-from").value;
    const to = $("#period-to").value;
    if (!from || !to || from > to) return showGlobalError("조회 기간을 확인하세요.");
    state.from = from;
    state.to = to;
    await loadData();
  });
  document.querySelectorAll("[data-period]").forEach((button) => button.addEventListener("click", () => setQuickPeriod(button.dataset.period)));
  $("#refresh-button").addEventListener("click", () => {
    state.calendarCache = {};
    state.calendarRequest += 1;
    loadData();
  });
  $("#logout-button").addEventListener("click", handleSessionAction);
  $("#session-button").addEventListener("click", handleSessionAction);
  $("#modal-close").addEventListener("click", closeModal);
  $("#modal-cancel").addEventListener("click", closeModal);
  $("#modal-backdrop").addEventListener("mousedown", (event) => { if (event.target === event.currentTarget) closeModal(); });
  $("#candidate-drawer-close").addEventListener("click", closeCandidateDrawer);
  $("#candidate-drawer-backdrop").addEventListener("mousedown", (event) => { if (event.target === event.currentTarget) closeCandidateDrawer(); });
  $("#candidate-global-search-input").addEventListener("input", renderGlobalCandidateSearch);
  $("#candidate-global-search-input").addEventListener("focus", renderGlobalCandidateSearch);
  $("#candidate-global-search-results").addEventListener("click", (event) => {
    const button = event.target.closest("[data-global-candidate]");
    if (!button) return;
    $("#candidate-global-search-results").hidden = true;
    openCandidateDetail(button.dataset.globalCandidate, button.dataset.globalApplication);
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest("#candidate-global-search")) $("#candidate-global-search-results").hidden = true;
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("#modal-backdrop").hidden) closeModal();
    else if (event.key === "Escape" && !$("#candidate-drawer-backdrop").hidden) closeCandidateDrawer();
  });
  $("#modal-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.modalSubmit) return;
    const submitHandler = state.modalSubmit;
    setBusy(true);
    try {
      const result = await submitHandler(valuesOf(event.currentTarget));
      if (state.modalSubmit === submitHandler) {
        closeModal();
        state.calendarCache = {};
        state.calendarRequest += 1;
        await loadData();
        if (state.activeCandidateId) await loadCandidateDetail(state.activeCandidateId, state.activeCandidateApplicationId, false);
        showToast("저장했습니다.");
      }
      return result;
    } catch (error) {
      showGlobalError(error.message);
    } finally {
      setBusy(false);
    }
  });
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (state.view === "dashboard" && state.data) drawDashboardCharts(); }, 120);
  });
}

async function authAction(action) {
  authError.hidden = true;
  setBusy(true);
  try { await action(); } catch (error) { showAuthError(error.message); } finally { setBusy(false); }
}

async function enterApp(actor) {
  state.actor = actor;
  state.calendarCache = {};
  state.calendarRequest += 1;
  bootView.hidden = false;
  authView.hidden = true;
  appView.hidden = true;
  updateAccessUi(actor);
  await loadData();
  bootView.hidden = true;
  appView.hidden = false;
}

function updateAccessUi(actor) {
  const registered = Boolean(actor);
  const name = actor?.name || "공개 조회";
  const role = actor ? roleLabels[actor.role] : "읽기 전용";
  $("#profile-name").textContent = name;
  $("#profile-role").textContent = actor?.department ? `${actor.department} · ${role}` : role;
  $("#profile-initials").textContent = actor ? initials(name) : "공";
  $("#users-nav").hidden = actor?.role !== "admin";
  $("#candidate-global-search").hidden = !registered;
  $("#logout-button").textContent = registered ? "↗" : "⇥";
  $("#logout-button").title = registered ? "로그아웃" : "로그인";
  $("#session-button").textContent = registered ? "로그아웃" : "로그인";
  const badge = $("#access-badge");
  badge.textContent = registered ? `${role} 로그인` : "공개 조회";
  badge.classList.toggle("public", !registered);
}

function showLogin() {
  bootView.hidden = true;
  appView.hidden = true;
  authView.hidden = false;
  $("#login-panel").hidden = false;
  $("#setup-panel").hidden = true;
  authError.hidden = true;
  if (state.setupNeeded) showAuthError("관리자 설정이 아직 필요합니다. 발급된 일회용 admin 설정 링크를 사용하세요.");
  $("#login-form input[name='username']")?.focus();
}

async function handleSessionAction() {
  if (!state.actor) return showLogin();
  setBusy(true);
  try {
    await api("/api/logout", { method: "POST", body: {} });
    location.reload();
  } catch (error) {
    showGlobalError(error.message);
    setBusy(false);
  }
}

async function setQuickPeriod(type) {
  const today = state.data?.today || localYmd(new Date());
  if (type === "week") {
    state.from = startOfWeek(today);
    state.to = addDays(state.from, 6);
  } else if (type === "august") {
    state.from = "2026-08-01";
    state.to = "2026-08-31";
  } else {
    state.from = `${today.slice(0, 7)}-01`;
    state.to = monthEnd(today);
  }
  $("#period-from").value = state.from;
  $("#period-to").value = state.to;
  await loadData();
}

async function loadData() {
  setBusy(true);
  try {
    if (state.view === "reports") state.activeReportSnapshot = null;
    state.data = await api(`/api/hr?from=${encodeURIComponent(state.from)}&to=${encodeURIComponent(state.to)}`);
    state.actor = state.data.actor;
    updateAccessUi(state.actor);
    $("#period-from").value = state.from;
    $("#period-to").value = state.to;
    $("#sidebar-period").textContent = `${formatDate(state.from)} ~ ${formatDate(state.to)}`;
    $("#sidebar-summary").textContent = `활동 ${state.data.report.totals.totalCount}건 · 목표 ${state.data.goals.length}개`;
    hideGlobalError();
    syncNav();
    render();
  } catch (error) {
    showGlobalError(error.message);
  } finally {
    setBusy(false);
  }
}

function syncNav() {
  if (state.view === "users" && state.actor?.role !== "admin") state.view = "dashboard";
  document.querySelectorAll("#nav-list button[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === state.view));
}

function render() {
  if (!state.data) return;
  if (state.view === "dashboard") renderDashboard();
  else if (state.view === "activities") renderActivities();
  else if (state.view === "goals") renderGoals();
  else if (state.view === "postings") renderPostings();
  else if (state.view === "calendar") renderCalendar();
  else if (state.view === "meetings") renderMeetings();
  else if (state.view === "talent") renderTalent();
  else if (state.view === "reports") renderReports();
  else if (state.view === "users" && state.actor?.role === "admin") renderUsers();
  else state.view = "dashboard", syncNav(), renderDashboard();
}

function renderDashboard() {
  const { report, goals, jobPostings = [], saramin = {}, workforce = {} } = state.data;
  const totals = report.totals;
  const priorityGoals = [...goals].sort(goalSort).slice(0, 8);
  const activePostings = jobPostings.filter((row) => row.status === "active").slice(0, 5);
  content.innerHTML = `
    ${heading("COMPANY WORKFORCE & RECRUITING TO", "전사 인원 및 TO 통합 현황", `기준일 ${formatDate(workforce.asOfDate)} · 정원·현원·채용 TO와 입퇴사 예정, 채용 진행을 한 화면에서 확인합니다.`, canWrite() ? `<button class="button secondary" data-action="new-workforce">＋ 인원·TO 입력</button><button class="button primary" data-action="new-activity">＋ 오늘 활동 입력</button>` : `<button class="button primary" data-action="login">담당자 로그인</button>`)}
    ${renderWorkforceOverview()}
    ${renderMyWorkPanel()}
    <div class="dashboard-section-heading"><div><small>RECRUITING OPERATIONS</small><h2>채용활동·목표 진행</h2></div><span>${escapeHtml(formatDate(report.from))} ~ ${escapeHtml(formatDate(report.to))}</span></div>
    <section class="notice ${report.goals.atRisk ? "warning" : "ok"}"><i>${report.goals.atRisk ? "!" : "✓"}</i><div><strong>${report.narrative}</strong><small>엑셀의 2026년 8월 유효 활동과 현재 프로그램 입력값을 기준으로 자동 집계합니다.</small></div></section>
    <section class="kpis six">
      ${kpi("채용활동", totals.totalCount, "건", `입력 ${totals.entryCount}개`, "activity:all")}
      ${kpi("DM 발송", totals.dmSent, "건", `수락 ${totals.dmAccepted}건`, "activity:dm_sent")}
      ${kpi("DM 수락률", totals.dmAcceptanceRate, "%", "발송 대비 수락", "activity:dm_accepted")}
      ${kpi("면접 수립", totals.interviews, "건", `실시 ${totals.interviewsConducted}건`, "activity:interview_scheduled")}
      ${kpi("과거후보 재접촉", totals.pastContacts, "건", `검토 ${totals.pastReviews}건`, "activity:past_pool_contacted")}
      ${kpi("위험 목표", report.goals.atRisk, "개", `평균 진행률 ${report.goals.averageProgress}%`, "goals")}
    </section>
    <section class="panel saramin-dashboard">
      <div class="section-heading saramin-heading"><div><small>SARAMIN RECRUIT</small><h2>사람인 채용공고 현황</h2></div><div class="saramin-heading-actions"><span class="integration-state ${saramin.connected ? "connected" : "waiting"}">${saramin.connected ? "API 연결" : "API 키 승인 대기"}</span><button class="text-button" data-view-postings>전체 공고 보기 →</button></div></div>
      <div class="saramin-overview">
        <div class="saramin-metrics">
          <article><span>진행 중</span><strong>${Number(saramin.activeCount || 0)}<small>건</small></strong></article>
          <article><span>7일 내 마감</span><strong>${Number(saramin.closingThisWeek || 0)}<small>건</small></strong></article>
          <article><span>최근 7일 등록</span><strong>${Number(saramin.newThisWeek || 0)}<small>건</small></strong></article>
          ${state.actor ? `<article><span>공고 지원</span><strong>${Number(saramin.totalApplications || 0)}<small>명</small></strong></article>` : ""}
        </div>
        <div class="posting-preview-list">
          ${activePostings.map((row) => `<a class="posting-preview" href="${escapeHtml(row.url)}" target="_blank" rel="noopener noreferrer nofollow"><div><strong>${escapeHtml(row.title)}</strong><small>${escapeHtml([row.department, row.location].filter(Boolean).join(" · ") || "(주)메드파크")}</small></div><span class="posting-dday ${jobPostingDday(row).className}">${escapeHtml(jobPostingDday(row).label)}</span></a>`).join("") || `<div class="posting-empty compact"><strong>등록된 진행 공고가 없습니다.</strong><span>사람인 API 키 연결 대기 · 관리자는 공고를 수동 등록할 수 있습니다.</span></div>`}
        </div>
      </div>
      <footer class="saramin-attribution"><span>${saramin.lastSyncedAt ? `최근 동기화 ${escapeHtml(formatDateTime(saramin.lastSyncedAt))}` : "키 승인 전에는 관리자가 공고를 직접 등록합니다."}</span><a href="${escapeHtml(saramin.companyPage || "https://www.saramin.co.kr")}" target="_blank" rel="noopener noreferrer nofollow">Powered by 사람인 ↗</a></footer>
    </section>
    <section class="chart-grid">
      <article class="panel chart-panel"><div class="panel-heading"><div><small>DAILY ACTIVITY</small><h2>일자별 채용활동 추이</h2></div><span class="legend"><i class="dm"></i>DM <i class="interview"></i>면접 <i class="pool"></i>재접촉</span></div><canvas id="trend-chart" height="250" aria-label="일자별 채용활동 추이"></canvas></article>
      <article class="panel chart-panel"><div class="panel-heading"><div><small>OWNER MANAGEMENT</small><h2>담당자별 활동량</h2></div><span class="subtle">상위 6명</span></div><canvas id="owner-chart" height="250" aria-label="담당자별 채용활동"></canvas></article>
    </section>
    <section class="panel table-panel dashboard-goals">
      <div class="section-heading"><div><small>GOAL CONTROL</small><h2>우선순위·중간점검·목표일 관리</h2></div><button class="text-button" data-view-goals>전체 목표 보기 →</button></div>
      <div class="table-wrap"><table><thead><tr><th>우선</th><th>포지션</th><th>담당</th><th>자동 진행률</th><th>중간점검</th><th>현재 목표일</th><th>상태</th></tr></thead><tbody>${priorityGoals.map(goalDashboardRow).join("")}</tbody></table></div>
    </section>
    ${renderSourcePerformance()}
    ${renderCandidatePipelineSection()}`;
  content.querySelector('[data-action="new-workforce"]')?.addEventListener("click", () => openWorkforceModal());
  content.querySelector('[data-action="new-activity"]')?.addEventListener("click", () => openActivityModal());
  content.querySelector('[data-action="login"]')?.addEventListener("click", showLogin);
  content.querySelectorAll("[data-edit-workforce]").forEach((button) => button.addEventListener("click", () => openWorkforceModal((state.data.workforcePlans || []).find((row) => row.id === button.dataset.editWorkforce))));
  content.querySelectorAll("[data-delete-workforce]").forEach((button) => button.addEventListener("click", () => deleteWorkforce(button.dataset.deleteWorkforce)));
  content.querySelectorAll("[data-dashboard-action]").forEach((button) => button.addEventListener("click", () => {
    state.view = "meetings";
    syncNav();
    render();
    const item = (state.data.actionItems || []).find((row) => row.id === button.dataset.dashboardAction);
    if (item) openActionItemModal(item);
  }));
  content.querySelector("[data-view-goals]")?.addEventListener("click", () => { state.view = "goals"; syncNav(); render(); });
  content.querySelector("[data-view-postings]")?.addEventListener("click", () => { state.view = "postings"; syncNav(); render(); });
  content.querySelector("[data-view-meetings]")?.addEventListener("click", () => { state.view = "meetings"; syncNav(); render(); });
  bindDashboardDrilldowns();
  bindCandidatePipeline();
  requestAnimationFrame(drawDashboardCharts);
}

function renderWorkforceOverview() {
  const workforce = state.data.workforce || {};
  const departments = workforce.byDepartment || [];
  const plans = state.data.workforcePlans || [];
  const needsBaseline = Number(workforce.baselineRows || 0) === 0;
  return `<section class="workforce-overview">
    ${needsBaseline ? `<div class="workforce-baseline-alert"><i>!</i><div><strong>정원·현원 기준값 입력이 필요합니다.</strong><span>기존 채용목표의 채용 TO ${Number(workforce.recruitingTo || 0)}명은 연동했습니다. 부서별 정원과 현재 인원을 입력하면 충원율·예상현원이 자동 계산됩니다.</span></div></div>` : ""}
    <div class="workforce-kpis">
      ${workforceKpi("전사 정원", workforce.approvedHeadcount, "명", needsBaseline ? "기준값 미입력" : `충원율 ${Number(workforce.fillRate || 0)}%`, "approved")}
      ${workforceKpi("현재 인원", workforce.currentHeadcount, "명", `예상 ${Number(workforce.projectedHeadcount || 0)}명`, "current")}
      ${workforceKpi("채용 TO", workforce.recruitingTo, "명", `${Number(workforce.totalRows || 0)}개 직무`, "to")}
      ${workforceKpi("입사 예정", workforce.joiningPlanned, "명", "예정 반영", "join")}
      ${workforceKpi("퇴사 예정", workforce.leavingPlanned, "명", "예정 반영", "leave")}
      ${workforceKpi("충원 필요", workforce.vacancy, "명", "입퇴사 반영", "vacancy")}
    </div>
    <section class="panel table-panel workforce-department-panel">
      <div class="section-heading"><div><small>DEPARTMENT HEADCOUNT</small><h2>부서별 인원·채용 TO</h2></div><span class="subtle">예상현원 = 현원 + 입사예정 − 퇴사예정</span></div>
      <div class="table-wrap"><table><thead><tr><th>부서</th><th>정원</th><th>현원</th><th>예상현원</th><th>채용 TO</th><th>입사 예정</th><th>퇴사 예정</th><th>충원율</th></tr></thead><tbody>${departments.map((row) => `<tr><td><strong>${escapeHtml(row.department)}</strong><small class="sub">${Number(row.positions)}개 직무</small></td><td>${Number(row.approvedHeadcount)}명</td><td><b>${Number(row.currentHeadcount)}명</b></td><td>${Number(row.projectedHeadcount)}명</td><td><strong class="to-emphasis">${Number(row.recruitingTo)}명</strong></td><td>${Number(row.joiningPlanned)}명</td><td>${Number(row.leavingPlanned)}명</td><td><div class="fill-rate"><progress max="100" value="${Math.min(100, Number(row.fillRate || 0))}"></progress><b>${Number(row.fillRate || 0)}%</b></div></td></tr>`).join("") || emptyRow(8, "등록된 인원·TO 항목이 없습니다.")}</tbody></table></div>
    </section>
    ${state.actor ? `<section class="panel table-panel workforce-position-panel"><div class="section-heading"><div><small>POSITION DETAIL</small><h2>직무별 입력 내역</h2></div><span class="subtle">모든 항목 수정·삭제 가능</span></div><div class="table-wrap"><table><thead><tr><th>부서·직무</th><th>정원</th><th>현원</th><th>채용 TO</th><th>입사</th><th>퇴사</th><th>기준일·메모</th><th></th></tr></thead><tbody>${plans.map((row) => `<tr><td><strong>${escapeHtml(row.position)}</strong><small class="sub">${escapeHtml(row.department)}</small></td><td>${Number(row.approvedHeadcount)}</td><td>${Number(row.currentHeadcount)}</td><td><b>${Number(row.recruitingTo)}</b></td><td>${Number(row.joiningPlanned)}</td><td>${Number(row.leavingPlanned)}</td><td><strong>${escapeHtml(formatDate(row.asOfDate))}</strong><small class="sub detail">${escapeHtml(row.note || "-")}</small></td><td>${canWrite() ? `<div class="row-actions"><button data-edit-workforce="${escapeHtml(row.id)}">수정</button><button class="danger" data-delete-workforce="${escapeHtml(row.id)}">삭제</button></div>` : ""}</td></tr>`).join("") || emptyRow(8, "등록된 직무별 인원·TO가 없습니다.")}</tbody></table></div></section>` : ""}
  </section>`;
}

function workforceKpi(label, value, unit, note, tone) {
  return `<article class="workforce-kpi ${escapeHtml(tone)}"><span>${escapeHtml(label)}</span><strong>${Number(value || 0)}<small>${escapeHtml(unit)}</small></strong><em>${escapeHtml(note)}</em></article>`;
}

function renderMyWorkPanel() {
  if (!state.actor || !state.data.myWork) return "";
  const work = state.data.myWork;
  const items = [...(work.open || [])].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || ({ urgent: 0, high: 1, normal: 2, low: 3 }[a.priority] - ({ urgent: 0, high: 1, normal: 2, low: 3 }[b.priority]))).slice(0, 6);
  return `<section class="panel personal-work-panel">
    <div class="section-heading"><div><small>MY HR WORK</small><h2>${escapeHtml(state.actor.name)}님의 업무 현황</h2><p>로그인 계정에 지정된 업무와 전체 알림을 함께 표시합니다.</p></div><button class="text-button" data-view-meetings>HR 회의·업무 전체 보기 →</button></div>
    <div class="personal-work-metrics"><article><span>오늘 해야 할 일</span><strong>${work.today.length}<small>건</small></strong></article><article class="week"><span>이번 주 마감</span><strong>${work.week.length}<small>건</small></strong></article><article class="overdue"><span>지연 업무</span><strong>${work.overdue.length}<small>건</small></strong></article><article class="review"><span>검토 사항</span><strong>${work.review.length}<small>건</small></strong></article></div>
    <div class="personal-work-list">${items.map((row) => `<button type="button" data-dashboard-action="${escapeHtml(row.id)}"><span class="action-priority ${escapeHtml(row.priority)}">${escapeHtml(actionPriorityLabels[row.priority])}</span><div><strong>${escapeHtml(row.title)}</strong><small>${escapeHtml(row.assigneeName)} · 기한 ${escapeHtml(formatDate(row.dueDate))} · ${escapeHtml(actionStatusLabels[row.status])}</small></div><em class="${row.dueDate < state.data.today ? "late" : ""}">${row.notificationScope === "all" ? "전체 알림" : "개인 알림"}</em></button>`).join("") || `<div class="personal-work-empty">현재 지정된 미완료 업무가 없습니다.</div>`}</div>
  </section>`;
}

function renderSourcePerformance() {
  const rows = state.data.report?.executive?.sourceFunnel || [];
  return `<section class="panel table-panel source-performance-panel"><div class="section-heading"><div><small>SOURCE CONVERSION</small><h2>채용 루트별 성과</h2><p>지원·접수에서 면접, 합격·제안, 실제 입사까지 같은 기준으로 비교합니다.</p></div></div><div class="table-wrap"><table><thead><tr><th>채용 루트</th><th>지원·후보</th><th>검토</th><th>면접</th><th>합격·제안</th><th>입사</th><th>면접 전환율</th><th>입사율</th></tr></thead><tbody>${rows.map((row) => `<tr><td><strong>${escapeHtml(row.source)}</strong><small class="sub">기간 활동 ${Number(row.periodActivities)}건</small></td><td>${Number(row.candidates)}명</td><td>${Number(row.reviewed)}명</td><td><b>${Number(row.interviews)}명</b></td><td>${Number(row.offers)}명</td><td><strong class="hire-emphasis">${Number(row.hired)}명</strong></td><td>${Number(row.interviewRate)}%</td><td>${Number(row.hireRate)}%</td></tr>`).join("") || emptyRow(8, "채용 루트 데이터가 없습니다.")}</tbody></table></div></section>`;
}

function goalDashboardRow(goal) {
  return `<tr><td><span class="priority p${escapeHtml(goal.priority.slice(0,1))}">${escapeHtml(goal.priority)}</span></td><td><strong>${escapeHtml(goal.functionName)}</strong><small class="sub">${escapeHtml(goal.level || goal.title)}</small></td><td>${escapeHtml(goal.ownerPrimary || "미지정")}</td><td><div class="progress-cell"><progress max="100" value="${Number(goal.progress || 0)}"></progress><b>${Number(goal.progress || 0)}%</b></div></td><td>${escapeHtml(formatDate(goal.checkpointDate))}</td><td>${goal.revisedTargetDate ? `<del>${escapeHtml(formatDate(goal.originalTargetDate))}</del><strong class="revised">${escapeHtml(formatDate(goal.targetDate))}</strong>` : escapeHtml(formatDate(goal.targetDate))}</td><td><span class="risk ${escapeHtml(goal.riskStatus)}">${escapeHtml(riskLabels[goal.riskStatus] || goal.riskStatus)}</span></td></tr>`;
}

function renderCandidatePipelineSection() {
  const summaryData = state.data.candidateSummary || {};
  if (!state.actor) {
    return `<section class="panel candidate-pipeline-panel public-candidate-summary">
      <div class="section-heading"><div><small>HR MEETING PIPELINE</small><h2>HR 후보군 진행현황</h2></div><button class="text-button" data-candidate-login>후보자 상세 로그인 →</button></div>
      <div class="candidate-meeting-metrics">
        ${candidateMetric("전체 후보군", summaryData.total, "명", "all")}${candidateMetric("진행 중", summaryData.active, "명", "active")}${candidateMetric("면접 단계", summaryData.interview, "명", "interview")}${candidateMetric("처우·제안", summaryData.offer, "명", "offer")}${candidateMetric("일정 지연", summaryData.overdue, "명", "overdue")}
      </div>
      <div class="candidate-privacy"><i>●</i><div><strong>후보자 개인정보는 등록 사용자에게만 표시됩니다.</strong><span>로그인하면 후보자별 포지션·진행단계·담당자·다음 활동·예정일·목표일과 누적 HR 활동 내역을 확인할 수 있습니다.</span></div></div>
    </section>`;
  }
  const rows = filteredCandidateRows();
  return `<section class="panel table-panel candidate-pipeline-panel">
    <div class="section-heading candidate-pipeline-heading"><div><small>HR MEETING PIPELINE</small><h2>HR 후보군 진행현황</h2><p>숫자를 누르면 해당 후보군만 표시되고, 후보자 이름을 누르면 누적 활동과 다음 조치 계획이 열립니다.</p></div><div class="candidate-meeting-metrics compact">${candidateMetric("진행", summaryData.active, "명", "active")}${candidateMetric("면접", summaryData.interview, "명", "interview")}${candidateMetric("지연", summaryData.overdue, "명", "overdue")}</div></div>
    <div class="candidate-toolbar"><label><span>후보군 구분</span><select id="candidate-filter">${["active", "due", "overdue", "interview", "offer", "talent_pool", "all"].map((value) => option(value, candidateFilterLabels[value], state.candidateFilter === value)).join("")}</select></label><label class="candidate-search"><span>후보자·포지션·담당자 검색</span><input id="candidate-search" type="search" value="${escapeHtml(state.candidateSearch)}" placeholder="이름, 포지션 또는 담당자"></label><strong id="candidate-result-count">${rows.length}명</strong></div>
    <div class="table-wrap candidate-table-wrap"><table class="candidate-table"><thead><tr><th>후보자</th><th>지원 포지션</th><th>유입 소스</th><th>현재 단계</th><th>담당자</th><th>최근 HR 활동</th><th>다음 활동</th><th>예정일</th><th>목표일</th><th>일정</th></tr></thead><tbody id="candidate-pipeline-body">${rows.map(candidatePipelineRow).join("") || emptyRow(10, "조건에 맞는 후보자가 없습니다.")}</tbody></table></div>
  </section>`;
}

function candidateMetric(label, value, unit, filter) {
  const active = Boolean(state.actor) && state.candidateFilter === filter;
  return `<button type="button" class="candidate-metric ${active ? "active" : ""}" data-candidate-metric="${escapeHtml(filter)}" aria-pressed="${active}" aria-label="${escapeHtml(label)} ${Number(value || 0)}${escapeHtml(unit)} 목록 보기"><span>${escapeHtml(label)}</span><strong>${Number(value || 0)}<small>${escapeHtml(unit)}</small></strong><em>${state.actor ? "목록 보기" : "로그인 후 보기"}</em></button>`;
}

function filteredCandidateRows() {
  const query = state.candidateSearch.trim().toLowerCase();
  return (state.data.candidatePipeline || []).filter((row) => {
    if (state.candidateFilter === "active" && (row.archivedAt || ["closed", "hired"].includes(row.stage))) return false;
    if (state.candidateFilter === "due" && !["due", "overdue", "target_overdue"].includes(row.scheduleStatus)) return false;
    if (state.candidateFilter === "overdue" && !["overdue", "target_overdue"].includes(row.scheduleStatus)) return false;
    if (state.candidateFilter === "interview" && row.stage !== "interview") return false;
    if (state.candidateFilter === "offer" && row.stage !== "offer") return false;
    if (state.candidateFilter === "talent_pool" && !row.isTalentPool) return false;
    if (!query) return true;
    return [row.candidateName, row.position, row.division, row.ownerName, row.sourceChannel, row.nextActivity].some((value) => String(value || "").toLowerCase().includes(query));
  });
}

function candidatePipelineRow(row) {
  const schedule = candidateSchedule(row.scheduleStatus);
  return `<tr class="candidate-row ${escapeHtml(row.scheduleStatus)}">
    <td><button class="candidate-name" data-candidate-id="${escapeHtml(row.candidateId)}" data-application-id="${escapeHtml(row.applicationId)}">${escapeHtml(row.candidateName)}</button><small class="sub">${escapeHtml([row.gender, row.age ? `${row.age}세` : "", row.experienceText].filter(Boolean).join(" · ") || "기본정보 미등록")}</small></td>
    <td><strong>${escapeHtml(row.position)}</strong><small class="sub">${escapeHtml([row.priority, row.division, row.level].filter(Boolean).join(" · "))}</small></td>
    <td>${escapeHtml(row.sourceChannel || "기타")}</td>
    <td><span class="candidate-stage ${escapeHtml(row.stage)}">${escapeHtml(stageLabels[row.stage] || row.stage)}</span>${row.outcome ? `<small class="sub">${escapeHtml(row.outcome)}</small>` : ""}</td>
    <td>${escapeHtml(row.ownerName || "미지정")}</td>
    <td><strong class="candidate-activity-copy">${escapeHtml(row.lastActivity || "-")}</strong><small class="sub">${escapeHtml(formatDate(row.lastActivityAt))}</small></td>
    <td><strong class="candidate-next-copy">${escapeHtml(row.nextActivity || "미입력")}</strong></td>
    <td>${row.nextActionAt ? `<strong>${escapeHtml(formatDateTime(row.nextActionAt))}</strong>` : `<span class="muted-cell">미정</span>`}</td>
    <td>${row.targetDate ? `<strong>${escapeHtml(formatDate(row.targetDate))}</strong>` : `<span class="muted-cell">미정</span>`}</td>
    <td><span class="candidate-schedule ${escapeHtml(row.scheduleStatus)}">${escapeHtml(schedule)}</span></td>
  </tr>`;
}

function candidateSchedule(value) {
  return ({ normal: "정상", due: "3일 내 예정", overdue: "활동 지연", target_overdue: "목표일 경과" })[value] || "정상";
}

function bindCandidatePipeline() {
  content.querySelector("[data-candidate-login]")?.addEventListener("click", showLogin);
  content.querySelectorAll("[data-candidate-metric]").forEach((button) => button.addEventListener("click", () => {
    if (!state.actor) return showLogin();
    state.candidateFilter = button.dataset.candidateMetric;
    state.candidateSearch = "";
    const filterControl = $("#candidate-filter");
    const searchControl = $("#candidate-search");
    if (filterControl) filterControl.value = state.candidateFilter;
    if (searchControl) searchControl.value = "";
    updateCandidatePipelineRows();
    content.querySelector(".candidate-toolbar")?.scrollIntoView({ behavior: "smooth", block: "start" });
    showToast(`${candidateFilterLabels[state.candidateFilter]} ${filteredCandidateRows().length}명을 표시합니다.`);
  }));
  const filter = $("#candidate-filter");
  const search = $("#candidate-search");
  filter?.addEventListener("change", () => { state.candidateFilter = filter.value; updateCandidatePipelineRows(); });
  search?.addEventListener("input", () => { state.candidateSearch = search.value; updateCandidatePipelineRows(); });
  bindCandidateLinks();
}

function updateCandidatePipelineRows() {
  const rows = filteredCandidateRows();
  const body = $("#candidate-pipeline-body");
  if (!body) return;
  body.innerHTML = rows.map(candidatePipelineRow).join("") || emptyRow(10, "조건에 맞는 후보자가 없습니다.");
  const count = $("#candidate-result-count");
  if (count) count.textContent = `${rows.length}명`;
  content.querySelectorAll("[data-candidate-metric]").forEach((button) => {
    const active = button.dataset.candidateMetric === state.candidateFilter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  bindCandidateLinks();
}

function bindDashboardDrilldowns() {
  content.querySelectorAll("[data-dashboard-drilldown]").forEach((button) => button.addEventListener("click", () => {
    const [view, filter] = button.dataset.dashboardDrilldown.split(":");
    if (view === "activity") {
      state.activityFilter = filter || "all";
      state.view = "activities";
    } else if (view === "goals") {
      state.view = "goals";
    } else {
      return;
    }
    syncNav();
    render();
  }));
}

function bindCandidateLinks() {
  content.querySelectorAll("[data-candidate-id]").forEach((button) => button.addEventListener("click", () => openCandidateDetail(button.dataset.candidateId, button.dataset.applicationId)));
}

function renderGlobalCandidateSearch() {
  const input = $("#candidate-global-search-input");
  const results = $("#candidate-global-search-results");
  if (!state.actor || !input || !results) return;
  const query = input.value.trim().toLowerCase();
  if (!query) {
    results.hidden = true;
    results.innerHTML = "";
    return;
  }
  const rows = (state.data?.candidatePipeline || []).filter((row) =>
    [row.candidateName, row.position, row.division, row.ownerName, row.sourceChannel, stageLabels[row.stage], row.outcome]
      .some((value) => String(value || "").toLowerCase().includes(query))
  ).slice(0, 10);
  results.innerHTML = rows.length
    ? rows.map((row) => `<button type="button" data-global-candidate="${escapeHtml(row.candidateId)}" data-global-application="${escapeHtml(row.applicationId)}"><span class="candidate-stage ${escapeHtml(row.stage)}">${escapeHtml(stageLabels[row.stage] || row.stage)}</span><strong>${escapeHtml(row.candidateName)}</strong><small>${escapeHtml(row.position)} · ${escapeHtml(row.sourceChannel || "기타")}${row.outcome ? ` · ${escapeHtml(row.outcome)}` : ""}</small></button>`).join("")
    : `<div class="global-search-empty">검색 결과가 없습니다.</div>`;
  results.hidden = false;
}

async function openCandidateDetail(candidateId, applicationId = null) {
  if (!state.actor) return showLogin();
  state.activeCandidateId = candidateId;
  state.activeCandidateApplicationId = applicationId;
  state.candidateDetail = null;
  $("#candidate-drawer-backdrop").hidden = false;
  $("#candidate-drawer-title").textContent = "후보자 진행 내역";
  $("#candidate-drawer-body").innerHTML = `<div class="drawer-loading"><i></i><strong>후보자 누적 활동을 불러오는 중입니다.</strong></div>`;
  await loadCandidateDetail(candidateId, applicationId, false);
}

async function loadCandidateDetail(candidateId, applicationId = null, showBusyIndicator = true) {
  if (showBusyIndicator) setBusy(true);
  try {
    const detail = await api(`/api/candidates/${encodeURIComponent(candidateId)}/timeline`);
    if (state.activeCandidateId !== candidateId) return;
    state.candidateDetail = detail;
    state.activeCandidateApplicationId = applicationId || state.activeCandidateApplicationId || detail.applications.find((row) => !row.archivedAt)?.applicationId || detail.applications[0]?.applicationId || null;
    renderCandidateDrawer(detail);
  } catch (error) {
    $("#candidate-drawer-body").innerHTML = `<div class="drawer-error"><strong>후보자 내역을 불러오지 못했습니다.</strong><span>${escapeHtml(error.message)}</span></div>`;
  } finally {
    if (showBusyIndicator) setBusy(false);
  }
}

function renderCandidateDrawer(detail) {
  const candidate = detail.candidate;
  const selectedApplication = detail.applications.find((row) => row.applicationId === state.activeCandidateApplicationId) || detail.applications[0] || null;
  $("#candidate-drawer-title").textContent = `${candidate.name} 후보자`;
  $("#candidate-drawer-body").innerHTML = `
    <section class="candidate-profile-card">
      <div class="candidate-avatar">${escapeHtml(initials(candidate.name))}</div>
      <div class="candidate-profile-copy"><strong>${escapeHtml(candidate.name)}</strong><span>${escapeHtml([candidate.gender, candidate.age ? `${candidate.age}세` : "", candidate.experienceText, candidate.currentCompany, candidate.currentTitle].filter(Boolean).join(" · ") || "후보자 기본정보")}</span><small>${escapeHtml([candidate.phone, candidate.email].filter(Boolean).join(" · ") || "연락처 미등록")}</small></div>
      ${canWrite() && selectedApplication ? `<button class="button primary" data-new-candidate-activity>＋ 다음 활동 입력</button>` : ""}
    </section>
    <section class="candidate-application-list">
      <div class="drawer-section-title"><div><small>APPLICATIONS</small><h3>지원 포지션·현재 계획</h3></div></div>
      ${detail.applications.map((row) => `<article class="candidate-application ${row.applicationId === selectedApplication?.applicationId ? "selected" : ""}" data-select-candidate-application="${escapeHtml(row.applicationId)}"><div><span class="candidate-stage ${escapeHtml(row.stage)}">${escapeHtml(stageLabels[row.stage] || row.stage)}</span><strong>${escapeHtml(row.position)}</strong><small>${escapeHtml([row.priority, row.division, row.level, row.sourceChannel].filter(Boolean).join(" · "))}</small></div><dl><div><dt>담당자</dt><dd>${escapeHtml(row.ownerName || "미지정")}</dd></div><div><dt>다음 활동</dt><dd>${escapeHtml(row.nextActivity || "미입력")}</dd></div><div><dt>예정일</dt><dd>${escapeHtml(row.nextActionAt ? formatDateTime(row.nextActionAt) : "미정")}</dd></div><div><dt>목표일</dt><dd>${escapeHtml(row.targetDate ? formatDate(row.targetDate) : "미정")}</dd></div></dl></article>`).join("") || `<div class="drawer-empty">연결된 지원 포지션이 없습니다.</div>`}
    </section>
    <section class="candidate-timeline-section">
      <div class="drawer-section-title"><div><small>CUMULATIVE HR ACTIVITY</small><h3>누적 HR 활동 내역</h3></div><span>${detail.timeline.length}건</span></div>
      <div class="candidate-timeline">
        ${detail.timeline.map(candidateTimelineItem).join("") || `<div class="drawer-empty">누적 활동이 없습니다. 다음 활동 입력에서 첫 기록을 남겨주세요.</div>`}
      </div>
    </section>`;
  $("#candidate-drawer-body").querySelector("[data-new-candidate-activity]")?.addEventListener("click", () => openCandidateActivityModal(detail, selectedApplication?.applicationId));
  $("#candidate-drawer-body").querySelectorAll("[data-select-candidate-application]").forEach((element) => element.addEventListener("click", () => {
    state.activeCandidateApplicationId = element.dataset.selectCandidateApplication;
    renderCandidateDrawer(detail);
  }));
  $("#candidate-drawer-body").querySelectorAll("[data-edit-candidate-activity]").forEach((button) => button.addEventListener("click", () => {
    const activity = detail.timeline.find((row) => row.id === button.dataset.editCandidateActivity);
    if (activity) openCandidateActivityModal(detail, activity.applicationId, activity);
  }));
  $("#candidate-drawer-body").querySelectorAll("[data-delete-candidate-activity]").forEach((button) => button.addEventListener("click", () => deleteCandidateActivity(button.dataset.deleteCandidateActivity)));
}

function candidateTimelineItem(row) {
  const originLabel = ({ candidate: "직접 입력", daily: "일일 활동", interview: "면접 일정", legacy: "기존 데이터" })[row.origin] || "활동";
  return `<article class="candidate-timeline-item ${escapeHtml(row.origin)}"><div class="timeline-marker"></div><div class="timeline-content"><header><div><span class="activity-tag ${escapeHtml(row.activityType)}">${escapeHtml(activityLabels[row.activityType] || row.activityType)}</span>${row.stageAfter ? `<span class="candidate-stage ${escapeHtml(row.stageAfter)}">${escapeHtml(stageLabels[row.stageAfter] || row.stageAfter)}</span>` : ""}</div><time>${escapeHtml(formatDate(row.activityDate))}</time></header><strong>${escapeHtml(row.summary)}</strong>${row.outcome ? `<p><b>결과</b>${escapeHtml(row.outcome)}</p>` : ""}${row.nextActivity || row.nextActionAt || row.targetDate ? `<dl><div><dt>다음 활동</dt><dd>${escapeHtml(row.nextActivity || "미입력")}</dd></div><div><dt>예정일</dt><dd>${escapeHtml(row.nextActionAt ? formatDateTime(row.nextActionAt) : "미정")}</dd></div><div><dt>목표일</dt><dd>${escapeHtml(row.targetDate ? formatDate(row.targetDate) : "미정")}</dd></div></dl>` : ""}<footer><span>${escapeHtml(originLabel)} · ${escapeHtml(row.createdByName || "시스템")}</span>${row.editable && canWrite() ? `<div class="row-actions"><button data-edit-candidate-activity="${escapeHtml(row.id)}">수정</button><button class="danger" data-delete-candidate-activity="${escapeHtml(row.id)}">삭제</button></div>` : ""}</footer></div></article>`;
}

function closeCandidateDrawer() {
  $("#candidate-drawer-backdrop").hidden = true;
  state.activeCandidateId = null;
  state.activeCandidateApplicationId = null;
  state.candidateDetail = null;
}

function openCandidateActivityModal(detail, applicationId, activity = null) {
  const editing = Boolean(activity);
  const applications = detail.applications || [];
  const selected = applications.find((row) => row.applicationId === applicationId) || applications[0];
  if (!selected) return showGlobalError("활동을 연결할 지원 포지션이 없습니다.");
  const applicationField = editing
    ? `<input type="hidden" name="applicationId" value="${escapeHtml(selected.applicationId)}"><div class="checkpoint-context full"><span>지원 포지션</span><strong>${escapeHtml(selected.position)}</strong><small>${escapeHtml([selected.priority, selected.division, selected.sourceChannel].filter(Boolean).join(" · "))}</small></div>`
    : `<label class="full"><span>지원 포지션 *</span><select name="applicationId" required>${applications.map((row) => option(row.applicationId, `${row.position} · ${stageLabels[row.stage] || row.stage}`, row.applicationId === selected.applicationId)).join("")}</select></label>`;
  openModal(editing ? "CANDIDATE ACTIVITY EDIT" : "NEXT HR ACTIVITY", editing ? `${detail.candidate.name} 활동 수정` : `${detail.candidate.name} 다음 활동 입력`, `
    ${applicationField}
    ${field("activityDate", "이번 활동일 *", "date", activity?.activityDate || state.data.today, true)}
    <label><span>활동 구분 *</span><select name="activityType" id="candidate-activity-type">${Object.entries(activityLabels).map(([value, label]) => option(value, label, value === (activity?.activityType || "resume_reviewed"))).join("")}</select></label>
    <label><span>진행단계 *</span><select name="stageAfter" id="candidate-stage-after">${Object.entries(stageLabels).map(([value, label]) => option(value, label, value === (activity?.stageAfter || selected.stage))).join("")}</select></label>
    ${field("outcome", "결과·판정", "text", activity?.outcome || "")}
    <label class="full"><span>이번 활동 내용 *</span><textarea name="summary" required placeholder="이력서 검토 결과, 연락 내용, 면접 결과, 협의사항 등을 기록">${escapeHtml(activity?.summary || "")}</textarea></label>
    <label class="full"><span>다음 활동</span><textarea name="nextActivity" placeholder="다음 연락, 면접 준비, 처우 협의 등 해야 할 일을 입력">${escapeHtml(activity?.nextActivity || selected.nextActivity || "")}</textarea></label>
    ${field("nextActionAt", "다음 활동 예정일시", "datetime-local", toLocalInput(activity?.nextActionAt || selected.nextActionAt || ""))}
    ${field("targetDate", "후보자 목표일", "date", activity?.targetDate || selected.targetDate || "")}
    <div class="field-note full">저장하면 후보자 진행현황의 현재 단계·다음 활동·예정일·목표일이 갱신되고, 이번 활동은 누적 이력에 남습니다.</div>`,
    (body) => api(editing ? `/api/candidate-activities/${encodeURIComponent(activity.id)}` : `/api/candidates/${encodeURIComponent(detail.candidate.id)}/activities`, { method: editing ? "PATCH" : "POST", body }));
  $("#candidate-activity-type")?.addEventListener("change", (event) => {
    const stage = $("#candidate-stage-after");
    if (!stage || editing) return;
    if (["interview_scheduled", "interview_conducted", "reinterview_scheduled"].includes(event.target.value)) stage.value = "interview";
    if (event.target.value === "offer_coordination") stage.value = "offer";
    if (event.target.value === "hired") stage.value = "hired";
  });
}

async function deleteCandidateActivity(id) {
  if (!confirm("이 후보자 활동을 삭제할까요? 연결된 일일 활동 집계도 함께 제거되며, 삭제 사실은 감사 로그에 남습니다.")) return;
  setBusy(true);
  try {
    await api(`/api/candidate-activities/${encodeURIComponent(id)}`, { method: "DELETE", body: {} });
    await loadData();
    if (state.activeCandidateId) await loadCandidateDetail(state.activeCandidateId, state.activeCandidateApplicationId, false);
    showToast("후보자 활동을 삭제했습니다.");
  } catch (error) {
    showGlobalError(error.message);
  } finally {
    setBusy(false);
  }
}

function drawDashboardCharts() {
  drawTrendChart($("#trend-chart"), state.data?.report.byDay || []);
  drawOwnerChart($("#owner-chart"), state.data?.report.byOwner || []);
}

function canvasContext(canvas, height = 250) {
  if (!canvas) return null;
  const width = Math.max(320, canvas.getBoundingClientRect().width || 500);
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { ctx, width, height };
}

function drawTrendChart(canvas, rows) {
  const surface = canvasContext(canvas);
  if (!surface) return;
  const { ctx, width, height } = surface;
  const data = rows.slice(-14);
  ctx.clearRect(0, 0, width, height);
  if (!data.length) return drawEmptyChart(ctx, width, height, "선택한 기간에 활동이 없습니다.");
  const pad = { left: 38, right: 12, top: 18, bottom: 35 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const max = Math.max(1, ...data.flatMap((row) => [row.dmSent, row.interviews, row.pastContacts]));
  ctx.font = "10px Arial";
  ctx.strokeStyle = "#dfe6eb";
  ctx.fillStyle = "#758597";
  for (let step = 0; step <= 4; step++) {
    const y = pad.top + (plotH * step / 4);
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y); ctx.stroke();
    ctx.fillText(String(Math.round(max * (4 - step) / 4)), 5, y + 3);
  }
  const slot = plotW / data.length;
  const colors = ["#1674aa", "#6e58b0", "#d17a35"];
  data.forEach((row, index) => {
    const values = [row.dmSent, row.interviews, row.pastContacts];
    const barW = Math.max(3, Math.min(10, slot / 4));
    values.forEach((value, series) => {
      const barH = value / max * plotH;
      const x = pad.left + index * slot + slot / 2 + (series - 1) * (barW + 1) - barW / 2;
      ctx.fillStyle = colors[series];
      ctx.fillRect(x, pad.top + plotH - barH, barW, barH);
    });
    ctx.fillStyle = "#7c8996";
    ctx.textAlign = "center";
    ctx.fillText(shortDate(row.label), pad.left + index * slot + slot / 2, height - 13);
  });
  ctx.textAlign = "left";
}

function drawOwnerChart(canvas, rows) {
  const surface = canvasContext(canvas);
  if (!surface) return;
  const { ctx, width, height } = surface;
  const data = rows.slice(0, 6);
  ctx.clearRect(0, 0, width, height);
  if (!data.length) return drawEmptyChart(ctx, width, height, "선택한 기간에 담당자 활동이 없습니다.");
  const left = Math.min(100, width * .25);
  const right = 40;
  const max = Math.max(1, ...data.map((row) => row.totalCount));
  const rowH = (height - 28) / data.length;
  ctx.font = "11px Arial";
  data.forEach((row, index) => {
    const y = 16 + index * rowH;
    ctx.fillStyle = "#213549";
    ctx.textAlign = "right";
    ctx.fillText(row.label, left - 10, y + 12);
    ctx.fillStyle = "#edf2f5";
    ctx.fillRect(left, y, width - left - right, 16);
    ctx.fillStyle = "#2c86b8";
    ctx.fillRect(left, y, (width - left - right) * row.totalCount / max, 16);
    ctx.fillStyle = "#33495c";
    ctx.textAlign = "left";
    ctx.fillText(`${row.totalCount}건`, width - right + 6, y + 12);
  });
  ctx.textAlign = "left";
}

function drawEmptyChart(ctx, width, height, message) {
  ctx.fillStyle = "#83909d";
  ctx.font = "12px Arial";
  ctx.textAlign = "center";
  ctx.fillText(message, width / 2, height / 2);
  ctx.textAlign = "left";
}

function renderActivities() {
  const { report, recruitingActivities } = state.data;
  if (!state.actor) {
    content.innerHTML = `
      ${heading("PUBLIC DAILY SUMMARY", "일일 채용활동 조회", "비로그인 화면에는 담당자별 원문 대신 일자별 집계만 표시됩니다.", `<button class="button primary" data-action="login">상세 입력·조회 로그인</button>`)}
      <section class="summary">${summary("DM 발송", `${report.totals.dmSent}건`)}${summary("DM 수락", `${report.totals.dmAccepted}건`)}${summary("면접 수립", `${report.totals.interviews}건`)}${summary("과거후보 연락", `${report.totals.pastContacts}건`)}</section>
      <section class="panel table-panel"><div class="table-wrap"><table><thead><tr><th>일자</th><th>전체 활동</th><th>DM 발송</th><th>수락</th><th>면접 수립</th><th>면접 실시</th><th>과거후보 연락</th></tr></thead><tbody>${report.byDay.map((row) => `<tr><td><strong>${escapeHtml(formatDate(row.label))}</strong></td><td>${row.totalCount}건</td><td>${row.dmSent}건</td><td>${row.dmAccepted}건</td><td>${row.interviews}건</td><td>${row.interviewsConducted}건</td><td>${row.pastContacts}건</td></tr>`).join("") || emptyRow(7, "선택한 기간에 활동이 없습니다.")}</tbody></table></div></section>`;
    content.querySelector('[data-action="login"]').addEventListener("click", showLogin);
    return;
  }
  const rows = state.activityFilter === "all" ? recruitingActivities : recruitingActivities.filter((row) => row.activityType === state.activityFilter);
  content.innerHTML = `
    ${heading("담당자가 직접 입력하면 자동 집계", "일일 채용활동", "사람인 접수·이력서 검토·DM·수락자 연락·면접·과거후보 재접촉을 활동 단위로 남깁니다.", canWrite() ? `<button class="button primary" data-action="new-activity">＋ 활동 입력</button>` : "")}
    <section class="summary">${summary("활동 입력", `${report.totals.entryCount}개`)}${summary("사람인·공고 접수", `${report.totals.applications}건`)}${summary("이력서 검토", `${report.totals.reviews}건`)}${summary("면접 수립", `${report.totals.interviews}건`)}</section>
    <div class="toolbar"><label class="filter-label">활동 구분<select id="activity-filter"><option value="all">전체 활동</option>${Object.entries(activityLabels).map(([value, label]) => option(value, label, state.activityFilter === value)).join("")}</select></label><span>${rows.length}개 입력 기록</span></div>
    <section class="panel table-panel"><div class="table-wrap"><table><thead><tr><th>일자</th><th>담당자</th><th>부서·포지션</th><th>활동</th><th>소스</th><th>건수</th><th>후보·내용</th><th>다음 조치</th><th></th></tr></thead><tbody>${rows.map(activityRow).join("") || emptyRow(9, "조건에 맞는 채용활동이 없습니다.")}</tbody></table></div></section>`;
  content.querySelector('[data-action="new-activity"]')?.addEventListener("click", () => openActivityModal());
  $("#activity-filter").addEventListener("change", (event) => { state.activityFilter = event.target.value; renderActivities(); });
  content.querySelectorAll("[data-edit-activity]").forEach((button) => button.addEventListener("click", () => openActivityModal(recruitingActivities.find((row) => row.id === button.dataset.editActivity))));
  content.querySelectorAll("[data-delete-activity]").forEach((button) => button.addEventListener("click", () => deleteActivity(button.dataset.deleteActivity)));
}

function activityRow(row) {
  const editable = canEditActivity(row);
  return `<tr><td><strong>${escapeHtml(formatDate(row.activityDate))}</strong></td><td>${escapeHtml(row.ownerName)}</td><td><strong>${escapeHtml(row.position)}</strong><small class="sub">${escapeHtml(row.department)}</small></td><td><span class="activity-tag ${escapeHtml(row.activityType)}">${escapeHtml(activityLabels[row.activityType] || row.activityType)}</span></td><td>${escapeHtml(sourceLabels[row.source] || row.source)}</td><td><b>${Number(row.count)}건</b>${row.acceptedCount ? `<small class="sub">수락 ${Number(row.acceptedCount)}건</small>` : ""}</td><td>${row.candidateName ? `<strong>${escapeHtml(row.candidateName)}</strong>` : ""}<small class="sub detail">${escapeHtml(row.details || "-")}</small></td><td>${escapeHtml(formatDateTime(row.nextActionAt))}</td><td>${editable ? `<div class="row-actions"><button data-edit-activity="${escapeHtml(row.id)}">수정</button><button class="danger" data-delete-activity="${escapeHtml(row.id)}">삭제</button></div>` : ""}</td></tr>`;
}

function renderPostings() {
  const rows = state.data.jobPostings || [];
  const saramin = state.data.saramin || {};
  const isAdmin = state.actor?.role === "admin";
  const actions = `<a class="button secondary link-button" href="${escapeHtml(saramin.companyPage || "https://www.saramin.co.kr")}" target="_blank" rel="noopener noreferrer nofollow">사람인 채용관 ↗</a>${isAdmin ? `${saramin.connected ? `<button class="button secondary" data-action="sync-postings">↻ 지금 동기화</button>` : ""}<button class="button primary" data-action="new-posting">＋ 공고 등록</button>` : !state.actor ? `<button class="button primary" data-action="login">담당자 로그인</button>` : ""}`;
  content.innerHTML = `
    ${heading("SARAMIN JOB POSTINGS", "사람인 채용공고", "(주)메드파크의 진행 공고와 마감일을 공개하고, 등록 사용자는 지원·조회 현황과 연결된 채용목표까지 확인합니다.", actions)}
    <section class="summary posting-summary">
      ${summary("진행 중 공고", `${Number(saramin.activeCount || 0)}건`)}
      ${summary("7일 내 마감", `${Number(saramin.closingThisWeek || 0)}건`)}
      ${summary("최근 7일 등록", `${Number(saramin.newThisWeek || 0)}건`)}
      ${summary(state.actor ? "공고 지원자" : "연동 상태", state.actor ? `${Number(saramin.totalApplications || 0)}명` : (saramin.connected ? "API 연결" : "승인 대기"))}
    </section>
    <section class="integration-banner ${saramin.connected ? "connected" : "waiting"}">
      <i>${saramin.connected ? "✓" : "…"}</i><div><strong>${saramin.connected ? "사람인 Open API가 연결되어 있습니다." : "사람인 Open API 키 승인 대기 중입니다."}</strong><span>${saramin.connected ? `공고 현황은 주기적으로 자동 갱신됩니다.${saramin.lastSyncedAt ? ` 최근 동기화 ${formatDateTime(saramin.lastSyncedAt)}` : ""}` : "승인 전에는 관리자가 공고를 직접 등록·수정할 수 있으며, 키가 나오면 같은 화면에서 자동 동기화로 전환됩니다."}</span></div><a href="${escapeHtml(saramin.companyPage || "https://www.saramin.co.kr")}" target="_blank" rel="noopener noreferrer nofollow">Powered by 사람인 ↗</a>
    </section>
    <section class="posting-grid">
      ${rows.map(postingCard).join("") || `<article class="panel posting-empty"><i>▧</i><strong>아직 등록된 채용공고가 없습니다.</strong><span>사람인 API 키 연결 대기 · 관리자는 ‘공고 등록’에서 현재 공고를 먼저 입력할 수 있습니다.</span>${isAdmin ? `<button class="button primary" data-action="new-posting-empty">첫 공고 등록</button>` : ""}</article>`}
    </section>`;
  content.querySelector('[data-action="login"]')?.addEventListener("click", showLogin);
  content.querySelector('[data-action="new-posting"]')?.addEventListener("click", () => openJobPostingModal());
  content.querySelector('[data-action="new-posting-empty"]')?.addEventListener("click", () => openJobPostingModal());
  content.querySelector('[data-action="sync-postings"]')?.addEventListener("click", syncJobPostings);
  content.querySelectorAll("[data-edit-posting]").forEach((button) => button.addEventListener("click", () => openJobPostingModal(rows.find((row) => row.id === button.dataset.editPosting))));
  content.querySelectorAll("[data-delete-posting]").forEach((button) => button.addEventListener("click", () => deleteJobPosting(button.dataset.deletePosting)));
}

function postingCard(row) {
  const goal = state.data.goals.find((item) => item.id === row.requisitionId);
  const deadline = jobPostingDday(row);
  const details = [row.department, row.location, row.experience, row.jobType].filter(Boolean);
  return `<article class="posting-card ${escapeHtml(row.status)}">
    <header><div><span class="posting-status ${escapeHtml(row.status)}">${escapeHtml(jobPostingStatusLabel(row.status))}</span><span class="posting-source">${row.source === "saramin_api" ? "API 자동" : "관리자 등록"}</span></div><span class="posting-dday ${deadline.className}">${escapeHtml(deadline.label)}</span></header>
    <div class="posting-card-copy"><small>${escapeHtml(row.department || "(주)메드파크")}</small><h2>${escapeHtml(row.title)}</h2><div class="posting-meta">${details.map((item) => `<span>${escapeHtml(item)}</span>`).join("") || `<span>상세 조건은 사람인 공고에서 확인</span>`}</div></div>
    ${state.actor ? `<div class="posting-private"><span><b>조회</b>${Number(row.viewCount || 0).toLocaleString("ko-KR")}회</span><span><b>지원</b>${Number(row.applyCount || 0).toLocaleString("ko-KR")}명</span><span class="posting-goal"><b>연결 목표</b>${escapeHtml(goal ? `${goal.priority} · ${goal.functionName}` : "미연결")}</span></div>` : ""}
    <footer><div><span>${row.openingDate ? `${escapeHtml(formatDate(row.openingDate))} 등록` : "등록일 미입력"}</span><strong>${row.expirationDate ? `${escapeHtml(formatDate(row.expirationDate))} 마감` : escapeHtml(row.closeType || "채용시 마감")}</strong></div><div class="posting-actions"><a class="button primary link-button" href="${escapeHtml(row.url)}" target="_blank" rel="noopener noreferrer nofollow">공고 보기·지원 ↗</a>${state.actor?.role === "admin" ? `<button class="button secondary" data-edit-posting="${escapeHtml(row.id)}">수정</button><button class="button danger" data-delete-posting="${escapeHtml(row.id)}">삭제</button>` : ""}</div></footer>
  </article>`;
}

async function syncJobPostings() {
  setBusy(true);
  try {
    const result = await api("/api/job-postings/sync", { method: "POST", body: {} });
    await loadData();
    showToast(`사람인 공고 ${Number(result.synced || 0)}건을 동기화했습니다.`);
  } catch (error) {
    showGlobalError(error.message);
  } finally {
    setBusy(false);
  }
}

function renderCalendar() {
  const month = state.calendarMonth;
  const calendarData = state.calendarCache[month];
  const actions = canWrite()
    ? `<button class="button primary" data-action="new-interview">＋ 면접 일정 등록</button>`
    : !state.actor ? `<button class="button primary" data-action="login">상세 일정 로그인</button>` : "";

  if (!calendarData) {
    content.innerHTML = `
      ${heading("INTERVIEW CALENDAR", "면접 일정", "신규 면접과 과거후보 재면접 일정을 월간 달력으로 확인합니다.", actions)}
      ${calendarToolbar(month)}
      <section class="panel calendar-loading" aria-busy="true"><i></i><strong>${escapeHtml(calendarMonthLabel(month))} 일정을 불러오는 중입니다.</strong></section>`;
    bindCalendarControls();
    void loadCalendarMonth(month);
    return;
  }

  const registered = Boolean(state.actor);
  const scheduleTypes = new Set(["interview_scheduled", "reinterview_scheduled"]);
  const scheduleRows = registered
    ? (calendarData.recruitingActivities || [])
      .filter((row) => scheduleTypes.has(row.activityType) && calendarEventDate(row).slice(0, 7) === month)
      .sort((a, b) => calendarEventSortKey(a).localeCompare(calendarEventSortKey(b)))
    : [];
  const eventsByDate = new Map();
  scheduleRows.forEach((row) => {
    const date = calendarEventDate(row);
    if (!eventsByDate.has(date)) eventsByDate.set(date, []);
    eventsByDate.get(date).push(row);
  });
  const publicDays = (calendarData.report?.byDay || [])
    .filter((row) => row.label.slice(0, 7) === month && Number(row.interviews) > 0)
    .sort((a, b) => a.label.localeCompare(b.label));
  const publicByDate = new Map(publicDays.map((row) => [row.label, row]));
  const scheduledCount = registered
    ? scheduleRows.reduce((sum, row) => sum + Number(row.count || 1), 0)
    : publicDays.reduce((sum, row) => sum + Number(row.interviews || 0), 0);
  const reinterviewCount = registered
    ? scheduleRows.filter((row) => row.activityType === "reinterview_scheduled").reduce((sum, row) => sum + Number(row.count || 1), 0)
    : publicDays.reduce((sum, row) => sum + Number(row.reinterviews || 0), 0);
  const scheduledDays = registered ? eventsByDate.size : publicDays.length;
  const ownerCount = registered ? new Set(scheduleRows.map((row) => row.ownerName).filter(Boolean)).size : null;
  const departments = registered ? [...new Set(scheduleRows.map((row) => row.department || "미지정"))] : [];
  const days = calendarMonthCells(month);

  content.innerHTML = `
    ${heading("INTERVIEW CALENDAR", "면접 일정", "신규 면접과 과거후보 재면접 일정을 월간 달력으로 확인합니다.", actions)}
    ${calendarToolbar(month)}
    <section class="summary calendar-summary">
      ${summary("면접 일정", `${scheduledCount}건`)}
      ${summary("일정 있는 날", `${scheduledDays}일`)}
      ${summary("재면접", `${reinterviewCount}건`)}
      ${summary(registered ? "담당자" : "공개 범위", registered ? `${ownerCount}명` : "건수만")}
    </section>
    ${!registered ? `<section class="calendar-privacy"><i>i</i><span>공개 조회에서는 후보자 정보 없이 면접 수립 건수만 표시합니다. 로그인하면 시간·후보자·포지션·담당자를 확인할 수 있습니다.</span></section>` : ""}
    <section class="panel calendar-panel">
      ${registered && departments.length ? `<div class="calendar-department-legend">${departments.map((department) => `<span class="${departmentColorClass(department)}"><i></i>${escapeHtml(department)}</span>`).join("")}</div>` : ""}
      <div class="calendar-scroll">
        <div class="calendar-grid calendar-weekdays" role="row">${["일", "월", "화", "수", "목", "금", "토"].map((day, index) => `<div class="calendar-weekday ${index === 0 ? "sunday" : index === 6 ? "saturday" : ""}" role="columnheader">${day}</div>`).join("")}</div>
        <div class="calendar-grid calendar-days" role="grid" aria-label="${escapeHtml(calendarMonthLabel(month))} 면접 일정">
          ${days.map((day) => calendarDayCell(day, month, registered, eventsByDate.get(day.date) || [], publicByDate.get(day.date))).join("")}
        </div>
      </div>
    </section>
    <section class="panel calendar-agenda">
      <div class="section-heading"><div><small>MONTHLY AGENDA</small><h2>${escapeHtml(calendarMonthLabel(month))} 면접 일정 목록</h2></div><span class="subtle">${scheduledCount}건</span></div>
      <div class="agenda-list">
        ${registered ? scheduleRows.map(calendarAgendaRow).join("") || calendarEmpty("등록된 면접 일정이 없습니다.", canWrite() ? "달력의 날짜 옆 + 버튼으로 바로 등록할 수 있습니다." : "") : publicDays.map(calendarPublicAgendaRow).join("") || calendarEmpty("면접 수립 기록이 없습니다.", "로그인하면 상세 일정을 확인할 수 있습니다.")}
      </div>
    </section>`;
  bindCalendarControls(scheduleRows);
}

async function loadCalendarMonth(month) {
  const request = ++state.calendarRequest;
  setBusy(true);
  try {
    const from = calendarLookupStart(month);
    const to = monthEnd(`${month}-01`);
    const data = await api(`/api/hr?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    if (request !== state.calendarRequest || month !== state.calendarMonth) return;
    state.calendarCache[month] = data;
    hideGlobalError();
    renderCalendar();
  } catch (error) {
    if (request !== state.calendarRequest || month !== state.calendarMonth) return;
    showGlobalError(error.message);
    content.querySelector(".calendar-loading")?.classList.add("failed");
    const message = content.querySelector(".calendar-loading strong");
    if (message) message.textContent = "일정을 불러오지 못했습니다. 새로고침해 주세요.";
  } finally {
    if (request === state.calendarRequest) setBusy(false);
  }
}

function calendarToolbar(month) {
  return `<section class="calendar-toolbar" aria-label="달력 월 이동">
    <button type="button" data-calendar-shift="-1" aria-label="이전 달">‹</button>
    <div><small>MONTHLY SCHEDULE</small><strong>${escapeHtml(calendarMonthLabel(month))}</strong></div>
    <button type="button" data-calendar-shift="1" aria-label="다음 달">›</button>
    <button type="button" class="calendar-today" data-calendar-today>오늘</button>
  </section>`;
}

function bindCalendarControls(scheduleRows = []) {
  content.querySelectorAll("[data-calendar-shift]").forEach((button) => button.addEventListener("click", () => {
    state.calendarMonth = shiftMonthKey(state.calendarMonth, Number(button.dataset.calendarShift));
    state.calendarExpandedDay = null;
    renderCalendar();
  }));
  content.querySelector("[data-calendar-today]")?.addEventListener("click", () => {
    state.calendarMonth = (state.data?.today || localYmd(new Date())).slice(0, 7);
    state.calendarExpandedDay = null;
    renderCalendar();
  });
  content.querySelector('[data-action="new-interview"]')?.addEventListener("click", () => openInterviewForDate(calendarDefaultDate()));
  content.querySelector('[data-action="login"]')?.addEventListener("click", showLogin);
  content.querySelectorAll("[data-calendar-add]").forEach((button) => button.addEventListener("click", () => openInterviewForDate(button.dataset.calendarAdd)));
  content.querySelectorAll("[data-calendar-more]").forEach((button) => button.addEventListener("click", () => {
    state.calendarExpandedDay = state.calendarExpandedDay === button.dataset.calendarMore ? null : button.dataset.calendarMore;
    renderCalendar();
  }));
  content.querySelectorAll("[data-calendar-event]").forEach((button) => button.addEventListener("click", () => {
    const row = scheduleRows.find((item) => item.id === button.dataset.calendarEvent);
    if (row && canEditActivity(row)) openActivityModal(row, { calendar: true });
  }));
  content.querySelectorAll("[data-calendar-delete]").forEach((button) => button.addEventListener("click", () => deleteActivity(button.dataset.calendarDelete)));
}

function calendarDayCell(day, month, registered, rows, publicRow) {
  const inMonth = day.date.slice(0, 7) === month;
  const today = day.date === (state.data?.today || localYmd(new Date()));
  const events = registered ? rows : [];
  const expanded = state.calendarExpandedDay === day.date;
  const visibleEvents = expanded ? events : events.slice(0, 3);
  const remaining = events.length - visibleEvents.length;
  const weekday = new Date(`${day.date}T00:00:00Z`).getUTCDay();
  const dayClass = weekday === 0 ? "sunday" : weekday === 6 ? "saturday" : "";
  return `<article class="calendar-day ${inMonth ? "" : "outside"} ${today ? "today" : ""} ${dayClass}" role="gridcell" aria-label="${escapeHtml(day.date)}">
    <header><time datetime="${escapeHtml(day.date)}">${Number(day.date.slice(8, 10))}</time>${inMonth && canWrite() ? `<button type="button" data-calendar-add="${escapeHtml(day.date)}" aria-label="${escapeHtml(day.date)} 면접 일정 등록">＋</button>` : ""}</header>
    <div class="calendar-events">
      ${inMonth && registered ? visibleEvents.map(calendarEventChip).join("") : ""}
      ${inMonth && registered && (remaining > 0 || expanded && events.length > 3) ? `<button type="button" class="calendar-more" data-calendar-more="${escapeHtml(day.date)}">${expanded ? "접기" : `+ ${remaining}개 일정 더보기`}</button>` : ""}
      ${inMonth && !registered && Number(publicRow?.interviews || 0) > 0 ? `<div class="calendar-count"><strong>${Number(publicRow.interviews)}건</strong><span>면접 수립</span>${Number(publicRow.reinterviews || 0) ? `<small>재면접 ${Number(publicRow.reinterviews)}건</small>` : ""}</div>` : ""}
    </div>
  </article>`;
}

function calendarEventChip(row) {
  const editable = canEditActivity(row);
  const tag = row.activityType === "reinterview_scheduled" ? "재면접" : "면접";
  const inner = `<span><time>${escapeHtml(calendarEventTime(row.nextActionAt))}</time><b>${escapeHtml(tag)}</b></span><strong>${escapeHtml(row.candidateName || `${Number(row.count || 1)}건 일정`)}</strong><small>${escapeHtml(row.position || "포지션 미입력")}${row.interviewLocation ? ` · ${escapeHtml(row.interviewLocation)}` : ""}</small>`;
  return editable
    ? `<button type="button" class="calendar-event ${departmentColorClass(row.department)} ${row.activityType === "reinterview_scheduled" ? "reinterview" : ""}" data-calendar-event="${escapeHtml(row.id)}" title="일정 수정·결과 입력">${inner}</button>`
    : `<div class="calendar-event ${departmentColorClass(row.department)} ${row.activityType === "reinterview_scheduled" ? "reinterview" : ""}">${inner}</div>`;
}

function calendarAgendaRow(row) {
  const editable = canEditActivity(row);
  const date = calendarEventDate(row);
  return `<article class="agenda-item">
    <div class="agenda-date"><strong>${Number(date.slice(8, 10))}</strong><span>${escapeHtml(calendarWeekday(date))}</span></div>
    <div class="agenda-time"><strong>${escapeHtml(calendarEventTime(row.nextActionAt))}</strong><span>${row.nextActionAt ? "면접 예정" : "시간 미입력"}</span></div>
    <div class="agenda-copy ${departmentColorClass(row.department)}"><span class="activity-tag ${escapeHtml(row.activityType)}">${escapeHtml(activityLabels[row.activityType])}</span><strong>${escapeHtml(row.candidateName || `${Number(row.count || 1)}건 일정`)}</strong><small>${escapeHtml(row.department || "부서 미입력")} · ${escapeHtml(row.position || "포지션 미입력")} · ${escapeHtml(row.ownerName || "담당자 미입력")}</small><div class="agenda-interview-meta">${row.interviewLocation ? `<span>장소 ${escapeHtml(row.interviewLocation)}</span>` : ""}${row.interviewerNames ? `<span>면접관 ${escapeHtml(row.interviewerNames)}</span>` : ""}${row.interviewStatus ? `<span>${escapeHtml(interviewStatusLabels[row.interviewStatus] || row.interviewStatus)}</span>` : ""}${row.interviewResult && row.interviewResult !== "pending" ? `<span>${escapeHtml(interviewResultLabels[row.interviewResult] || row.interviewResult)}</span>` : ""}</div>${row.details ? `<p>${escapeHtml(row.details)}</p>` : ""}${row.resultNotes ? `<p><b>결과</b> ${escapeHtml(row.resultNotes)}${row.rejectionReason ? ` · ${escapeHtml(row.rejectionReason)}` : ""}</p>` : ""}</div>
    ${editable ? `<div class="row-actions agenda-actions"><button type="button" data-calendar-event="${escapeHtml(row.id)}">수정</button><button type="button" class="danger" data-calendar-delete="${escapeHtml(row.id)}">삭제</button></div>` : ""}
  </article>`;
}

function calendarPublicAgendaRow(row) {
  return `<article class="agenda-item public"><div class="agenda-date"><strong>${Number(row.label.slice(8, 10))}</strong><span>${escapeHtml(calendarWeekday(row.label))}</span></div><div class="agenda-copy"><strong>면접 수립 ${Number(row.interviews)}건</strong><small>${Number(row.reinterviews || 0) ? `재면접 ${Number(row.reinterviews)}건 포함` : "후보자 상세정보 비공개"}</small></div></article>`;
}

function departmentColorClass(value) {
  const text = String(value || "미지정");
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return `department-color-${hash % 8}`;
}

function calendarEmpty(title, description) {
  return `<div class="calendar-empty"><i>□</i><strong>${escapeHtml(title)}</strong>${description ? `<span>${escapeHtml(description)}</span>` : ""}</div>`;
}

function openInterviewForDate(date) {
  openActivityModal(null, { calendar: true, activityType: "interview_scheduled", source: "saramin", activityDate: date, nextActionAt: `${date}T10:00` });
}

function calendarMonthCells(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  const firstDay = new Date(Date.UTC(year, monthNumber - 1, 1));
  const leading = firstDay.getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const cellCount = Math.ceil((leading + daysInMonth) / 7) * 7;
  return Array.from({ length: cellCount }, (_, index) => {
    const date = new Date(Date.UTC(year, monthNumber - 1, 1 - leading + index));
    return { date: utcYmd(date) };
  });
}

function shiftMonthKey(month, amount) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + amount, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function calendarLookupStart(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  return utcYmd(new Date(Date.UTC(year, monthNumber - 7, 1)));
}

function calendarDefaultDate() {
  const today = state.data?.today || localYmd(new Date());
  return today.slice(0, 7) === state.calendarMonth ? today : `${state.calendarMonth}-01`;
}

function calendarEventDate(row) {
  const value = row.nextActionAt;
  if (!value) return row.activityDate || `${state.calendarMonth}-01`;
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(text)) return text.slice(0, 10);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return text.slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function calendarEventTime(value) {
  if (!value) return "시간 미입력";
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(text)) return text.slice(11, 16);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return text.slice(11, 16) || "시간 미입력";
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

function calendarEventSortKey(row) {
  return `${calendarEventDate(row)}T${row.nextActionAt ? calendarEventTime(row.nextActionAt) : "99:99"}-${row.position || ""}`;
}

function calendarMonthLabel(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  return `${year}년 ${monthNumber}월`;
}

function calendarWeekday(value) {
  return new Intl.DateTimeFormat("ko-KR", { weekday: "short", timeZone: "Asia/Seoul" }).format(new Date(`${value}T00:00:00+09:00`));
}

function utcYmd(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function renderMeetings() {
  if (!state.actor) {
    content.innerHTML = `${heading("REGISTERED HR WORKSPACE", "아침 HR 회의·개인 업무", "회의 아젠다·회의록·담당자별 액션플랜과 알림은 등록 사용자에게만 표시됩니다.", `<button class="button primary" data-action="login">담당자 로그인</button>`)}<section class="candidate-privacy"><i>●</i><div><strong>회의록과 개인 업무는 내부 정보입니다.</strong><span>로그인하면 오늘 할 일, 이번 주 마감, 지연 업무, 검토 사항을 확인할 수 있습니다.</span></div></section>`;
    content.querySelector('[data-action="login"]').addEventListener("click", showLogin);
    return;
  }
  const meetings = state.data.meetings || [];
  const actions = state.data.actionItems || [];
  const work = state.data.myWork || { today: [], week: [], overdue: [], review: [] };
  const activeActions = actions.filter((row) => !["completed", "cancelled"].includes(row.status));
  content.innerHTML = `
    ${heading("HR MEETING WORKSPACE", "HR 회의록·실행과제", "녹취 내용을 자동 정리하고 결정사항과 담당자별 실행과제를 한 흐름으로 관리합니다.", canWrite() ? `<button class="button secondary" data-action="new-action-item">＋ 실행과제</button><button class="button primary" data-action="new-meeting">＋ 회의록 작성</button>` : "")}
    <section class="summary meeting-summary">${summary("오늘 해야 할 일", `${work.today.length}건`)}${summary("이번 주 마감", `${work.week.length}건`)}${summary("지연 업무", `${work.overdue.length}건`)}${summary("검토 사항", `${work.review.length}건`)}</section>
    <section class="meeting-layout">
      <div class="meeting-list"><div class="section-heading"><div><small>MEETING HISTORY</small><h2>회의 아젠다·회의록</h2></div><span class="subtle">${meetings.length}건</span></div>${meetings.map(meetingCard).join("") || `<div class="meeting-empty"><strong>등록된 HR 회의가 없습니다.</strong><span>매일 아침 회의의 아젠다와 결정사항을 첫 기록으로 남겨주세요.</span></div>`}</div>
      <aside class="notification-panel"><div class="section-heading"><div><small>ALERTS</small><h2>개인·전체 알림</h2></div></div><div class="notification-list">${activeActions.filter((row) => row.notificationScope === "all" || row.assigneeUsername === state.actor.username).slice(0, 12).map((row) => `<article class="${row.dueDate < state.data.today ? "overdue" : ""}"><span>${row.notificationScope === "all" ? "전체" : "개인"}</span><div><strong>${escapeHtml(row.title)}</strong><small>${escapeHtml(row.assigneeName)} · ${escapeHtml(formatDate(row.dueDate))}</small></div></article>`).join("") || `<div class="meeting-empty compact">현재 알림이 없습니다.</div>`}</div></aside>
    </section>
    <section class="panel table-panel action-plan-panel"><div class="section-heading"><div><small>ACTION PLAN</small><h2>담당자별 실행과제</h2><p>완료되지 않은 업무가 먼저 표시되며 지연 여부를 자동 판정합니다.</p></div><span class="subtle">미완료 ${activeActions.length}건</span></div><div class="table-wrap"><table><thead><tr><th>우선</th><th>업무</th><th>담당자</th><th>기한</th><th>상태</th><th>알림</th><th></th></tr></thead><tbody>${actions.map(actionItemRow).join("") || emptyRow(7, "등록된 액션플랜이 없습니다.")}</tbody></table></div></section>`;
  content.querySelector('[data-action="new-meeting"]')?.addEventListener("click", () => openMeetingModal());
  content.querySelector('[data-action="new-action-item"]')?.addEventListener("click", () => openActionItemModal());
  content.querySelectorAll("[data-edit-meeting]").forEach((button) => button.addEventListener("click", () => openMeetingModal(meetings.find((row) => row.id === button.dataset.editMeeting))));
  content.querySelectorAll("[data-delete-meeting]").forEach((button) => button.addEventListener("click", () => deleteMeeting(button.dataset.deleteMeeting)));
  content.querySelectorAll("[data-meeting-action]").forEach((button) => button.addEventListener("click", () => openActionItemModal(null, button.dataset.meetingAction)));
  content.querySelectorAll("[data-print-meeting]").forEach((button) => button.addEventListener("click", () => printMeeting(meetings.find((row) => row.id === button.dataset.printMeeting), actions)));
  content.querySelectorAll("[data-edit-action-item]").forEach((button) => button.addEventListener("click", () => openActionItemModal(actions.find((row) => row.id === button.dataset.editActionItem))));
  content.querySelectorAll("[data-delete-action-item]").forEach((button) => button.addEventListener("click", () => deleteActionItem(button.dataset.deleteActionItem)));
  content.querySelectorAll("[data-complete-action-item]").forEach((button) => button.addEventListener("click", () => completeActionItem(actions.find((row) => row.id === button.dataset.completeActionItem))));
}

function meetingCard(row) {
  const reviewed = row.analysisStatus === "reviewed";
  const meetingSection = (kind, number, title, value) => `<section class="meeting-section ${kind}"><header><i>${number}</i><b>${title}</b></header><p>${escapeHtml(value || "미입력")}</p></section>`;
  return `<article class="meeting-card ${escapeHtml(row.status)}"><header><div><span class="meeting-state">${escapeHtml(meetingStatusLabels[row.status] || row.status)}</span><span class="analysis-state ${reviewed ? "reviewed" : "draft"}">${reviewed ? "자동정리 검토완료" : "작성 중"}</span><h3>${escapeHtml(row.title)}</h3><time>${escapeHtml(formatDateTime(row.meetingDate))}${row.participants ? ` · 참석 ${escapeHtml(row.participants)}` : ""}</time></div><div class="row-actions"><button data-print-meeting="${escapeHtml(row.id)}">인쇄·PDF</button>${canWrite() ? `<button data-meeting-action="${escapeHtml(row.id)}">과제 추가</button><button data-edit-meeting="${escapeHtml(row.id)}">수정</button><button class="danger" data-delete-meeting="${escapeHtml(row.id)}">삭제</button>` : ""}</div></header><div class="meeting-sections">${meetingSection("agenda", "01", "아젠다", row.agenda)}${meetingSection("discussion", "02", "핵심 논의사항", row.keyDiscussions)}${meetingSection("decision", "03", "결정사항", row.decisions)}${meetingSection("issue", "04", "중요 이슈·보류", row.issues)}${meetingSection("minutes", "05", "회의 요약", row.minutes)}</div><footer>${escapeHtml(row.updatedByName)} · 최근 수정 ${escapeHtml(formatDateTime(row.updatedAt))}</footer></article>`;
}

function actionItemRow(row) {
  const late = !["completed", "cancelled"].includes(row.status) && row.dueDate < state.data.today;
  return `<tr class="${late ? "action-overdue" : ""}"><td><span class="action-priority ${escapeHtml(row.priority)}">${escapeHtml(actionPriorityLabels[row.priority] || row.priority)}</span></td><td><strong>${escapeHtml(row.title)}</strong><small class="sub detail">${escapeHtml(row.details || "-")}</small></td><td><strong>${escapeHtml(row.assigneeName)}</strong></td><td><strong>${escapeHtml(formatDate(row.dueDate))}</strong>${late ? `<small class="sub overdue-text">지연</small>` : ""}</td><td><span class="action-status ${escapeHtml(row.status)}">${escapeHtml(actionStatusLabels[row.status] || row.status)}</span></td><td>${row.notificationScope === "all" ? "전체 알림" : "개인 알림"}</td><td>${canWrite() ? `<div class="row-actions">${!["completed", "cancelled"].includes(row.status) ? `<button data-complete-action-item="${escapeHtml(row.id)}">완료</button>` : ""}<button data-edit-action-item="${escapeHtml(row.id)}">수정</button><button class="danger" data-delete-action-item="${escapeHtml(row.id)}">삭제</button></div>` : ""}</td></tr>`;
}

function renderGoals() {
  const goals = [...state.data.goals].sort(goalSort);
  const checkpoints = state.data.checkpoints || [];
  const reportGoals = state.data.report.goals;
  content.innerHTML = `
    ${heading("원목표 → 중간점검 → 수정목표", "채용 목표 관리", "포지션별 우선순위와 담당자, 중간점검일, 자동 진행률, 백업플랜을 연결합니다.", canWrite() ? `<button class="button primary" data-action="new-goal">＋ 채용목표 등록</button>` : "")}
    <section class="summary">${summary("전체 목표", `${goals.length}개`)}${summary("평균 진행률", `${reportGoals.averageProgress}%`)}${summary("점검 필요", `${reportGoals.checkpointDue}개`)}${summary("위험·지연", `${reportGoals.atRisk}개`)}</section>
    <section class="goal-grid">${goals.map(goalCard).join("")}</section>
    ${state.actor ? `<section class="panel table-panel checkpoint-history"><div class="section-heading"><div><small>CHECKPOINT HISTORY</small><h2>중간점검 기록</h2></div><span class="subtle">수정·삭제 가능</span></div><div class="table-wrap"><table><thead><tr><th>점검일</th><th>채용목표</th><th>진행률</th><th>점검내용·위험</th><th>수정목표일</th><th>작성자</th><th></th></tr></thead><tbody>${checkpoints.map((row) => checkpointRow(row, goals)).join("") || emptyRow(7, "등록된 중간점검이 없습니다.")}</tbody></table></div></section>` : ""}`;
  content.querySelector('[data-action="new-goal"]')?.addEventListener("click", () => openGoalModal());
  content.querySelectorAll("[data-edit-goal]").forEach((button) => button.addEventListener("click", () => openGoalModal(goals.find((goal) => goal.id === button.dataset.editGoal))));
  content.querySelectorAll("[data-check-goal]").forEach((button) => button.addEventListener("click", () => openCheckpointModal(goals.find((goal) => goal.id === button.dataset.checkGoal))));
  content.querySelectorAll("[data-delete-goal]").forEach((button) => button.addEventListener("click", () => deleteGoal(goals.find((goal) => goal.id === button.dataset.deleteGoal))));
  content.querySelectorAll("[data-edit-checkpoint]").forEach((button) => button.addEventListener("click", () => {
    const checkpoint = checkpoints.find((row) => row.id === button.dataset.editCheckpoint);
    const goal = goals.find((item) => item.id === checkpoint?.requisitionId);
    if (goal && checkpoint) openCheckpointModal(goal, checkpoint);
  }));
  content.querySelectorAll("[data-delete-checkpoint]").forEach((button) => button.addEventListener("click", () => deleteCheckpoint(button.dataset.deleteCheckpoint)));
}

function goalCard(goal) {
  const dates = goal.revisedTargetDate ? `<span><b>원목표</b><del>${escapeHtml(formatDate(goal.originalTargetDate))}</del></span><span><b>수정목표</b><strong class="revised">${escapeHtml(formatDate(goal.targetDate))}</strong></span>` : `<span><b>목표일</b><strong>${escapeHtml(formatDate(goal.targetDate))}</strong></span>`;
  return `<article class="goal-card goal-status-${escapeHtml(goal.riskStatus)}"><header><span class="priority p${escapeHtml(goal.priority.slice(0,1))}">${escapeHtml(goal.priority)}</span><span class="risk ${escapeHtml(goal.riskStatus)}">${escapeHtml(riskLabels[goal.riskStatus] || goal.riskStatus)}</span></header><div class="goal-title"><small>${escapeHtml(goal.division || "부서 미지정")}</small><h2>${escapeHtml(goal.functionName)}</h2><p>${escapeHtml(goal.level || goal.title)}</p></div><div class="goal-progress"><div><span>자동 진행률</span><strong>${Number(goal.progress)}%</strong></div><progress max="100" value="${Number(goal.progress)}"></progress><small>채용 ${Number(goal.filledCount)}/${Number(goal.targetHeadcount)}명 · 후보 단계 기반</small></div><div class="goal-dates"><span><b>중간점검</b><strong>${escapeHtml(formatDate(goal.checkpointDate))}</strong></span>${dates}</div><div class="goal-owner"><b>정</b>${escapeHtml(goal.ownerPrimary || "미지정")} <b>부</b>${escapeHtml(goal.ownerSecondary || "-")}</div>${state.actor ? `<div class="goal-backup"><b>백업플랜</b><span>${escapeHtml(goal.backupPlan || "중간점검 시 등록")}</span></div>` : ""}${canWrite() ? `<footer><button class="button secondary" data-edit-goal="${escapeHtml(goal.id)}">수정</button><button class="button primary" data-check-goal="${escapeHtml(goal.id)}">점검</button><button class="button danger" data-delete-goal="${escapeHtml(goal.id)}">삭제</button></footer>` : ""}</article>`;
}

function checkpointRow(row, goals) {
  const goal = goals.find((item) => item.id === row.requisitionId);
  return `<tr><td><strong>${escapeHtml(formatDate(row.checkpointDate))}</strong></td><td><strong>${escapeHtml(goal?.functionName || "삭제된 목표")}</strong><small class="sub">${escapeHtml(goal?.title || row.requisitionId)}</small></td><td>${Number(row.progressPercent)}%</td><td><strong>${escapeHtml(row.summary)}</strong><small class="sub detail">${escapeHtml(row.risks || row.backupPlan || "-")}</small></td><td>${escapeHtml(formatDate(row.revisedTargetDate))}</td><td>${escapeHtml(row.createdByName)}</td><td>${canWrite() ? `<div class="row-actions"><button data-edit-checkpoint="${escapeHtml(row.id)}">수정</button><button class="danger" data-delete-checkpoint="${escapeHtml(row.id)}">삭제</button></div>` : ""}</td></tr>`;
}

function renderTalent() {
  const totals = state.data.report.totals;
  const rows = state.data.recruitingActivities.filter((row) => ["past_pool_reviewed", "past_pool_contacted", "reinterview_scheduled"].includes(row.activityType));
  content.innerHTML = `
    ${heading("2026년 우선 → 2025년 이전 확대", "24~26년 과거 인재풀 재접촉", "면접 불참·조건 문제 탈락·기합격 대비 부족 인원을 우선 검토하고 연락·재면접까지 기록합니다.", canWrite() ? `<button class="button primary" data-action="new-past">＋ 과거후보 활동 입력</button>` : `<button class="button primary" data-action="login">상세 조회 로그인</button>`)}
    <section class="summary">${summary("과거후보 검토", `${totals.pastReviews}명`)}${summary("재접촉", `${totals.pastContacts}명`)}${summary("재면접 수립", `${totals.reinterviews}명`)}${summary("기존 인재풀 자산", `${state.data.legacy.talentPool}명`)}</section>
    ${state.actor ? `<section class="panel table-panel"><div class="table-wrap"><table><thead><tr><th>일자</th><th>담당자</th><th>부서·직무</th><th>활동</th><th>인원</th><th>후보·결과</th><th>다음 조치</th><th></th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escapeHtml(formatDate(row.activityDate))}</td><td>${escapeHtml(row.ownerName)}</td><td><strong>${escapeHtml(row.position)}</strong><small class="sub">${escapeHtml(row.department)}</small></td><td><span class="activity-tag ${escapeHtml(row.activityType)}">${escapeHtml(activityLabels[row.activityType])}</span></td><td><b>${Number(row.count)}명</b></td><td>${row.candidateName ? `<strong>${escapeHtml(row.candidateName)}</strong>` : ""}<small class="sub detail">${escapeHtml(row.details || "-")}</small></td><td>${escapeHtml(formatDateTime(row.nextActionAt))}</td><td>${canEditActivity(row) ? `<div class="row-actions"><button data-edit-past="${escapeHtml(row.id)}">수정</button><button class="danger" data-delete-past="${escapeHtml(row.id)}">삭제</button></div>` : ""}</td></tr>`).join("") || emptyRow(8, "선택한 기간에 과거후보 활동이 없습니다.")}</tbody></table></div></section>` : `<section class="panel public-explainer"><h2>공개 화면은 집계만 제공합니다.</h2><p>후보자 이름과 재접촉 결과는 개인정보이므로 등록 사용자에게만 표시됩니다. 공개 현황에서는 검토·연락·재면접 건수만 확인할 수 있습니다.</p></section>`}`;
  content.querySelector('[data-action="new-past"]')?.addEventListener("click", () => openActivityModal(null, { activityType: "past_pool_reviewed", source: "past_pool" }));
  content.querySelector('[data-action="login"]')?.addEventListener("click", showLogin);
  content.querySelectorAll("[data-edit-past]").forEach((button) => button.addEventListener("click", () => openActivityModal(rows.find((row) => row.id === button.dataset.editPast))));
  content.querySelectorAll("[data-delete-past]").forEach((button) => button.addEventListener("click", () => deleteActivity(button.dataset.deletePast)));
}

function renderReports() {
  const { snapshots } = state.data;
  const activeSnapshot = state.activeReportSnapshot;
  const report = activeSnapshot?.summary || state.data.report;
  const activeReportType = activeSnapshot?.periodType || state.reportType;
  const executive = report.executive || {};
  const totals = report.totals;
  const reportTitle = reportTypeLabels[activeReportType] || "HR 활동·실적 보고";
  const displayDepartments = (executive.departments || []).filter((row) => row.goalCount || row.activityCount);
  content.innerHTML = `
    ${heading("DAILY · CLOSE · PERFORMANCE REVIEW", "HR 활동·실적 보고센터", "보고 유형과 기준일을 고르면 실제 입력 데이터를 바탕으로 경영회의용 상세 보고서를 자동 생성합니다.", `${canWrite() ? `<button class="button secondary" data-action="close-report">${activeSnapshot ? "저장본 수정" : "현재 보고 저장"}</button>` : ""}<button class="button secondary" data-action="copy-report">보고서 복사</button><button class="button primary" data-action="print-report">인쇄·PDF</button>`)}
    <section class="report-generator panel">
      <div class="report-type-grid">${Object.entries(reportTypeLabels).map(([type, label]) => `<button type="button" class="report-type-button ${state.reportType === type ? "active" : ""}" data-report-type="${type}"><small>${type.startsWith("performance") ? `PERFORMANCE ${type.slice(-1)}` : type.toUpperCase()}</small><strong>${escapeHtml(label)}</strong><span>${reportTypeDescription(type)}</span></button>`).join("")}</div>
      <div class="report-generator-controls"><label><span>보고 기준일</span><input type="date" id="report-date" value="${escapeHtml(state.reportDate || state.data.today)}"></label><div><span>자동 집계 기간</span><strong id="report-auto-period">${escapeHtml(formatDate(report.from))} ~ ${escapeHtml(formatDate(report.to))}</strong></div><button class="button primary" data-action="generate-report">이 보고서 만들기</button></div>
    </section>
    ${activeSnapshot ? `<section class="saved-report-banner"><div><strong>저장본을 보고 있습니다.</strong><span>${escapeHtml(formatDateTime(activeSnapshot.closedAt))} · ${escapeHtml(activeSnapshot.closedByName)} 저장</span></div><button class="button secondary" data-live-report>현재 데이터로 돌아가기</button></section>` : ""}
    <article class="report-document ${escapeHtml(activeReportType)}" id="generated-report">
      <header class="report-document-header"><div><small>MEDPARK · 인재확보 및 인사기획</small><h1>${escapeHtml(reportTitle)}</h1><p>${escapeHtml(formatDate(report.from))} ~ ${escapeHtml(formatDate(report.to))} · 생성 ${escapeHtml(formatDateTime(executive.generatedAt))}</p></div><span class="report-status ${escapeHtml(executive.status || "monitor")}">${escapeHtml(executiveStatusLabel(executive.status))}</span></header>
      ${reportMeetingFocus(activeReportType, executive, totals)}
      <section class="report-executive-summary"><div class="report-section-title"><small>EXECUTIVE SUMMARY</small><h2>경영 요약</h2></div><ul>${(executive.bullets || [report.narrative]).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>
      <section class="report-scorecards">
        ${reportScorecard("기간 활동", totals.totalCount, "건", executive.deltas?.totalCount, "이전 동일기간")}
        ${reportScorecard("지원·접수", totals.applications, "건", executive.deltas?.applications, "기간 입력")}
        ${reportScorecard("면접 수립", totals.interviews, "건", executive.deltas?.interviews, `실시 ${totals.interviewsConducted}건`)}
        ${reportScorecard("현재 면접 경험", executive.pipeline?.interviews, "명", null, `전체 후보 대비 ${Number(executive.pipeline?.interviewRate || 0)}%`)}
        ${reportScorecard("실제 입사", executive.pipeline?.hired, "명", null, `전체 후보 대비 ${Number(executive.pipeline?.hireRate || 0)}%`)}
        ${reportScorecard("조치 필요 부서", executive.departmentSummary?.actionRequired, "개", null, `후보군 확보 ${Number(executive.departmentSummary?.pipelineNeeded || 0)}개`)}
      </section>
      ${activeReportType === "daily" ? renderDailyReportDetail(report) : renderPerformanceReportDetail(report, executive, displayDepartments)}
      <section class="report-definitions"><strong>집계 기준</strong>${(executive.definitions || []).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</section>
    </article>
    <section class="panel snapshots"><div class="section-heading"><div><small>SAVED REPORTS</small><h2>저장된 보고 이력</h2></div></div>${snapshots.map((row) => `<article><span class="report-type">${escapeHtml(reportTypeLabels[row.periodType] || row.periodType)}</span><div class="snapshot-copy"><strong>${escapeHtml(formatDate(row.periodStart))} ~ ${escapeHtml(formatDate(row.periodEnd))}</strong><small>${escapeHtml(row.summary?.executive?.bullets?.[0] || row.summary?.narrative || "HR 보고")} · ${escapeHtml(row.closedByName)} · ${escapeHtml(formatDateTime(row.closedAt))}</small>${row.note ? `<small class="snapshot-note">${escapeHtml(row.note)}</small>` : ""}</div><div class="row-actions snapshot-actions"><button data-open-snapshot="${escapeHtml(row.id)}">보기</button>${canWrite() ? `<button data-edit-report="${escapeHtml(row.id)}">수정</button><button class="danger" data-delete-report="${escapeHtml(row.id)}">삭제</button>` : ""}</div></article>`).join("") || `<div class="empty">저장된 보고가 없습니다.</div>`}</section>`;
  content.querySelectorAll("[data-report-type]").forEach((button) => button.addEventListener("click", () => {
    state.reportType = button.dataset.reportType;
    const range = reportRangeForType(state.reportType, state.reportDate || state.data.today);
    $("#report-auto-period").textContent = `${formatDate(range.from)} ~ ${formatDate(range.to)}`;
    content.querySelectorAll("[data-report-type]").forEach((item) => item.classList.toggle("active", item.dataset.reportType === state.reportType));
  }));
  $("#report-date")?.addEventListener("change", (event) => {
    state.reportDate = event.target.value || state.data.today;
    const range = reportRangeForType(state.reportType, state.reportDate);
    $("#report-auto-period").textContent = `${formatDate(range.from)} ~ ${formatDate(range.to)}`;
  });
  content.querySelector('[data-action="generate-report"]')?.addEventListener("click", generateSelectedReport);
  content.querySelector('[data-action="close-report"]')?.addEventListener("click", () => openReportCloseModal(activeSnapshot || null, activeReportType));
  content.querySelector('[data-action="copy-report"]').addEventListener("click", copyReportSummary);
  content.querySelector('[data-action="print-report"]').addEventListener("click", () => window.print());
  content.querySelectorAll("[data-open-snapshot]").forEach((button) => button.addEventListener("click", () => openSavedReport(snapshots.find((row) => row.id === button.dataset.openSnapshot))));
  content.querySelector("[data-live-report]")?.addEventListener("click", () => { state.activeReportSnapshot = null; renderReports(); });
  content.querySelectorAll("[data-edit-report]").forEach((button) => button.addEventListener("click", () => openReportCloseModal(snapshots.find((row) => row.id === button.dataset.editReport))));
  content.querySelectorAll("[data-delete-report]").forEach((button) => button.addEventListener("click", () => deleteReport(button.dataset.deleteReport)));
}

function reportTypeDescription(type) {
  return ({ daily: "당일 담당자 활동과 후속조치", week: "주간 활동·전환·미완료", month: "월 누계·부서·목표 마감", performance_1: "초기 파이프라인·소스 확보", performance_2: "중간 전환·부진 원인 점검", performance_3: "마감 전망·목표·백업 실행" })[type] || "";
}

function executiveStatusLabel(value) {
  return ({ action_required: "조치 필요", monitor: "집중 점검", on_track: "정상 진행" })[value] || "현황 점검";
}

function reportMeetingFocus(type, executive, totals) {
  const source = [...(executive.sourceFunnel || [])].sort((a, b) => b.periodActivities - a.periodActivities)[0];
  const focus = {
    daily: ["오늘의 실행과 내일의 조치", `담당자 입력 ${Number(totals.entryCount || 0)}개를 기준으로 미완료 후속조치와 다음 활동일을 확인합니다.`],
    week: ["이번 주 실행량과 미완료 관리", `주간 활동 ${Number(totals.totalCount || 0)}건, 면접 수립 ${Number(totals.interviews || 0)}건을 기준으로 다음 주 우선순위를 정합니다.`],
    month: ["월 누계 성과와 목표 마감", `실제 입사 ${Number(executive.pipeline?.hired || 0)}명과 조치 필요 부서 ${Number(executive.departmentSummary?.actionRequired || 0)}개를 중심으로 마감 판단을 내립니다.`],
    performance_1: ["1차 회의 · 채용소스와 후보군 확보", `${source ? `${source.source} 활동 ${source.periodActivities}건이 가장 많습니다. ` : ""}각 우선 포지션에 충분한 후보가 들어오고 있는지 먼저 점검합니다.`],
    performance_2: ["2차 회의 · 검토→면접 전환과 부진 원인", `현재 후보자 면접 경험률 ${Number(executive.pipeline?.interviewRate || 0)}%와 부서별 면접 단계 보유 여부를 기준으로 병목을 확인합니다.`],
    performance_3: ["3차 회의 · 목표 달성 전망과 백업플랜 실행", `조치 필요 ${Number(executive.departmentSummary?.actionRequired || 0)}개 부서와 후보군 확보 필요 ${Number(executive.departmentSummary?.pipelineNeeded || 0)}개 부서의 목표일·백업플랜을 확정합니다.`]
  }[type] || ["HR 채용 성과 점검", "기간 실적과 현재 후보 파이프라인을 함께 점검합니다."];
  return `<section class="report-meeting-focus"><b>${escapeHtml(focus[0])}</b><span>${escapeHtml(focus[1])}</span></section>`;
}

function reportScorecard(label, value, unit, delta, detail) {
  const deltaNumber = delta == null ? null : Number(delta);
  const deltaLabel = deltaNumber == null ? "" : deltaNumber === 0 ? "변동 없음" : `${deltaNumber > 0 ? "+" : ""}${deltaNumber} ${unit}`;
  return `<article><span>${escapeHtml(label)}</span><strong>${Number(value || 0)}<small>${escapeHtml(unit)}</small></strong><footer>${deltaLabel ? `<b class="${deltaNumber < 0 ? "down" : deltaNumber > 0 ? "up" : "flat"}">${escapeHtml(deltaLabel)}</b>` : ""}<em>${escapeHtml(detail || "")}</em></footer></article>`;
}

function renderDailyReportDetail(report) {
  const rows = report.activityDetails || state.data.recruitingActivities || [];
  return `
    <section class="report-section"><div class="report-section-title"><small>DAILY ACTIVITY DETAIL</small><h2>담당자별 일일 HR 활동과 다음 조치</h2><p>누가 어떤 경로로 누구에게 무엇을 했고, 다음 활동과 목표일이 언제인지 확인합니다.</p></div><div class="table-wrap"><table class="report-detail-table"><thead><tr><th>일자</th><th>담당자</th><th>부서·포지션</th><th>유입·활동</th><th>인원</th><th>후보·활동 결과</th><th>다음 활동·예정일·목표일</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escapeHtml(formatDate(row.activityDate))}</td><td><strong>${escapeHtml(row.ownerName)}</strong></td><td><strong>${escapeHtml(row.position)}</strong><small>${escapeHtml(row.department)}</small></td><td><span class="activity-tag ${escapeHtml(row.activityType)}">${escapeHtml(activityLabels[row.activityType] || row.activityType)}</span><small>${escapeHtml(sourceLabels[row.source] || row.source)}</small></td><td>${Number(row.count)}건</td><td>${row.candidateName ? `<strong>${escapeHtml(row.candidateName)}</strong>` : ""}<small>${escapeHtml(row.details || "내용 미입력")}</small></td><td><strong>${escapeHtml(row.nextActivity || (row.nextActionAt ? "후속 활동 예정" : "미입력"))}</strong><small>${row.nextActionAt ? `예정 ${escapeHtml(formatDateTime(row.nextActionAt))}` : "예정일 미정"}${row.targetDate ? ` · 목표 ${escapeHtml(formatDate(row.targetDate))}` : ""}</small></td></tr>`).join("") || emptyRow(7, "선택한 날짜에 입력된 활동이 없습니다.")}</tbody></table></div></section>
    <section class="report-grid"><article class="panel panel-pad"><div class="panel-heading"><div><small>OWNER</small><h2>담당자별 활동량</h2></div></div>${metricTable(report.byOwner)}</article><article class="panel panel-pad"><div class="panel-heading"><div><small>ACTIVITY MIX</small><h2>활동 구성</h2></div></div>${mixList(report.typeMix, activityLabels, "type")}</article></section>`;
}

function renderPerformanceReportDetail(report, executive, departments) {
  return `
    <section class="report-section"><div class="report-section-title"><small>RECRUITING FUNNEL</small><h2>채용 유입경로별 후보·면접·입사 전환</h2><p>기간 활동량과 현재 지원 포지션별 누적 이력을 함께 보되 서로 다른 기준임을 구분합니다.</p></div><div class="table-wrap"><table class="report-funnel-table"><thead><tr><th>유입 경로</th><th>기간 활동</th><th>지원후보 기록</th><th>검토</th><th>연락</th><th>면접 경험</th><th>처우·제안</th><th>입사</th><th>면접 전환</th><th>채용 전환</th></tr></thead><tbody>${(executive.sourceFunnel || []).map((row) => `<tr><td><strong>${escapeHtml(row.source)}</strong></td><td>${Number(row.periodActivities)}건</td><td>${Number(row.candidates)}건</td><td>${Number(row.reviewed)}건</td><td>${Number(row.contacted)}건</td><td>${Number(row.interviews)}건</td><td>${Number(row.offers)}건</td><td>${Number(row.hired)}건</td><td><b>${Number(row.interviewRate)}%</b></td><td><b>${Number(row.hireRate)}%</b></td></tr>`).join("") || emptyRow(10, "유입경로 데이터가 없습니다.")}</tbody></table></div></section>
    <section class="report-section"><div class="report-section-title"><small>DEPARTMENT DIAGNOSIS</small><h2>부서별 진행 판정과 백업플랜</h2><p>활동량뿐 아니라 목표 진척, 면접 이상 후보, 일정 지연과 등록 백업플랜을 함께 판단합니다.</p></div><div class="department-report-grid">${departments.map(departmentReportCard).join("") || `<div class="empty">부서 데이터가 없습니다.</div>`}</div></section>
    <section class="report-section"><div class="report-section-title"><small>RECRUITING FAILURE ANALYSIS</small><h2>채용 중단·불합격 사유 분석</h2><p>면접 결과에 입력한 표준 사유와 기존 종료 결과를 직무·소스 개선에 활용합니다.</p></div><div class="rejection-reason-grid">${(executive.rejectionReasons || []).map((row) => `<article><span>${escapeHtml(row.reason)}</span><strong>${Number(row.count)}<small>건</small></strong></article>`).join("") || `<div class="empty">등록된 불합격 사유가 없습니다. 면접 일정에서 결과와 사유를 입력해 주세요.</div>`}</div></section>
    <section class="report-section"><div class="report-section-title"><small>ACTION ITEMS</small><h2>회의 결정·후속조치</h2><p>조치가 필요한 부서부터 실행 항목을 정리합니다.</p></div><div class="report-action-list">${(executive.actions || []).map((row, index) => `<article><b>${index + 1}</b><div><strong>${escapeHtml(row.department)} · ${escapeHtml(departmentStatusLabels[row.status] || row.status)}</strong><p>${escapeHtml(row.action)}</p>${row.ownerAction ? `<small>우선 확인: ${escapeHtml(row.ownerAction)}</small>` : ""}</div></article>`).join("") || `<article class="clear"><b>✓</b><div><strong>즉시 조치 항목 없음</strong><p>예정된 중간점검일에 진행률과 다음 활동을 확인하세요.</p></div></article>`}</div></section>
    <section class="report-grid"><article class="panel panel-pad"><div class="panel-heading"><div><small>DEPARTMENT ACTIVITY</small><h2>부서별 기간 활동</h2></div></div>${metricTable(report.byDepartment)}</article><article class="panel panel-pad"><div class="panel-heading"><div><small>POSITION ACTIVITY</small><h2>채용 직무별 기간 활동</h2></div></div>${metricTable(report.byPosition)}</article></section>
    <section class="panel table-panel"><div class="section-heading"><div><small>RISK & CHECKPOINT</small><h2>목표 위험·중간점검 상세</h2></div></div><div class="table-wrap"><table><thead><tr><th>우선</th><th>부서·포지션</th><th>담당</th><th>진행률</th><th>점검일</th><th>목표일</th><th>상태</th><th>백업플랜</th></tr></thead><tbody>${report.atRiskGoals.map((goal) => `<tr><td>${escapeHtml(goal.priority)}</td><td><strong>${escapeHtml(goal.functionName || goal.title)}</strong><small class="sub">${escapeHtml(goal.division || "")}</small></td><td>${escapeHtml(goal.ownerPrimary)}</td><td>${goal.progress}%</td><td>${escapeHtml(formatDate(goal.checkpointDate))}</td><td>${escapeHtml(formatDate(goal.targetDate))}</td><td><span class="risk ${escapeHtml(goal.riskStatus)}">${escapeHtml(riskLabels[goal.riskStatus])}</span></td><td>${escapeHtml(goal.backupPlan || "미등록")}</td></tr>`).join("") || emptyRow(8, "현재 위험 목표가 없습니다.")}</tbody></table></div></section>`;
}

function departmentReportCard(row) {
  return `<article class="department-report-card ${escapeHtml(row.status)}"><header><div><small>${escapeHtml(row.department)}</small><h3>${escapeHtml((row.positions || []).join(" · ") || "연결 포지션 없음")}</h3></div><span>${escapeHtml(departmentStatusLabels[row.status] || row.status)}</span></header><div class="department-report-metrics"><span><b>${Number(row.weightedProgress)}%</b>목표 진행</span><span><b>${Number(row.activeCandidates)}</b>진행 후보</span><span><b>${Number(row.interviews)}</b>면접 단계</span><span><b>${Number(row.offers)}</b>처우·제안</span><span><b>${Number(row.overdueCandidates)}</b>일정 지연</span></div><p>${escapeHtml(row.recommendation)}</p>${row.backupPlan ? `<footer><b>등록 백업플랜</b><span>${escapeHtml(row.backupPlan)}</span></footer>` : ""}</article>`;
}

async function generateSelectedReport() {
  const date = $("#report-date")?.value || state.data.today;
  const range = reportRangeForType(state.reportType, date);
  state.reportDate = date;
  state.activeReportSnapshot = null;
  state.from = range.from;
  state.to = range.to;
  $("#period-from").value = state.from;
  $("#period-to").value = state.to;
  await loadData();
  showToast(`${reportTypeLabels[state.reportType]}를 생성했습니다.`);
}

function reportRangeForType(type, date) {
  const day = date || state.data?.today || localYmd(new Date());
  if (type === "daily") return { from: day, to: day };
  if (type === "week") return { from: startOfWeek(day), to: day };
  return { from: `${day.slice(0, 7)}-01`, to: day };
}

function openSavedReport(snapshot) {
  if (!snapshot) return;
  state.reportType = snapshot.periodType;
  state.reportDate = snapshot.periodEnd;
  state.from = snapshot.periodStart;
  state.to = snapshot.periodEnd;
  state.activeReportSnapshot = snapshot;
  $("#period-from").value = state.from;
  $("#period-to").value = state.to;
  $("#sidebar-period").textContent = `${formatDate(state.from)} ~ ${formatDate(state.to)}`;
  renderReports();
  content.querySelector("#generated-report")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function metricTable(rows) {
  return `<div class="mini-table">${rows.slice(0, 8).map((row) => `<div><strong>${escapeHtml(row.label)}</strong><span>활동 ${row.totalCount}</span><span>DM ${row.dmSent}</span><span>수락 ${row.dmAccepted}</span><span>면접 ${row.interviews}</span></div>`).join("") || `<div class="empty">데이터가 없습니다.</div>`}</div>`;
}

function mixList(rows, labels, key = "source") {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return `<div class="mix-list">${rows.slice(0, 8).map((row) => `<div><span>${escapeHtml(labels[row[key]] || row[key])}</span><progress max="${max}" value="${Number(row.count)}"></progress><strong>${Number(row.count)}</strong></div>`).join("") || `<div class="empty">데이터가 없습니다.</div>`}</div>`;
}

function renderUsers() {
  const users = state.data.users || [];
  const active = users.filter((user) => user.active);
  content.innerHTML = `
    ${heading("ADMIN ONLY", "사용자 및 담당 권한", "담당자 계정을 부서와 연결하고 입력·조회 권한을 관리합니다.", `<button class="button primary" data-action="new-user">＋ 사용자 추가</button>`)}
    <section class="summary">${summary("전체 사용자", `${users.length}명`)}${summary("활성 사용자", `${active.length}명`)}${summary("채용 담당자", `${active.filter((user) => user.role === "recruiter").length}명`)}${summary("조회 전용", `${active.filter((user) => user.role === "viewer").length}명`)}</section>
    <section class="permission-guide"><strong>권한</strong><span><b>admin</b> 사용자·목표·전체 활동</span><span><b>recruiter</b> 본인 활동 입력·목표 점검</span><span><b>viewer</b> 로그인 상세 조회</span></section>
    <section class="panel table-panel"><div class="table-wrap"><table><thead><tr><th>사용자</th><th>아이디·이메일</th><th>부서</th><th>권한</th><th>상태</th><th>최근 수정</th><th></th></tr></thead><tbody>${users.map((user) => `<tr><td><div class="user-id"><span>${escapeHtml(initials(user.displayName))}</span><div><strong>${escapeHtml(user.displayName)}</strong>${user.username === state.actor.username ? "<small>현재 계정</small>" : ""}</div></div></td><td><strong>${escapeHtml(user.username)}</strong><small class="sub">${escapeHtml(user.email || "이메일 미등록")}</small></td><td>${escapeHtml(user.department || "미지정")}</td><td><span class="role ${escapeHtml(user.role)}">${escapeHtml(user.role)}</span></td><td><span class="state ${user.active ? "active" : "inactive"}">${user.active ? "활성" : "비활성"}</span></td><td>${escapeHtml(formatDateTime(user.updatedAt))}</td><td><div class="row-actions"><button data-user="${escapeHtml(user.username)}">수정</button>${user.username !== state.actor.username ? `<button class="danger" data-delete-user="${escapeHtml(user.username)}">삭제</button>` : ""}</div></td></tr>`).join("")}</tbody></table></div></section>`;
  content.querySelector('[data-action="new-user"]').addEventListener("click", () => openUserModal());
  content.querySelectorAll("[data-user]").forEach((button) => button.addEventListener("click", () => openUserModal(users.find((user) => user.username === button.dataset.user))));
  content.querySelectorAll("[data-delete-user]").forEach((button) => button.addEventListener("click", () => deleteUser(users.find((user) => user.username === button.dataset.deleteUser))));
}

function openActivityModal(row = null, preset = {}) {
  const editing = Boolean(row);
  const goalOptions = `<option value="">목표 미연결</option>${state.data.goals.map((goal) => option(goal.id, `${goal.priority} · ${goal.functionName} · ${goal.level}`, (row?.requisitionId || preset.requisitionId) === goal.id)).join("")}`;
  const activityType = row?.activityType || preset.activityType || "resume_reviewed";
  const source = row?.source || preset.source || "saramin";
  const calendarMode = Boolean(preset.calendar) || ["interview_scheduled", "reinterview_scheduled"].includes(activityType);
  const candidateOptions = `<option value="">후보자 직접 입력·미연결</option>${(state.data.candidatePipeline || []).filter((item) => !item.archivedAt || item.applicationId === row?.applicationId).map((item) => option(item.applicationId, `${item.candidateName} · ${item.position} · ${stageLabels[item.stage] || item.stage}`, (row?.applicationId || preset.applicationId) === item.applicationId)).join("")}`;
  openModal(editing ? (calendarMode ? "INTERVIEW EDIT" : "활동 수정") : (calendarMode ? "INTERVIEW CALENDAR" : "DAILY INPUT"), editing ? (calendarMode ? "면접 일정 수정" : "채용활동 수정") : (calendarMode ? "면접 일정 등록" : "오늘의 채용활동 입력"), `
    ${field("activityDate", "활동일 *", "date", row?.activityDate || preset.activityDate || state.data.today, true)}
    <label><span>연결 채용목표</span><select name="requisitionId" id="activity-goal">${goalOptions}</select></label>
    ${calendarMode ? `<label class="full"><span>연결 후보자·지원 포지션</span><select name="applicationId" id="activity-application">${candidateOptions}</select></label>` : ""}
    ${field("department", "부서 *", "text", row?.department || preset.department || state.actor?.department || "", true)}
    ${field("position", "포지션 *", "text", row?.position || preset.position || "", true)}
    <label><span>활동 구분 *</span><select name="activityType">${Object.entries(activityLabels).map(([value, label]) => option(value, label, value === activityType)).join("")}</select></label>
    <label><span>채용 소스 *</span><select name="source">${Object.entries(sourceLabels).map(([value, label]) => option(value, label, value === source)).join("")}</select></label>
    ${field("count", "활동 건수 *", "number", row?.count ?? 1, true)}
    ${field("acceptedCount", "함께 집계할 수락 건수", "number", row?.acceptedCount ?? 0)}
    ${field("candidateName", "후보자명 (선택)", "text", row?.candidateName || preset.candidateName || "")}
    ${field("nextActionAt", calendarMode ? "면접 일시 *" : "다음 조치일시", "datetime-local", toLocalInput(row?.nextActionAt || preset.nextActionAt), calendarMode)}
    ${calendarMode ? `${field("interviewRound", "면접 차수", "number", row?.interviewRound || 1)}${field("interviewDuration", "예정 시간(분)", "number", row?.interviewDuration || 60)}${field("interviewLocation", "면접 장소·회의실 *", "text", row?.interviewLocation || "", true)}${field("interviewerNames", "면접관 (쉼표 구분) *", "text", row?.interviewerNames || "", true)}<label><span>면접 상태</span><select name="interviewStatus">${Object.entries(interviewStatusLabels).map(([value, label]) => option(value, label, value === (row?.interviewStatus || "scheduled"))).join("")}</select></label><label><span>면접 결과</span><select name="interviewResult">${Object.entries(interviewResultLabels).map(([value, label]) => option(value, label, value === (row?.interviewResult || "pending"))).join("")}</select></label><label><span>불합격·중단 사유</span><select name="rejectionReason">${rejectionReasons.map((value) => option(value, value || "해당 없음", value === (row?.rejectionReason || ""))).join("")}</select></label><label class="full"><span>면접 결과·평가</span><textarea name="resultNotes" placeholder="평가 요약, 합격·보류 판단, 다음 면접 또는 처우 협의사항">${escapeHtml(row?.resultNotes || "")}</textarea></label>` : ""}
    ${state.actor?.role === "admin" ? field("ownerName", "담당자명", "text", row?.ownerName || preset.ownerName || state.actor.name) : ""}
    <label class="full"><span>${calendarMode ? "면접 준비·기타 메모" : "활동 결과·메모"}</span><textarea name="details" placeholder="${calendarMode ? "준비자료, 안내사항, 화상링크 등" : "검토 결과, 수락자 연락 결과, 면접 수립 내용 등을 간단히 기록"}">${escapeHtml(row?.details || preset.details || "")}</textarea></label>`,
    (body) => api(editing ? `/api/recruiting-activities/${encodeURIComponent(row.id)}` : "/api/recruiting-activities", { method: editing ? "PATCH" : "POST", body }));
  $("#activity-goal").addEventListener("change", (event) => {
    const goal = state.data.goals.find((item) => item.id === event.target.value);
    if (!goal) return;
    $("#modal-form [name='department']").value = goal.division || "";
    $("#modal-form [name='position']").value = goal.functionName || "";
  });
  $("#activity-application")?.addEventListener("change", (event) => {
    const candidate = (state.data.candidatePipeline || []).find((item) => item.applicationId === event.target.value);
    if (!candidate) return;
    $("#modal-form [name='candidateName']").value = candidate.candidateName || "";
    $("#modal-form [name='department']").value = candidate.division || "";
    $("#modal-form [name='position']").value = candidate.position || "";
    $("#modal-form [name='requisitionId']").value = candidate.requisitionId || "";
  });
}

function openGoalModal(goal = null) {
  const editing = Boolean(goal);
  openModal(editing ? "목표 수정" : "NEW GOAL", editing ? `${goal.functionName} 채용목표 수정` : "채용목표 등록", `
    <label><span>우선순위 *</span><select name="priority">${["1순위", "2순위", "3순위"].map((value) => option(value, value, value === (goal?.priority || "2순위"))).join("")}</select></label>
    <label><span>목표 상태</span><select name="goalStatus">${[["active", "진행"], ["on_hold", "보류"], ["completed", "완료"], ["closed", "종료"]].map(([value, label]) => option(value, label, value === (goal?.goalStatus || "active"))).join("")}</select></label>
    ${field("division", "부서 *", "text", goal?.division || "", true)}
    ${field("functionName", "직무·포지션 *", "text", goal?.functionName || "", true)}
    ${field("title", "채용목표명 *", "text", goal?.title || "", true)}
    ${field("level", "직급·직책", "text", goal?.level || "")}
    ${field("targetHeadcount", "목표인원 *", "number", goal?.targetHeadcount || 1, true)}
    ${field("dailyDmTarget", "일일 DM 목표", "number", goal?.dailyDmTarget || 20)}
    ${field("checkpointDate", "중간점검일", "date", goal?.checkpointDate || "")}
    ${field("originalTargetDate", "원목표일", "date", goal?.originalTargetDate || goal?.targetDate || "")}
    ${field("revisedTargetDate", "수정목표일", "date", goal?.revisedTargetDate || "")}
    ${field("ownerPrimary", "정 담당자", "text", goal?.ownerPrimary || state.actor?.name || "")}
    ${field("ownerSecondary", "부 담당자", "text", goal?.ownerSecondary || "")}
    ${field("reviewers", "검토자 (쉼표 구분)", "text", reviewersText(goal))}
    <label class="full"><span>현재 백업플랜</span><textarea name="backupPlan" placeholder="중간점검 결과에 따라 가동할 대체 소스·인재풀·일정">${escapeHtml(goal?.backupPlan || "")}</textarea></label>`,
    (body) => api(editing ? `/api/goals/${encodeURIComponent(goal.id)}` : "/api/requisitions", { method: editing ? "PATCH" : "POST", body }));
}

function openCheckpointChooser() {
  const goalOptions = state.data.goals.filter((goal) => !["completed", "closed"].includes(goal.goalStatus)).map((goal) => option(goal.id, `${goal.priority} · ${goal.functionName} · ${goal.level}`)).join("");
  openModal("CHECKPOINT", "중간점검할 채용목표 선택", `<label class="full"><span>채용목표 *</span><select name="goalId" required><option value="">선택</option>${goalOptions}</select></label>`, (body) => {
    const goal = state.data.goals.find((item) => item.id === body.goalId);
    closeModal();
    if (goal) openCheckpointModal(goal);
  }, "다음");
}

function openJobPostingModal(row = null) {
  const editing = Boolean(row);
  const goalOptions = `<option value="">채용목표 미연결</option>${state.data.goals.map((goal) => option(goal.id, `${goal.priority} · ${goal.functionName} · ${goal.level || goal.title}`, row?.requisitionId === goal.id)).join("")}`;
  openModal(editing ? "SARAMIN POST EDIT" : "SARAMIN POST", editing ? "사람인 채용공고 수정" : "사람인 채용공고 등록", `
    ${field("title", "공고 제목 *", "text", row?.title || "", true)}
    <label><span>공고 상태 *</span><select name="status">${[["active", "진행 중"], ["draft", "임시 저장"], ["closed", "마감"]].map(([value, label]) => option(value, label, value === (row?.status || "active"))).join("")}</select></label>
    <label class="full"><span>사람인 공고 URL *</span><input name="url" type="url" value="${escapeHtml(row?.url || "")}" required placeholder="https://www.saramin.co.kr/... "></label>
    ${field("saraminId", "사람인 공고번호", "text", row?.saraminId || "")}
    <label><span>연결 채용목표</span><select name="requisitionId">${goalOptions}</select></label>
    ${field("department", "부서·직무분야", "text", row?.department || "")}
    ${field("location", "근무지역", "text", row?.location || "")}
    ${field("experience", "경력 조건", "text", row?.experience || "")}
    ${field("jobType", "고용 형태", "text", row?.jobType || "")}
    ${field("education", "학력 조건", "text", row?.education || "")}
    ${field("openingDate", "공고 시작일", "date", row?.openingDate || state.data.today)}
    ${field("expirationDate", "공고 마감일", "date", row?.expirationDate || "")}
    <label><span>마감 방식</span><select name="closeType">${["접수마감일", "채용시", "상시", "수시"].map((value) => option(value, value, value === (row?.closeType || "접수마감일"))).join("")}</select></label>
    ${field("viewCount", "사람인 조회수", "number", row?.viewCount ?? 0)}
    ${field("applyCount", "사람인 지원자수", "number", row?.applyCount ?? 0)}
    <div class="field-note full">API 키 연결 전에는 관리자가 숫자를 직접 갱신할 수 있습니다. 키 연결 후에는 사람인에서 제공하는 값으로 자동 업데이트됩니다.</div>`,
    (body) => api(editing ? `/api/job-postings/${encodeURIComponent(row.id)}` : "/api/job-postings", { method: editing ? "PATCH" : "POST", body }));
}

function openCheckpointModal(goal, checkpoint = null) {
  const editing = Boolean(checkpoint);
  openModal(editing ? "CHECKPOINT EDIT" : "CHECKPOINT", `${goal.functionName} 중간점검 ${editing ? "수정" : ""}`, `
    <div class="checkpoint-context full"><span>${escapeHtml(goal.priority)} · ${escapeHtml(goal.level)}</span><strong>현재 자동 진행률 ${Number(goal.progress)}%</strong><small>원목표 ${escapeHtml(formatDate(goal.originalTargetDate))} · 현재목표 ${escapeHtml(formatDate(goal.targetDate))}</small></div>
    ${field("checkpointDate", "점검일 *", "date", checkpoint?.checkpointDate || state.data.today, true)}
    ${field("progressPercent", "점검 진행률 (%)", "number", checkpoint?.progressPercent ?? goal.progress)}
    ${field("newTargetDate", "수정목표일 (필요 시)", "date", checkpoint?.revisedTargetDate || goal.revisedTargetDate || "")}
    <label class="full"><span>점검 내용 *</span><textarea name="summary" required placeholder="진행 현황, 병목, 담당자 조치사항">${escapeHtml(checkpoint?.summary || "")}</textarea></label>
    <label class="full"><span>위험·이슈</span><textarea name="risks" placeholder="후보 부족, 전환 저조, 일정 지연 등">${escapeHtml(checkpoint?.risks || "")}</textarea></label>
    <label class="full"><span>백업플랜</span><textarea name="backupPlan" placeholder="과거 후보 재접촉, 소스 확대, 우선순위 변경 등">${escapeHtml(checkpoint?.backupPlan ?? goal.backupPlan ?? "")}</textarea></label>`,
    (body) => api(editing ? `/api/checkpoints/${encodeURIComponent(checkpoint.id)}` : `/api/goals/${encodeURIComponent(goal.id)}/checkpoints`, { method: editing ? "PATCH" : "POST", body }));
}

function openReportCloseModal(snapshot = null, presetType = null) {
  const editing = Boolean(snapshot);
  const days = dayDiff(state.from, state.to) + 1;
  const defaultType = snapshot?.periodType || presetType || (days === 1 ? "daily" : days <= 8 ? "week" : "month");
  const from = snapshot?.periodStart || state.from;
  const to = snapshot?.periodEnd || state.to;
  openModal(editing ? "REPORT EDIT" : "REPORT SAVE", editing ? "저장 보고 수정" : "현재 HR 보고 저장", `
    <label><span>보고 유형 *</span><select name="periodType">${Object.entries(reportTypeLabels).map(([value, label]) => option(value, label, defaultType === value)).join("")}</select></label>
    <div class="checkpoint-context"><span>보고 기간</span><strong>${escapeHtml(formatDate(from))} ~ ${escapeHtml(formatDate(to))}</strong><small>${escapeHtml(snapshot?.summary?.executive?.bullets?.[0] || snapshot?.summary?.narrative || state.data.report.executive?.bullets?.[0] || state.data.report.narrative)}</small></div>
    <label class="full"><span>회의 결정·강조사항</span><textarea name="note" placeholder="경영회의 결정사항, 부서별 조치, 백업플랜 실행 내용">${escapeHtml(snapshot?.note || "")}</textarea></label>`,
    (body) => api("/api/reports/close", { method: "POST", body: { ...body, from, to, previousReportId: snapshot?.id || "" } }));
}

function openUserModal(user = null) {
  const editing = Boolean(user);
  openModal("ADMIN ONLY", editing ? "사용자 권한 수정" : "새 사용자 추가", `
    ${field("displayName", "사용자 이름 *", "text", user?.displayName || "", true)}
    ${field("username", "로그인 아이디 *", "text", user?.username || "", true, editing)}
    ${field("email", "이메일", "email", user?.email || "")}
    ${field("department", "소속 부서", "text", user?.department || "")}
    <label><span>권한 *</span><select name="role">${[["admin", "admin · 시스템 관리자"], ["recruiter", "recruiter · 채용활동 담당자"], ["viewer", "viewer · 상세 조회자"]].map(([value, label]) => option(value, label, value === (user?.role || "recruiter"))).join("")}</select></label>
    ${editing ? `<label><span>계정 상태</span><select name="active">${option("true", "활성", user.active)}${option("false", "비활성", !user.active)}</select></label>${field("password", "새 비밀번호", "password", "")}<label class="full"><span>안내</span><div class="field-note">비밀번호를 비워두면 기존 비밀번호가 유지됩니다.</div></label>` : `${field("password", "초기 비밀번호 *", "password", "", true)}<label class="full"><span>안내</span><div class="field-note">영문·숫자를 포함한 10자 이상 비밀번호를 입력하세요.</div></label>`}`,
    (body) => api(editing ? `/api/users/${encodeURIComponent(user.username)}` : "/api/users", { method: editing ? "PATCH" : "POST", body: editing ? { ...body, active: body.active === "true" } : body }));
}

function openWorkforceModal(row = null) {
  const editing = Boolean(row);
  openModal(editing ? "WORKFORCE EDIT" : "WORKFORCE & TO", editing ? `${row.department} ${row.position} 인원·TO 수정` : "전사 인원·TO 입력", `
    ${field("department", "부서 *", "text", row?.department || "", true)}
    ${field("position", "직무·포지션 *", "text", row?.position || "", true)}
    ${field("approvedHeadcount", "정원", "number", row?.approvedHeadcount ?? 0)}
    ${field("currentHeadcount", "현재 인원", "number", row?.currentHeadcount ?? 0)}
    ${field("recruitingTo", "채용 TO", "number", row?.recruitingTo ?? 0)}
    ${field("joiningPlanned", "입사 예정", "number", row?.joiningPlanned ?? 0)}
    ${field("leavingPlanned", "퇴사 예정", "number", row?.leavingPlanned ?? 0)}
    ${field("asOfDate", "기준일 *", "date", row?.asOfDate || state.data.today, true)}
    <label class="full"><span>메모</span><textarea name="note" placeholder="채용 TO 근거, 입퇴사 예정일, 특이사항">${escapeHtml(row?.note || "")}</textarea></label>
    <div class="field-note full">예상현원과 충원 필요 인원은 입력값을 기준으로 자동 계산됩니다.</div>`,
    (body) => api(editing ? `/api/workforce-plans/${encodeURIComponent(row.id)}` : "/api/workforce-plans", { method: editing ? "PATCH" : "POST", body }));
}

function openMeetingModal(row = null) {
  const editing = Boolean(row);
  state.meetingActionDrafts = [];
  state.meetingActionDraftsGenerated = false;
  openModal(editing ? "HR MEETING EDIT" : "HR MEETING MINUTES", editing ? "HR 회의록 수정" : "HR 회의록 작성", `
    <section class="meeting-editor-block meeting-editor-meta full"><header><i>00</i><div><strong>회의 기본정보</strong><span>회의의 기준 정보를 먼저 입력하세요.</span></div></header><div class="meeting-editor-grid">
      ${field("meetingDate", "회의 일시 *", "datetime-local", toLocalInput(row?.meetingDate || `${state.data.today}T09:00`), true)}
      <label><span>회의 상태</span><select name="status">${Object.entries(meetingStatusLabels).map(([value, label]) => option(value, label, value === (row?.status || "scheduled"))).join("")}</select></label>
      ${field("title", "회의 제목 *", "text", row?.title || `${formatDate(state.data.today)} HR 회의`, true)}
      ${field("participants", "참석자", "text", row?.participants || "")}
    </div></section>
    <label class="meeting-editor-block meeting-editor-agenda full"><span><i>01</i><b>아젠다</b><small>이번 회의에서 확인하고 결정할 항목</small></span><textarea name="agenda" placeholder="예: 채용 진행현황, 지연 포지션, 후보자 이슈, 의사결정 필요사항">${escapeHtml(row?.agenda || "")}</textarea></label>
    <label class="meeting-editor-block meeting-editor-transcript full"><span><i>원문</i><b>녹취본·회의 메모 *</b><small>녹취 텍스트를 붙여넣거나 직접 작성</small></span><textarea name="transcript" placeholder="담당자와 기한을 문장에 포함하면 실행과제 추출 정확도가 높아집니다.">${escapeHtml(row?.transcript || row?.minutes || "")}</textarea></label>
    <div class="meeting-ai-toolbar full"><button type="button" class="button ai" data-analyze-meeting>✦ 회의록 자동 정리</button><span>결정사항·중요 이슈·담당자별 실행과제를 추출합니다. 저장 전 반드시 검토해 주세요.</span></div>
    <div class="meeting-analysis-status full" data-analysis-message hidden></div>
    <section class="meeting-analysis-workspace full">
      <label class="meeting-editor-block meeting-editor-summary"><span><i>05</i><b>회의 요약</b><small>대표 보고용 핵심 결론</small></span><textarea name="minutes" placeholder="회의의 핵심 결론을 3~5줄로 정리합니다.">${escapeHtml(row?.minutes || "")}</textarea></label>
      <div class="meeting-analysis-grid">
        <label class="meeting-editor-block meeting-editor-discussion"><span><i>02</i><b>핵심 논의사항</b><small>검토 내용과 논의 배경</small></span><textarea name="keyDiscussions" placeholder="보고할 핵심 이슈, 백업플랜 가동 여부, 후속 검토사항">${escapeHtml(row?.keyDiscussions || "")}</textarea></label>
        <label class="meeting-editor-block meeting-editor-decision"><span><i>03</i><b>결정사항</b><small>회의에서 최종 확정한 내용</small></span><textarea name="decisions" placeholder="확정된 방향, 승인사항, 시행 기준">${escapeHtml(row?.decisions || "")}</textarea></label>
        <label class="meeting-editor-block meeting-editor-issue"><span><i>04</i><b>중요 이슈·보류</b><small>미해결 위험과 추가 검토사항</small></span><textarea name="issues" placeholder="보류 사유, 위험요소, 추가 확인이 필요한 내용">${escapeHtml(row?.issues || "")}</textarea></label>
      </div>
    </section>
    <section class="meeting-action-drafts full" data-action-drafts hidden><header><div><strong>추출된 실행과제</strong><span>체크한 항목만 담당자 업무로 생성됩니다.</span></div></header><div data-action-draft-list></div></section>
    <label><span>자동정리 검토상태</span><select name="analysisStatus">${option("draft", "작성 중", (row?.analysisStatus || "draft") === "draft")}${option("reviewed", "검토 완료", row?.analysisStatus === "reviewed")}</select></label>
    <input type="hidden" name="analysisJson" value="${escapeHtml(JSON.stringify(row?.analysis || {}))}">
    <div class="field-note full">‘검토 완료’로 저장할 때 선택한 실행과제가 생성됩니다. 기존 실행과제는 중복 생성하지 않습니다.</div>`,
    async (body) => {
      body.analysisJson = JSON.stringify(state.meetingActionDraftsGenerated ? { actions: state.meetingActionDrafts } : (row?.analysis || {}));
      const result = await api(editing ? `/api/hr-meetings/${encodeURIComponent(row.id)}` : "/api/hr-meetings", { method: editing ? "PATCH" : "POST", body });
      const meetingId = result.id || row?.id;
      if (body.analysisStatus === "reviewed" && state.meetingActionDraftsGenerated && meetingId) {
        const selected = collectMeetingActionDrafts();
        for (const action of selected) {
          await api("/api/action-items", { method: "POST", body: { ...action, meetingId, status: "open", notificationScope: action.assigneeUsername ? "personal" : "all" } });
        }
      }
      return result;
    }, "회의록 저장");
  document.querySelector(".modal")?.classList.add("meeting-editor-modal");
  document.querySelector("[data-analyze-meeting]")?.addEventListener("click", analyzeMeetingDraft);
}

async function analyzeMeetingDraft() {
  const form = $("#modal-form");
  const transcript = form.elements.transcript.value.trim();
  const message = form.querySelector("[data-analysis-message]");
  if (transcript.length < 10) return showGlobalError("분석할 녹취 내용 또는 회의 메모를 10자 이상 입력하세요.");
  setBusy(true);
  try {
    const result = await api("/api/hr-meetings/analyze", { method: "POST", body: {
      transcript,
      meetingDate: form.elements.meetingDate.value,
      title: form.elements.title.value,
      agenda: form.elements.agenda.value,
      participants: form.elements.participants.value
    } });
    const analysis = result.analysis;
    form.elements.minutes.value = analysis.summary || "";
    form.elements.keyDiscussions.value = analysis.keyDiscussions || "";
    form.elements.decisions.value = analysis.decisions || "";
    form.elements.issues.value = analysis.issues || "";
    form.elements.analysisStatus.value = "draft";
    state.meetingActionDrafts = analysis.actions || [];
    state.meetingActionDraftsGenerated = true;
    renderMeetingActionDrafts();
    message.hidden = false;
    message.textContent = `전체 맥락 정리가 완료되었습니다. 중복 발언을 제거한 요약과 실행과제 ${state.meetingActionDrafts.length}건을 확인한 후 검토 완료로 저장하세요.`;
  } catch (error) {
    showGlobalError(error.message);
  } finally {
    setBusy(false);
  }
}

function renderMeetingActionDrafts() {
  const section = document.querySelector("[data-action-drafts]");
  const list = document.querySelector("[data-action-draft-list]");
  if (!section || !list) return;
  section.hidden = false;
  list.innerHTML = state.meetingActionDrafts.map((action, index) => `<article class="meeting-action-draft" data-action-draft="${index}"><input type="checkbox" checked aria-label="실행과제 선택"><div><input type="text" data-draft-title value="${escapeHtml(action.title)}" aria-label="실행과제"><textarea data-draft-details aria-label="구체적 실행내용">${escapeHtml(action.details || "")}</textarea><div><select data-draft-assignee aria-label="담당자"><option value="">담당자 미지정</option>${(state.data.assignees || []).map((user) => option(user.username, `${user.displayName}${user.department ? ` · ${user.department}` : ""}`, user.username === action.assigneeUsername)).join("")}</select><input type="date" data-draft-due value="${escapeHtml(action.dueDate || state.data.today)}" aria-label="기한"><select data-draft-priority aria-label="우선순위">${Object.entries(actionPriorityLabels).map(([value, label]) => option(value, label, value === action.priority)).join("")}</select></div></div></article>`).join("") || `<div class="meeting-empty compact">추출된 실행과제가 없습니다. 회의록 저장 후 직접 추가할 수 있습니다.</div>`;
}

function collectMeetingActionDrafts() {
  return [...document.querySelectorAll("[data-action-draft]")].filter((item) => item.querySelector('input[type="checkbox"]').checked).map((item) => ({
    title: item.querySelector("[data-draft-title]").value.trim(),
    details: item.querySelector("[data-draft-details]").value.trim(),
    assigneeUsername: item.querySelector("[data-draft-assignee]").value,
    dueDate: item.querySelector("[data-draft-due]").value || state.data.today,
    priority: item.querySelector("[data-draft-priority]").value || "normal"
  })).filter((item) => item.title);
}

function printMeeting(row, actions = []) {
  if (!row) return;
  const related = actions.filter((item) => item.meetingId === row.id);
  const popup = window.open("", "_blank", "width=1000,height=850");
  if (!popup) return showGlobalError("인쇄 창을 열 수 없습니다. 팝업 차단을 해제해 주세요.");
  const reportSection = (number, title, value, tone = "") => `<section class="report-section ${tone}"><header><span>${number}</span><h2>${escapeHtml(title)}</h2></header><div class="section-body">${escapeHtml(value || "-").replaceAll("\n", "<br>")}</div></section>`;
  const actionRows = related.map((item) => `<tr><td>${escapeHtml(item.title)}</td><td>${escapeHtml(item.assigneeName)}</td><td>${escapeHtml(formatDate(item.dueDate))}</td><td>${escapeHtml(actionPriorityLabels[item.priority] || item.priority)}</td><td>${escapeHtml(actionStatusLabels[item.status] || item.status)}</td></tr>`).join("") || `<tr><td colspan="5">등록된 실행과제가 없습니다.</td></tr>`;
  popup.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(row.title)}</title><link rel="stylesheet" href="/hr-maps-operations-v9-20260910d.css"></head><body class="meeting-print-page"><div class="no-print"><button onclick="window.print()">인쇄 · PDF 저장</button></div><header class="document-header"><div class="print-brand"><small>MEDPARK HUMAN RESOURCES</small><strong>메드파크 인사·채용 운영</strong></div><span class="classification">사내 업무용</span></header><div class="title-block"><span>HR MEETING MINUTES</span><h1>${escapeHtml(row.title)}</h1></div><table class="meta"><tr><th>회의 일시</th><td>${escapeHtml(formatDateTime(row.meetingDate))}</td><th>상태</th><td>${escapeHtml(meetingStatusLabels[row.status] || row.status)}</td></tr><tr><th>참석자</th><td colspan="3">${escapeHtml(row.participants || "-")}</td></tr></table>${reportSection("01", "아젠다", row.agenda)}${reportSection("05", "회의 요약", row.minutes, "summary")}${reportSection("02", "핵심 논의사항", row.keyDiscussions)}${reportSection("03", "결정사항", row.decisions, "decision")}${reportSection("04", "중요 이슈·보류사항", row.issues, "issue")}<section class="action-section"><header><h2>담당자별 실행과제</h2><small>ACTION PLAN</small></header><table class="actions"><thead><tr><th>실행과제</th><th>담당자</th><th>기한</th><th>우선순위</th><th>상태</th></tr></thead><tbody>${actionRows}</tbody></table></section><div class="sign-line"><div><b>작성</b><span></span></div><div><b>검토</b><span></span></div><div><b>승인</b><span></span></div></div><footer class="document-footer"><span>작성 ${escapeHtml(row.createdByName)} · 최종 수정 ${escapeHtml(row.updatedByName)}</span><span>${escapeHtml(formatDateTime(row.updatedAt))}</span></footer></body></html>`);
  popup.document.close();
  popup.document.querySelector('link[rel="stylesheet"]')?.setAttribute("href", "/hr-maps-operations-v10-20260911a.css");
  return;
  popup.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(row.title)}</title><style>@page{size:A4 portrait;margin:13mm 14mm 15mm}*{box-sizing:border-box}html{background:#e8edf1}body{width:210mm;min-height:297mm;margin:18px auto;padding:14mm;font-family:"Malgun Gothic",Arial,sans-serif;color:#152a38;background:#fff;box-shadow:0 14px 45px #2137472b}.no-print{display:flex;justify-content:flex-end;margin:-4px 0 14px}.no-print button{padding:10px 18px;border:0;border-radius:7px;color:#fff;background:#0e6688;font-weight:700;cursor:pointer}.document-header{display:grid;grid-template-columns:1fr auto;align-items:start;padding-bottom:13px;border-bottom:3px solid #173f63}.brand small,.brand strong{display:block}.brand small{color:#1884a7;font-size:10px;font-weight:800;letter-spacing:.15em}.brand strong{margin-top:5px;font-size:14px}.classification{border:1px solid #b8c8d1;padding:5px 9px;color:#566c79;font-size:10px;font-weight:700}.title-block{padding:20px 0 14px;text-align:center}.title-block span{color:#177a9e;font-size:11px;font-weight:800;letter-spacing:.14em}.title-block h1{margin:7px 0 0;font-size:25px;letter-spacing:-.04em}.meta{width:100%;margin-bottom:14px;border-collapse:collapse;font-size:11px}.meta th,.meta td{border:1px solid #cbd7dd;padding:8px 10px;text-align:left}.meta th{width:14%;color:#334e5d;background:#edf3f6}.meta td{width:36%}.report-section{margin:0 0 10px;border:1px solid #ccd8de;break-inside:avoid}.report-section>header{display:flex;align-items:center;gap:9px;margin:0;padding:8px 11px;border-bottom:1px solid #d7e1e6;background:#edf3f6}.report-section>header span{display:grid;width:22px;height:22px;place-items:center;border-radius:5px;color:#fff;background:#476676;font-size:9px;font-weight:800}.report-section h2{margin:0;font-size:12px}.section-body{min-height:43px;padding:10px 12px;font-size:11px;line-height:1.72}.report-section.summary{border:2px solid #176f91}.report-section.summary>header{color:#fff;border:0;background:#176f91}.report-section.summary>header span{color:#176f91;background:#fff}.report-section.decision{border-color:#9fcdbd}.report-section.decision>header{background:#e9f5f0}.report-section.decision>header span{background:#238367}.report-section.issue{border-color:#e4c59e}.report-section.issue>header{background:#fff4e5}.report-section.issue>header span{background:#c97922}.action-section{margin-top:12px;break-inside:avoid}.action-section>header{display:flex;align-items:center;justify-content:space-between;margin-bottom:7px}.action-section h2{margin:0;font-size:13px}.action-section small{color:#6b7d87;font-size:9px}table.actions{width:100%;border-collapse:collapse;font-size:10px}table.actions th,table.actions td{border:1px solid #cbd7dd;padding:7px;text-align:left;vertical-align:top}table.actions th{color:#334e5d;background:#edf3f6}.document-footer{display:flex;justify-content:space-between;margin-top:17px;padding-top:8px;border-top:1px solid #bfcdd4;color:#657984;font-size:9px}.sign-line{display:grid;grid-template-columns:repeat(3,70px);margin:15px 0 0 auto;width:max-content}.sign-line div{border:1px solid #aebfc8;border-right:0;text-align:center}.sign-line div:last-child{border-right:1px solid #aebfc8}.sign-line b,.sign-line span{display:block}.sign-line b{padding:4px;background:#edf3f6;font-size:9px}.sign-line span{height:28px}@media print{html{background:#fff}body{width:auto;min-height:auto;margin:0;padding:0;box-shadow:none}.no-print{display:none}}</style></head><body><div class="no-print"><button onclick="window.print()">인쇄 · PDF 저장</button></div><header class="document-header"><div class="brand"><small>MEDPARK HUMAN RESOURCES</small><strong>메드파크 인사·채용 운영</strong></div><span class="classification">사내 업무용</span></header><div class="title-block"><span>HR MEETING MINUTES</span><h1>${escapeHtml(row.title)}</h1></div><table class="meta"><tr><th>회의 일시</th><td>${escapeHtml(formatDateTime(row.meetingDate))}</td><th>상태</th><td>${escapeHtml(meetingStatusLabels[row.status] || row.status)}</td></tr><tr><th>참석자</th><td colspan="3">${escapeHtml(row.participants || "-")}</td></tr></table>${reportSection("01", "아젠다", row.agenda)}${reportSection("05", "회의 요약", row.minutes, "summary")}${reportSection("02", "핵심 논의사항", row.keyDiscussions)}${reportSection("03", "결정사항", row.decisions, "decision")}${reportSection("04", "중요 이슈·보류사항", row.issues, "issue")}<section class="action-section"><header><h2>담당자별 실행과제</h2><small>ACTION PLAN</small></header><table class="actions"><thead><tr><th>실행과제</th><th>담당자</th><th>기한</th><th>우선순위</th><th>상태</th></tr></thead><tbody>${related.map((item) => `<tr><td>${escapeHtml(item.title)}</td><td>${escapeHtml(item.assigneeName)}</td><td>${escapeHtml(formatDate(item.dueDate))}</td><td>${escapeHtml(actionPriorityLabels[item.priority] || item.priority)}</td><td>${escapeHtml(actionStatusLabels[item.status] || item.status)}</td></tr>`).join("") || `<tr><td colspan="5">등록된 실행과제가 없습니다.</td></tr>`}</tbody></table></section><div class="sign-line"><div><b>작성</b><span></span></div><div><b>검토</b><span></span></div><div><b>승인</b><span></span></div></div><footer class="document-footer"><span>작성 ${escapeHtml(row.createdByName)} · 최종 수정 ${escapeHtml(row.updatedByName)}</span><span>${escapeHtml(formatDateTime(row.updatedAt))}</span></footer></body></html>`);
  popup.document.close();
}

function openActionItemModal(row = null, meetingId = null) {
  const editing = Boolean(row);
  const selectedMeeting = row?.meetingId || meetingId || "";
  const meetingOptions = `<option value="">회의와 직접 연결하지 않음</option>${(state.data.meetings || []).map((meeting) => option(meeting.id, `${formatDateTime(meeting.meetingDate)} · ${meeting.title}`, selectedMeeting === meeting.id)).join("")}`;
  const assigneeOptions = `<option value="">담당자 미지정</option>${(state.data.assignees || []).map((user) => option(user.username, `${user.displayName}${user.department ? ` · ${user.department}` : ""}`, (row?.assigneeUsername || state.actor.username) === user.username)).join("")}`;
  openModal(editing ? "ACTION PLAN EDIT" : "ACTION PLAN", editing ? "액션플랜 수정" : "회의 액션플랜 등록", `
    <label class="full"><span>연결 HR 회의</span><select name="meetingId">${meetingOptions}</select></label>
    ${field("title", "실행과제 *", "text", row?.title || "", true)}
    <label class="full"><span>구체적 실행내용</span><textarea name="details" placeholder="무엇을 확인하고 어떤 결과를 남길지 입력">${escapeHtml(row?.details || "")}</textarea></label>
    <label><span>담당자</span><select name="assigneeUsername">${assigneeOptions}</select></label>
    ${field("dueDate", "기한 *", "date", row?.dueDate || state.data.today, true)}
    <label><span>우선순위</span><select name="priority">${Object.entries(actionPriorityLabels).map(([value, label]) => option(value, label, value === (row?.priority || "normal"))).join("")}</select></label>
    <label><span>업무 상태</span><select name="status">${Object.entries(actionStatusLabels).map(([value, label]) => option(value, label, value === (row?.status || "open"))).join("")}</select></label>
    <label><span>알림 범위</span><select name="notificationScope">${option("personal", "담당자 개인 알림", (row?.notificationScope || "personal") === "personal")}${option("all", "전체 사용자 알림", row?.notificationScope === "all")}</select></label>
    <div class="field-note full">개인 알림은 지정 담당자의 현황판에, 전체 알림은 모든 로그인 사용자에게 표시됩니다.</div>`,
    (body) => api(editing ? `/api/action-items/${encodeURIComponent(row.id)}` : "/api/action-items", { method: editing ? "PATCH" : "POST", body }));
}

async function completeActionItem(row) {
  if (!row) return;
  setBusy(true);
  try {
    await api(`/api/action-items/${encodeURIComponent(row.id)}`, { method: "PATCH", body: { status: "completed" } });
    await loadData();
    showToast("액션플랜을 완료 처리했습니다.");
  } catch (error) {
    showGlobalError(error.message);
  } finally {
    setBusy(false);
  }
}

async function deleteActivity(id) {
  return deleteRecord(`/api/recruiting-activities/${encodeURIComponent(id)}`, "이 채용활동 기록을 삭제할까요? 삭제 사실은 감사 로그에 남습니다.", "채용활동을 삭제했습니다.");
}

async function deleteWorkforce(id) {
  return deleteRecord(`/api/workforce-plans/${encodeURIComponent(id)}`, "이 인원·TO 항목을 삭제할까요?", "인원·TO 항목을 삭제했습니다.");
}

async function deleteMeeting(id) {
  return deleteRecord(`/api/hr-meetings/${encodeURIComponent(id)}`, "이 HR 회의를 삭제할까요? 연결 액션플랜은 보존되며 회의 연결만 해제됩니다.", "HR 회의를 삭제했습니다.");
}

async function deleteActionItem(id) {
  return deleteRecord(`/api/action-items/${encodeURIComponent(id)}`, "이 액션플랜을 삭제할까요?", "액션플랜을 삭제했습니다.");
}

async function deleteGoal(goal) {
  if (!goal) return;
  return deleteRecord(`/api/goals/${encodeURIComponent(goal.id)}`, `‘${goal.functionName}’ 채용목표를 삭제할까요?\n\n연결된 활동·후보는 보존하되 목표 연결이 해제되고, 중간점검 기록은 함께 삭제됩니다.`, "채용목표를 삭제했습니다.");
}

async function deleteCheckpoint(id) {
  return deleteRecord(`/api/checkpoints/${encodeURIComponent(id)}`, "이 중간점검 기록을 삭제할까요? 현재 채용목표의 날짜와 백업플랜은 유지되며 필요하면 목표 수정에서 변경할 수 있습니다.", "중간점검을 삭제했습니다.");
}

async function deleteReport(id) {
  return deleteRecord(`/api/reports/${encodeURIComponent(id)}`, "저장된 마감 보고를 삭제할까요? 원본 활동 데이터는 삭제되지 않습니다.", "마감 보고를 삭제했습니다.");
}

async function deleteJobPosting(id) {
  return deleteRecord(`/api/job-postings/${encodeURIComponent(id)}`, "이 채용공고를 삭제할까요? 사람인 원본 공고는 삭제되지 않고 프로그램의 공고 현황에서만 제거됩니다.", "채용공고를 삭제했습니다.");
}

async function deleteUser(user) {
  if (!user) return;
  return deleteRecord(`/api/users/${encodeURIComponent(user.username)}`, `‘${user.displayName}’ 사용자 계정을 삭제할까요? 기존 활동과 감사기록의 작성자명은 보존됩니다.`, "사용자를 삭제했습니다.");
}

async function deleteRecord(path, message, successMessage) {
  if (!confirm(message)) return;
  setBusy(true);
  try {
    await api(path, { method: "DELETE", body: {} });
    state.calendarCache = {};
    state.calendarRequest += 1;
    await loadData();
    showToast(successMessage);
  } catch (error) {
    showGlobalError(error.message);
  } finally {
    setBusy(false);
  }
}

async function copyReportSummary() {
  const report = state.activeReportSnapshot?.summary || state.data.report;
  const executive = report.executive || {};
  const lines = [
    `[인재확보 및 인사기획 · ${reportTypeLabels[state.reportType] || "HR 활동·실적 보고"} | ${formatDate(report.from)}~${formatDate(report.to)}]`,
    "",
    "[경영 요약]",
    ...(executive.bullets || [report.narrative]).map((item) => `- ${item}`),
    "",
    "[핵심 지표]",
    `- 기간 활동 ${report.totals.totalCount}건 / 지원·접수 ${report.totals.applications}건 / 면접 수립 ${report.totals.interviews}건 / 면접 실시 ${report.totals.interviewsConducted}건`,
    `- 현재 후보 ${executive.pipeline?.totalCandidates || 0}명 / 면접 경험 ${executive.pipeline?.interviews || 0}명(${executive.pipeline?.interviewRate || 0}%) / 실제 입사 ${executive.pipeline?.hired || 0}명(${executive.pipeline?.hireRate || 0}%)`,
    `목표 평균 진행률 ${report.goals.averageProgress}% / 점검 필요 ${report.goals.checkpointDue}개 / 위험·지연 ${report.goals.atRisk}개`,
    "",
    "[유입경로별 누적 전환]",
    ...(executive.sourceFunnel || []).map((row) => `- ${row.source}: 지원후보 기록 ${row.candidates}건 → 면접 ${row.interviews}건(${row.interviewRate}%) → 입사 ${row.hired}건(${row.hireRate}%) / 기간활동 ${row.periodActivities}건`),
    "",
    "[채용 직무별 기간 활동]",
    ...(report.byPosition || []).map((row) => `- ${row.label}: 활동 ${row.totalCount}건 / 검토 ${row.reviews}건 / DM ${row.dmSent}건 / 면접 ${row.interviews}건`),
    "",
    "[채용 중단·불합격 사유]",
    ...((executive.rejectionReasons || []).length ? executive.rejectionReasons.map((row) => `- ${row.reason}: ${row.count}건`) : ["- 등록 사유 없음"]),
    "",
    "[부서별 판정·백업플랜]",
    ...(executive.departments || []).filter((row) => row.goalCount || row.activityCount).map((row) => `- ${row.department}: ${departmentStatusLabels[row.status] || row.status} / 진행 ${row.weightedProgress}% / 진행후보 ${row.activeCandidates}명 / 면접 ${row.interviews}명 / ${row.recommendation}`),
    "",
    "[위험 목표]",
    ...(report.atRiskGoals.length ? report.atRiskGoals.map((goal) => `- ${goal.priority} ${goal.functionName || goal.title}: ${goal.progress}% / ${riskLabels[goal.riskStatus]} / 목표 ${formatDate(goal.targetDate)} / 백업 ${goal.backupPlan || "미등록"}`) : ["- 없음"]),
  ];
  try {
    await navigator.clipboard.writeText(lines.join("\n"));
    showToast("보고 요약을 복사했습니다.");
  } catch {
    showGlobalError("브라우저에서 클립보드 사용을 허용해 주세요.");
  }
}

function openModal(eyebrow, title, bodyHtml, submit, submitLabel = "저장") {
  $("#modal-eyebrow").textContent = eyebrow;
  $("#modal-title").textContent = title;
  $("#modal-body").innerHTML = bodyHtml;
  $("#modal-submit").textContent = submitLabel;
  $("#modal-backdrop").hidden = false;
  state.modalSubmit = submit;
  $("#modal-body input:not([readonly]), #modal-body select")?.focus();
}

function closeModal() {
  $("#modal-backdrop").hidden = true;
  $("#modal-form").reset();
  $("#modal-submit").textContent = "저장";
  state.modalSubmit = null;
}

async function api(path, { method = "GET", body } = {}) {
  const response = await fetch(path, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "요청을 처리하지 못했습니다.");
  return payload;
}

function heading(eyebrow, title, description, actions = "") { return `<section class="page-heading"><div><p>${escapeHtml(eyebrow)}</p><h1>${escapeHtml(title)}</h1><span>${escapeHtml(description)}</span></div>${actions ? `<div class="heading-actions">${actions}</div>` : ""}</section>`; }
function kpi(label, value, unit, detail, drilldown = "") {
  const tag = drilldown ? "button" : "article";
  const attrs = drilldown ? ` type="button" data-dashboard-drilldown="${escapeHtml(drilldown)}" aria-label="${escapeHtml(label)} ${Number(value || 0)}${escapeHtml(unit)} 상세 데이터 보기"` : "";
  return `<${tag} class="kpi ${drilldown ? "drilldown" : ""}"${attrs}><span>${escapeHtml(label)}</span><strong>${Number(value || 0)}<small>${escapeHtml(unit)}</small></strong><small>${escapeHtml(detail)}</small>${drilldown ? "<em>상세 보기 →</em>" : ""}</${tag}>`;
}
function summary(label, value) { return `<article><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`; }
function field(name, label, type = "text", value = "", required = false, readOnly = false) { return `<label><span>${escapeHtml(label)}</span><input name="${escapeHtml(name)}" type="${escapeHtml(type)}" value="${escapeHtml(value)}" ${required ? "required" : ""} ${readOnly ? "readonly" : ""}></label>`; }
function option(value, label, selected = false) { return `<option value="${escapeHtml(value)}" ${selected ? "selected" : ""}>${escapeHtml(label)}</option>`; }
function emptyRow(cols, message) { return `<tr><td colspan="${cols}" class="empty">${escapeHtml(message)}</td></tr>`; }
function valuesOf(form) { return Object.fromEntries(new FormData(form).entries()); }
function canWrite() { return ["admin", "recruiter"].includes(state.actor?.role); }
function canEditActivity(row) { return canWrite() && (state.actor.role === "admin" || row.createdByUsername === state.actor.username); }
function jobPostingStatusLabel(value) { return ({ active: "진행 중", draft: "임시 저장", closed: "마감" })[value] || value; }
function jobPostingDday(row) {
  if (row.status === "closed") return { label: "마감", className: "closed" };
  if (!row.expirationDate) return { label: row.closeType || "채용시", className: "rolling" };
  const days = dayDiff(state.data?.today || localYmd(new Date()), row.expirationDate);
  if (days < 0) return { label: "마감", className: "closed" };
  if (days === 0) return { label: "D-DAY", className: "urgent" };
  return { label: `D-${days}`, className: days <= 7 ? "urgent" : "open" };
}
function goalSort(a, b) { return String(a.priority).localeCompare(String(b.priority), "ko") || riskRank(a.riskStatus) - riskRank(b.riskStatus) || String(a.targetDate || "9999").localeCompare(String(b.targetDate || "9999")); }
function riskRank(value) { return ({ overdue: 0, checkpoint_due: 1, risk: 2, on_track: 3, on_hold: 4, completed: 5 })[value] ?? 9; }
function reviewersText(goal) { if (!goal) return ""; if (Array.isArray(goal.reviewers)) return goal.reviewers.join(", "); try { return JSON.parse(goal.reviewersJson || "[]").join(", "); } catch { return String(goal.reviewersJson || ""); } }
function initials(name) { const value = String(name || "A").replace(/\s/g, ""); return value.length >= 2 ? value.slice(-2).toUpperCase() : value.toUpperCase(); }
function seoulYmd(date) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date); }
function localYmd(date) { const year = date.getFullYear(); const month = String(date.getMonth() + 1).padStart(2, "0"); const day = String(date.getDate()).padStart(2, "0"); return `${year}-${month}-${day}`; }
function monthEnd(value) { const [year, month] = value.split("-").map(Number); return localYmd(new Date(year, month, 0)); }
function startOfWeek(value) { const date = new Date(`${value}T00:00:00`); const day = date.getDay() || 7; date.setDate(date.getDate() - day + 1); return localYmd(date); }
function addDays(value, amount) { const date = new Date(`${value}T00:00:00`); date.setDate(date.getDate() + amount); return localYmd(date); }
function dayDiff(from, to) { return Math.round((new Date(`${to}T00:00:00`) - new Date(`${from}T00:00:00`)) / 86400000); }
function formatDate(value) { return value ? String(value).slice(0, 10).replaceAll("-", ".") : "미정"; }
function shortDate(value) { return value ? `${Number(value.slice(5, 7))}/${Number(value.slice(8, 10))}` : ""; }
function formatDateTime(value) { if (!value) return "-"; try { return new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" }).format(new Date(value)); } catch { return String(value); } }
function toLocalInput(value) { return value ? String(value).slice(0, 16) : ""; }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]); }
function setBusy(value) { busy.hidden = !value; }
function showToast(message) { toast.textContent = `✓ ${message}`; toast.hidden = false; setTimeout(() => toast.hidden = true, 3000); }
function showAuthError(message) { authError.textContent = message; authError.hidden = false; }
function showGlobalError(message) { const element = $("#global-error"); element.textContent = `확인 필요 · ${message}`; element.hidden = false; }
function hideGlobalError() { $("#global-error").hidden = true; }
