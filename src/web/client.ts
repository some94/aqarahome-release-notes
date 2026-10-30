// 웹 뷰어 (SPEC 8번): 버전 타임라인 + 상세, 통합 검색·필터는 전부 브라우저에서 처리.
import {
  compareVersionDesc,
  EMPTY_FILTERS,
  fromItemRow,
  hasActiveFilters,
  matchesFilters,
  normalize,
  VIEWER_SECTION_ORDER,
  type Filters,
  type ViewerData,
  type ViewerItem,
  type ViewerVersion,
} from '../shared/viewer';

const PLATFORMS = ['공통', 'Android', 'iOS', 'Mac', 'Google Play', 'HarmonyOS', 'Web'];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const el = {
  meta: $('meta'),
  status: $('status'),
  app: $('app'),
  list: $('list'),
  detail: $('detail'),
  q: $<HTMLInputElement>('q'),
  platform: $<HTMLSelectElement>('f-platform'),
  section: $<HTMLSelectElement>('f-section'),
  device: $<HTMLSelectElement>('f-device'),
  from: $<HTMLInputElement>('f-from'),
  to: $<HTMLInputElement>('f-to'),
  internal: $<HTMLInputElement>('f-internal'),
  reset: $<HTMLButtonElement>('f-reset'),
};

interface State {
  versions: ViewerVersion[];
  byVersion: Map<string, ViewerItem[]>;
  itemById: Map<string, ViewerItem>;
  filters: Filters;
  selected: string;
  /** 필터가 걸려 있어도 선택한 버전은 전체 항목 보기 */
  showAll: boolean;
  /** 원문을 펼친 항목 ID */
  openEn: Set<string>;
}

const state: State = {
  versions: [],
  byVersion: new Map(),
  itemById: new Map(),
  filters: { ...EMPTY_FILTERS },
  selected: '',
  showAll: false,
  openEn: new Set(),
};

