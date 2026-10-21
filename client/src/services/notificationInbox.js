const empty = () => ({items: [], unread: 0, next: null});
const initial = (enabled) => ({data: empty(), loading: enabled, refreshing: false, loadingMore: false, marking: [], error: '', moreError: '', markError: null});
const abortError = () => Object.assign(new Error('The notification request was cancelled.'), {name: 'AbortError'});

function unique(items) {
  return [...new Map(items.map(item => [String(item.id), item])).values()];
}

// Refresh through the oldest loaded item, rather than replacing the inbox with
// its first page. Walking the cursor also covers bursts larger than one page.
export async function readNotificationRange(fetchPage, oldestId, signal, {maxPages=100,timeoutMs=20000}={}) {
  const budget = new AbortController();let rejectBudget;
  const interrupted = new Promise((_,reject) => {rejectBudget = reject;});
  const abort = () => {budget.abort();rejectBudget(abortError());};
  signal?.addEventListener('abort',abort,{once:true});
  const timer = setTimeout(() => {budget.abort();rejectBudget(new Error('Refreshing notifications took too long. Your current list is still here. Please try again.'));},timeoutMs);
  const read = before => Promise.race([fetchPage(before,budget.signal),interrupted]);
  try {
    if(signal?.aborted) throw abortError();
    let page = await read(null),pages = 1;
    const unread = page.unread, items = [...page.items], seen = new Set();
    while (oldestId != null && page.next != null && page.items.length && BigInt(page.items.at(-1).id) > BigInt(oldestId)) {
      if(pages >= maxPages) throw new Error('There are too many notifications to refresh at once. Reload this page to start from the latest notifications. Your existing list is still here.');
      const cursor = String(page.next);
      if (seen.has(cursor)) throw new Error('Notifications could not be refreshed. Please try again.');
      seen.add(cursor);pages++;
      page = await read(cursor);
      items.push(...page.items);
    }
    return {items: unique(items), unread, next: page.next};
  } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}

export function createNotificationInbox({get, post, onRead = () => {}, summary = false, enabled = true}) {
  let state = initial(enabled), active = false, epoch = 0, controller;
  let readQueue = Promise.resolve(), refreshing, loadingMore, mutationRevision = 0, refreshAgain = false;
  const listeners = new Set(), marks = new Set();
  const emit = patch => {state = {...state, ...patch};listeners.forEach(listener => listener());};
  const current = run => active && epoch === run;
  const fetchPage = (before, signal) => get(`/notifications${before == null ? '' : `?before=${encodeURIComponent(before)}`}`, {signal});
  const enqueue = task => {
    const run = epoch;
    const result = readQueue.catch(() => {}).then(() => {if (!current(run)) throw abortError();return task(run);});
    readQueue = result;
    return result;
  };
  function refresh() {
    if (!active || !enabled) return Promise.resolve();
    if (refreshing) return refreshing;
    const run = epoch;
    emit({refreshing: true});
    refreshing = enqueue(async request => {
      const boundary = summary ? null : state.data.items.at(-1)?.id;
      let data, revision;
      do {
        refreshAgain = false;
        revision = mutationRevision;
        data = await readNotificationRange(fetchPage, boundary, controller.signal);
        if (!current(request)) return;
        if (revision === mutationRevision) emit({data, error: ''});
      } while (revision !== mutationRevision || refreshAgain);
    }).catch(error => {if (current(run) && error.name !== 'AbortError') emit({error: error.message || 'Notifications are temporarily unavailable. Please try again.'});})
      .finally(() => {if (current(run)) {refreshing = null;emit({loading: false, refreshing: false});}});
    return refreshing;
  }
  function invalidate() {
    if (refreshing) refreshAgain = true;
    return refresh();
  }
  function more() {
    if (!active || !state.data.next || summary) return Promise.resolve();
    if (loadingMore) return loadingMore;
    const run = epoch;
    emit({loadingMore: true, moreError: ''});
    loadingMore = enqueue(async request => {
      const before = state.data.next;
      if (before == null) return;
      const revision = mutationRevision, result = await readNotificationRange((_cursor,signal) => fetchPage(before,signal),null,controller.signal);
      if (current(request)) emit({data: {...result, unread: revision === mutationRevision ? result.unread : state.data.unread,
        items: unique([...result.items, ...state.data.items]).sort((a,b) => BigInt(a.id) > BigInt(b.id) ? -1 : 1)}, moreError: ''});
    }).catch(error => {if (current(run) && error.name !== 'AbortError') emit({moreError: error.message || 'Unable to load more notifications. Please try again.'});})
      .finally(() => {if (current(run)) {loadingMore = null;emit({loadingMore: false});}});
    return loadingMore;
  }
  async function mark(id) {
    const key = id == null ? 'all' : String(id);
    if (!active || marks.has(key) || marks.has('all') || key === 'all' && marks.size) return;
    const run = epoch;
    marks.add(key);emit({marking: [...marks], markError: null});
    try {
      await post('/notifications/read', id == null ? {} : {id});
      if (!current(run)) return;
      mutationRevision++;
      const now = new Date().toISOString(), wasUnread = state.data.items.some(item => String(item.id) === key && !item.read_at);
      emit({data: {...state.data, unread: id == null ? 0 : Math.max(0, state.data.unread - Number(wasUnread)),
        items: state.data.items.map(item => id == null || String(item.id) === key ? {...item, read_at: item.read_at || now} : item)}});
      onRead();
      void invalidate();
    } catch (error) {if (current(run)) emit({markError: {id, message: error.message || 'Unable to mark notifications read. Please try again.'}});}
    finally {if (current(run)) {marks.delete(key);emit({marking: [...marks]});}}
  }
  return {
    getSnapshot: () => state,
    subscribe(listener) {listeners.add(listener);return () => listeners.delete(listener);},
    start() {active = true;epoch++;controller = new AbortController();readQueue = Promise.resolve();refreshing = null;loadingMore = null;refreshAgain = false;marks.clear();emit(initial(enabled));void refresh();},
    stop() {active = false;epoch++;controller?.abort();},
    refresh, invalidate, more, mark,
  };
}
