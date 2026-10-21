import {useState,useCallback,useMemo} from 'react';
import {Link} from 'react-router-dom';
import {useBookmarks} from '../../hooks';
import {getEventStatus,normalize} from '../../utils/date';
import {scheduleSummary,nextStart} from '../../utils/event';
import EventStatusBadge from '../../components/EventStatusBadge';
import EventImage from '../../components/EventImage';
import SearchInput from '../../components/SearchInput';
import EmptyState from '../../components/EmptyState';
import Description from '../../components/Description';
import PageLayout from '../../components/PageLayout';

const BookmarkListItem=({id,eventData,bookmarkInfo,toggle,pending})=>{
  const ended=getEventStatus(eventData)==='Expired',when=scheduleSummary(eventData);
  return <article className="content-card saved-card">
    <div className="saved-artwork"><EventImage event={eventData} showDates={false} className="aspect-[4/3] w-full"/></div>
    <div className="saved-card-body">
      <div className="card-heading"><div className="min-w-0">
        <EventStatusBadge event={eventData} position="inline-block mb-2"/>
        <h2>{ended?eventData?.title:<Link to={`/?event=${id}`}>{eventData?.title||`Event ${id}`}</Link>}</h2>
      </div><button className="btn btn-ghost text-error" disabled={pending} aria-busy={pending} aria-label={`Remove ${eventData?.title||'event'} from saved events`} onClick={()=>toggle(id,false)}>{pending?'…':'✕'}</button></div>
      <p className="saved-event-time"><strong>{when.label}</strong><span>{when.text}</span></p>
      {eventData?.description&&<Description text={eventData.description}/>}
      {eventData?._row?.archived_at&&<p className="form-help mt-3">This event has ended. Its saved summary stays here after the full listing and photo are cleared.</p>}
      {eventData?._row?.location_address&&<p className="text-sm muted mt-3">{eventData._row.location_address}</p>}
      {eventData?.position&&<details className="card-coordinates"><summary>Map coordinates</summary><p>{eventData.position.lat.toFixed(4)}, {eventData.position.lng.toFixed(4)}</p></details>}
      <p className="saved-date">Saved {new Date(bookmarkInfo.updatedAt).toLocaleDateString()}</p>
    </div>
  </article>;
};

export default function BookmarksPage() {
  const {listBookmarkedEvents,toggle,isPending,loading,error,refetchBookmarks}=useBookmarks();
  const bookmarkedEvents = listBookmarkedEvents();

  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState("bookmarked-desc");
  const filteredSorted = useMemo(() => {
    // Filter by search & hideExpired
    const matches = bookmarkedEvents.filter(({ eventData }) => {
      if (!eventData) return false;

      if (!q) return true;
      const hay = [eventData.title, eventData.description, eventData?._row?.location_address]
        .map(normalize)
        .join(" ");

      return hay.includes(normalize(q));
    });

    const withFields = matches.map((row) => {
      const starts=nextStart(row.eventData)?new Date(nextStart(row.eventData)):null;
      const ends = row.eventData?._row?.ends_at ? new Date(row.eventData._row.ends_at) : null;
      return { ...row, __starts: starts, __ends: ends };
    });

    withFields.sort((a, b) => {
      switch (sortKey) {
        case "title-asc":
          return normalize(a.eventData?.title).localeCompare(normalize(b.eventData?.title));
        case "title-desc":
          return normalize(b.eventData?.title).localeCompare(normalize(a.eventData?.title));
        case "starts-asc": {
          const av = a.__starts ? a.__starts.getTime() : Number.MAX_SAFE_INTEGER;
          const bv = b.__starts ? b.__starts.getTime() : Number.MAX_SAFE_INTEGER;
          return av - bv;
        }
        case "ends-asc": {
          const av = a.__ends ? a.__ends.getTime() : Number.MAX_SAFE_INTEGER;
          const bv = b.__ends ? b.__ends.getTime() : Number.MAX_SAFE_INTEGER;
          return av - bv;
        }
        case "bookmarked-desc":
        default:
          return new Date(b.bookmarkInfo.updatedAt) - new Date(a.bookmarkInfo.updatedAt);
      }
    });

    return withFields;
  }, [bookmarkedEvents, q, sortKey]);

  const expiredCount = useMemo(
    () =>
      bookmarkedEvents.filter(({ eventData }) => getEventStatus(eventData) === "Expired").length,
    [bookmarkedEvents]
  );

  // Bulk remove expired
  const removeExpired = useCallback(async () => {
    if (!expiredCount) return;
    const ok = window.confirm(`Remove ${expiredCount} ended event(s) from your saved list?`);
    if (!ok) return;

    const tasks = bookmarkedEvents
      .filter(({ eventData }) => getEventStatus(eventData) === "Expired")
      .map(({ id }) => toggle(id, false));
    await Promise.allSettled(tasks);
  }, [bookmarkedEvents, expiredCount, toggle]);
  return <PageLayout title="Saved events" intro={loading?'Your favourite events and past plans, all in one place.':`${bookmarkedEvents.length} saved · ${expiredCount} ended. Your past plans stay here until you remove them.`}>
    <div className="page-toolbar">
      <SearchInput value={q} onChange={setQ} ariaLabel="Search saved events" placeholder="Search your saved events"/>
      <label className="sort-field"><span className="sr-only">Sort saved events</span><select className="select select-bordered" value={sortKey} onChange={event=>setSortKey(event.target.value)}>
        <option value="bookmarked-desc">Recently saved</option><option value="starts-asc">Starts soon</option><option value="ends-asc">Ends soon</option><option value="title-asc">Title A–Z</option><option value="title-desc">Title Z–A</option>
      </select></label>
      <button className="btn btn-ghost text-error" disabled={!expiredCount} onClick={removeExpired}>Remove ended</button>
    </div>
    {error&&<div role="alert" className="page-error"><p>{error}</p><button className="btn btn-outline" onClick={refetchBookmarks}>Retry</button></div>}
    {loading?<p role="status" className="content-card">Loading your saved events…</p>:error&&!bookmarkedEvents.length?null:<div className="saved-grid">
      {!filteredSorted.length?<EmptyState message={q?'No saved events match your search.':'Your next plan starts with a saved event.'}><Link to="/" className="btn btn-outline mt-4">Explore the map</Link></EmptyState>
        :filteredSorted.map(({id,eventData,bookmarkInfo})=><BookmarkListItem key={id} id={id} eventData={eventData} bookmarkInfo={bookmarkInfo} toggle={toggle} pending={isPending(id)}/>)}
    </div>}
  </PageLayout>;
}