// ---------- 유틸 ----------

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** 검색어 강조: 이스케이프한 뒤 단어마다 <mark> */
function highlight(text: string): string {
  const html = escapeHtml(text);
  const words = normalize(state.filters.query).split(' ').filter((w) => w.length > 0);
  if (words.length === 0) return html;
  const pattern = new RegExp(`(${words.map((w) => escapeHtml(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return html.replace(pattern, '<mark>$1</mark>');
}

function setStatus(message: string, isError = false): void {
  el.status.textContent = message;
  el.status.classList.toggle('error', isError);
  el.status.hidden = !message;
}

function channelBadge(label: string, value: string): string {
  if (!value) return '';
  const cls = value.startsWith('출시 완료') ? 'ok' : value.startsWith('확인 필요') ? 'warn' : '';
  return `<span class="badge ${cls}" title="${escapeHtml(`${label}: ${value}`)}">${escapeHtml(label)} ${escapeHtml(value.replace(/\s*\(.*\)$/, ''))}</span>`;
}

function statusBadge(status: string): string {
  if (status === '정상' || !status) return '';
  const cls = status === '검수 필요' || status === '오류' ? 'danger' : 'warn';
  return `<span class="badge ${cls}">${escapeHtml(status)}</span>`;
}

// ---------- 필터 결과 ----------

function matchedItems(version: ViewerVersion): ViewerItem[] {
  const items = state.byVersion.get(version.version) ?? [];
  if (!hasActiveFilters(state.filters)) return items;
  return items.filter((it) => matchesFilters(it, version, state.filters));
}

function visibleVersions(): { version: ViewerVersion; matches: number }[] {
  const active = hasActiveFilters(state.filters);
  return state.versions
    .map((version) => ({ version, matches: matchedItems(version).length }))
    .filter((v) => !active || v.matches > 0);
}

// ---------- 렌더링: 목록 ----------

function renderList(): void {
  const rows = visibleVersions();
  const active = hasActiveFilters(state.filters);
  const total = rows.reduce((n, r) => n + r.matches, 0);
  const summary = active
    ? `<div class="summary">일치하는 항목 ${total}개 · 버전 ${rows.length}개</div>`
    : `<div class="summary">버전 ${rows.length}개 · 최신순</div>`;
  if (rows.length === 0) {
    el.list.innerHTML = `${summary}<div class="placeholder">조건에 맞는 항목이 없습니다.</div>`;
    return;
  }
  el.list.innerHTML =
    summary +
    rows
      .map(({ version: v, matches }) => {
        const items = state.byVersion.get(v.version) ?? [];
        const internal = items.filter((i) => i.internal).length;
        return `<button type="button" class="card${v.version === state.selected ? ' selected' : ''}" data-version="${escapeHtml(v.version)}">
          <div class="row">
            <span class="ver">v${escapeHtml(v.version)}</span>
            <span class="date">${escapeHtml(v.approvalDate || v.receivedDate)}</span>
            ${statusBadge(v.status)}
            ${v.source === '루미 메일' ? '' : `<span class="badge">${escapeHtml(v.source)}</span>`}
            ${active ? `<span class="badge match">일치 ${matches}</span>` : ''}
          </div>
          <div class="channels">${channelBadge('Android', v.android)}${channelBadge('iOS', v.ios)}${channelBadge('GP', v.googlePlay)}</div>
          <div class="counts">항목 ${items.length}개${internal ? ` · <span class="badge internal">내부용 ${internal}</span>` : ''}</div>
        </button>`;
      })
      .join('');
}

// ---------- 렌더링: 상세 ----------

function itemHtml(item: ViewerItem, depth: number, context: boolean): string {
  const open = state.openEn.has(item.id);
  const badges = [
    item.platform && item.platform !== '공통' ? `<span class="badge platform">${escapeHtml(item.platform)}</span>` : '',
    item.internal ? '<span class="badge internal">내부용</span>' : '',
  ].join('');
  const chips = [
    ...item.devices.map((d) => `<span class="chip device">${highlight(d)}</span>`),
    ...item.tags.map((t) => `<span class="chip">${highlight(t)}</span>`),
  ].join('');
  const ko = item.ko || '(번역 없음 — 아래 원문 참고)';
  return `<div class="item${context ? ' context' : ''}" style="--depth:${depth}">
    <div class="head"><span class="bullet">${depth ? '–' : '•'}</span><div class="ko">${badges ? `${badges} ` : ''}${highlight(ko)}</div></div>
    <div class="meta-row">${chips}<button type="button" class="link toggle" data-en="${escapeHtml(item.id)}">${open ? '원문 접기' : '원문 보기'}</button></div>
    ${open || !item.ko ? `<div class="en">${highlight(item.en)}</div>` : ''}
  </div>`;
}

function renderDetail(): void {
  const version = state.versions.find((v) => v.version === state.selected);
  if (!version) {
    el.detail.innerHTML = '<div class="placeholder">왼쪽에서 버전을 선택하세요.</div>';
    el.app.classList.remove('show-detail');
    return;
  }
  const all = state.byVersion.get(version.version) ?? [];
  const filtered = hasActiveFilters(state.filters) && !state.showAll;
  const matched = new Set(matchedItems(version).map((i) => i.id));

  // 필터 중에는 일치 항목과 그 상위 항목(맥락, 흐리게)만 보여준다
  const shown = new Set<string>();
  for (const item of all) {
    if (!filtered || matched.has(item.id)) {
      shown.add(item.id);
      let parent = item.parentId ? state.itemById.get(item.parentId) : undefined;
      while (parent) {
        shown.add(parent.id);
        parent = parent.parentId ? state.itemById.get(parent.parentId) : undefined;
      }
    }
  }

  const depthOf = (item: ViewerItem) => item.id.split('-').length - 3;
  const sections = VIEWER_SECTION_ORDER.map((name) => {
    const items = all.filter((i) => i.section === name && shown.has(i.id));
    if (items.length === 0) return '';
    const count = items.filter((i) => !filtered || matched.has(i.id)).length;
    return `<div class="section"><h3>${escapeHtml(name)}${name.includes('내부용') ? ' <span class="badge internal">내부용</span>' : ''} <span class="count">${count}</span></h3>
      ${items.map((i) => itemHtml(i, depthOf(i), filtered && !matched.has(i.id))).join('')}</div>`;
  }).join('');

  const fact = (label: string, value: string) => (value ? `<dt>${escapeHtml(label)}</dt><dd>${value}</dd>` : '');
  const channelVersions = version.appVersion || version.googlePlayVersion
    ? `Android/iOS ${escapeHtml(version.appVersion || '-')} · Google Play ${escapeHtml(version.googlePlayVersion || '-')}`
    : '';

  el.detail.innerHTML = `
    <button type="button" class="link back" data-back>← 목록</button>
    <h2>v${escapeHtml(version.version)} ${statusBadge(version.status)}</h2>
    <div class="sub">승인일 ${escapeHtml(version.approvalDate || '-')} · 메일 ${escapeHtml(version.receivedDate || '-')} · 항목 ${all.length}개</div>
    <dl class="facts">
      ${fact('채널별 버전', channelVersions)}
      ${fact('Android', escapeHtml(version.android))}
      ${fact('iOS', escapeHtml(version.ios))}
      ${fact('Google Play', escapeHtml(version.googlePlay))}
      ${fact('출처', escapeHtml(version.source))}
      ${fact('메일 제목', escapeHtml(version.subject))}
      ${fact('원본 메일', version.gmailLink ? `<a href="${escapeHtml(version.gmailLink)}" target="_blank" rel="noopener">Gmail에서 열기</a> <span class="meta">(이 메일을 받은 계정에서만 열림 — 받지 않았다면 Gmail 검색 결과가 비어 있음)</span>` : '')}
    </dl>
    ${version.warnings ? `<div class="warnings">${escapeHtml(version.warnings)}</div>` : ''}
    ${hasActiveFilters(state.filters)
      ? `<div class="notice"><span>${state.showAll ? '이 버전의 전체 항목을 보고 있습니다.' : `검색·필터에 일치하는 ${matched.size}개 항목만 보고 있습니다(흐린 항목은 상위 맥락).`}</span>
         <button type="button" class="link" data-showall>${state.showAll ? '일치 항목만 보기' : '이 버전 전체 보기'}</button></div>`
      : ''}
    ${sections || '<div class="placeholder">표시할 항목이 없습니다.</div>'}`;
  el.app.classList.add('show-detail');
}

function render(): void {
  renderList();
  renderDetail();
}

// ---------- 상태 ↔ 주소(공유 가능한 링크) ----------

function syncUrl(): void {
  const f = state.filters;
  const params: Record<string, string> = {};
  if (state.selected) params.v = state.selected;
  if (f.query) params.q = f.query;
  if (f.platform) params.platform = f.platform;
  if (f.section) params.section = f.section;
  if (f.device) params.device = f.device;
  if (f.internalOnly) params.internal = '1';
  if (f.from) params.from = f.from;
  if (f.to) params.to = f.to;
  try {
    google.script.history.replace(null, params);
  } catch {
    // 테스트 배포 등에서 history를 쓸 수 없으면 무시
  }
}

function readFilterInputs(): void {
  state.filters = {
    query: el.q.value,
    platform: el.platform.value,
    section: el.section.value,
    device: el.device.value,
    internalOnly: el.internal.checked,
    from: el.from.value,
    to: el.to.value,
  };
}

function writeFilterInputs(): void {
  const f = state.filters;
  el.q.value = f.query;
  el.platform.value = f.platform;
  el.section.value = f.section;
  el.device.value = f.device;
  el.internal.checked = f.internalOnly;
  el.from.value = f.from;
  el.to.value = f.to;
}

/** 필터를 바꾸면 선택 버전이 결과에 없을 때 첫 결과로 옮긴다 */
function onFiltersChanged(): void {
  readFilterInputs();
  state.showAll = false;
  const visible = visibleVersions().map((v) => v.version.version);
  if (state.selected && !visible.includes(state.selected)) state.selected = visible[0] ?? '';
  render();
  syncUrl();
}

// ---------- 초기화 ----------

function fillOptions(select: HTMLSelectElement, values: string[]): void {
  select.insertAdjacentHTML('beforeend', values.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join(''));
}

function load(data: ViewerData): void {
  state.versions = [...data.versions].sort((a, b) => compareVersionDesc(a.version, b.version));
  const items = data.items.map(fromItemRow);
  for (const item of items) {
    state.itemById.set(item.id, item);
    const list = state.byVersion.get(item.version) ?? [];
    list.push(item);
    state.byVersion.set(item.version, list);
  }

  const deviceCounts = new Map<string, number>();
  for (const item of items) for (const d of item.devices) deviceCounts.set(d, (deviceCounts.get(d) ?? 0) + 1);
  fillOptions(el.platform, PLATFORMS);
  fillOptions(el.section, VIEWER_SECTION_ORDER.filter((s) => items.some((i) => i.section === s)));
  fillOptions(el.device, [...deviceCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([d]) => d));

  const latest = state.versions[0];
  el.meta.textContent = `버전 ${state.versions.length}개 · 항목 ${items.length}개 · 최신 v${latest?.version ?? '-'} · 데이터 기준 ${data.generatedAt}`;
}

function bindEvents(): void {
  let timer = 0;
  el.q.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(onFiltersChanged, 150);
  });
  for (const input of [el.platform, el.section, el.device, el.from, el.to, el.internal]) input.addEventListener('change', onFiltersChanged);
  el.reset.addEventListener('click', () => {
    state.filters = { ...EMPTY_FILTERS };
    writeFilterInputs();
    onFiltersChanged();
  });

  el.list.addEventListener('click', (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>('[data-version]');
    if (!card) return;
    state.selected = card.dataset.version!;
    state.showAll = false;
    render();
    syncUrl();
    if (window.matchMedia('(max-width: 860px)').matches) window.scrollTo(0, 0);
  });

  el.detail.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const en = target.closest<HTMLElement>('[data-en]');
    if (en) {
      const id = en.dataset.en!;
      if (state.openEn.has(id)) state.openEn.delete(id);
      else state.openEn.add(id);
      renderDetail();
      return;
    }
    if (target.closest('[data-showall]')) {
      state.showAll = !state.showAll;
      renderDetail();
      return;
    }
    if (target.closest('[data-back]')) {
      state.selected = '';
      render();
      syncUrl();
    }
  });

  // 목록 고정 위치를 실제 상단 바 높이에 맞춤
  const header = document.querySelector<HTMLElement>('.topbar')!;
  const fitHeader = () => document.documentElement.style.setProperty('--header-h', `${header.offsetHeight}px`);
  window.addEventListener('resize', fitHeader);
  fitHeader();
}

function start(params: Record<string, string>): void {
  const started = Date.now();
  google.script.run
    .withSuccessHandler((data: ViewerData) => {
      load(data);
      state.filters = {
        query: params.q ?? '',
        platform: params.platform ?? '',
        section: params.section ?? '',
        device: params.device ?? '',
        internalOnly: params.internal === '1',
        from: params.from ?? '',
        to: params.to ?? '',
      };
      writeFilterInputs();
      const wide = !window.matchMedia('(max-width: 860px)').matches;
      state.selected = params.v ?? (wide ? (visibleVersions()[0]?.version.version ?? '') : '');
      bindEvents();
      render();
      setStatus('');
      // 불러오는 데 걸린 시간(전체/서버) — 느리다는 문의가 오면 이 값으로 판단
      const total = Date.now() - started;
      el.meta.textContent += ` (${(total / 1000).toFixed(1)}초 · 서버 ${(data.serverMs / 1000).toFixed(1)}초)`;
      el.meta.title = `전체 ${total}ms · 서버 ${data.serverMs}ms`;
    })
    .withFailureHandler((error: Error) => setStatus(`데이터를 불러오지 못했습니다: ${error.message}`, true))
    .getViewerData();
}

try {
  google.script.url.getLocation((location) => start(location.parameter ?? {}));
} catch {
  start({});
}
