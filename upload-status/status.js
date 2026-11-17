(() => {
  const element = id => document.getElementById(id);
  const periodPattern = /^\d{4}-(0[1-9]|1[0-2])-[1-9]\d?$/;
  const labels = {normal: '정상', complex: '복합'};
  const minimum = 5;
  let editions = [];
  let rows = [];
  let activePeriod;
  const historyReports = new Map();
  let endpoint;
  let loading = false;
  const requested = new URL(location.href).searchParams.get('period') || '';
  let manualPeriod = periodPattern.test(requested) ? requested : '';

  async function query(period) {
    if (!endpoint) {
      const response = await fetch('./endpoint.json', {cache: 'no-store', signal: AbortSignal.timeout(5000)});
      if (!response.ok) throw Error('집계 설정을 읽지 못했습니다. (HTTP ' + response.status + ')');
      const {url} = await response.json();
      if (!url) throw Error('Apps Script 조회 주소를 설정해주세요.');
      const target = new URL(url);
      if (target.origin !== 'https://script.google.com' || !/^\/macros\/s\/[\w-]+\/exec$/.test(target.pathname)
          || target.search || target.hash || target.username || target.password) {
        throw Error('Apps Script 웹 앱의 /exec 주소를 확인해주세요.');
      }
      endpoint = target.href;
    }
    const url = new URL(endpoint);
    if (period) url.searchParams.set('period', period);
    try {
      const response = await fetch(url, {
        credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) throw Error('HTTP ' + response.status);
      if (!response.headers.get('content-type')?.includes('application/json')) {
        throw Error('unexpected content type');
      }
      return await response.json();
    } catch (error) {
      console.warn('[업로드 현황] JSON 요청 실패, JSONP로 재시도:', error.name, error.message);
      return queryJsonp(url);
    }
  }

  function queryJsonp(url) {
    const token = [...crypto.getRandomValues(new Uint8Array(12))]
      .map(byte => byte.toString(16).padStart(2, '0')).join('');
    const callback = 'kangolStatus_' + token;
    url.searchParams.set('cb', callback);
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const finish = (error, data) => {
        clearTimeout(timer);
        script.remove();
        // A response arriving after timeout must not update the page.
        delete window[callback];
        if (error) reject(error);
        else resolve(data);
      };
      const timer = setTimeout(() => finish(Error('집계 응답 시간이 초과되었습니다. 잠시 후 새로고침해주세요.')), 15000);
      window[callback] = data => finish(null, data);
      script.onerror = () => finish(Error('집계 요청을 불러오지 못했습니다. 잠시 후 새로고침해주세요.'));
      script.onload = () => {
        if (window[callback]) finish(Error('집계 응답에 JSONP 콜백이 없습니다. 잠시 후 새로고침해주세요.'));
      };
      script.src = url.href;
      document.head.append(script);
    });
  }

  function options(select, values, selected, label) {
    select.replaceChildren(...values.map(value => new Option(label(value), value)));
    select.value = selected;
  }

  function selectors(period) {
    const month = period.slice(0, 7);
    options(element('month'), [...new Set(editions.map(id => id.slice(0, 7)))], month,
      value => value.slice(0, 4) + '년 ' + Number(value.slice(5)) + '월');
    options(element('round'), editions.filter(id => id.startsWith(month + '-')), period,
      value => value.split('-')[2] + '차');
  }

  function historyReport(period) {
    const cached = historyReports.get(period);
    if (cached && cached.expires > Date.now()) return cached.report;
    const report = query(period).then(data => {
      if (data.error || data.period !== period || !Array.isArray(data.stores)
          || !data.stores.every(row => typeof row?.name === 'string'
            && Number.isSafeInteger(row.photo_count) && row.photo_count >= 0)) {
        throw Error('과거 집계 응답을 확인할 수 없습니다.');
      }
      return data.stores;
    }).catch(error => {
      if (historyReports.get(period)?.report === report) historyReports.delete(period);
      throw error;
    });
    historyReports.set(period, {report, expires: Date.now() + 60000});
    return report;
  }

  function detailMetric(title, maximum) {
    const section = document.createElement('div');
    section.className = 'detail-metric';
    const heading = document.createElement('span');
    heading.className = 'detail-label';
    heading.textContent = title;
    const result = document.createElement('span');
    result.className = 'detail-result';
    const bar = document.createElement('progress');
    bar.max = maximum;
    bar.setAttribute('aria-label', title);
    section.append(heading, result, bar);
    return {section, result, bar};
  }

  async function fillSubmissionHistory(metric, store, period, prefix, currentRows, currentNames) {
    const {section, result, bar} = metric;
    let complete = 0;
    let eligible = 0;
    try {
      for (const edition of editions.filter(id => id.startsWith(prefix))) {
        if (!section.isConnected) return;
        const report = edition === period ? currentRows : await historyReport(edition);
        if (!section.isConnected) return;
        const matches = report.filter(row => row.name === store.name);
        // A changed name cannot be distinguished from a closed or new store.
        if (matches.length > 1 || (!matches.length && report.some(row => !currentNames.has(row.name)))) {
          result.textContent = '매장명 확인 필요';
          return;
        }
        if (matches.length) {
          eligible++;
          if (matches[0].photo_count >= minimum) complete++;
        }
      }
      if (!eligible) {
        result.textContent = '기록 없음';
        return;
      }
      const rate = Math.round(complete / eligible * 1000) / 10;
      const count = document.createElement('small');
      count.textContent = complete + '/' + eligible + '차 완료';
      bar.value = rate;
      bar.hidden = false;
      result.replaceChildren(rate + '%', count);
    } catch (_) {
      result.textContent = '조회 실패 · 다시 열어주세요';
    }
  }

  function storeDetails(row) {
    const details = document.createElement('div');
    details.className = 'store-details';
    const name = document.createElement('div');
    name.className = 'detail-metric';
    const nameLabel = document.createElement('span');
    nameLabel.className = 'detail-label';
    nameLabel.textContent = '매장명';
    const nameValue = document.createElement('strong');
    nameValue.textContent = row.name;
    name.append(nameLabel, nameValue);

    const submitted = Math.min(row.photo_count, minimum);
    const current = detailMetric('최소 제출 기준 충족', minimum);
    current.result.textContent = row.photo_count + '장 / ' + minimum + '장 (' + (submitted / minimum * 100) + '%)';
    current.bar.value = submitted;
    const monthly = detailMetric('누적 제출률 — 월간', 100);
    const annual = detailMetric('누적 제출률 — 연간', 100);
    for (const {result, bar} of [monthly, annual]) {
      result.setAttribute('aria-live', 'polite');
      result.textContent = '조회 중…';
      bar.hidden = true;
    }
    details.append(name, current.section, monthly.section, annual.section);
    const period = activePeriod;
    const currentRows = rows;
    const names = new Set(currentRows.map(store => store.name));
    queueMicrotask(async () => {
      await fillSubmissionHistory(monthly, row, period, period.slice(0, 7) + '-', currentRows, names);
      await fillSubmissionHistory(annual, row, period, period.slice(0, 4) + '-', currentRows, names);
    });
    return details;
  }

  function render() {
    const type = element('store-type').value;
    const search = element('store-search').value.trim().toLocaleLowerCase('ko');
    const missing = element('missing-only').checked;
    const body = element('store-list');
    body.replaceChildren();
    let opened;
    for (const row of rows) {
      if ((type && row.store_type !== type) || (missing && row.photo_count !== 0)
          || !row.name.toLocaleLowerCase('ko').includes(search)) continue;
      const tr = body.insertRow();
      tr.className = 'store-row';
      tr.setAttribute('role', 'row');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'store-toggle';
      const name = document.createElement('span');
      name.className = 'store-name';
      name.textContent = row.name;
      button.append(name);
      button.setAttribute('aria-expanded', 'false');
      tr.insertCell().append(button);
      tr.insertCell().textContent = labels[row.store_type] || '—';
      tr.insertCell().textContent = row.photo_count + '장';
      const badge = document.createElement('span');
      badge.className = 'badge' + (row.photo_count === 0 ? ' missing' : row.photo_count < 5 ? ' short' : '');
      badge.textContent = row.submission_status;
      tr.insertCell().append(badge);
      for (const cell of tr.cells) cell.setAttribute('role', 'cell');

      tr.addEventListener('click', () => {
        const wasOpen = opened?.button === button;
        if (opened) {
          opened.button.setAttribute('aria-expanded', 'false');
          opened.button.removeAttribute('aria-controls');
          opened.detailRow.remove();
          opened = null;
        }
        if (wasOpen) return;
        const detailRow = document.createElement('tr');
        detailRow.className = 'store-detail-row';
        detailRow.setAttribute('role', 'row');
        detailRow.id = 'store-detail-' + tr.sectionRowIndex;
        const cell = detailRow.insertCell();
        cell.setAttribute('role', 'cell');
        cell.colSpan = 4;
        cell.append(storeDetails(row));
        tr.after(detailRow);
        button.setAttribute('aria-controls', detailRow.id);
        button.setAttribute('aria-expanded', 'true');
        opened = {button, detailRow};
      });
    }
    if (!body.rows.length) {
      const emptyRow = body.insertRow();
      emptyRow.setAttribute('role', 'row');
      const cell = emptyRow.insertCell();
      cell.setAttribute('role', 'cell');
      cell.colSpan = 4;
      cell.textContent = loading ? '집계 결과를 불러오는 중입니다.'
        : rows.length ? '조건에 맞는 매장이 없습니다.' : '표시할 집계가 없습니다.';
    }
  }

  async function load(period = '') {
    if (loading) return;
    loading = true;
    for (const id of ['month', 'round', 'refresh']) element(id).disabled = true;
    element('message').hidden = true;
    element('busy').textContent = '조회 중…';
    element('collected-at').textContent = '마지막 집계 —';
    const stats = ['summary-total', 'summary-complete', 'summary-missing', 'submission-rate'];
    for (const id of stats) element(id).textContent = '—';
    rows = [];
    activePeriod = undefined;
    historyReports.clear();
    render();
    if (period && editions.includes(period)) selectors(period);
    try {
      const data = await query(period);
      if (Array.isArray(data.editions)) {
        editions = data.editions.filter(id => periodPattern.test(id));
        if (editions.length) selectors(editions.includes(data.period) ? data.period : editions[0]);
      }
      if (data.error) throw Error({
        busy: '다른 요청이 집계 중입니다. 잠시 후 새로고침해주세요.',
        unpublished: '아직 게시된 가이드 차수를 확인할 수 없습니다.',
      }[data.error] || 'Drive 집계 또는 가이드 차수 확인에 실패했습니다. 잠시 후 다시 시도해주세요.');
      if (!editions.includes(data.period)) throw Error('집계 차수를 확인할 수 없습니다.');
      if (!Array.isArray(data.stores) || !data.stores.every(row =>
        row && typeof row.name === 'string' && Number.isSafeInteger(row.photo_count)
        && row.photo_count >= 0 && typeof row.submission_status === 'string')
        || !data.collected_at || !Number.isFinite(Date.parse(data.collected_at))) {
        throw Error('매장 집계 응답 형식을 확인할 수 없습니다. 잠시 후 새로고침해주세요.');
      }
      rows = data.stores;
      activePeriod = data.period;
      const complete = rows.filter(row => row.photo_count >= 5).length;
      element('summary-total').textContent = rows.length;
      element('summary-complete').textContent = complete;
      element('summary-missing').textContent = rows.filter(row => row.photo_count === 0).length;
      element('submission-rate').textContent = rows.length ? (100 * complete / rows.length).toFixed(1) + '%' : '—';
      const collected = new Intl.DateTimeFormat('ko-KR', {dateStyle: 'medium', timeStyle: 'medium',
        timeZone: 'Asia/Seoul'}).format(new Date(data.collected_at));
      element('collected-at').textContent = '마지막 집계 ' + collected + ' (한국 시간)' +
        (data.cached ? ' · 최대 60초 이내 저장된 집계' : '');
    } catch (error) {
      console.error('[업로드 현황] 조회 실패:', period || '기본 차수', error.name, error.message);
      element('message').textContent = error.message;
      element('message').hidden = false;
    } finally {
      loading = false;
      render();
      element('busy').textContent = '';
      element('month').disabled = element('round').disabled = !editions.length;
      element('refresh').disabled = false;
    }
  }

  function selectPeriod(period) {
    manualPeriod = period;
    const url = new URL(location.href);
    url.searchParams.set('period', period);
    history.replaceState(null, '', url);
    load(period);
  }

  element('month').addEventListener('change', event => selectPeriod(editions.find(id => id.startsWith(event.target.value + '-'))));
  element('round').addEventListener('change', event => selectPeriod(event.target.value));
  element('refresh').addEventListener('click', () => load(manualPeriod));
  element('store-type').addEventListener('change', render);
  element('store-search').addEventListener('input', render);
  element('missing-only').addEventListener('change', render);
  load(manualPeriod);
})();
